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
      fingerprint TEXT
    );

    CREATE TABLE comments (
      id TEXT PRIMARY KEY,
      post_id TEXT,
      content TEXT,
      ip TEXT,
      fingerprint TEXT
    );

    CREATE TABLE chat_messages (
      id INTEGER PRIMARY KEY,
      text_content TEXT,
      ip_snapshot TEXT,
      session_id TEXT,
      fingerprint_hash TEXT
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
    chatRealtime: {
      deleteMessageByAdmin: () => ({ ok: true }),
      banByAdmin: () => {},
      muteByAdmin: () => {},
    },
    resolveStoredIdentityHash: () => null,
  });

  return { db, routes: app.routes };
};

const seedPostReport = (db, { id, postId, status, createdAt }) => {
  db.prepare(`
    INSERT INTO posts (id, content, ip, session_id, fingerprint)
    VALUES (?, ?, ?, ?, ?)
  `).run(postId, `post:${postId}`, '127.0.0.1', `session-${postId}`, `fp-${postId}`);

  db.prepare(`
    INSERT INTO reports (id, post_id, comment_id, target_type, reason, content_snippet, created_at, status, risk_level, fingerprint, reporter_ip)
    VALUES (?, ?, NULL, 'post', '广告', ?, ?, ?, 'low', ?, '127.0.0.9')
  `).run(id, postId, `snippet:${id}`, createdAt, status, `reporter-${id}`);
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
