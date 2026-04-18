import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { registerAdminRumorsRoutes } from '../routes/admin/rumors-routes.js';

const createDb = () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE reports (
      id TEXT PRIMARY KEY,
      post_id TEXT,
      comment_id TEXT,
      target_type TEXT NOT NULL,
      reason TEXT,
      reason_code TEXT,
      evidence TEXT,
      content_snippet TEXT,
      created_at INTEGER NOT NULL,
      status TEXT NOT NULL,
      risk_level TEXT,
      fingerprint TEXT,
      reporter_ip TEXT,
      action TEXT,
      resolved_at INTEGER
    );

    CREATE TABLE posts (
      id TEXT PRIMARY KEY,
      content TEXT,
      ip TEXT,
      session_id TEXT,
      fingerprint TEXT,
      rumor_status TEXT,
      rumor_status_updated_at INTEGER
    );

    CREATE TABLE comments (
      id TEXT PRIMARY KEY,
      post_id TEXT,
      content TEXT,
      ip TEXT,
      fingerprint TEXT,
      rumor_status TEXT,
      rumor_status_updated_at INTEGER
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

const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

const createHarness = (overrides = {}) => {
  const db = createDb();
  const app = createApp();

  registerAdminRumorsRoutes(app, {
    db,
    requireAdmin: (_req, _res, next) => next(),
    requireAdminCsrf: (_req, _res, next) => next(),
    logAdminAction: () => {},
    resolveStoredIdentityHash: () => null,
    wecomWebhookService: overrides.wecomWebhookService,
  });

  return { db, routes: app.routes };
};

test('admin rumors groups pending rumor reports by target', async () => {
  const { db, routes } = createHarness();
  db.prepare(`
    INSERT INTO posts (id, content, ip, session_id, fingerprint, rumor_status, rumor_status_updated_at)
    VALUES ('post-1', '帖子内容', '127.0.0.1', 'session-1', 'fp-post-1', NULL, NULL)
  `).run();
  db.prepare(`
    INSERT INTO reports (id, post_id, comment_id, target_type, reason, reason_code, evidence, content_snippet, created_at, status, risk_level, fingerprint, reporter_ip)
    VALUES
      ('report-1', 'post-1', NULL, 'post', '举报谣言', 'rumor', '截图与公告时间不一致', 'snippet-1', 1000, 'pending', 'medium', 'user-a', '127.0.0.2'),
      ('report-2', 'post-1', NULL, 'post', '举报谣言', 'rumor', '没有可信来源', 'snippet-2', 2000, 'pending', 'medium', 'user-b', '127.0.0.3')
  `).run();

  const res = await runHandlers(routes.get('GET /api/admin/rumors'), {
    query: { status: 'pending', page: '1', limit: '10' },
  });
  await flushAsync();

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.total, 1);
  assert.equal(res.payload.items[0].targetId, 'post-1');
  assert.equal(res.payload.items[0].pendingReportCount, 2);
  assert.equal(res.payload.items[0].reportCount, 2);
  assert.equal(res.payload.items[0].evidenceSamples.length, 2);

  db.close();
});

test('admin rumors can mark target as suspected and resolve pending rumor reports without sending webhook', async () => {
  const webhookCalls = [];
  const { db, routes } = createHarness({
    wecomWebhookService: {
      notifyRumorPending(payload) {
        webhookCalls.push(payload);
      },
    },
  });
  db.prepare(`
    INSERT INTO posts (id, content, ip, session_id, fingerprint, rumor_status, rumor_status_updated_at)
    VALUES ('post-2', '帖子内容', '127.0.0.1', 'session-2', 'fp-post-2', NULL, NULL)
  `).run();
  db.prepare(`
    INSERT INTO reports (id, post_id, comment_id, target_type, reason, reason_code, evidence, content_snippet, created_at, status, risk_level, fingerprint, reporter_ip)
    VALUES ('report-3', 'post-2', NULL, 'post', '举报谣言', 'rumor', '证据', 'snippet-3', 3000, 'pending', 'medium', 'user-c', '127.0.0.4')
  `).run();

  const res = await runHandlers(routes.get('POST /api/admin/rumors/:targetType/:targetId/action'), {
    params: { targetType: 'post', targetId: 'post-2' },
    body: { action: 'mark', reason: '管理员判定' },
  });
  await flushAsync();

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.rumorStatus, 'suspected');
  assert.equal(res.payload.resolvedCount, 1);

  const post = db.prepare('SELECT rumor_status FROM posts WHERE id = ?').get('post-2');
  assert.equal(post.rumor_status, 'suspected');

  const report = db.prepare('SELECT status, action FROM reports WHERE id = ?').get('report-3');
  assert.equal(report.status, 'resolved');
  assert.equal(report.action, 'rumor_marked');
  assert.equal(webhookCalls.length, 0);

  db.close();
});

test('admin rumors can clear comment rumor status without sending webhook', async () => {
  const webhookCalls = [];
  const { db, routes } = createHarness({
    wecomWebhookService: {
      notifyRumorPending(payload) {
        webhookCalls.push(payload);
      },
    },
  });
  db.prepare(`
    INSERT INTO comments (id, post_id, content, ip, fingerprint, rumor_status, rumor_status_updated_at)
    VALUES ('comment-1', 'post-9', '评论内容', '127.0.0.1', 'fp-comment-1', 'suspected', 1000)
  `).run();

  const res = await runHandlers(routes.get('POST /api/admin/rumors/:targetType/:targetId/action'), {
    params: { targetType: 'comment', targetId: 'comment-1' },
    body: { action: 'clear', reason: '误判撤回' },
  });
  await flushAsync();

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.rumorStatus, null);
  assert.equal(res.payload.resolvedCount, 0);

  const comment = db.prepare('SELECT rumor_status FROM comments WHERE id = ?').get('comment-1');
  assert.equal(comment.rumor_status, null);
  assert.equal(webhookCalls.length, 0);

  db.close();
});
