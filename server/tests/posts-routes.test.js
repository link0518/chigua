import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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
      ip TEXT,
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
  viewerReaction: row.viewer_reaction || null,
  viewerFavorited: Boolean(row.viewer_favorited),
  viewerIsAuthor: Boolean(row.viewer_is_author),
  viewerDeleteRequestStatus: row.viewer_delete_request_status || null,
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
  postHotScoreService: options.postHotScoreService || createPostHotScoreService({
    db,
    nowProvider: options.nowProvider || (() => TEST_NOW),
    cacheTtlMs: options.cacheTtlMs ?? 0,
  }),
  mapPostRow: mapPostRowForTest,
  mapCommentRow: mapCommentRowForTest,
  checkBanFor: () => true,
  formatDateKey: () => '2026-01-10',
  trackDailyVisit: () => {},
  getIdentityLookupHashes: (req, res) => (
    options.getIdentityLookupHashes?.(req, res) || options.identityHashes || []
  ),
  getRequestIdentityContext: () => ({ lookupHashes: options.identityHashes || [] }),
  startOfDay: (date) => {
    const normalized = new Date(date);
    normalized.setHours(0, 0, 0, 0);
    return normalized.getTime();
  },
  crypto,
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
  author = '匿名',
  fingerprint = `fingerprint-${id}`,
  ip = null,
}) => {
  db.prepare(
    `
      INSERT INTO posts (
        id, content, author, fingerprint, ip, tags, created_at, deleted, hidden, featured, featured_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    id,
    content,
    author,
    fingerprint,
    ip,
    JSON.stringify(tags),
    createdAt,
    deleted,
    hidden,
    featured,
    featuredAt
  );
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

const insertHotReaction = (db, postId, fingerprint, createdAt) => {
  db.prepare(`
    INSERT INTO post_reactions_fingerprint (post_id, fingerprint, reaction, created_at)
    VALUES (?, ?, 'like', ?)
  `).run(postId, fingerprint, createdAt);
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
  assert.equal(res.payload.nextOffset, 2);
  assert.equal(res.payload.hasMore, false);
  assert.equal(Number.isSafeInteger(res.payload.rankingUpdatedAt), true);
  assert.ok(res.payload.rankingUpdatedAt >= 1_000_000_000_000);
  assert.equal(res.payload.rankingExpiresAt, TEST_NOW);

  const candidatePostSql = preparedSql.find((sql) => (
    sql.includes('SELECT posts.*') && sql.includes('FROM json_each(?) AS hot_posts')
  ));
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

test('热门列表分页返回准确游标，并用单次集合查询校验公开状态', () => {
  const db = createDb();
  for (let index = 0; index < 5; index += 1) {
    const id = `rank-${index}`;
    insertPost(db, { id, createdAt: TEST_NOW - index * 60 * 1000 });
    insertHotReaction(db, id, `identity-${index}`, TEST_NOW - index * 60 * 1000);
  }

  const hydrationCalls = [];
  const visibilityCalls = [];
  const deps = buildDeps(db);
  deps.db = new Proxy(db, {
    get(target, property) {
      if (property === 'prepare') {
        return (sql) => {
          const statement = target.prepare(sql);
          return new Proxy(statement, {
            get(statementTarget, statementProperty) {
              if (statementProperty === 'all') {
                return (...args) => {
                  if (sql.includes('SELECT posts.*') && sql.includes('FROM json_each(?) AS hot_posts')) {
                    hydrationCalls.push({ sql, args });
                  }
                  if (sql.includes('SELECT posts.id') && sql.includes('FROM json_each(?) AS hot_posts')) {
                    visibilityCalls.push({ sql, args });
                  }
                  return statementTarget.all(...args);
                };
              }
              const value = statementTarget[statementProperty];
              return typeof value === 'function' ? value.bind(statementTarget) : value;
            },
          });
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

  handler({
    query: { filter: 'today', limit: '2', offset: '1' },
    sessionID: 'feed-page-session',
  }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload.items.map((item) => item.id), ['rank-1', 'rank-2']);
  assert.equal(res.payload.total, 5);
  assert.equal(res.payload.nextOffset, 3);
  assert.equal(res.payload.hasMore, true);
  assert.equal(visibilityCalls.length, 1);
  assert.deepEqual(JSON.parse(visibilityCalls[0].args[0]), [
    'rank-0',
    'rank-1',
    'rank-2',
    'rank-3',
    'rank-4',
  ]);
  assert.equal(hydrationCalls.length, 1);
  assert.deepEqual(JSON.parse(hydrationCalls[0].args.at(-1)), ['rank-1', 'rank-2']);
  db.close();
});

test('热门缓存中的隐藏或删除 ID 会被实时剔除并修正分页元数据', () => {
  const db = createDb();
  insertPost(db, { id: 'hidden-after-cache', createdAt: TEST_NOW });
  insertPost(db, { id: 'deleted-after-cache', createdAt: TEST_NOW - 1000 });
  insertPost(db, { id: 'visible-next-page', createdAt: TEST_NOW - 2000 });
  insertHotReaction(db, 'hidden-after-cache', 'identity-hidden', TEST_NOW);
  insertHotReaction(db, 'deleted-after-cache', 'identity-deleted', TEST_NOW - 1000);
  insertHotReaction(db, 'visible-next-page', 'identity-visible', TEST_NOW - 2000);

  const app = createApp();
  registerPublicPostsRoutes(app, buildDeps(db, { cacheTtlMs: 60 * 1000 }));
  const handler = app.routes.get('GET /api/posts/feed');
  const warmResponse = createResponse();
  handler({ query: { filter: 'today' }, sessionID: 'feed-warm-session' }, warmResponse);
  assert.equal(warmResponse.payload.total, 3);

  db.prepare(`UPDATE posts SET hidden = 1 WHERE id = 'hidden-after-cache'`).run();
  db.prepare(`UPDATE posts SET deleted = 1 WHERE id = 'deleted-after-cache'`).run();

  const staleNextPage = createResponse();
  handler({
    query: {
      filter: 'today',
      limit: '2',
      offset: '2',
      rankingUpdatedAt: String(warmResponse.payload.rankingUpdatedAt),
    },
    sessionID: 'feed-hidden-session',
  }, staleNextPage);
  assert.equal(staleNextPage.payload.resetRequired, true);
  assert.deepEqual(staleNextPage.payload.items, []);
  assert.equal(staleNextPage.payload.total, 1);
  assert.equal(staleNextPage.payload.nextOffset, 0);
  assert.equal(staleNextPage.payload.hasMore, true);

  const firstPage = createResponse();
  handler({
    query: { filter: 'today', limit: '2', offset: '0' },
    sessionID: 'feed-visible-session',
  }, firstPage);
  assert.deepEqual(firstPage.payload.items.map((item) => item.id), ['visible-next-page']);
  assert.equal(firstPage.payload.total, 1);
  assert.equal(firstPage.payload.nextOffset, 1);
  assert.equal(firstPage.payload.hasMore, false);
  db.close();
});

test('排行缓存建立时隐藏的候选恢复公开后可立即进入榜单', () => {
  const db = createDb();
  insertPost(db, { id: 'always-visible', createdAt: TEST_NOW });
  insertPost(db, { id: 'restored-visible', createdAt: TEST_NOW - 1000, hidden: 1 });
  insertHotReaction(db, 'always-visible', 'identity-visible', TEST_NOW);
  insertHotReaction(db, 'restored-visible', 'identity-restored', TEST_NOW - 1000);

  const app = createApp();
  registerPublicPostsRoutes(app, buildDeps(db, { cacheTtlMs: 60 * 1000 }));
  const handler = app.routes.get('GET /api/posts/feed');
  const initialResponse = createResponse();
  handler({ query: { filter: 'today' }, sessionID: 'feed-before-restore' }, initialResponse);
  assert.deepEqual(initialResponse.payload.items.map((item) => item.id), ['always-visible']);
  assert.equal(initialResponse.payload.total, 1);

  db.prepare(`UPDATE posts SET hidden = 0 WHERE id = 'restored-visible'`).run();
  const restoredResponse = createResponse();
  handler({ query: { filter: 'today' }, sessionID: 'feed-after-restore' }, restoredResponse);
  assert.deepEqual(
    restoredResponse.payload.items.map((item) => item.id),
    ['always-visible', 'restored-visible']
  );
  assert.equal(restoredResponse.payload.total, 2);
  assert.notEqual(
    restoredResponse.payload.rankingUpdatedAt,
    initialResponse.payload.rankingUpdatedAt
  );
  db.close();
});

test('热门榜单分页携带旧快照版本时要求客户端从第一页重启', () => {
  const db = createDb();
  let now = TEST_NOW;
  insertPost(db, { id: 'old-ranking', createdAt: now });
  insertHotReaction(db, 'old-ranking', 'old-identity', now);
  const app = createApp();
  registerPublicPostsRoutes(app, buildDeps(db, {
    nowProvider: () => now,
    cacheTtlMs: 1000,
  }));
  const handler = app.routes.get('GET /api/posts/feed');
  const firstPage = createResponse();
  handler({ query: { filter: 'today', limit: '1' }, sessionID: 'ranking-v1' }, firstPage);

  insertPost(db, { id: 'new-ranking', createdAt: now + 2000 });
  insertHotReaction(db, 'new-ranking', 'new-identity', now + 2000);
  now += 2000;
  const staleNextPage = createResponse();
  handler({
    query: {
      filter: 'today',
      limit: '1',
      offset: '1',
      rankingUpdatedAt: String(firstPage.payload.rankingUpdatedAt),
    },
    sessionID: 'ranking-v2',
  }, staleNextPage);

  assert.equal(staleNextPage.payload.resetRequired, true);
  assert.equal(staleNextPage.payload.nextOffset, 0);
  assert.notEqual(
    staleNextPage.payload.rankingUpdatedAt,
    firstPage.payload.rankingUpdatedAt
  );
  assert.equal(Number.isSafeInteger(staleNextPage.payload.rankingUpdatedAt), true);
  assert.equal(staleNextPage.payload.rankingExpiresInMs, 1000);
  db.close();
});

test('热门列表搜索继续匹配帖子 ID、正文、IP 和指纹，并保持排行顺序', () => {
  const db = createDb();
  const posts = [
    { id: 'content-match', content: '正文包含 needle' },
    { id: 'needle-id' },
    { id: 'ip-match', ip: 'needle-ip' },
    { id: 'fingerprint-match', fingerprint: 'needle-fingerprint' },
    { id: 'unmatched' },
  ];
  posts.forEach((post, index) => {
    insertPost(db, { ...post, createdAt: TEST_NOW - index * 1000 });
    insertHotReaction(db, post.id, `search-identity-${index}`, TEST_NOW - index * 1000);
  });

  const app = createApp();
  registerPublicPostsRoutes(app, buildDeps(db));
  const handler = app.routes.get('GET /api/posts/feed');
  const res = createResponse();
  handler({
    query: { filter: 'today', search: 'needle' },
    sessionID: 'feed-search-session',
  }, res);

  assert.equal(res.payload.total, 4);
  assert.deepEqual(
    res.payload.items.map((item) => item.id),
    ['content-match', 'needle-id', 'ip-match', 'fingerprint-match']
  );
  assert.equal(res.payload.nextOffset, 4);
  assert.equal(res.payload.hasMore, false);
  db.close();
});

test('热门搜索结果因隐藏、删除或编辑发生变化时要求分页重启', () => {
  const mutationCases = [
    {
      name: '隐藏',
      contents: ['needle-a', 'needle-b', 'needle-c'],
      mutate: (db) => db.prepare(`UPDATE posts SET hidden = 1 WHERE id = 'rank-a'`).run(),
      expectedTotal: 2,
      expectedPageIds: ['rank-b', 'rank-c'],
    },
    {
      name: '删除',
      contents: ['needle-a', 'needle-b', 'needle-c'],
      mutate: (db) => db.prepare(`UPDATE posts SET deleted = 1 WHERE id = 'rank-a'`).run(),
      expectedTotal: 2,
      expectedPageIds: ['rank-b', 'rank-c'],
    },
    {
      name: '编辑',
      contents: ['needle-a', '普通正文', 'needle-c'],
      mutate: (db) => db.prepare(`UPDATE posts SET content = 'needle-b' WHERE id = 'rank-b'`).run(),
      expectedTotal: 3,
      expectedPageIds: ['rank-a', 'rank-b'],
    },
  ];

  mutationCases.forEach((mutationCase) => {
    const db = createDb();
    ['rank-a', 'rank-b', 'rank-c'].forEach((id, index) => {
      insertPost(db, {
        id,
        content: mutationCase.contents[index],
        createdAt: TEST_NOW - index * 1000,
      });
      insertHotReaction(db, id, `${mutationCase.name}-${index}`, TEST_NOW - index * 1000);
    });

    const app = createApp();
    registerPublicPostsRoutes(app, buildDeps(db, { cacheTtlMs: 60 * 1000 }));
    const handler = app.routes.get('GET /api/posts/feed');
    const firstPage = createResponse();
    handler({
      query: { filter: 'today', search: 'needle', limit: '1' },
      sessionID: `search-${mutationCase.name}-first`,
    }, firstPage);
    mutationCase.mutate(db);

    const staleNextPage = createResponse();
    handler({
      query: {
        filter: 'today',
        search: 'needle',
        limit: '1',
        offset: '1',
        rankingUpdatedAt: String(firstPage.payload.rankingUpdatedAt),
      },
      sessionID: `search-${mutationCase.name}-stale`,
    }, staleNextPage);
    assert.equal(
      staleNextPage.payload.resetRequired,
      true,
      `${mutationCase.name}后应要求重启分页`
    );
    assert.equal(staleNextPage.payload.total, mutationCase.expectedTotal);
    assert.equal(staleNextPage.payload.nextOffset, 0);

    const refreshedFirstPage = createResponse();
    handler({
      query: { filter: 'today', search: 'needle', limit: '1' },
      sessionID: `search-${mutationCase.name}-refreshed`,
    }, refreshedFirstPage);
    const refreshedSecondPage = createResponse();
    handler({
      query: {
        filter: 'today',
        search: 'needle',
        limit: '1',
        offset: String(refreshedFirstPage.payload.nextOffset),
        rankingUpdatedAt: String(refreshedFirstPage.payload.rankingUpdatedAt),
      },
      sessionID: `search-${mutationCase.name}-next`,
    }, refreshedSecondPage);
    assert.deepEqual(
      [refreshedFirstPage.payload.items[0].id, refreshedSecondPage.payload.items[0].id],
      mutationCase.expectedPageIds
    );
    assert.equal(refreshedSecondPage.payload.resetRequired, undefined);
    db.close();
  });
});

test('热门搜索限制关键词长度，并把 LIKE 通配符按字面量匹配', () => {
  const db = createDb();
  insertPost(db, { id: 'literal-percent', content: '包含 100% 字样', createdAt: TEST_NOW });
  insertPost(db, { id: 'ordinary', content: '普通正文', createdAt: TEST_NOW - 1000 });
  insertHotReaction(db, 'literal-percent', 'literal-identity', TEST_NOW);
  insertHotReaction(db, 'ordinary', 'ordinary-identity', TEST_NOW - 1000);
  const app = createApp();
  registerPublicPostsRoutes(app, buildDeps(db));
  const handler = app.routes.get('GET /api/posts/feed');

  const literalResponse = createResponse();
  handler({
    query: { filter: 'today', search: '%' },
    sessionID: 'feed-search-literal',
  }, literalResponse);
  assert.deepEqual(literalResponse.payload.items.map((item) => item.id), ['literal-percent']);

  const oversizedResponse = createResponse();
  handler({
    query: { filter: 'today', search: 'a'.repeat(81) },
    sessionID: 'feed-search-oversized',
  }, oversizedResponse);
  assert.equal(oversizedResponse.statusCode, 400);
  assert.match(oversizedResponse.payload.error, /不能超过 80 个字符/);
  db.close();
});

test('大量不同热门搜索不会改变相同结果集的稳定分页版本', () => {
  const db = createDb();
  insertPost(db, { id: 'stable-a', content: 'needle-a', createdAt: TEST_NOW });
  insertPost(db, { id: 'stable-b', content: 'needle-b', createdAt: TEST_NOW - 1000 });
  insertHotReaction(db, 'stable-a', 'stable-identity-a', TEST_NOW);
  insertHotReaction(db, 'stable-b', 'stable-identity-b', TEST_NOW - 1000);
  const app = createApp();
  registerPublicPostsRoutes(app, buildDeps(db, { cacheTtlMs: 60 * 1000 }));
  const handler = app.routes.get('GET /api/posts/feed');

  const initialResponse = createResponse();
  handler({
    query: { filter: 'today', search: 'needle', limit: '1' },
    sessionID: 'stable-version-initial',
  }, initialResponse);

  for (let index = 0; index < 100; index += 1) {
    const noiseResponse = createResponse();
    handler({
      query: { filter: 'today', search: `noise-${index}`, limit: '1' },
      sessionID: `stable-version-noise-${index}`,
    }, noiseResponse);
    assert.equal(noiseResponse.statusCode, 200);
  }

  const repeatedResponse = createResponse();
  handler({
    query: { filter: 'today', search: 'needle', limit: '1' },
    sessionID: 'stable-version-repeated',
  }, repeatedResponse);
  assert.equal(
    repeatedResponse.payload.rankingUpdatedAt,
    initialResponse.payload.rankingUpdatedAt
  );

  const nextPage = createResponse();
  handler({
    query: {
      filter: 'today',
      search: 'needle',
      limit: '1',
      offset: '1',
      rankingUpdatedAt: String(initialResponse.payload.rankingUpdatedAt),
    },
    sessionID: 'stable-version-next-page',
  }, nextPage);
  assert.equal(nextPage.payload.resetRequired, undefined);
  assert.deepEqual(nextPage.payload.items.map((item) => item.id), ['stable-b']);
  db.close();
});

test('热门公共排行缓存不混入用户态字段，每次请求独立补全当前用户状态', () => {
  const db = createDb();
  insertPost(db, {
    id: 'viewer-state-post',
    fingerprint: 'viewer-author',
    createdAt: TEST_NOW,
  });
  insertHotReaction(db, 'viewer-state-post', 'viewer-author', TEST_NOW);
  db.prepare(`
    INSERT INTO post_favorites (post_id, fingerprint, created_at)
    VALUES ('viewer-state-post', 'viewer-favorite', ?)
  `).run(TEST_NOW - 1000);

  const postHotScoreService = createPostHotScoreService({
    db,
    nowProvider: () => TEST_NOW,
    cacheTtlMs: 60 * 1000,
  });
  const app = createApp();
  registerPublicPostsRoutes(app, buildDeps(db, {
    postHotScoreService,
    getIdentityLookupHashes: (req) => req.identityHashes,
  }));
  const handler = app.routes.get('GET /api/posts/feed');

  const authorResponse = createResponse();
  handler({
    query: { filter: 'today' },
    identityHashes: ['viewer-author'],
    sessionID: 'feed-author-session',
  }, authorResponse);
  assert.equal(authorResponse.payload.items[0].viewerReaction, 'like');
  assert.equal(authorResponse.payload.items[0].viewerFavorited, false);
  assert.equal(authorResponse.payload.items[0].viewerIsAuthor, true);

  const favoriteResponse = createResponse();
  handler({
    query: { filter: 'today' },
    identityHashes: ['viewer-favorite'],
    sessionID: 'feed-favorite-session',
  }, favoriteResponse);
  assert.equal(favoriteResponse.payload.items[0].viewerReaction, null);
  assert.equal(favoriteResponse.payload.items[0].viewerFavorited, true);
  assert.equal(favoriteResponse.payload.items[0].viewerIsAuthor, false);

  const publicCandidate = postHotScoreService.getRanking('today')[0];
  assert.equal(Object.hasOwn(publicCandidate, 'viewerReaction'), false);
  assert.equal(Object.hasOwn(publicCandidate, 'viewerFavorited'), false);
  assert.equal(Object.hasOwn(publicCandidate, 'author'), false);
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
