import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { registerAdminRumorsRoutes } from '../routes/admin/rumors-routes.js';

const createDb = () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE reports (
      id TEXT PRIMARY KEY,
      post_id TEXT,
      comment_id TEXT,
      target_type TEXT NOT NULL,
      reason TEXT,
      reason_code TEXT,
      evidence TEXT,
      content_snippet TEXT,
      created_at INTEGER NOT NULL,
      status TEXT NOT NULL,
      risk_level TEXT,
      fingerprint TEXT,
      reporter_ip TEXT,
      action TEXT,
      resolved_at INTEGER
    );

    CREATE TABLE posts (
      id TEXT PRIMARY KEY,
      content TEXT,
      ip TEXT,
      session_id TEXT,
      fingerprint TEXT,
      rumor_status TEXT,
      rumor_status_updated_at INTEGER
    );

    CREATE TABLE comments (
      id TEXT PRIMARY KEY,
      post_id TEXT,
      content TEXT,
      ip TEXT,
      fingerprint TEXT,
      rumor_status TEXT,
      rumor_status_updated_at INTEGER
    );
  `);
  return db;
};

const createApp = () => {
  const routes = new Map();
  return {
    get(path, ...handlers) {
      routes.set(`GET ${path}`, handlers);
    },
    post(path, ...handlers) {
      routes.set(`POST ${path}`, handlers);
    },
    routes,
  };
};

const createResponse = () => {
  let statusCode = 200;
  let payload;
  return {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      payload = data;
      return this;
    },
    get statusCode() {
      return statusCode;
    },
    get payload() {
      return payload;
    },
  };
};

const runHandlers = async (handlers, req) => {
  const res = createResponse();
  let index = -1;
  const next = async () => {
    index += 1;
    const handler = handlers[index];
    if (!handler) {
      return;
    }
    if (handler.length >= 3) {
      return handler(req, res, next);
    }
    return handler(req, res);
  };
  await next();
  return res;
};

const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

const createHarness = ({ createNotification } = {}) => {
  const db = createDb();
  const app = createApp();
  const notifications = [];

  registerAdminRumorsRoutes(app, {
    db,
    requireAdmin: (_req, _res, next) => next(),
    requireAdminCsrf: (_req, _res, next) => next(),
    logAdminAction: () => {},
    resolveStoredIdentityHash: () => null,
    createNotification: createNotification || ((payload) => {
      notifications.push(payload);
    }),
  });

  return { db, routes: app.routes, notifications };
};

test('admin rumors groups pending rumor reports by target', async () => {
  const { db, routes } = createHarness();
  db.prepare(`
    INSERT INTO posts (id, content, ip, session_id, fingerprint, rumor_status, rumor_status_updated_at)
    VALUES ('post-1', '帖子内容', '127.0.0.1', 'session-1', 'fp-post-1', NULL, NULL)
  `).run();
  db.prepare(`
    INSERT INTO reports (id, post_id, comment_id, target_type, reason, reason_code, evidence, content_snippet, created_at, status, risk_level, fingerprint, reporter_ip)
    VALUES
      ('report-1', 'post-1', NULL, 'post', '举报谣言', 'rumor', '截图与公告时间不一致', 'snippet-1', 1000, 'pending', 'medium', 'user-a', '127.0.0.2'),
      ('report-2', 'post-1', NULL, 'post', '举报谣言', 'rumor', '没有可信来源', 'snippet-2', 2000, 'pending', 'medium', 'user-b', '127.0.0.3')
  `).run();

  const res = await runHandlers(routes.get('GET /api/admin/rumors'), {
    query: { status: 'pending', page: '1', limit: '10' },
  });
  await flushAsync();

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.total, 1);
  assert.equal(res.payload.items[0].targetId, 'post-1');
  assert.equal(res.payload.items[0].pendingReportCount, 2);
  assert.equal(res.payload.items[0].reportCount, 2);
  assert.equal(res.payload.items[0].evidenceSamples.length, 2);

  db.close();
});

test('admin rumors mark notifies all pending reporters and resolves only pending rumor reports', async () => {
  const { db, routes, notifications } = createHarness();
  db.prepare(`
    INSERT INTO posts (id, content, ip, session_id, fingerprint, rumor_status, rumor_status_updated_at)
    VALUES ('post-2', '这是被举报的帖子摘要', '127.0.0.1', 'session-2', 'fp-post-2', NULL, NULL)
  `).run();
  db.prepare(`
    INSERT INTO reports (id, post_id, comment_id, target_type, reason, reason_code, evidence, content_snippet, created_at, status, risk_level, fingerprint, reporter_ip, action)
    VALUES
      ('report-3', 'post-2', NULL, 'post', '举报谣言', 'rumor', '证据 A', '帖子摘要 A', 3000, 'pending', 'medium', 'user-c', '127.0.0.4', NULL),
      ('report-4', 'post-2', NULL, 'post', '举报谣言', 'rumor', '证据 B', '帖子摘要 B', 4000, 'pending', 'medium', 'user-d', '127.0.0.5', NULL),
      ('report-5', 'post-2', NULL, 'post', '举报谣言', 'rumor', '旧证据', '旧摘要', 2000, 'resolved', 'medium', 'user-old', '127.0.0.6', 'rumor_marked')
  `).run();

  const res = await runHandlers(routes.get('POST /api/admin/rumors/:targetType/:targetId/action'), {
    params: { targetType: 'post', targetId: 'post-2' },
    body: { action: 'mark', reason: '管理员判定成立' },
  });
  await flushAsync();

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.rumorStatus, 'suspected');
  assert.equal(res.payload.resolvedCount, 2);
  assert.equal(res.payload.notifiedCount, 2);

  const post = db.prepare('SELECT rumor_status FROM posts WHERE id = ?').get('post-2');
  assert.equal(post.rumor_status, 'suspected');

  const reports = db.prepare('SELECT id, status, action FROM reports WHERE post_id = ? ORDER BY id').all('post-2');
  assert.deepEqual(
    reports.map((item) => ({ id: item.id, status: item.status, action: item.action })),
    [
      { id: 'report-3', status: 'resolved', action: 'rumor_marked' },
      { id: 'report-4', status: 'resolved', action: 'rumor_marked' },
      { id: 'report-5', status: 'resolved', action: 'rumor_marked' },
    ]
  );

  assert.deepEqual(
    notifications.map((item) => ({
      recipientFingerprint: item.recipientFingerprint,
      type: item.type,
      postId: item.postId,
      commentId: item.commentId,
      preview: item.preview,
    })),
    [
      {
        recipientFingerprint: 'user-d',
        type: 'rumor_marked',
        postId: 'post-2',
        commentId: null,
        preview: '帖子摘要 B',
      },
      {
        recipientFingerprint: 'user-c',
        type: 'rumor_marked',
        postId: 'post-2',
        commentId: null,
        preview: '帖子摘要 B',
      },
    ]
  );

  db.close();
});

test('admin rumors reject requires a reason', async () => {
  const { db, routes, notifications } = createHarness();
  db.prepare(`
    INSERT INTO posts (id, content, ip, session_id, fingerprint, rumor_status, rumor_status_updated_at)
    VALUES ('post-3', '帖子内容', '127.0.0.1', 'session-3', 'fp-post-3', NULL, NULL)
  `).run();

  const res = await runHandlers(routes.get('POST /api/admin/rumors/:targetType/:targetId/action'), {
    params: { targetType: 'post', targetId: 'post-3' },
    body: { action: 'reject', reason: '   ' },
  });
  await flushAsync();

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.error, '请输入驳回理由');
  assert.equal(notifications.length, 0);

  db.close();
});

test('admin rumors rolls back status update when notification creation fails', async () => {
  const { db, routes } = createHarness({
    createNotification: () => {
      throw new Error('notification insert failed');
    },
  });
  db.prepare(`
    INSERT INTO posts (id, content, ip, session_id, fingerprint, rumor_status, rumor_status_updated_at)
    VALUES ('post-rollback', 'ÐèÒª»Ø¹öµÄÌû×Ó', '127.0.0.1', 'session-rollback', 'fp-post-rollback', NULL, NULL)
  `).run();
  db.prepare(`
    INSERT INTO reports (id, post_id, comment_id, target_type, reason, reason_code, evidence, content_snippet, created_at, status, risk_level, fingerprint, reporter_ip)
    VALUES ('report-rollback', 'post-rollback', NULL, 'post', '¾Ù±¨Ò¥ÑÔ', 'rumor', 'Ö¤¾Ý', '»Ø¹öÕªÒª', 4500, 'pending', 'medium', 'user-rollback', '127.0.0.10')
  `).run();

  await assert.rejects(
    () => runHandlers(routes.get('POST /api/admin/rumors/:targetType/:targetId/action'), {
      params: { targetType: 'post', targetId: 'post-rollback' },
      body: { action: 'mark', reason: '¹ÜÀíÔ±ÅÐ¶¨³ÉÁ¢' },
    }),
    /notification insert failed/
  );
  await flushAsync();

  const post = db.prepare('SELECT rumor_status, rumor_status_updated_at FROM posts WHERE id = ?').get('post-rollback');
  assert.equal(post.rumor_status, null);
  assert.equal(post.rumor_status_updated_at, null);

  const report = db.prepare('SELECT status, action, resolved_at FROM reports WHERE id = ?').get('report-rollback');
  assert.equal(report.status, 'pending');
  assert.equal(report.action, null);
  assert.equal(report.resolved_at, null);

  db.close();
});

test('admin rumors reject notifies all pending reporters with rejection reason', async () => {
  const { db, routes, notifications } = createHarness();
  db.prepare(`
    INSERT INTO comments (id, post_id, content, ip, fingerprint, rumor_status, rumor_status_updated_at)
    VALUES ('comment-1', 'post-9', '评论内容', '127.0.0.1', 'fp-comment-1', NULL, NULL)
  `).run();
  db.prepare(`
    INSERT INTO reports (id, post_id, comment_id, target_type, reason, reason_code, evidence, content_snippet, created_at, status, risk_level, fingerprint, reporter_ip)
    VALUES
      ('report-6', 'post-9', 'comment-1', 'comment', '举报谣言', 'rumor', '证据 1', '评论摘要 1', 5000, 'pending', 'medium', 'user-e', '127.0.0.7'),
      ('report-7', 'post-9', 'comment-1', 'comment', '举报谣言', 'rumor', '证据 2', '评论摘要 2', 6000, 'pending', 'medium', 'user-f', '127.0.0.8')
  `).run();

  const res = await runHandlers(routes.get('POST /api/admin/rumors/:targetType/:targetId/action'), {
    params: { targetType: 'comment', targetId: 'comment-1' },
    body: { action: 'reject', reason: '证据不足，暂不采纳' },
  });
  await flushAsync();

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.rumorStatus, 'rejected');
  assert.equal(res.payload.resolvedCount, 2);
  assert.equal(res.payload.notifiedCount, 2);

  const comment = db.prepare('SELECT rumor_status FROM comments WHERE id = ?').get('comment-1');
  assert.equal(comment.rumor_status, 'rejected');

  const reports = db.prepare('SELECT status, action FROM reports WHERE comment_id = ? ORDER BY id').all('comment-1');
  assert.deepEqual(reports, [
    { status: 'resolved', action: 'rumor_rejected' },
    { status: 'resolved', action: 'rumor_rejected' },
  ]);

  assert.deepEqual(
    notifications.map((item) => ({
      recipientFingerprint: item.recipientFingerprint,
      type: item.type,
      postId: item.postId,
      commentId: item.commentId,
      preview: item.preview,
    })),
    [
      {
        recipientFingerprint: 'user-f',
        type: 'rumor_rejected',
        postId: 'post-9',
        commentId: 'comment-1',
        preview: '驳回理由：证据不足，暂不采纳',
      },
      {
        recipientFingerprint: 'user-e',
        type: 'rumor_rejected',
        postId: 'post-9',
        commentId: 'comment-1',
        preview: '驳回理由：证据不足，暂不采纳',
      },
    ]
  );

  db.close();
});

test('admin rumors clear keeps pending reports untouched and sends no notification', async () => {
  const { db, routes, notifications } = createHarness();
  db.prepare(`
    INSERT INTO comments (id, post_id, content, ip, fingerprint, rumor_status, rumor_status_updated_at)
    VALUES ('comment-2', 'post-10', '评论内容', '127.0.0.1', 'fp-comment-2', 'suspected', 1000)
  `).run();
  db.prepare(`
    INSERT INTO reports (id, post_id, comment_id, target_type, reason, reason_code, evidence, content_snippet, created_at, status, risk_level, fingerprint, reporter_ip)
    VALUES ('report-8', 'post-10', 'comment-2', 'comment', '举报谣言', 'rumor', '证据', '评论摘要', 7000, 'pending', 'medium', 'user-g', '127.0.0.9')
  `).run();

  const res = await runHandlers(routes.get('POST /api/admin/rumors/:targetType/:targetId/action'), {
    params: { targetType: 'comment', targetId: 'comment-2' },
    body: { action: 'clear', reason: '误判撤回' },
  });
  await flushAsync();

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.rumorStatus, null);
  assert.equal(res.payload.resolvedCount, 0);
  assert.equal(res.payload.notifiedCount, 0);

  const comment = db.prepare('SELECT rumor_status FROM comments WHERE id = ?').get('comment-2');
  assert.equal(comment.rumor_status, null);

  const report = db.prepare('SELECT status, action FROM reports WHERE id = ?').get('report-8');
  assert.equal(report.status, 'pending');
  assert.equal(report.action, null);
  assert.equal(notifications.length, 0);

  db.close();
});
