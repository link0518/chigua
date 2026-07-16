import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { registerPublicPostFeaturesRoutes } from '../routes/public/post-features-routes.js';

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
    INSERT INTO posts (id, content, created_at, deleted, hidden, featured)
    VALUES ('post-1', '待申请帖子', 1000, 0, 0, 0)
  `).run();
  return db;
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

const registerHarness = ({
  db = createDb(),
  identityKey = 'canonical-1',
  legacyFingerprint = 'legacy-1',
  identityHashes,
  onRateLimit,
} = {}) => {
  const routes = new Map();
  const app = {
    post(path, handler) {
      routes.set(path, handler);
    },
  };
  registerPublicPostFeaturesRoutes(app, {
    db,
    requireFingerprint: () => identityKey,
    getRequestIdentityContext: () => ({
      lookupHashes: identityHashes || [identityKey, legacyFingerprint].filter(Boolean),
      legacyFingerprintHash: legacyFingerprint,
    }),
    enforceRateLimit: (_req, _res, action) => {
      onRateLimit?.(action);
      return true;
    },
    checkBanFor: () => true,
    getClientIp: () => '127.0.0.1',
    crypto: { randomUUID: () => `request-${identityKey}` },
  });
  return { db, handler: routes.get('/api/posts/:id/feature-requests') };
};

test('用户确认后可以提交一次精华申请且不需要填写理由', () => {
  const { db, handler } = registerHarness();
  const res = createResponse();
  handler({ params: { id: 'post-1' }, sessionID: 'session-1' }, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.payload.request.status, 'pending');
  assert.deepEqual(
    db.prepare(`
      SELECT post_id, requester_identity_key, requester_legacy_fingerprint, status
      FROM post_feature_requests
    `).get(),
    {
      post_id: 'post-1',
      requester_identity_key: 'canonical-1',
      requester_legacy_fingerprint: 'legacy-1',
      status: 'pending',
    }
  );
  db.close();
});

test('Cookie 轮换后仍会通过 legacy 指纹命中既有申请且不消耗限流', () => {
  const db = createDb();
  db.prepare(`
    INSERT INTO post_feature_requests (
      id,
      post_id,
      requester_identity_key,
      requester_legacy_fingerprint,
      status,
      created_at
    ) VALUES ('existing', 'post-1', 'canonical-old', 'legacy-1', 'rejected', 1001)
  `).run();
  let rateLimitCalls = 0;
  const { handler } = registerHarness({
    db,
    identityKey: 'canonical-new',
    legacyFingerprint: 'legacy-1',
    identityHashes: ['canonical-new', 'legacy-1'],
    onRateLimit: () => { rateLimitCalls += 1; },
  });
  const res = createResponse();
  handler({ params: { id: 'post-1' }, sessionID: 'session-1' }, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.payload.code, 'already_requested');
  assert.equal(rateLimitCalls, 0);
  assert.equal(db.prepare('SELECT COUNT(1) AS count FROM post_feature_requests').get().count, 1);
  db.close();
});

test('不同身份可以申请同一帖子，已加精帖子不能再次申请', () => {
  const db = createDb();
  const first = registerHarness({ db, identityKey: 'canonical-1', legacyFingerprint: 'legacy-1' });
  first.handler({ params: { id: 'post-1' }, sessionID: 'session-1' }, createResponse());
  const second = registerHarness({ db, identityKey: 'canonical-2', legacyFingerprint: 'legacy-2' });
  const secondRes = createResponse();
  second.handler({ params: { id: 'post-1' }, sessionID: 'session-2' }, secondRes);
  assert.equal(secondRes.statusCode, 201);
  assert.equal(db.prepare('SELECT COUNT(1) AS count FROM post_feature_requests').get().count, 2);

  db.prepare('UPDATE posts SET featured = 1, featured_at = 2000 WHERE id = ?').run('post-1');
  const third = registerHarness({ db, identityKey: 'canonical-3', legacyFingerprint: 'legacy-3' });
  const thirdRes = createResponse();
  third.handler({ params: { id: 'post-1' }, sessionID: 'session-3' }, thirdRes);
  assert.equal(thirdRes.statusCode, 409);
  assert.equal(thirdRes.payload.code, 'already_featured');
  db.close();
});
