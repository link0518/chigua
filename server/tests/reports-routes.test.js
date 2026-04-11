import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import Database from 'better-sqlite3';
import { registerPublicReportsRoutes } from '../routes/public/reports-routes.js';
import { AUTO_HIDE_THRESHOLD, createHiddenContentService } from '../services/hidden-content-service.js';

const createDb = () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE posts (
      id TEXT PRIMARY KEY,
      content TEXT,
      deleted INTEGER NOT NULL DEFAULT 0,
      hidden INTEGER NOT NULL DEFAULT 0,
      hidden_at INTEGER,
      hidden_review_status TEXT,
      comments_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER
    );

    CREATE TABLE comments (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      content TEXT,
      deleted INTEGER NOT NULL DEFAULT 0,
      hidden INTEGER NOT NULL DEFAULT 0,
      hidden_at INTEGER,
      hidden_review_status TEXT,
      created_at INTEGER
    );

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
      reporter_ip TEXT,
      action TEXT,
      resolved_at INTEGER
    );

    CREATE TABLE report_sessions (
      post_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (post_id, session_id)
    );

    CREATE TABLE report_fingerprints (
      post_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (post_id, fingerprint)
    );

    CREATE TABLE comment_report_sessions (
      comment_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (comment_id, session_id)
    );

    CREATE TABLE comment_report_fingerprints (
      comment_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (comment_id, fingerprint)
    );
  `);
  return db;
};

const createApp = () => {
  const routes = new Map();
  return {
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

const insertPost = (db, id = 'post-1') => {
  db.prepare(`
    INSERT INTO posts (id, content, deleted, hidden, comments_count, created_at)
    VALUES (?, ?, 0, 0, 0, ?)
  `).run(id, 'post content for webhook', Date.now() - 5000);
};

const insertPendingPostReports = (db, postId, count) => {
  const createdAt = Date.now() - 2000;
  for (let index = 0; index < count; index += 1) {
    db.prepare(`
      INSERT INTO reports (id, post_id, comment_id, target_type, reason, content_snippet, created_at, status, risk_level, fingerprint, reporter_ip)
      VALUES (?, ?, NULL, 'post', 'seed', 'seed snippet', ?, 'pending', 'low', ?, '127.0.0.1')
    `).run(`seed-report-${index}`, postId, createdAt + index, `seed-fp-${index}`);
  }
};

const registerRoute = (db, wecomMessages) => {
  const app = createApp();
  const hiddenContentService = createHiddenContentService({ db, logAdminAction: () => {} });
  registerPublicReportsRoutes(app, {
    db,
    requireFingerprint: () => 'reporter-fp',
    getIdentityLookupHashes: () => ['reporter-fp'],
    enforceRateLimit: () => true,
    checkBanFor: () => true,
    getClientIp: () => '127.0.0.9',
    crypto,
    incrementDailyStat: () => {},
    formatDateKey: () => '2026-04-11',
    hiddenContentService,
    wecomWebhookService: {
      notifyHiddenContent: (payload) => {
        wecomMessages.push(payload);
        return Promise.resolve({ ok: true });
      },
    },
  });
  return app.routes.get('POST /api/reports');
};

test('举报触发帖子自动隐藏时推送企业微信待审提醒', () => {
  const db = createDb();
  const wecomMessages = [];
  insertPost(db, 'post-1');
  insertPendingPostReports(db, 'post-1', AUTO_HIDE_THRESHOLD - 1);
  const handler = registerRoute(db, wecomMessages);
  const res = createResponse();

  handler({ body: { postId: 'post-1', reason: '广告' }, sessionID: 'session-new' }, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.payload.autoHidden, true);
  assert.equal(wecomMessages.length, 1);
  assert.equal(wecomMessages[0].targetType, 'post');
  assert.equal(wecomMessages[0].targetId, 'post-1');
  assert.equal(wecomMessages[0].pendingReportCount, AUTO_HIDE_THRESHOLD);
  assert.equal('ip' in wecomMessages[0], false);
  assert.equal('fingerprint' in wecomMessages[0], false);
  assert.equal(db.prepare('SELECT hidden FROM posts WHERE id = ?').get('post-1').hidden, 1);
  db.close();
});

test('举报未达到自动隐藏阈值时不推送企业微信待审提醒', () => {
  const db = createDb();
  const wecomMessages = [];
  insertPost(db, 'post-2');
  insertPendingPostReports(db, 'post-2', AUTO_HIDE_THRESHOLD - 2);
  const handler = registerRoute(db, wecomMessages);
  const res = createResponse();

  handler({ body: { postId: 'post-2', reason: '广告' }, sessionID: 'session-new' }, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.payload.autoHidden, false);
  assert.equal(wecomMessages.length, 0);
  assert.equal(db.prepare('SELECT hidden FROM posts WHERE id = ?').get('post-2').hidden, 0);
  db.close();
});

test('已隐藏帖子无法再次举报并不会重复推送企业微信提醒', () => {
  const db = createDb();
  const wecomMessages = [];
  db.prepare(`
    INSERT INTO posts (id, content, deleted, hidden, hidden_at, hidden_review_status, comments_count, created_at)
    VALUES (?, ?, 0, 1, ?, 'pending', 0, ?)
  `).run('post-hidden', 'already hidden', Date.now() - 1000, Date.now() - 5000);
  const handler = registerRoute(db, wecomMessages);
  const res = createResponse();

  handler({ body: { postId: 'post-hidden', reason: '广告' }, sessionID: 'session-new' }, res);

  assert.equal(res.statusCode, 404);
  assert.equal(wecomMessages.length, 0);
  db.close();
});

