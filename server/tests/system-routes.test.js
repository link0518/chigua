import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import Database from 'better-sqlite3';
import { getNotificationRecipientValues, registerPublicSystemRoutes } from '../routes/public/system-routes.js';
import { buildIdentityMatch } from '../sql-utils.js';

const createNotificationsDb = () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE notifications (
      id TEXT PRIMARY KEY,
      recipient_fingerprint TEXT,
      type TEXT,
      post_id TEXT,
      comment_id TEXT,
      preview TEXT,
      created_at INTEGER,
      read_at INTEGER
    );
  `);
  return db;
};

test('通用通知可在同一响应中聚合招募通知', () => {
  const db = createNotificationsDb();
  db.prepare(
    'INSERT INTO notifications (id, recipient_fingerprint, type, created_at) VALUES (?, ?, ?, ?)'
  ).run('general-1', 'canonical-1', 'post_like', 10);
  const app = createRouteApp();
  const recruitmentCalls = [];
  registerPublicSystemRoutes(app, {
    db,
    requireFingerprint: () => 'canonical-1',
    getIdentityLookupHashes: () => ['canonical-1'],
    getRequestIdentityContext: () => ({ canonicalHash: 'canonical-1' }),
    checkBanFor: () => true,
    touchOnlineSession: () => {},
    getOnlineCount: () => 1,
    formatDateKey: () => '2026-07-24',
    verifyTurnstile: async () => ({ ok: true }),
    getClientIp: () => '127.0.0.1',
    getRateLimitConfig: () => ({ limit: 10, windowMs: 60_000 }),
    crypto,
    listRecruitmentNotifications: (params) => {
      recruitmentCalls.push(params);
      return {
        items: [{ id: 'recruitment-1', type: 'recruitment_message', createdAt: 20 }],
        unreadCount: 1,
      };
    },
  });

  const res = createResponse();
  app.routes.get('GET /api/notifications')({
    query: { status: 'all', limit: '20', includeRecruitment: '1' },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload.items.map((item) => item.id), ['general-1']);
  assert.deepEqual(res.payload.recruitment.items.map((item) => item.id), ['recruitment-1']);
  assert.deepEqual(recruitmentCalls, [{ identityHash: 'canonical-1', page: 1, limit: 20 }]);
  assert.equal(res.getHeader('cache-control'), 'private, no-store, max-age=0');
  assert.match(res.getHeader('vary'), /Cookie/);
  assert.match(res.getHeader('vary'), /X-Client-Fingerprint/);
  db.close();
});

test('通知查询同时命中旧指纹和新身份，不依赖通知创建时间', () => {
  const db = createNotificationsDb();
  const match = buildIdentityMatch('recipient_fingerprint', getNotificationRecipientValues({
    canonicalHash: 'canonical-1',
    legacyFingerprintHash: 'legacy-1',
  }));

  db.prepare(
    'INSERT INTO notifications (id, recipient_fingerprint, created_at, read_at) VALUES (?, ?, ?, ?)'
  ).run('legacy-after-cutover', 'legacy-1', Date.UTC(2026, 2, 9), null);
  db.prepare(
    'INSERT INTO notifications (id, recipient_fingerprint, created_at, read_at) VALUES (?, ?, ?, ?)'
  ).run('canonical-after-cutover', 'canonical-1', Date.UTC(2026, 2, 9, 1), null);
  db.prepare(
    'INSERT INTO notifications (id, recipient_fingerprint, created_at, read_at) VALUES (?, ?, ?, ?)'
  ).run('legacy-read', 'legacy-1', Date.UTC(2026, 2, 7, 23), Date.UTC(2026, 2, 9, 2));

  const unreadCount = db
    .prepare(`SELECT COUNT(1) AS count FROM notifications WHERE ${match.clause} AND read_at IS NULL`)
    .get(...match.params).count;
  const totalCount = db
    .prepare(`SELECT COUNT(1) AS count FROM notifications WHERE ${match.clause}`)
    .get(...match.params).count;
  const updated = db
    .prepare(`UPDATE notifications SET read_at = ? WHERE ${match.clause} AND read_at IS NULL`)
    .run(Date.UTC(2026, 2, 9, 3), ...match.params).changes;

  assert.equal(unreadCount, 2);
  assert.equal(totalCount, 3);
  assert.equal(updated, 2);

  db.close();
});

test('通知接收键会去重并忽略空值', () => {
  assert.deepEqual(
    getNotificationRecipientValues({
      canonicalHash: 'same-key',
      legacyFingerprintHash: 'same-key',
    }),
    ['same-key']
  );

  assert.deepEqual(getNotificationRecipientValues({}), []);
});
const createRouteApp = () => {
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
  const headers = new Map();
  return {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      payload = data;
      return this;
    },
    set(name, value) {
      headers.set(String(name).toLowerCase(), String(value));
      return this;
    },
    vary(name) {
      const key = 'vary';
      const values = new Set(
        String(headers.get(key) || '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      );
      values.add(String(name));
      headers.set(key, Array.from(values).join(', '));
      return this;
    },
    getHeader(name) {
      return headers.get(String(name).toLowerCase());
    },
    get statusCode() {
      return statusCode;
    },
    get payload() {
      return payload;
    },
  };
};

const createFeedbackDb = () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE feedback_messages (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      email TEXT NOT NULL,
      wechat TEXT,
      qq TEXT,
      created_at INTEGER NOT NULL,
      session_id TEXT,
      ip TEXT,
      fingerprint TEXT,
      read_at INTEGER
    );
  `);
  return db;
};

test('新留言成功落库后触发企业微信后台提醒', async () => {
  const db = createFeedbackDb();
  const app = createRouteApp();
  const wecomMessages = [];
  registerPublicSystemRoutes(app, {
    db,
    requireFingerprint: () => 'fp-1',
    getIdentityLookupHashes: () => ['fp-1'],
    getRequestIdentityContext: () => ({ canonicalHash: 'fp-1', legacyFingerprintHash: 'fp-1' }),
    checkBanFor: () => true,
    touchOnlineSession: () => {},
    getOnlineCount: () => 1,
    formatDateKey: () => '2026-04-11',
    verifyTurnstile: async () => ({ ok: true }),
    getClientIp: () => '127.0.0.1',
    getRateLimitConfig: () => ({ limit: 10, windowMs: 60 * 60 * 1000 }),
    crypto,
    wecomWebhookService: {
      notifyFeedbackMessage: (payload) => {
        wecomMessages.push(payload);
        return Promise.resolve({ ok: true });
      },
    },
  });

  const handler = app.routes.get('POST /api/feedback');
  const req = {
    body: { content: '这里有一个新留言', email: 'dev@example.com', wechat: 'wxid', qq: '12345' },
    sessionID: 'session-1',
  };
  const res = createResponse();

  await handler(req, res);

  assert.equal(res.statusCode, 201);
  assert.equal(wecomMessages.length, 1);
  assert.equal(wecomMessages[0].content, '这里有一个新留言');
  assert.equal(wecomMessages[0].email, 'dev@example.com');
  assert.ok(wecomMessages[0].feedbackId);
  assert.equal('ip' in wecomMessages[0], false);
  assert.equal('fingerprint' in wecomMessages[0], false);
  db.close();
});
