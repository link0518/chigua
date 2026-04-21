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
      comments_count INTEGER DEFAULT 0,
      comment_identity_enabled INTEGER DEFAULT 0,
      comment_identity_guest_seq INTEGER DEFAULT 0
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
      rumor_status_updated_at INTEGER,
      post_identity_key TEXT,
      post_identity_label TEXT,
      post_identity_role TEXT
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

const mapCommentRowForTest = (row) => {
  const postIdentityRole = row.post_identity_role === 'op'
    ? 'op'
    : row.post_identity_role === 'guest'
      ? 'guest'
      : null;
  const postIdentityKey = String(row.post_identity_key || '').trim();
  const postIdentityLabel = String(row.post_identity_label || '').trim();

  return {
    id: row.id,
    postId: row.post_id,
    parentId: row.parent_id || null,
    replyToId: row.reply_to_id || null,
    postIdentity: postIdentityKey && postIdentityLabel && postIdentityRole
      ? {
        key: postIdentityKey,
        label: postIdentityLabel,
        role: postIdentityRole,
      }
      : null,
    content: row.content,
    author: row.author || '匿名',
    timestamp: String(row.created_at || ''),
    createdAt: row.created_at || 0,
    replies: [],
    deleted: row.deleted === 1,
    hidden: row.hidden === 1,
    likes: Number(row.likes_count || 0),
    viewerLiked: Boolean(row.viewer_liked),
  };
};

const buildCommentTreeForTest = (rows) => {
  const nodes = new Map();
  rows.forEach((row) => {
    const node = { ...mapCommentRowForTest(row), replies: [] };
    nodes.set(node.id, node);
  });

  nodes.forEach((node) => {
    if (!node.parentId) {
      return;
    }
    const parent = nodes.get(node.parentId);
    if (parent?.parentId) {
      node.parentId = parent.parentId;
    }
  });

  const roots = [];
  nodes.forEach((node) => {
    if (node.parentId && nodes.has(node.parentId)) {
      nodes.get(node.parentId).replies.push(node);
    } else {
      roots.push(node);
    }
  });

  const sortTree = (items) => {
    items.sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0));
    items.forEach((item) => {
      if (item.replies?.length) {
        sortTree(item.replies);
      }
    });
  };

  sortTree(roots);
  return roots;
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
  mapCommentRow: mapCommentRowForTest,
  buildCommentTree: buildCommentTreeForTest,
  crypto,
});

const registerRoute = (method, path, db, notifications, options = {}) => {
  const app = createApp();
  registerPublicCommentsRoutes(app, buildDeps(db, notifications, options));
  return app.routes.get(`${method} ${path}`);
};

const registerCommentRoute = (db, notifications, options = {}) => (
  registerRoute('POST', '/api/posts/:id/comments', db, notifications, options)
);

const registerGetCommentsRoute = (db, notifications, options = {}) => (
  registerRoute('GET', '/api/posts/:id/comments', db, notifications, options)
);

const registerGetCommentThreadRoute = (db, notifications, options = {}) => (
  registerRoute('GET', '/api/posts/:id/comment-thread', db, notifications, options)
);

const insertPost = (db, {
  id,
  fingerprint,
  createdAt,
  commentIdentityEnabled = 0,
  commentIdentityGuestSeq = 0,
}) => {
  db.prepare(
    `
      INSERT INTO posts (
        id,
        fingerprint,
        created_at,
        deleted,
        hidden,
        comments_count,
        comment_identity_enabled,
        comment_identity_guest_seq
      ) VALUES (?, ?, ?, 0, 0, 0, ?, ?)
    `
  ).run(id, fingerprint, createdAt, commentIdentityEnabled, commentIdentityGuestSeq);
};

test('新帖下楼主评论自己的帖子时不会收到 post_comment 提醒，并写入楼主身份', async () => {
  const db = createDb();
  const notifications = [];
  const postCreatedAt = Date.UTC(2026, 2, 7, 12, 0, 0, 0);
  insertPost(db, {
    id: 'post-1',
    fingerprint: 'canonical-owner',
    createdAt: postCreatedAt,
    commentIdentityEnabled: 1,
  });

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
  assert.deepEqual(res.payload.comment.postIdentity, {
    key: 'op',
    label: '楼主',
    role: 'op',
  });
  assert.equal(
    db.prepare('SELECT comment_identity_guest_seq FROM posts WHERE id = ?').get('post-1').comment_identity_guest_seq,
    0,
  );
  db.close();
});

