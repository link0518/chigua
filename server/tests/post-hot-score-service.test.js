import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import {
  calculateInteractionHotScore,
  createPostHotScoreService,
} from '../services/post-hot-score-service.js';

const NOW = new Date('2026-01-10T12:00:00+08:00').getTime();
const HOUR_MS = 60 * 60 * 1000;

const createDb = () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE posts (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0,
      hidden INTEGER NOT NULL DEFAULT 0
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
    CREATE TABLE comments (
      id TEXT PRIMARY KEY,
      post_id TEXT,
      fingerprint TEXT,
      post_identity_key TEXT,
      ip TEXT,
      created_at INTEGER,
      deleted INTEGER NOT NULL DEFAULT 0,
      hidden INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_post_reactions_created_at ON post_reactions(created_at DESC);
    CREATE INDEX idx_post_reactions_fingerprint_created_at
      ON post_reactions_fingerprint(created_at DESC);
    CREATE INDEX idx_post_favorites_created_at ON post_favorites(created_at DESC);
    CREATE INDEX idx_comments_hidden_deleted_created_at
      ON comments(hidden, deleted, created_at DESC);
  `);
  return db;
};

test('收藏权重高于点赞，点踩只降低热度', () => {
  const likeScore = calculateInteractionHotScore({ likes: 1 });
  const favoriteScore = calculateInteractionHotScore({ favorites: 1 });
  const scoreWithDislike = calculateInteractionHotScore({ favorites: 1, dislikes: 1 });

  assert.ok(favoriteScore > likeScore);
  assert.ok(scoreWithDislike < favoriteScore);
  assert.ok(scoreWithDislike > 0);
});

test('有限时间窗口直接使用 created_at 索引', () => {
  const db = createDb();
  const preparedSql = [];
  createPostHotScoreService({
    db: {
      prepare(sql) {
        preparedSql.push(sql);
        return db.prepare(sql);
      },
    },
  });

  const windowedSql = preparedSql.find((sql) => sql.includes('@windowStart'));
  const historicalSql = preparedSql.find((sql) => !sql.includes('@windowStart'));
  assert.ok(windowedSql);
  assert.ok(historicalSql);
  assert.doesNotMatch(windowedSql, /window_start\s+IS\s+NULL/i);
  assert.doesNotMatch(historicalSql, /created_at\s*>=\s*@windowStart/i);

  const planDetails = db.prepare(`EXPLAIN QUERY PLAN ${windowedSql}`).all({
    nowMs: NOW,
    halfLifeMs: 72 * HOUR_MS,
    windowStart: NOW - 7 * 24 * HOUR_MS,
  }).map((item) => item.detail);
  const expectedIndexes = [
    'idx_post_reactions_fingerprint_created_at',
    'idx_post_reactions_created_at',
    'idx_post_favorites_created_at',
    'idx_comments_hidden_deleted_created_at',
  ];
  expectedIndexes.forEach((indexName) => {
    assert.ok(
      planDetails.some((detail) => detail.includes(indexName)),
      `时间窗口查询应使用索引 ${indexName}`
    );
  });
  db.close();
});

test('今日榜忽略窗口外互动，同一评论者最多计一次核心评论和两次额外评论', () => {
  const db = createDb();
  const insertComment = db.prepare(`
    INSERT INTO comments (id, post_id, fingerprint, created_at)
    VALUES (?, ?, ?, ?)
  `);

  for (let index = 0; index < 8; index += 1) {
    insertComment.run(`spam-${index}`, 'comment-spam', 'same-identity', NOW - index * 1000);
  }
  for (let index = 0; index < 3; index += 1) {
    insertComment.run(`capped-${index}`, 'comment-capped', 'same-identity', NOW - index * 1000);
  }
  db.prepare(`
    INSERT INTO post_reactions_fingerprint (post_id, fingerprint, reaction, created_at)
    VALUES ('stale-like', 'stale-identity', 'like', ?)
  `).run(NOW - 30 * HOUR_MS);
  db.prepare(`
    INSERT INTO post_reactions_fingerprint (post_id, fingerprint, reaction, created_at)
    VALUES ('previous-day-like', 'previous-day-identity', 'like', ?)
  `).run(new Date('2026-01-09T23:30:00+08:00').getTime());

  const service = createPostHotScoreService({
    db,
    nowProvider: () => NOW,
    cacheTtlMs: 0,
  });
  const today = service.getSnapshot('today');
  const week = service.getSnapshot('week');
  const all = service.getSnapshot('all');

  assert.equal(today.has('stale-like'), false);
  assert.equal(week.has('stale-like'), true);
  assert.equal(all.has('stale-like'), true);
  assert.equal(today.has('previous-day-like'), false);
  assert.equal(week.has('previous-day-like'), true);
  assert.equal(today.get('comment-spam').interactionIdentityCount, 1);
  assert.equal(today.get('comment-spam').score, today.get('comment-capped').score);
  db.close();
});

test('点踩只扣分，不会增加热门资格或刷新正向互动时间', () => {
  const db = createDb();
  const insertReaction = db.prepare(`
    INSERT INTO post_reactions_fingerprint (post_id, fingerprint, reaction, created_at)
    VALUES (?, ?, ?, ?)
  `);
  for (let index = 0; index < 3; index += 1) {
    insertReaction.run(
      'dislike-only',
      `dislike-${index}`,
      'dislike',
      NOW - index * 1000
    );
  }
  db.prepare(`
    INSERT INTO post_favorites (post_id, fingerprint, created_at) VALUES
      ('positive', 'favorite-1', ?),
      ('positive', 'favorite-2', ?)
  `).run(NOW - 2000, NOW - 1000);

  const service = createPostHotScoreService({
    db,
    nowProvider: () => NOW,
    cacheTtlMs: 0,
  });
  const snapshot = service.getSnapshot('today');

  assert.equal(snapshot.get('dislike-only').interactionIdentityCount, 0);
  assert.equal(snapshot.get('dislike-only').lastInteractionAt, 0);
  assert.ok(snapshot.get('dislike-only').score < 0);
  assert.equal(snapshot.get('positive').interactionIdentityCount, 2);
  assert.ok(snapshot.get('positive').score > 0);
  db.close();
});

test('缺失全部身份字段的历史评论不计入热度或独立互动人数', () => {
  const db = createDb();
  const insertComment = db.prepare(`
    INSERT INTO comments (
      id, post_id, fingerprint, post_identity_key, ip, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  insertComment.run('unknown-null', 'unknown-only', null, null, null, NOW);
  insertComment.run('unknown-empty', 'unknown-only', '', '', '', NOW - 1000);
  insertComment.run('unknown-space', 'mixed', '  ', '  ', '  ', NOW - 2000);
  insertComment.run('known', 'mixed', 'known-identity', null, null, NOW - 3000);

  const service = createPostHotScoreService({
    db,
    nowProvider: () => NOW,
    cacheTtlMs: 0,
  });
  const snapshot = service.getSnapshot('today');

  assert.equal(snapshot.has('unknown-only'), false);
  assert.equal(snapshot.get('mixed').interactionIdentityCount, 1);
  assert.ok(snapshot.get('mixed').score > 0);
  db.close();
});

test('默认缓存按今日、近七天和历史榜使用分级 TTL', () => {
  const cases = [
    { filter: 'today', ttlMs: 15 * 60 * 1000 },
    { filter: 'week', ttlMs: 30 * 60 * 1000 },
    { filter: 'all', ttlMs: 60 * 60 * 1000 },
  ];

  cases.forEach(({ filter, ttlMs }) => {
    const db = createDb();
    let now = NOW;
    db.prepare(`
      INSERT INTO post_reactions_fingerprint (post_id, fingerprint, reaction, created_at)
      VALUES ('initial', 'identity-initial', 'like', ?)
    `).run(now - 1000);
    const service = createPostHotScoreService({ db, nowProvider: () => now });

    assert.equal(service.getSnapshot(filter).has('initial'), true, `${filter} 应生成初始快照`);
    db.prepare(`
      INSERT INTO post_reactions_fingerprint (post_id, fingerprint, reaction, created_at)
      VALUES ('new-interaction', 'identity-new', 'like', ?)
    `).run(now);

    now += ttlMs - 1;
    assert.equal(
      service.getSnapshot(filter).has('new-interaction'),
      false,
      `${filter} 在 TTL 内应复用缓存`
    );
    now += 2;
    assert.equal(
      service.getSnapshot(filter).has('new-interaction'),
      true,
      `${filter} 到期后应刷新缓存`
    );
    db.close();
  });
});

test('数值 cacheTtlMs 继续对所有榜单生效', () => {
  const db = createDb();
  let now = NOW;
  const service = createPostHotScoreService({
    db,
    nowProvider: () => now,
    cacheTtlMs: 1000,
  });

  service.getSnapshot('all');
  db.prepare(`
    INSERT INTO post_reactions_fingerprint (post_id, fingerprint, reaction, created_at)
    VALUES ('numeric-ttl', 'identity-numeric', 'like', ?)
  `).run(now);
  now += 999;
  assert.equal(service.getSnapshot('all').has('numeric-ttl'), false);
  now += 2;
  assert.equal(service.getSnapshot('all').has('numeric-ttl'), true);
  db.close();
});

test('今日榜缓存不会跨北京时间自然日复用，过期时间也不晚于次日零点', () => {
  const db = createDb();
  let now = new Date('2026-01-10T23:50:00+08:00').getTime();
  db.prepare(`
    INSERT INTO post_reactions_fingerprint (post_id, fingerprint, reaction, created_at)
    VALUES ('previous-day', 'identity-previous', 'like', ?)
  `).run(now - 1000);
  const service = createPostHotScoreService({ db, nowProvider: () => now });

  const firstState = service.getRankingState('today');
  assert.equal(firstState.ranking.length, 0);
  assert.equal(
    firstState.expiresAt,
    new Date('2026-01-11T00:00:00+08:00').getTime()
  );

  db.prepare(`
    INSERT INTO post_reactions_fingerprint (post_id, fingerprint, reaction, created_at)
    VALUES ('new-day', 'identity-new-day', 'like', ?)
  `).run(new Date('2026-01-11T00:00:30+08:00').getTime());
  now = new Date('2026-01-11T00:01:00+08:00').getTime();
  const refreshed = service.getSnapshot('today');

  assert.equal(refreshed.has('previous-day'), false);
  assert.equal(refreshed.has('new-day'), true);
  db.close();
});
