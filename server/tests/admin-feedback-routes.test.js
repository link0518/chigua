import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import Database from 'better-sqlite3';

import { registerAdminFeedbackRoutes } from '../routes/admin/feedback-routes.js';

const createDb = () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE feedback_messages (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      email TEXT NOT NULL,
      wechat TEXT,
      qq TEXT,
      created_at INTEGER NOT NULL,
      session_id TEXT,
      ip TEXT,
      fingerprint TEXT,
      read_at INTEGER
    );

    CREATE TABLE feedback_replies (
      id TEXT PRIMARY KEY,
      feedback_id TEXT NOT NULL,
      content TEXT NOT NULL,
      admin_id INTEGER,
      admin_username TEXT,
      created_at INTEGER NOT NULL
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

const runHandlers = async (handlers, req = {}) => {
  assert.ok(Array.isArray(handlers), 'route should be registered');
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

const createHarness = () => {
  const db = createDb();
  const app = createApp();
  const notifications = [];
  const auditLogs = [];

  registerAdminFeedbackRoutes(app, {
    db,
    requireAdmin: (_req, _res, next) => next(),
    requireAdminCsrf: (_req, _res, next) => next(),
    requireAdminRead: (_req, _res, next) => next(),
    requireAdminManage: (_req, _res, next) => next(),
    logAdminAction: (_req, payload) => auditLogs.push(payload),
    resolveBanOptions: () => ({}),
    upsertBan: () => {},
    BAN_PERMISSIONS: [],
    resolveStoredIdentityHash: () => null,
    createNotification: (payload) => notifications.push(payload),
    trimPreview: (value) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 120),
    crypto,
  });

  return { db, routes: app.routes, notifications, auditLogs };
};

const seedFeedback = (db, overrides = {}) => {
  db.prepare(`
    INSERT INTO feedback_messages (id, content, email, wechat, qq, created_at, session_id, ip, fingerprint, read_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    overrides.id || 'feedback-1',
    overrides.content || '我想反馈一个问题',
    overrides.email || 'dev@example.com',
    overrides.wechat || null,
    overrides.qq || null,
    overrides.createdAt || 1000,
    overrides.sessionId || 'session-1',
    overrides.ip || '127.0.0.1',
    overrides.fingerprint ?? 'fp-user',
    overrides.readAt || null,
  );
};

test('admin feedback reply creates reply history notification and audit log', async () => {
  const { db, routes, notifications, auditLogs } = createHarness();
  seedFeedback(db);

  const res = await runHandlers(routes.get('POST /api/admin/feedback/:id/replies'), {
    params: { id: 'feedback-1' },
    body: { content: '谢谢反馈，我们已经记录。' },
    session: { admin: { id: 7, username: 'alice' } },
  });

  assert.equal(res.statusCode, 201);
  assert.equal(res.payload.item.feedbackId, 'feedback-1');
  assert.equal(res.payload.item.content, '谢谢反馈，我们已经记录。');
  assert.equal(res.payload.item.adminUsername, 'alice');

  const row = db.prepare('SELECT feedback_id, content, admin_id, admin_username FROM feedback_replies').get();
  assert.deepEqual(row, {
    feedback_id: 'feedback-1',
    content: '谢谢反馈，我们已经记录。',
    admin_id: 7,
    admin_username: 'alice',
  });

  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].recipientFingerprint, 'fp-user');
  assert.equal(notifications[0].type, 'feedback_reply');
  assert.equal(notifications[0].preview, '谢谢反馈，我们已经记录。');

  assert.equal(auditLogs.length, 1);
  assert.equal(auditLogs[0].action, 'feedback_reply');
  assert.equal(auditLogs[0].targetType, 'feedback');
  assert.equal(auditLogs[0].targetId, 'feedback-1');
  db.close();
});

test('admin feedback delete removes reply history with the message', async () => {
  const { db, routes } = createHarness();
  seedFeedback(db);
  db.prepare(`
    INSERT INTO feedback_replies (id, feedback_id, content, admin_id, admin_username, created_at)
    VALUES ('reply-1', 'feedback-1', '历史回复', 7, 'alice', 2000)
  `).run();

  const res = await runHandlers(routes.get('POST /api/admin/feedback/:id/action'), {
    params: { id: 'feedback-1' },
    body: { action: 'delete', reason: '清理无效留言' },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(db.prepare('SELECT COUNT(1) AS count FROM feedback_messages').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(1) AS count FROM feedback_replies').get().count, 0);
  db.close();
});

test('admin feedback list includes reply history in chronological order', async () => {
  const { db, routes } = createHarness();
  seedFeedback(db);
  db.prepare(`
    INSERT INTO feedback_replies (id, feedback_id, content, admin_id, admin_username, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('reply-2', 'feedback-1', '第二次回复', 8, 'bob', 3000);
  db.prepare(`
    INSERT INTO feedback_replies (id, feedback_id, content, admin_id, admin_username, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('reply-1', 'feedback-1', '第一次回复', 7, 'alice', 2000);

  const res = await runHandlers(routes.get('GET /api/admin/feedback'), {
    query: { status: 'all', page: '1', limit: '10' },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.items.length, 1);
  assert.deepEqual(
    res.payload.items[0].replies.map((item) => ({
      id: item.id,
      content: item.content,
      adminUsername: item.adminUsername,
      createdAt: item.createdAt,
    })),
    [
      { id: 'reply-1', content: '第一次回复', adminUsername: 'alice', createdAt: 2000 },
      { id: 'reply-2', content: '第二次回复', adminUsername: 'bob', createdAt: 3000 },
    ],
  );
  db.close();
});
