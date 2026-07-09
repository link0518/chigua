import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import Database from 'better-sqlite3';

import { registerAdminPostDeleteRequestsRoutes } from '../routes/admin/post-delete-requests-routes.js';
import { registerPublicPostsRoutes } from '../routes/public/posts-routes.js';

const createDb = () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE posts (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      author TEXT NOT NULL DEFAULT '匿名',
      tags TEXT,
      location TEXT,
      image_url TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER,
      deleted INTEGER NOT NULL DEFAULT 0,
      deleted_at INTEGER,
      hidden INTEGER NOT NULL DEFAULT 0,
      hidden_at INTEGER,
      hidden_review_status TEXT,
      rumor_status TEXT,
      rumor_status_updated_at INTEGER,
      session_id TEXT,
      ip TEXT,
      fingerprint TEXT,
      likes_count INTEGER NOT NULL DEFAULT 0,
      dislikes_count INTEGER NOT NULL DEFAULT 0,
      comments_count INTEGER NOT NULL DEFAULT 0,
      views_count INTEGER NOT NULL DEFAULT 0,
      comment_identity_enabled INTEGER NOT NULL DEFAULT 0,
      comment_identity_guest_seq INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE post_delete_requests (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      requester_fingerprint TEXT NOT NULL,
      requester_ip TEXT,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      reviewed_at INTEGER,
      reviewed_by INTEGER,
      reviewed_by_username TEXT,
      review_reason TEXT
    );

    CREATE TABLE post_reactions_fingerprint (
      post_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      reaction TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (post_id, fingerprint)
    );

    CREATE TABLE post_favorites (
      post_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (post_id, fingerprint)
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

const seedPost = (db, overrides = {}) => {
  db.prepare(`
    INSERT INTO posts (
      id, content, author, tags, created_at, deleted, hidden, session_id, ip, fingerprint,
      likes_count, dislikes_count, comments_count, views_count
    ) VALUES (?, ?, '匿名', '[]', ?, ?, ?, ?, ?, ?, 0, 0, 0, 0)
  `).run(
    overrides.id || 'post-1',
    overrides.content || '这是一条帖子',
    overrides.createdAt || 1000,
    overrides.deleted || 0,
    overrides.hidden || 0,
    overrides.sessionId || 'session-post',
    overrides.ip || '127.0.0.1',
    overrides.fingerprint || 'owner-canonical',
  );
};

const registerPublicHarness = (options = {}) => {
  const db = options.db || createDb();
  const app = createApp();
  registerPublicPostsRoutes(app, {
    db,
    hotScoreSql: '0',
    mapPostRow: (row) => ({
      id: row.id,
      content: row.content,
      createdAt: row.created_at,
      deleted: row.deleted === 1,
      viewerIsAuthor: Boolean(row.viewer_is_author),
      viewerDeleteRequestStatus: row.viewer_delete_request_status || null,
    }),
    checkBanFor: () => true,
    formatDateKey: () => '2026-07-09',
    trackDailyVisit: () => {},
    getIdentityLookupHashes: () => options.identityHashes || ['owner-canonical', 'owner-legacy'],
    getRequestIdentityContext: () => ({
      canonicalHash: options.identityHashes?.[0] || 'owner-canonical',
      legacyFingerprintHash: options.identityHashes?.[1] || '',
      lookupHashes: options.identityHashes || ['owner-canonical', 'owner-legacy'],
    }),
    startOfDay: () => 0,
    containsSensitiveWord: () => false,
    requireFingerprint: () => options.requiredFingerprint || 'owner-canonical',
    enforceRateLimit: () => true,
    getClientIp: () => '127.0.0.2',
    verifyTurnstile: async () => ({ ok: true }),
    incrementDailyStat: () => {},
    generateSnapshotForPost: () => {},
    scheduleSitemapGenerate: () => {},
    createNotification: () => {},
    trimPreview: (value) => String(value || '').slice(0, 120),
    crypto,
    getDefaultPostTags: () => [],
  });
  return { db, routes: app.routes };
};

const registerAdminHarness = (db) => {
  const app = createApp();
  const notifications = [];
  const auditLogs = [];
  registerAdminPostDeleteRequestsRoutes(app, {
    db,
    requireAdmin: (_req, _res, next) => next(),
    requireAdminCsrf: (_req, _res, next) => next(),
    requireAdminRead: (_req, _res, next) => next(),
    requireAdminManage: (_req, _res, next) => next(),
    formatRelativeTime: (value) => String(value || ''),
    logAdminAction: (_req, payload) => auditLogs.push(payload),
    createNotification: (payload) => notifications.push(payload),
    trimPreview: (value) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 120),
    resolveStoredIdentityHash: () => null,
  });
  return { routes: app.routes, notifications, auditLogs };
};

test('post author can submit delete request while post remains visible', async () => {
  const { db, routes } = registerPublicHarness();
  seedPost(db);

  const res = await runHandlers(routes.get('POST /api/posts/:id/delete-requests'), {
    params: { id: 'post-1' },
    body: { reason: '我想删除自己发布的内容' },
  });

  assert.equal(res.statusCode, 201);
  assert.equal(res.payload.item.postId, 'post-1');
  assert.equal(res.payload.item.status, 'pending');
  assert.equal(db.prepare('SELECT deleted FROM posts WHERE id = ?').get('post-1').deleted, 0);
  assert.equal(db.prepare('SELECT COUNT(1) AS count FROM post_delete_requests').get().count, 1);
  db.close();
});

test('new post creation response marks requester as author for delete request entry', async () => {
  const { db, routes } = registerPublicHarness();

  const res = await runHandlers(routes.get('POST /api/posts'), {
    body: { content: '新发布的帖子', tags: ['日常'] },
    sessionID: 'session-new',
  });

  assert.equal(res.statusCode, 201);
  assert.equal(res.payload.post.content, '新发布的帖子');
  assert.equal(res.payload.post.viewerIsAuthor, true);
  assert.equal(res.payload.post.viewerDeleteRequestStatus, null);
  assert.equal(db.prepare('SELECT COUNT(1) AS count FROM posts').get().count, 1);
  db.close();
});

test('non author cannot submit delete request', async () => {
  const { db, routes } = registerPublicHarness({
    identityHashes: ['other-canonical'],
    requiredFingerprint: 'other-canonical',
  });
  seedPost(db);

  const res = await runHandlers(routes.get('POST /api/posts/:id/delete-requests'), {
    params: { id: 'post-1' },
    body: { reason: '不是作者也想删' },
  });

  assert.equal(res.statusCode, 403);
  assert.equal(db.prepare('SELECT COUNT(1) AS count FROM post_delete_requests').get().count, 0);
  db.close();
});

test('duplicate pending delete request is rejected', async () => {
  const { db, routes } = registerPublicHarness();
  seedPost(db);
  db.prepare(`
    INSERT INTO post_delete_requests (id, post_id, requester_fingerprint, reason, status, created_at)
    VALUES ('request-existing', 'post-1', 'owner-canonical', '已有申请', 'pending', 1000)
  `).run();

  const res = await runHandlers(routes.get('POST /api/posts/:id/delete-requests'), {
    params: { id: 'post-1' },
    body: { reason: '再次申请' },
  });

  assert.equal(res.statusCode, 409);
  assert.equal(db.prepare('SELECT COUNT(1) AS count FROM post_delete_requests').get().count, 1);
  db.close();
});

test('admin can list pending delete requests and approve with soft delete notification', async () => {
  const db = createDb();
  seedPost(db);
  db.prepare(`
    INSERT INTO post_delete_requests (id, post_id, requester_fingerprint, requester_ip, reason, status, created_at)
    VALUES ('request-1', 'post-1', 'owner-canonical', '127.0.0.2', '申请删除原因', 'pending', 2000)
  `).run();
  const { routes, notifications, auditLogs } = registerAdminHarness(db);

  const listRes = await runHandlers(routes.get('GET /api/admin/post-delete-requests'), {
    query: { status: 'pending', page: '1', limit: '10' },
  });
  assert.equal(listRes.statusCode, 200);
  assert.equal(listRes.payload.total, 1);
  assert.equal(listRes.payload.items[0].reason, '申请删除原因');
  assert.equal(listRes.payload.items[0].postContent, '这是一条帖子');

  const actionRes = await runHandlers(routes.get('POST /api/admin/post-delete-requests/:id/action'), {
    params: { id: 'request-1' },
    body: { action: 'approve' },
    session: { admin: { id: 9, username: 'reviewer' } },
  });

  assert.equal(actionRes.statusCode, 200);
  assert.equal(db.prepare('SELECT status FROM post_delete_requests WHERE id = ?').get('request-1').status, 'approved');
  assert.equal(db.prepare('SELECT deleted FROM posts WHERE id = ?').get('post-1').deleted, 1);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].recipientFingerprint, 'owner-canonical');
  assert.equal(notifications[0].type, 'post_delete_request_approved');
  assert.equal(auditLogs.at(-1).action, 'post_delete_request_approve');
  db.close();
});

test('admin can reject delete request without deleting post', async () => {
  const db = createDb();
  seedPost(db);
  db.prepare(`
    INSERT INTO post_delete_requests (id, post_id, requester_fingerprint, requester_ip, reason, status, created_at)
    VALUES ('request-2', 'post-1', 'owner-canonical', '127.0.0.2', '申请删除原因', 'pending', 2000)
  `).run();
  const { routes, notifications, auditLogs } = registerAdminHarness(db);

  const res = await runHandlers(routes.get('POST /api/admin/post-delete-requests/:id/action'), {
    params: { id: 'request-2' },
    body: { action: 'reject', reason: '暂不删除' },
    session: { admin: { id: 9, username: 'reviewer' } },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(db.prepare('SELECT status, review_reason FROM post_delete_requests WHERE id = ?').get('request-2').status, 'rejected');
  assert.equal(db.prepare('SELECT deleted FROM posts WHERE id = ?').get('post-1').deleted, 0);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].type, 'post_delete_request_rejected');
  assert.equal(notifications[0].postId, 'post-1');
  assert.equal(auditLogs.at(-1).action, 'post_delete_request_reject');
  db.close();
});
