import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import {
  AUTO_HIDE_THRESHOLD,
  AUTO_HIDE_WINDOW_MS,
  HIDDEN_REVIEW_KEPT,
  HIDDEN_REVIEW_PENDING,
  createHiddenContentService,
} from '../services/hidden-content-service.js';

const createSchema = (db) => {
  db.exec(`
    CREATE TABLE posts (
      id TEXT PRIMARY KEY,
      content TEXT,
      deleted INTEGER NOT NULL DEFAULT 0,
      hidden INTEGER NOT NULL DEFAULT 0,
      hidden_at INTEGER,
      hidden_review_status TEXT,
      comments_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER
    );

    CREATE TABLE comments (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      content TEXT,
      deleted INTEGER NOT NULL DEFAULT 0,
      hidden INTEGER NOT NULL DEFAULT 0,
      hidden_at INTEGER,
      hidden_review_status TEXT,
      created_at INTEGER
    );

    CREATE TABLE reports (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      action TEXT,
      resolved_at INTEGER,
      target_type TEXT NOT NULL,
      post_id TEXT,
      comment_id TEXT,
      created_at INTEGER NOT NULL
    );
  `);
};

const createHarness = (options = {}) => {
  const db = new Database(':memory:');
  createSchema(db);
  const logs = [];
  const getAutoHideReportThreshold = typeof options.autoHideReportThreshold === 'number'
    ? () => options.autoHideReportThreshold
    : undefined;
  const service = createHiddenContentService({
    db,
    getAutoHideReportThreshold,
    logAdminAction: (_req, payload) => {
      logs.push(payload);
    },
  });
  const req = {
    session: { admin: { id: 'admin-1', username: 'root' } },
    ip: '127.0.0.1',
  };
  return { db, logs, req, service };
};

const insertPendingPostReports = (db, postId, count, createdAt) => {
  for (let index = 0; index < count; index += 1) {
    db.prepare(`
      INSERT INTO reports (id, status, action, resolved_at, target_type, post_id, comment_id, created_at)
      VALUES (?, 'pending', NULL, NULL, 'post', ?, NULL, ?)
    `).run(`post-report-${postId}-${createdAt}-${index}`, postId, createdAt + index);
  }
};

const insertPendingCommentReports = (db, commentId, postId, count, createdAt) => {
  for (let index = 0; index < count; index += 1) {
    db.prepare(`
      INSERT INTO reports (id, status, action, resolved_at, target_type, post_id, comment_id, created_at)
      VALUES (?, 'pending', NULL, NULL, 'comment', ?, ?, ?)
    `).run(`comment-report-${commentId}-${createdAt}-${index}`, postId, commentId, createdAt + index);
  }
};

test('帖子在第十条待处理举报时自动隐藏', () => {
  const { db, service } = createHarness();
  const now = 1_700_000_000_000;

  db.prepare(`
    INSERT INTO posts (id, content, deleted, hidden, comments_count, created_at)
    VALUES (?, ?, 0, 0, 0, ?)
  `).run('post-1', 'post content', now - 1000);

  insertPendingPostReports(db, 'post-1', AUTO_HIDE_THRESHOLD - 1, now - 5000);

  const beforeThreshold = service.maybeAutoHideTarget({
    targetType: 'post',
    targetId: 'post-1',
    now,
  });
  assert.deepEqual(beforeThreshold, {
    autoHidden: false,
    pendingCount: AUTO_HIDE_THRESHOLD - 1,
  });
  assert.equal(db.prepare('SELECT hidden FROM posts WHERE id = ?').get('post-1').hidden, 0);

  insertPendingPostReports(db, 'post-1', 1, now - 1000);

  const afterThreshold = service.maybeAutoHideTarget({
    targetType: 'post',
    targetId: 'post-1',
    now,
  });
  assert.deepEqual(afterThreshold, {
    autoHidden: true,
    pendingCount: AUTO_HIDE_THRESHOLD,
  });

  const row = db.prepare('SELECT hidden, hidden_at, hidden_review_status FROM posts WHERE id = ?').get('post-1');
  assert.equal(row.hidden, 1);
  assert.equal(row.hidden_at, now);
  assert.equal(row.hidden_review_status, HIDDEN_REVIEW_PENDING);

  db.close();
});

test('超过二十四小时的旧举报不会触发自动隐藏', () => {
  const { db, service } = createHarness();
  const now = 1_700_000_000_000;

  db.prepare(`
    INSERT INTO posts (id, content, deleted, hidden, comments_count, created_at)
    VALUES (?, ?, 0, 0, 0, ?)
  `).run('post-2', 'old reports post', now - 2000);

  insertPendingPostReports(db, 'post-2', AUTO_HIDE_THRESHOLD - 1, now - 10_000);
  insertPendingPostReports(db, 'post-2', 1, now - AUTO_HIDE_WINDOW_MS - 10_000);

  const result = service.maybeAutoHideTarget({
    targetType: 'post',
    targetId: 'post-2',
    now,
  });

  assert.deepEqual(result, {
    autoHidden: false,
    pendingCount: AUTO_HIDE_THRESHOLD - 1,
  });
  assert.equal(db.prepare('SELECT hidden FROM posts WHERE id = ?').get('post-2').hidden, 0);

  db.close();
});

