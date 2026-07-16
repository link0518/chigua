import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { registerAdminPostFeaturesRoutes } from '../routes/admin/post-features-routes.js';

const createDb = () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE posts (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0,
      hidden INTEGER NOT NULL DEFAULT 0,
      featured INTEGER NOT NULL DEFAULT 0,
      featured_at INTEGER
    );
    CREATE TABLE post_feature_requests (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      requester_identity_key TEXT NOT NULL,
      requester_legacy_fingerprint TEXT,
      requester_ip TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      reviewed_at INTEGER,
      reviewed_by INTEGER,
      reviewed_by_username TEXT,
      review_reason TEXT,
      UNIQUE(post_id, requester_identity_key),
      UNIQUE(post_id, requester_legacy_fingerprint)
    );
  `);
  db.prepare(`
    INSERT INTO posts (id, content, created_at) VALUES
      ('post-1', '多人申请的帖子', 1000),
      ('post-2', '管理员直接加精的帖子', 1100)
  `).run();
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
    json(value) {
      payload = value;
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
      await handler(req, res, next);
    } else {
      await handler(req, res);
    }
  };
  await next();
  return res;
};

const registerHarness = (db) => {
  const app = createApp();
  const notifications = [];
  const auditLogs = [];
  registerAdminPostFeaturesRoutes(app, {
    db,
    requireAdmin: (_req, _res, next) => next(),
    requireAdminCsrf: (_req, _res, next) => next(),
    requireAdminRead: (_req, _res, next) => next(),
    requireAdminManage: (_req, _res, next) => next(),
    createNotification: (payload) => notifications.push(payload),
    logAdminAction: (_req, payload) => auditLogs.push(payload),
    formatRelativeTime: (value) => String(value),
  });
  return { routes: app.routes, notifications, auditLogs };
};

test('后台待审核列表按帖子聚合多个申请', async () => {
  const db = createDb();
  db.prepare(`
    INSERT INTO post_feature_requests (
      id,
      post_id,
      requester_identity_key,
      requester_legacy_fingerprint,
      status,
      created_at
    ) VALUES
      ('request-1', 'post-1', 'identity-1', 'legacy-1', 'pending', 1200),
      ('request-2', 'post-1', 'identity-2', 'legacy-2', 'pending', 1300)
  `).run();
  const { routes } = registerHarness(db);
  const res = await runHandlers(routes.get('GET /api/admin/post-features'), {
    query: { mode: 'pending', page: '1', limit: '10' },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.total, 1);
  assert.equal(res.payload.items[0].postId, 'post-1');
  assert.equal(res.payload.items[0].requestCount, 2);
  db.close();
});

test('审核通过会在事务中加精帖子、处理全部申请并通知申请人', async () => {
  const db = createDb();
  db.prepare(`
    INSERT INTO post_feature_requests (
      id,
      post_id,
      requester_identity_key,
      requester_legacy_fingerprint,
      status,
      created_at
    ) VALUES
      ('request-1', 'post-1', 'identity-1', 'legacy-1', 'pending', 1200),
      ('request-2', 'post-1', 'identity-2', 'legacy-2', 'pending', 1300)
  `).run();
  const { routes, notifications, auditLogs } = registerHarness(db);
  const res = await runHandlers(routes.get('POST /api/admin/post-features/:postId/action'), {
    params: { postId: 'post-1' },
    body: { action: 'approve', reason: '' },
    session: { admin: { id: 9, username: 'reviewer' } },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(db.prepare('SELECT featured FROM posts WHERE id = ?').get('post-1').featured, 1);
  assert.deepEqual(
    db.prepare('SELECT DISTINCT status FROM post_feature_requests WHERE post_id = ?').all('post-1'),
    [{ status: 'approved' }]
  );
  assert.deepEqual(notifications.map((item) => item.recipientFingerprint).sort(), ['legacy-1', 'legacy-2']);
  assert.equal(auditLogs.at(-1).action, 'post_feature_request_approve');
  db.close();
});

test('管理员可以直接加精并取消精华帖子', async () => {
  const db = createDb();
  const { routes, auditLogs } = registerHarness(db);
  const handlers = routes.get('POST /api/admin/post-features/:postId/action');
  const addRes = await runHandlers(handlers, {
    params: { postId: 'post-2' },
    body: { action: 'add', reason: '优质内容' },
    session: { admin: { id: 9, username: 'reviewer' } },
  });
  assert.equal(addRes.statusCode, 200);
  assert.equal(db.prepare('SELECT featured FROM posts WHERE id = ?').get('post-2').featured, 1);

  const removeRes = await runHandlers(handlers, {
    params: { postId: 'post-2' },
    body: { action: 'remove', reason: '内容已过时' },
    session: { admin: { id: 9, username: 'reviewer' } },
  });
  assert.equal(removeRes.statusCode, 200);
  assert.deepEqual(
    db.prepare('SELECT featured, featured_at FROM posts WHERE id = ?').get('post-2'),
    { featured: 0, featured_at: null }
  );
  assert.deepEqual(auditLogs.map((item) => item.action), ['post_feature_add', 'post_feature_remove']);
  db.close();
});