test('新帖下其他用户评论时会创建 post_comment 提醒，并分配首个瓜友身份', async () => {
  const db = createDb();
  const notifications = [];
  const postCreatedAt = Date.UTC(2026, 2, 7, 12, 0, 0, 0);
  insertPost(db, {
    id: 'post-2',
    fingerprint: 'canonical-owner',
    createdAt: postCreatedAt,
    commentIdentityEnabled: 1,
  });

  const handler = registerCommentRoute(db, notifications, {
    actorLegacyHash: 'legacy-other',
    actorCanonicalHash: 'canonical-other',
    requiredFingerprint: 'canonical-other',
  });
  const req = {
    params: { id: 'post-2' },
    body: { content: '路过评论一句', parentId: '', replyToId: '' },
  };
  const res = createResponse();

  await handler(req, res);

  assert.equal(res.statusCode, 201);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].type, 'post_comment');
  assert.equal(notifications[0].recipientFingerprint, 'canonical-owner');
  assert.deepEqual(res.payload.comment.postIdentity, {
    key: 'guest-1',
    label: '瓜友01',
    role: 'guest',
  });
  assert.equal(
    db.prepare('SELECT comment_identity_guest_seq FROM posts WHERE id = ?').get('post-2').comment_identity_guest_seq,
    1,
  );
  db.close();
});

test('帖子作者既是被回复者又是帖子作者时，不会因为新旧身份并存收到两条提醒', async () => {
  const db = createDb();
  const notifications = [];
  const postCreatedAt = Date.UTC(2026, 2, 7, 12, 0, 0, 0);
  insertPost(db, {
    id: 'post-3',
    fingerprint: 'canonical-owner',
    createdAt: postCreatedAt,
    commentIdentityEnabled: 1,
    commentIdentityGuestSeq: 1,
  });
  db.prepare(
    `
      INSERT INTO comments (
        id,
        post_id,
        parent_id,
        reply_to_id,
        content,
        author,
        created_at,
        fingerprint,
        ip,
        deleted,
        post_identity_key,
        post_identity_label,
        post_identity_role
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `
  ).run('comment-1', 'post-3', null, null, '旧评论', '匿名', postCreatedAt, 'legacy-owner', '127.0.0.1', 'op', '楼主', 'op');

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
    body: { content: '回复一句', parentId: 'comment-1', replyToId: 'comment-1' },
  };
  const res = createResponse();

  await handler(req, res);

  assert.equal(res.statusCode, 201);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].type, 'comment_reply');
  assert.equal(notifications[0].recipientFingerprint, 'legacy-owner');
  assert.deepEqual(res.payload.comment.postIdentity, {
    key: 'guest-2',
    label: '瓜友02',
    role: 'guest',
  });
  db.close();
});