test('评论自动隐藏会扣减评论数，恢复后补回并关闭本轮举报', () => {
  const { db, logs, req, service } = createHarness();
  const now = 1_700_000_000_000;

  db.prepare(`
    INSERT INTO posts (id, content, deleted, hidden, comments_count, created_at)
    VALUES (?, ?, 0, 0, 1, ?)
  `).run('post-3', 'post for comment', now - 5000);
  db.prepare(`
    INSERT INTO comments (id, post_id, content, deleted, hidden, created_at)
    VALUES (?, ?, ?, 0, 0, ?)
  `).run('comment-1', 'post-3', 'comment content', now - 4000);

  insertPendingCommentReports(db, 'comment-1', 'post-3', AUTO_HIDE_THRESHOLD, now - 3000);

  const hiddenResult = service.maybeAutoHideTarget({
    targetType: 'comment',
    targetId: 'comment-1',
    now,
  });
  assert.deepEqual(hiddenResult, {
    autoHidden: true,
    pendingCount: AUTO_HIDE_THRESHOLD,
  });
  assert.equal(db.prepare('SELECT hidden FROM comments WHERE id = ?').get('comment-1').hidden, 1);
  assert.equal(db.prepare('SELECT comments_count FROM posts WHERE id = ?').get('post-3').comments_count, 0);

  const restoreResult = service.handleHiddenContentAction({
    req,
    targetType: 'comment',
    targetId: 'comment-1',
    action: 'restore',
    reason: 'manual review',
    now: now + 1000,
  });

  assert.equal(restoreResult.hidden, false);
  assert.equal(restoreResult.hiddenReviewStatus, null);
  assert.equal(restoreResult.resolvedReports, AUTO_HIDE_THRESHOLD);

  const commentRow = db.prepare('SELECT hidden, hidden_at, hidden_review_status FROM comments WHERE id = ?').get('comment-1');
  assert.equal(commentRow.hidden, 0);
  assert.equal(commentRow.hidden_at, null);
  assert.equal(commentRow.hidden_review_status, null);
  assert.equal(db.prepare('SELECT comments_count FROM posts WHERE id = ?').get('post-3').comments_count, 1);

  const reportRows = db.prepare(`
    SELECT status, action, resolved_at
    FROM reports
    WHERE target_type = 'comment' AND comment_id = ?
  `).all('comment-1');
  assert.ok(reportRows.every((row) => row.status === 'resolved'));
  assert.ok(reportRows.every((row) => row.action === 'hidden_restore'));
  assert.ok(logs.some((item) => item.action === 'comment_hidden_restore'));

  db.close();
});

test('保持隐藏会标记审核状态并清空当前待处理举报', () => {
  const { db, logs, req, service } = createHarness();
  const now = 1_700_000_000_000;

  db.prepare(`
    INSERT INTO posts (id, content, deleted, hidden, hidden_at, hidden_review_status, comments_count, created_at)
    VALUES (?, ?, 0, 1, ?, ?, 0, ?)
  `).run('post-4', 'already hidden post', now - 1000, HIDDEN_REVIEW_PENDING, now - 5000);

  insertPendingPostReports(db, 'post-4', 3, now - 500);

  const result = service.handleHiddenContentAction({
    req,
    targetType: 'post',
    targetId: 'post-4',
    action: 'keep',
    reason: 'confirmed hide',
    now,
  });

  assert.equal(result.hidden, true);
  assert.equal(result.hiddenReviewStatus, HIDDEN_REVIEW_KEPT);
  assert.equal(result.resolvedReports, 3);

  const row = db.prepare('SELECT hidden, hidden_review_status FROM posts WHERE id = ?').get('post-4');
  assert.equal(row.hidden, 1);
  assert.equal(row.hidden_review_status, HIDDEN_REVIEW_KEPT);

  const reportRows = db.prepare(`
    SELECT status, action
    FROM reports
    WHERE target_type = 'post' AND post_id = ?
  `).all('post-4');
  assert.ok(reportRows.every((report) => report.status === 'resolved'));
  assert.ok(reportRows.every((report) => report.action === 'hidden_keep'));
  assert.ok(logs.some((item) => item.action === 'post_hidden_keep'));

  db.close();
});

test('custom auto hide threshold is configurable', () => {
  const threshold = 3;
  const { db, service } = createHarness({ autoHideReportThreshold: threshold });
  const now = 1_700_000_000_000;

  db.prepare(`
    INSERT INTO posts (id, content, deleted, hidden, comments_count, created_at)
    VALUES (?, ?, 0, 0, 0, ?)
  `).run('post-custom-threshold', 'post content', now - 1000);

  insertPendingPostReports(db, 'post-custom-threshold', threshold - 1, now - 5000);

  const beforeThreshold = service.maybeAutoHideTarget({
    targetType: 'post',
    targetId: 'post-custom-threshold',
    now,
  });
  assert.deepEqual(beforeThreshold, {
    autoHidden: false,
    pendingCount: threshold - 1,
  });
  assert.equal(db.prepare('SELECT hidden FROM posts WHERE id = ?').get('post-custom-threshold').hidden, 0);

  insertPendingPostReports(db, 'post-custom-threshold', 1, now - 1000);

  const afterThreshold = service.maybeAutoHideTarget({
    targetType: 'post',
    targetId: 'post-custom-threshold',
    now,
  });
  assert.deepEqual(afterThreshold, {
    autoHidden: true,
    pendingCount: threshold,
  });
  assert.equal(db.prepare('SELECT hidden FROM posts WHERE id = ?').get('post-custom-threshold').hidden, 1);

  db.close();
});
