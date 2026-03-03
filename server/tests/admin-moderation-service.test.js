import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createModerationRepository } from '../repositories/moderation-repository.js';
import { createAdminModerationService } from '../services/admin-moderation-service.js';

const BAN_PERMISSIONS = ['post', 'comment', 'like', 'view', 'site'];

const createSchema = (db) => {
  db.exec(`
    CREATE TABLE posts (
      id TEXT PRIMARY KEY,
      content TEXT,
      deleted INTEGER DEFAULT 0,
      deleted_at INTEGER,
      session_id TEXT,
      ip TEXT,
      fingerprint TEXT,
      comments_count INTEGER DEFAULT 0
    );

    CREATE TABLE comments (
      id TEXT PRIMARY KEY,
      post_id TEXT,
      content TEXT,
      deleted INTEGER DEFAULT 0,
      deleted_at INTEGER,
      ip TEXT,
      fingerprint TEXT
    );

    CREATE TABLE reports (
      id TEXT PRIMARY KEY,
      status TEXT,
      action TEXT,
      resolved_at INTEGER,
      target_type TEXT,
      post_id TEXT,
      comment_id TEXT
    );

    CREATE TABLE banned_ips (
      ip TEXT PRIMARY KEY,
      banned_at INTEGER,
      expires_at INTEGER,
      permissions TEXT,
      reason TEXT
    );

    CREATE TABLE banned_fingerprints (
      fingerprint TEXT PRIMARY KEY,
      banned_at INTEGER,
      expires_at INTEGER,
      permissions TEXT,
      reason TEXT
    );
  `);
};

const createUpsertBan = (db) => (table, _column, value, options = {}) => {
  const now = Date.now();
  const expiresAt = options.expiresAt || null;
  const permissions = Array.isArray(options.permissions) && options.permissions.length
    ? options.permissions
    : BAN_PERMISSIONS;
  const reason = options.reason || null;

  if (table === 'banned_ips') {
    db.prepare(
      `
      INSERT INTO banned_ips (ip, banned_at, expires_at, permissions, reason)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(ip) DO UPDATE SET
        banned_at = excluded.banned_at,
        expires_at = excluded.expires_at,
        permissions = excluded.permissions,
        reason = excluded.reason
      `
    ).run(value, now, expiresAt, JSON.stringify(permissions), reason);
    return;
  }

  if (table === 'banned_fingerprints') {
    db.prepare(
      `
      INSERT INTO banned_fingerprints (fingerprint, banned_at, expires_at, permissions, reason)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(fingerprint) DO UPDATE SET
        banned_at = excluded.banned_at,
        expires_at = excluded.expires_at,
        permissions = excluded.permissions,
        reason = excluded.reason
      `
    ).run(value, now, expiresAt, JSON.stringify(permissions), reason);
    return;
  }

  throw new Error(`unsupported table: ${table}`);
};

const createHarness = () => {
  const db = new Database(':memory:');
  createSchema(db);

  const logs = [];
  const repository = createModerationRepository(db);
  const service = createAdminModerationService({
    repository,
    upsertBan: createUpsertBan(db),
    BAN_PERMISSIONS,
    logAdminAction: (_req, payload) => {
      logs.push(payload);
    },
  });

  const req = {
    sessionID: 'session-1',
    session: { admin: { id: 'admin-1', username: 'root' } },
    ip: '127.0.0.1',
  };

  return { db, logs, service, req };
};

test('帖子批量封禁会按去重后的 IP/指纹执行封禁', () => {
  const { db, service, logs, req } = createHarness();

  db.prepare('INSERT INTO posts (id, content, deleted, ip, fingerprint) VALUES (?, ?, 0, ?, ?)')
    .run('post-1', 'a', '10.0.0.1', 'fp-1');
  db.prepare('INSERT INTO posts (id, content, deleted, ip, fingerprint) VALUES (?, ?, 0, ?, ?)')
    .run('post-2', 'b', '10.0.0.1', 'fp-2');

  const result = service.executePostBatchAction({
    req,
    action: 'ban',
    ids: ['post-1', 'post-2'],
    reason: 'spam',
    banOptions: { permissions: ['comment'], expiresAt: 2000000000000 },
    now: 1700000000000,
  });

  assert.deepEqual(result, { updated: 2, ips: 1, fingerprints: 2 });
  assert.equal(db.prepare('SELECT COUNT(1) AS count FROM banned_ips').get().count, 1);
  assert.equal(db.prepare('SELECT COUNT(1) AS count FROM banned_fingerprints').get().count, 2);
  assert.ok(logs.some((item) => item.action === 'post_batch_ban'));

  db.close();
});

