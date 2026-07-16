import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { registerPublicPostsRoutes } from '../routes/public/posts-routes.js';
import { createPostHotScoreService } from '../services/post-hot-score-service.js';

const TEST_NOW = new Date('2026-01-10T12:00:00+08:00').getTime();

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
      hidden INTEGER NOT NULL DEFAULT 0,
      featured INTEGER NOT NULL DEFAULT 0,
      featured_at INTEGER
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
      fingerprint TEXT,
      ip TEXT,
      author_name_style_id TEXT
    );

    CREATE TABLE post_reactions (
      post_id TEXT,
      session_id TEXT,
      reaction TEXT,
      created_at INTEGER
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

    CREATE TABLE post_feature_requests (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      requester_identity_key TEXT NOT NULL,
      requester_legacy_fingerprint TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL
    );

    CREATE INDEX idx_comments_post_id ON comments(post_id);
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

const mapPostRowForTest = (row, isHot) => ({
  id: row.id,
  content: row.content,
  author: row.author || '匿名',
  timestamp: String(row.created_at),
  tags: JSON.parse(row.tags || '[]'),
  createdAt: row.created_at,
  isHot,
  isFeatured: row.featured === 1,
  featuredAt: row.featured_at || null,
  viewerFeatureRequestStatus: row.viewer_feature_request_status || null,
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

const buildDeps = (db, options = {}) => ({
  db,
  hotScoreSql: '0',
  postHotScoreService: createPostHotScoreService({
    db,
    nowProvider: () => TEST_NOW,
    cacheTtlMs: 0,
  }),
  mapPostRow: mapPostRowForTest,
  mapCommentRow: mapCommentRowForTest,
  checkBanFor: () => true,
  formatDateKey: () => '2026-01-10',
  trackDailyVisit: () => {},
  getIdentityLookupHashes: () => options.identityHashes || [],
  getRequestIdentityContext: () => ({ lookupHashes: options.identityHashes || [] }),
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
  featured = 0,
  featuredAt = null,
}) => {
  db.prepare(
    `
      INSERT INTO posts (id, content, author, fingerprint, tags, created_at, deleted, hidden, featured, featured_at)
      VALUES (?, ?, '匿名', ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(id, content, `fingerprint-${id}`, JSON.stringify(tags), createdAt, deleted, hidden, featured, featuredAt);
};

test('精华列表只返回公开精华帖子并按加精时间倒序', () => {
  const db = createDb();
  insertPost(db, { id: 'featured-old', featured: 1, featuredAt: 200 });
  insertPost(db, { id: 'featured-new', featured: 1, featuredAt: 300 });
  insertPost(db, { id: 'normal', featured: 0 });
  insertPost(db, { id: 'featured-hidden', featured: 1, featuredAt: 400, hidden: 1 });
  const app = createApp();
  registerPublicPostsRoutes(app, buildDeps(db));
  const handler = app.routes.get('GET /api/posts/featured');
  const res = createResponse();
  handler({ query: { limit: '20', offset: '0' }, sessionID: 'featured-session' }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.total, 2);
  assert.deepEqual(res.payload.items.map((item) => item.id), ['featured-new', 'featured-old']);
  assert.ok(res.payload.items.every((item) => item.isFeatured));
  db.close();
});

test('Cookie 轮换后帖子列表仍能通过 legacy 指纹返回原精华申请状态', () => {
  const db = createDb();
  insertPost(db, { id: 'requested-post', createdAt: 1000 });
  db.prepare(`
    INSERT INTO post_feature_requests (
      id,
      post_id,
      requester_identity_key,
      requester_legacy_fingerprint,
      status,
      created_at
    ) VALUES ('feature-request', 'requested-post', 'canonical-old', 'legacy-shared', 'pending', 1100)
  `).run();
  const app = createApp();
  registerPublicPostsRoutes(app, buildDeps(db, {
    identityHashes: ['canonical-new', 'legacy-shared'],
  }));
  const handler = app.routes.get('GET /api/posts/home');
  const res = createResponse();

  handler({ query: { limit: '20', offset: '0' }, sessionID: 'home-session' }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.items[0].viewerFeatureRequestStatus, 'pending');
  db.close();
});

const insertComment = (db, {
  id,
  postId,
  content,
  parentId = null,
  createdAt = Date.now(),
  deleted = 0,
  hidden = 0,
  fingerprint = null,
  postIdentityKey = null,
  ip = null,
}) => {
  db.prepare(
    `
      INSERT INTO comments (
        id, post_id, parent_id, reply_to_id, content, author, created_at, deleted, hidden,
        fingerprint, post_identity_key, ip
      ) VALUES (?, ?, ?, NULL, ?, '匿名用户', ?, ?, ?, ?, ?, ?)
    `
  ).run(id, postId, parentId, content, createdAt, deleted, hidden, fingerprint, postIdentityKey, ip);
};

test('热门列表按近期独立互动排序，并允许旧帖因新互动重新进入榜单', () => {
  const db = createDb();
  insertPost(db, { id: 'old-active', createdAt: TEST_NOW - 30 * 24 * 60 * 60 * 1000 });
  insertPost(db, { id: 'single-commenter', createdAt: TEST_NOW - 60 * 60 * 1000 });
  insertPost(db, { id: 'new-without-interaction', createdAt: TEST_NOW });

  db.prepare(`
    INSERT INTO post_reactions_fingerprint (post_id, fingerprint, reaction, created_at)
    VALUES (?, ?, 'like', ?)
  `).run('old-active', 'identity-like', TEST_NOW - 30 * 60 * 1000);
  db.prepare(`
    INSERT INTO post_favorites (post_id, fingerprint, created_at)
    VALUES (?, ?, ?)
  `).run('old-active', 'identity-favorite', TEST_NOW - 20 * 60 * 1000);
  insertComment(db, {
    id: 'old-active-comment',
    postId: 'old-active',
    content: '旧帖的新评论',
    fingerprint: 'identity-comment',
    createdAt: TEST_NOW - 10 * 60 * 1000,
  });
  for (let index = 0; index < 6; index += 1) {
    insertComment(db, {
      id: `single-comment-${index}`,
      postId: 'single-commenter',
      content: `同一人的第 ${index + 1} 条评论`,
      fingerprint: 'same-commenter',
      createdAt: TEST_NOW - index * 60 * 1000,
    });
  }

  const preparedSql = [];
  const viewerHashes = ['viewer-current', 'viewer-legacy'];
  const deps = buildDeps(db, { identityHashes: viewerHashes });
  deps.db = new Proxy(db, {
    get(target, property) {
      if (property === 'prepare') {
        return (sql) => {
          preparedSql.push(sql);
          return target.prepare(sql);
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const app = createApp();
  registerPublicPostsRoutes(app, deps);
  const handler = app.routes.get('GET /api/posts/feed');
  const res = createResponse();
  handler({ query: { filter: 'today' }, sessionID: 'feed-session' }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload.items.map((item) => item.id), ['old-active', 'single-commenter']);
  assert.equal(res.payload.items[0].isHot, true);
  assert.equal(res.payload.items[1].isHot, false);
  assert.equal(res.payload.total, 2);

  const candidatePostSql = preparedSql.find((sql) => sql.includes('FROM json_each(?) AS hot_posts'));
  assert.ok(candidatePostSql);
  const planDetails = db.prepare(`EXPLAIN QUERY PLAN ${candidatePostSql}`)
    .all(
      ...viewerHashes,
      ...viewerHashes,
      ...viewerHashes,
      ...viewerHashes,
      ...viewerHashes,
      ...viewerHashes,
      JSON.stringify(['old-active', 'single-commenter'])
    )
    .map((item) => item.detail);
  assert.ok(planDetails.some((detail) => /SEARCH posts USING INDEX .*\(id=\?\)/.test(detail)));
  db.close();
});

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
