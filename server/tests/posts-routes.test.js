import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { registerPublicPostsRoutes } from '../routes/public/posts-routes.js';

const createDb = () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE posts (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      author TEXT,
      fingerprint TEXT,
      tags TEXT,
      created_at INTEGER NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0,
      hidden INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE comments (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      parent_id TEXT,
      reply_to_id TEXT,
      content TEXT NOT NULL,
      author TEXT,
      created_at INTEGER NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0,
      hidden INTEGER NOT NULL DEFAULT 0,
      post_identity_key TEXT,
      post_identity_label TEXT,
      post_identity_role TEXT,
      author_name_style_id TEXT
    );

    CREATE TABLE post_reactions_fingerprint (
      post_id TEXT,
      fingerprint TEXT,
      reaction TEXT,
      created_at INTEGER
    );

    CREATE TABLE post_favorites (
      post_id TEXT,
      fingerprint TEXT,
      created_at INTEGER
    );

    CREATE TABLE post_delete_requests (
      id TEXT PRIMARY KEY,
      post_id TEXT,
      status TEXT,
      created_at INTEGER
    );
  `);
  return db;
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

const mapPostRowForTest = (row) => ({
  id: row.id,
  content: row.content,
  author: row.author || '匿名',
  timestamp: String(row.created_at),
  tags: JSON.parse(row.tags || '[]'),
  createdAt: row.created_at,
  isHot: false,
});

const mapCommentRowForTest = (row) => ({
  id: row.id,
  postId: row.post_id,
  parentId: row.parent_id || null,
  replyToId: row.reply_to_id || null,
  content: row.content,
  author: row.author || '匿名',
  timestamp: String(row.created_at),
  createdAt: row.created_at,
  deleted: row.deleted === 1,
  hidden: row.hidden === 1,
  authorNameStyleId: row.author_name_style_id || null,
});

const buildDeps = (db) => ({
  db,
  hotScoreSql: '0',
  mapPostRow: mapPostRowForTest,
  mapCommentRow: mapCommentRowForTest,
  checkBanFor: () => true,
  formatDateKey: () => '2026-01-10',
  trackDailyVisit: () => {},
  getIdentityLookupHashes: () => [],
  getRequestIdentityContext: () => ({ lookupHashes: [] }),
  startOfDay: (date) => {
    const normalized = new Date(date);
    normalized.setHours(0, 0, 0, 0);
    return normalized.getTime();
  },
});

const registerSearchRoute = (db) => {
  const app = createApp();
  registerPublicPostsRoutes(app, buildDeps(db));
  return app.routes.get('GET /api/posts/search');
};

const insertPost = (db, {
  id,
  content = '无关正文',
  tags = [],
  createdAt = Date.now(),
  deleted = 0,
  hidden = 0,
}) => {
  db.prepare(
    `
      INSERT INTO posts (id, content, author, fingerprint, tags, created_at, deleted, hidden)
      VALUES (?, ?, '匿名', ?, ?, ?, ?, ?)
    `
  ).run(id, content, `fingerprint-${id}`, JSON.stringify(tags), createdAt, deleted, hidden);
};

const insertComment = (db, {
  id,
  postId,
  content,
  parentId = null,
  createdAt = Date.now(),
  deleted = 0,
  hidden = 0,
}) => {
  db.prepare(
    `
      INSERT INTO comments (
        id, post_id, parent_id, reply_to_id, content, author, created_at, deleted, hidden
      ) VALUES (?, ?, ?, NULL, ?, '匿名用户', ?, ?, ?)
    `
  ).run(id, postId, parentId, content, createdAt, deleted, hidden);
};

const runSearch = (handler, query) => {
  const req = { query, sessionID: 'search-session' };
  const res = createResponse();
  handler(req, res);
  assert.equal(res.statusCode, 200);
  return res.payload;
};

test('关键词命中评论和嵌套回复时按帖子聚合，并只预览最新三条可见评论', () => {
  const db = createDb();
  insertPost(db, { id: 'post-1', createdAt: 100 });
  insertComment(db, { id: 'comment-1', postId: 'post-1', content: '目标词 第一条', createdAt: 101 });
  insertComment(db, {
    id: 'comment-2',
    postId: 'post-1',
    parentId: 'comment-1',
    content: '嵌套回复也有目标词',
    createdAt: 102,
  });
  insertComment(db, { id: 'comment-3', postId: 'post-1', content: '目标词 第三条', createdAt: 103 });
  insertComment(db, { id: 'comment-4', postId: 'post-1', content: '目标词 第四条', createdAt: 104 });
  insertComment(db, {
    id: 'comment-hidden',
    postId: 'post-1',
    content: '隐藏的目标词',
    createdAt: 105,
    hidden: 1,
  });
  insertComment(db, {
    id: 'comment-deleted',
    postId: 'post-1',
    content: '删除的目标词',
    createdAt: 106,
    deleted: 1,
  });

  const data = runSearch(registerSearchRoute(db), { q: '目标词', page: '1', limit: '20' });

  assert.equal(data.total, 1);
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].id, 'post-1');
  assert.equal(data.items[0].matchedCommentCount, 4);
  assert.deepEqual(
    data.items[0].matchedComments.map((comment) => comment.id),
    ['comment-4', 'comment-3', 'comment-2']
  );
  assert.equal(data.items[0].matchedComments[2].parentId, 'comment-1');
});

test('帖子正文命中保持原行为，隐藏或删除内容不会进入公开搜索', () => {
  const db = createDb();
  insertPost(db, { id: 'post-content', content: '正文包含目标词', createdAt: 100 });
  insertPost(db, { id: 'post-comment', createdAt: 200 });
  insertPost(db, { id: 'post-hidden', content: '目标词', createdAt: 300, hidden: 1 });
  insertPost(db, { id: 'post-deleted', content: '目标词', createdAt: 400, deleted: 1 });
  insertComment(db, { id: 'visible-comment', postId: 'post-comment', content: '评论包含目标词', createdAt: 201 });

  const data = runSearch(registerSearchRoute(db), { q: '目标词' });

  assert.equal(data.total, 2);
  assert.deepEqual(data.items.map((post) => post.id), ['post-comment', 'post-content']);
  assert.equal(data.items[0].matchedCommentCount, 1);
  assert.equal(data.items[1].matchedCommentCount, 0);
});

test('评论命中仍需同时满足帖子的标签和日期筛选', () => {
  const db = createDb();
  const targetDay = new Date(2026, 0, 10, 12, 0, 0, 0).getTime();
  const outsideDay = new Date(2026, 0, 11, 12, 0, 0, 0).getTime();
  insertPost(db, { id: 'post-in-range', tags: ['校园'], createdAt: targetDay });
  insertPost(db, { id: 'post-wrong-tag', tags: ['职场'], createdAt: targetDay });
  insertPost(db, { id: 'post-wrong-date', tags: ['校园'], createdAt: outsideDay });
  insertComment(db, { id: 'comment-in-range', postId: 'post-in-range', content: '目标词', createdAt: targetDay });
  insertComment(db, { id: 'comment-wrong-tag', postId: 'post-wrong-tag', content: '目标词', createdAt: targetDay });
  insertComment(db, { id: 'comment-wrong-date', postId: 'post-wrong-date', content: '目标词', createdAt: outsideDay });

  const data = runSearch(registerSearchRoute(db), {
    q: '目标词',
    tag: '校园',
    startDate: '2026-01-10',
    endDate: '2026-01-10',
  });

  assert.equal(data.total, 1);
  assert.equal(data.items[0].id, 'post-in-range');
  assert.equal(data.items[0].matchedComments[0].id, 'comment-in-range');
});