test('新帖评论列表会直接返回已存储的帖内身份', () => {
  const db = createDb();
  const notifications = [];
  const baseTime = Date.UTC(2026, 2, 8, 9, 0, 0, 0);
  insertPost(db, {
    id: 'post-identities',
    fingerprint: 'canonical-owner',
    createdAt: baseTime,
    commentIdentityEnabled: 1,
    commentIdentityGuestSeq: 2,
  });

  db.prepare(
    `
      INSERT INTO comments (
        id, post_id, parent_id, reply_to_id, content, author, created_at, fingerprint, ip,
        deleted, hidden, post_identity_key, post_identity_label, post_identity_role
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run('comment-op', 'post-identities', null, null, '楼主先说一句', '匿名', baseTime + 1, 'legacy-owner', '127.0.0.1', 0, 0, 'op', '楼主', 'op');
  db.prepare(
    `
      INSERT INTO comments (
        id, post_id, parent_id, reply_to_id, content, author, created_at, fingerprint, ip,
        deleted, hidden, post_identity_key, post_identity_label, post_identity_role
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run('comment-a', 'post-identities', null, null, '瓜友 A', '匿名', baseTime + 2, 'guest-a', '127.0.0.1', 0, 0, 'guest-1', '瓜友01', 'guest');
  db.prepare(
    `
      INSERT INTO comments (
        id, post_id, parent_id, reply_to_id, content, author, created_at, fingerprint, ip,
        deleted, hidden, post_identity_key, post_identity_label, post_identity_role
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run('comment-b', 'post-identities', null, null, '瓜友 B', '匿名', baseTime + 3, 'guest-b', '127.0.0.1', 0, 0, 'guest-2', '瓜友02', 'guest');
  db.prepare(
    `
      INSERT INTO comments (
        id, post_id, parent_id, reply_to_id, content, author, created_at, fingerprint, ip,
        deleted, hidden, post_identity_key, post_identity_label, post_identity_role
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run('comment-a-reply', 'post-identities', 'comment-a', 'comment-b', '瓜友 A 再回一句', '匿名', baseTime + 4, 'guest-a', '127.0.0.1', 0, 0, 'guest-1', '瓜友01', 'guest');

  const handler = registerGetCommentsRoute(db, notifications);
  const req = {
    params: { id: 'post-identities' },
    query: { limit: 10, offset: 0 },
  };
  const res = createResponse();

  handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.items.length, 3);
  const itemById = new Map(res.payload.items.map((item) => [item.id, item]));
  assert.equal(itemById.get('comment-op').postIdentity.label, '楼主');
  assert.equal(itemById.get('comment-a').postIdentity.label, '瓜友01');
  assert.equal(itemById.get('comment-b').postIdentity.label, '瓜友02');
  assert.equal(itemById.get('comment-a').replies[0].postIdentity.label, '瓜友01');
  db.close();
});

test('新帖评论线程会复用已存储的帖内身份', () => {
  const db = createDb();
  const notifications = [];
  const baseTime = Date.UTC(2026, 2, 8, 10, 0, 0, 0);
  insertPost(db, {
    id: 'post-thread',
    fingerprint: 'canonical-owner',
    createdAt: baseTime,
    commentIdentityEnabled: 1,
    commentIdentityGuestSeq: 1,
  });

  db.prepare(
    `
      INSERT INTO comments (
        id, post_id, parent_id, reply_to_id, content, author, created_at, fingerprint, ip,
        deleted, hidden, post_identity_key, post_identity_label, post_identity_role
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run('thread-root', 'post-thread', null, null, '楼主继续说', '匿名', baseTime + 2, 'canonical-owner', '127.0.0.1', 0, 0, 'op', '楼主', 'op');
  db.prepare(
    `
      INSERT INTO comments (
        id, post_id, parent_id, reply_to_id, content, author, created_at, fingerprint, ip,
        deleted, hidden, post_identity_key, post_identity_label, post_identity_role
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run('thread-reply', 'post-thread', 'thread-root', 'thread-root', '新瓜友回复', '匿名', baseTime + 3, 'guest-z', '127.0.0.1', 0, 0, 'guest-1', '瓜友01', 'guest');

  const handler = registerGetCommentThreadRoute(db, notifications);
  const req = {
    params: { id: 'post-thread' },
    query: { commentId: 'thread-reply' },
  };
  const res = createResponse();

  handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.thread.postIdentity.label, '楼主');
  assert.equal(res.payload.thread.replies[0].postIdentity.label, '瓜友01');
  db.close();
});

test('旧帖下新评论不会分配帖内身份', async () => {
  const db = createDb();
  const notifications = [];
  const postCreatedAt = Date.UTC(2026, 2, 9, 12, 0, 0, 0);
  insertPost(db, {
    id: 'post-old',
    fingerprint: 'canonical-owner',
    createdAt: postCreatedAt,
    commentIdentityEnabled: 0,
  });

  const handler = registerCommentRoute(db, notifications, {
    actorLegacyHash: 'legacy-other',
    actorCanonicalHash: 'canonical-other',
    requiredFingerprint: 'canonical-other',
  });
  const req = {
    params: { id: 'post-old' },
    body: { content: '老帖不分配身份', parentId: '', replyToId: '' },
  };
  const res = createResponse();

  await handler(req, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.payload.comment.postIdentity, null);
  const row = db.prepare('SELECT post_identity_key, post_identity_label, post_identity_role FROM comments WHERE post_id = ?').get('post-old');
  assert.equal(row.post_identity_key, null);
  assert.equal(row.post_identity_label, null);
  assert.equal(row.post_identity_role, null);
  db.close();
});
