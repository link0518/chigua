import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { registerAdminReportsRoutes } from '../routes/admin/reports-routes.js';

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
      reporter_ip TEXT
    );

    CREATE TABLE posts (
      id TEXT PRIMARY KEY,
      content TEXT,
      ip TEXT,
      session_id TEXT,
      fingerprint TEXT,
      deleted INTEGER NOT NULL DEFAULT 0,
      hidden INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE comments (
      id TEXT PRIMARY KEY,
      post_id TEXT,
      content TEXT,
      ip TEXT,
      fingerprint TEXT,
      deleted INTEGER NOT NULL DEFAULT 0,
      hidden INTEGER NOT NULL DEFAULT 0
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

const createHarness = () => {
  const db = createDb();
  const app = createApp();

  registerAdminReportsRoutes(app, {
    db,
    requireAdmin: (_req, _res, next) => next(),
    requireAdminCsrf: (_req, _res, next) => next(),
    formatRelativeTime: (value) => String(value || ''),
    logAdminAction: () => {},
    resolveBanOptions: () => ({}),
    upsertBan: () => {},
    BAN_PERMISSIONS: {},
  });

  return { db, routes: app.routes };
};

const seedPostReport = (db, { id, postId, status, createdAt, reason = '垃圾广告', reasonCode = null }) => {
  db.prepare(`
    INSERT INTO posts (id, content, ip, session_id, fingerprint)
    VALUES (?, ?, ?, ?, ?)
  `).run(postId, `post:${postId}`, '127.0.0.1', `session-${postId}`, `fp-${postId}`);

  db.prepare(`
    INSERT INTO reports (id, post_id, comment_id, target_type, reason, reason_code, evidence, content_snippet, created_at, status, risk_level, fingerprint, reporter_ip)
    VALUES (?, ?, NULL, 'post', ?, ?, NULL, ?, ?, ?, 'low', ?, '127.0.0.9')
  `).run(id, postId, reason, reasonCode, `snippet:${id}`, createdAt, status, `reporter-${id}`);
};

test('admin reports supports pending preview limit with total count', async () => {
  const { db, routes } = createHarness();
  seedPostReport(db, { id: 'report-1', postId: 'post-1', status: 'pending', createdAt: 1000 });
  seedPostReport(db, { id: 'report-2', postId: 'post-2', status: 'pending', createdAt: 2000 });
  seedPostReport(db, { id: 'report-3', postId: 'post-3', status: 'pending', createdAt: 3000 });
  seedPostReport(db, { id: 'report-4', postId: 'post-4', status: 'resolved', createdAt: 4000 });

  const res = await runHandlers(routes.get('GET /api/reports'), {
    query: { status: 'pending', limit: '2' },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.total, 3);
  assert.equal(res.payload.items.length, 2);
  assert.deepEqual(res.payload.items.map((item) => item.id), ['report-3', 'report-2']);

  db.close();
});

test('admin reports pending list excludes deleted, hidden or unavailable targets', async () => {
  const { db, routes } = createHarness();
  seedPostReport(db, { id: 'report-active', postId: 'post-active', status: 'pending', createdAt: 1000 });
  seedPostReport(db, { id: 'report-deleted', postId: 'post-deleted', status: 'pending', createdAt: 2000 });
  seedPostReport(db, { id: 'report-hidden', postId: 'post-hidden', status: 'pending', createdAt: 2500 });
  db.prepare('UPDATE posts SET deleted = 1 WHERE id = ?').run('post-deleted');
  db.prepare('UPDATE posts SET hidden = 1 WHERE id = ?').run('post-hidden');
  db.prepare(`
    INSERT INTO posts (id, content, deleted, hidden)
    VALUES ('post-comment-active', 'comment parent', 0, 0)
  `).run();
  db.prepare(`
    INSERT INTO comments (id, post_id, content, deleted, hidden)
    VALUES ('comment-hidden', 'post-comment-active', 'hidden comment', 0, 1)
  `).run();
  db.prepare(`
    INSERT INTO reports (id, post_id, comment_id, target_type, reason, content_snippet, created_at, status, risk_level)
    VALUES ('report-comment-hidden', 'post-comment-active', 'comment-hidden', 'comment', '垃圾广告', 'hidden comment', 2750, 'pending', 'low')
  `).run();
  db.prepare(`
    INSERT INTO reports (id, post_id, comment_id, target_type, reason, content_snippet, created_at, status, risk_level)
    VALUES ('report-missing', 'post-missing', NULL, 'post', '垃圾广告', 'missing', 3000, 'pending', 'low')
  `).run();

  const res = await runHandlers(routes.get('GET /api/reports'), {
    query: { status: 'pending' },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.total, 1);
  assert.deepEqual(res.payload.items.map((item) => item.id), ['report-active']);

  db.close();
});

test('admin report action rejects an already processed report', async () => {
  const { db, routes } = createHarness();
  seedPostReport(db, { id: 'report-processed', postId: 'post-processed', status: 'resolved', createdAt: 1000 });

  const res = await runHandlers(routes.get('POST /api/reports/:id/action'), {
    params: { id: 'report-processed' },
    body: { action: 'delete', reason: '重复请求' },
  });

  assert.equal(res.statusCode, 409);
  assert.equal(res.payload.error, '举报已处理');
  assert.equal(db.prepare('SELECT deleted FROM posts WHERE id = ?').get('post-processed').deleted, 0);

  db.close();
});

test('admin reports excludes rumor reports by default', async () => {
  const { db, routes } = createHarness();
  seedPostReport(db, { id: 'report-normal', postId: 'post-normal', status: 'pending', createdAt: 1000 });
  seedPostReport(db, {
    id: 'report-rumor',
    postId: 'post-rumor',
    status: 'pending',
    createdAt: 2000,
    reason: '举报谣言',
    reasonCode: 'rumor',
  });

  const res = await runHandlers(routes.get('GET /api/reports'), {
    query: { status: 'pending' },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.total, 1);
  assert.deepEqual(res.payload.items.map((item) => item.id), ['report-normal']);

  db.close();
});

test('admin reports also excludes legacy rumor reports without reason_code', async () => {
  const { db, routes } = createHarness();
  seedPostReport(db, { id: 'report-normal', postId: 'post-normal-legacy', status: 'pending', createdAt: 1000 });
  seedPostReport(db, {
    id: 'report-rumor-legacy',
    postId: 'post-rumor-legacy',
    status: 'pending',
    createdAt: 2000,
    reason: '举报谣言',
    reasonCode: null,
  });

  const res = await runHandlers(routes.get('GET /api/reports'), {
    query: { status: 'pending' },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.total, 1);
  assert.deepEqual(res.payload.items.map((item) => item.id), ['report-normal']);

  db.close();
});
