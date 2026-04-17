import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import Database from 'better-sqlite3';
import { registerPublicCommentsRoutes } from '../routes/public/comments-routes.js';

const createDb = () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE posts (
      id TEXT PRIMARY KEY,
      fingerprint TEXT,
      created_at INTEGER,
      deleted INTEGER DEFAULT 0,
      hidden INTEGER DEFAULT 0,
      comments_count INTEGER DEFAULT 0
    );

    CREATE TABLE comments (
      id TEXT PRIMARY KEY,
      post_id TEXT,
      parent_id TEXT,
      reply_to_id TEXT,
      content TEXT,
      author TEXT,
      created_at INTEGER,
      fingerprint TEXT,
      ip TEXT,
      deleted INTEGER DEFAULT 0,
      hidden INTEGER DEFAULT 0,
      hidden_at INTEGER,
      rumor_status TEXT,
      rumor_status_updated_at INTEGER
    );

    CREATE TABLE comment_likes (
      comment_id TEXT,
      fingerprint TEXT,
      created_at INTEGER
    );
  `);
  return db;
};

const createIdentityResolver = (mapping = {}) => (value) => {
  const normalizedValue = String(value || '').trim();
  const entry = normalizedValue ? mapping[normalizedValue] : null;
  if (!normalizedValue) {
    return { type: 'fingerprint', identityKey: '', identityHashes: [], legacyFingerprintHash: '' };
  }
  if (!entry) {
    return {
      type: 'fingerprint',
      identityKey: normalizedValue,
      identityHashes: [normalizedValue],
      legacyFingerprintHash: normalizedValue,
    };
  }
  return {
    type: entry.type || 'identity',
    identityKey: entry.identityKey || normalizedValue,
    identityHashes: entry.identityHashes || [entry.identityKey || normalizedValue],
    legacyFingerprintHash: entry.legacyFingerprintHash || '',
  };
};

const createApp = () => {
  const routes = new Map();
  return {
    get(path, handler) {
      routes.set(`GET ${path}`, handler);
    },
    post(path, handler) {
      routes.set(`POST ${path}`, handler);
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

const buildDeps = (db, notifications, options = {}) => ({
  db,
  checkBanFor: () => true,
  getIdentityLookupHashes: () => [options.actorCanonicalHash || '', options.actorLegacyHash || ''].filter(Boolean),
  getRequestIdentityContext: () => ({
    canonicalHash: options.actorCanonicalHash || '',
    legacyFingerprintHash: options.actorLegacyHash || '',
    effectiveHash: options.actorCanonicalHash || options.actorLegacyHash || '',
    lookupHashes: [options.actorCanonicalHash || '', options.actorLegacyHash || ''].filter(Boolean),
  }),
  resolveStoredIdentityHash: options.resolveStoredIdentityHash || createIdentityResolver(),
  requireFingerprint: () => options.requiredFingerprint || '',
  enforceRateLimit: () => true,
  getClientIp: () => '127.0.0.1',
  containsSensitiveWord: () => false,
  verifyTurnstile: async () => ({ ok: true }),
  createNotification: (payload) => notifications.push(payload),
  trimPreview: (value) => String(value || '').trim().slice(0, 120),
  mapCommentRow: (row) => ({
    id: row.id,
    postId: row.post_id,
    parentId: row.parent_id || null,
    replyToId: row.reply_to_id || null,
    content: row.content,
  }),
  buildCommentTree: (rows) => rows,
  crypto,
});

const registerCommentRoute = (db, notifications, options = {}) => {
  const app = createApp();
  registerPublicCommentsRoutes(app, buildDeps(db, notifications, options));
  return app.routes.get('POST /api/posts/:id/comments');
};

test('帖子作者评论自己的帖子时不会收到 post_comment 提醒', async () => {
  const db = createDb();
  const notifications = [];
  const postCreatedAt = Date.UTC(2026, 2, 7, 12, 0, 0, 0);
  db.prepare(
    'INSERT INTO posts (id, fingerprint, created_at, deleted, comments_count) VALUES (?, ?, ?, 0, 0)'
  ).run('post-1', 'canonical-owner', postCreatedAt);

  const handler = registerCommentRoute(db, notifications, {
    actorLegacyHash: 'legacy-owner',
    actorCanonicalHash: 'canonical-owner',
    requiredFingerprint: 'canonical-owner',
  });
  const req = {
    params: { id: 'post-1' },
    body: { content: '自己给自己补充一句', parentId: '', replyToId: '' },
  };
  const res = createResponse();

  await handler(req, res);

  assert.equal(res.statusCode, 201);
  assert.equal(notifications.length, 0);
  db.close();
});

test('其他用户评论帖子时仍会给帖子作者创建 post_comment 提醒', async () => {
  const db = createDb();
  const notifications = [];
  const postCreatedAt = Date.UTC(2026, 2, 7, 12, 0, 0, 0);
  db.prepare(
    'INSERT INTO posts (id, fingerprint, created_at, deleted, comments_count) VALUES (?, ?, ?, 0, 0)'
  ).run('post-2', 'canonical-owner', postCreatedAt);

  const handler = registerCommentRoute(db, notifications, {
    actorLegacyHash: 'legacy-other',
    actorCanonicalHash: 'canonical-other',
    requiredFingerprint: 'canonical-other',
  });
  const req = {
    params: { id: 'post-2' },
    body: { content: '路过评论一下', parentId: '', replyToId: '' },
  };
  const res = createResponse();

  await handler(req, res);

  assert.equal(res.statusCode, 201);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].type, 'post_comment');
  assert.equal(notifications[0].recipientFingerprint, 'canonical-owner');
  db.close();
});

test('帖子作者既是评论被回复者又是帖子作者时，不会因新旧身份并存收到两条提醒', async () => {
  const db = createDb();
  const notifications = [];
  const postCreatedAt = Date.UTC(2026, 2, 7, 12, 0, 0, 0);
  db.prepare(
    'INSERT INTO posts (id, fingerprint, created_at, deleted, comments_count) VALUES (?, ?, ?, 0, 0)'
  ).run('post-3', 'canonical-owner', postCreatedAt);
  db.prepare(
    'INSERT INTO comments (id, post_id, parent_id, reply_to_id, content, author, created_at, fingerprint, ip, deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)'
  ).run('comment-1', 'post-3', null, null, '旧评论', '匿名', postCreatedAt, 'legacy-owner', '127.0.0.1');

  const handler = registerCommentRoute(db, notifications, {
    actorLegacyHash: 'legacy-other',
    actorCanonicalHash: 'canonical-other',
    requiredFingerprint: 'canonical-other',
    resolveStoredIdentityHash: createIdentityResolver({
      'canonical-owner': {
        type: 'identity',
        identityKey: 'canonical-owner',
        identityHashes: ['canonical-owner', 'legacy-owner'],
        legacyFingerprintHash: 'legacy-owner',
      },
      'legacy-owner': {
        type: 'identity',
        identityKey: 'canonical-owner',
        identityHashes: ['canonical-owner', 'legacy-owner'],
        legacyFingerprintHash: 'legacy-owner',
      },
    }),
  });
  const req = {
    params: { id: 'post-3' },
    body: { content: '回复一下', parentId: 'comment-1', replyToId: 'comment-1' },
  };
  const res = createResponse();

  await handler(req, res);

  assert.equal(res.statusCode, 201);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].type, 'comment_reply');
  assert.equal(notifications[0].recipientFingerprint, 'legacy-owner');
  db.close();
});