test('举报处置 ban 会删除评论、回收计数并封禁目标', () => {
  const { db, service, logs, req } = createHarness();

  db.prepare('INSERT INTO posts (id, content, deleted, comments_count, ip, fingerprint) VALUES (?, ?, 0, ?, ?, ?)')
    .run('post-1', 'post', 1, '10.0.0.2', 'post-fp');
  db.prepare('INSERT INTO comments (id, post_id, content, deleted, ip, fingerprint) VALUES (?, ?, ?, 0, ?, ?)')
    .run('comment-1', 'post-1', 'comment', '10.0.0.3', 'comment-fp');
  db.prepare('INSERT INTO reports (id, status, action, target_type, post_id, comment_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run('report-1', 'pending', null, 'comment', 'post-1', 'comment-1');

  const result = service.executeReportAction({
    req,
    reportId: 'report-1',
    action: 'ban',
    reason: 'abuse',
    banOptions: { permissions: ['comment'], expiresAt: 2000000000000 },
    now: 1700000000000,
  });

  assert.deepEqual(result, { status: 'resolved', action: 'ban' });
  assert.equal(
    db.prepare('SELECT status FROM reports WHERE id = ?').get('report-1').status,
    'resolved'
  );
  assert.equal(
    db.prepare('SELECT deleted FROM comments WHERE id = ?').get('comment-1').deleted,
    1
  );
  assert.equal(
    db.prepare('SELECT comments_count FROM posts WHERE id = ?').get('post-1').comments_count,
    0
  );
  assert.equal(db.prepare('SELECT COUNT(1) AS count FROM banned_ips').get().count, 1);
  assert.equal(db.prepare('SELECT COUNT(1) AS count FROM banned_fingerprints').get().count, 1);
  assert.ok(logs.some((item) => item.action === 'report_ban'));
  assert.ok(logs.some((item) => item.action === 'ban_ip'));
  assert.ok(logs.some((item) => item.action === 'ban_fingerprint'));

  db.close();
});

test('封禁解封动作会写入对应封禁表', () => {
  const { db, service, logs, req } = createHarness();

  db.prepare('INSERT INTO banned_ips (ip, banned_at, expires_at, permissions, reason) VALUES (?, ?, ?, ?, ?)')
    .run('10.0.0.8', 1700000000000, null, JSON.stringify(BAN_PERMISSIONS), 'seed');

  const unbanResult = service.executeBanAction({
    req,
    action: 'unban',
    type: 'ip',
    value: '10.0.0.8',
    reason: 'manual',
    banOptions: null,
  });
  assert.deepEqual(unbanResult, { ok: true });
  assert.equal(
    db.prepare('SELECT COUNT(1) AS count FROM banned_ips WHERE ip = ?').get('10.0.0.8').count,
    0
  );

  const banResult = service.executeBanAction({
    req,
    action: 'ban',
    type: 'fingerprint',
    value: 'fp-100',
    reason: 'manual',
    banOptions: { permissions: ['view'], expiresAt: 2000000000000 },
  });
  assert.deepEqual(banResult, { ok: true });

  const fpRow = db.prepare('SELECT permissions FROM banned_fingerprints WHERE fingerprint = ?').get('fp-100');
  assert.ok(fpRow);
  assert.deepEqual(JSON.parse(fpRow.permissions), ['view']);
  assert.ok(logs.some((item) => item.action === 'unban_ip'));
  assert.ok(logs.some((item) => item.action === 'ban_fingerprint'));

  db.close();
});

test('举报批量处置只更新 pending 记录', () => {
  const { db, service, logs, req } = createHarness();

  db.prepare('INSERT INTO reports (id, status, action, target_type, post_id, comment_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run('report-1', 'pending', null, 'post', 'post-1', null);
  db.prepare('INSERT INTO reports (id, status, action, target_type, post_id, comment_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run('report-2', 'pending', null, 'post', 'post-2', null);
  db.prepare('INSERT INTO reports (id, status, action, target_type, post_id, comment_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run('report-3', 'resolved', 'reviewed', 'post', 'post-3', null);

  const result = service.executeReportBatchResolve({
    req,
    ids: ['report-1', 'report-2', 'report-3'],
    reason: 'batch',
    now: 1700000000000,
  });

  assert.deepEqual(result, { updated: 2 });
  assert.equal(db.prepare('SELECT status FROM reports WHERE id = ?').get('report-1').status, 'resolved');
  assert.equal(db.prepare('SELECT status FROM reports WHERE id = ?').get('report-2').status, 'resolved');
  assert.equal(db.prepare('SELECT status FROM reports WHERE id = ?').get('report-3').status, 'resolved');
  assert.equal(logs.filter((item) => item.action === 'report_resolve').length, 2);

  db.close();
});
