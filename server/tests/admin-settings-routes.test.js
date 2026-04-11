import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createSiteSettingsService } from '../site-settings.js';
import { registerAdminSettingsRoutes } from '../routes/admin/settings-routes.js';

const VALID_URL = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const createDb = () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
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

const createHarness = () => {
  const db = createDb();
  const settings = createSiteSettingsService({ db, turnstileSecretKey: '' });
  const app = createApp();
  const logs = [];
  const testCalls = [];

  registerAdminSettingsRoutes(app, {
    requireAdmin: (_req, _res, next) => next(),
    requireAdminCsrf: (_req, _res, next) => next(),
    buildSettingsResponse: settings.buildSettingsResponse,
    setTurnstileEnabled: settings.setTurnstileEnabled,
    setCnyThemeEnabled: settings.setCnyThemeEnabled,
    setDefaultPostTags: settings.setDefaultPostTags,
    setRateLimits: settings.setRateLimits,
    setAutoHideReportThreshold: settings.setAutoHideReportThreshold,
    setWecomWebhookConfig: settings.setWecomWebhookConfig,
    getTurnstileEnabled: settings.getTurnstileEnabled,
    getCnyThemeEnabled: settings.getCnyThemeEnabled,
    getDefaultPostTags: settings.getDefaultPostTags,
    getRateLimits: settings.getRateLimits,
    getAutoHideReportThreshold: settings.getAutoHideReportThreshold,
    getWecomWebhookPublicConfig: settings.getWecomWebhookPublicConfig,
    getWecomWebhookAuditConfig: settings.getWecomWebhookAuditConfig,
    wecomWebhookService: {
      sendTestMessage: async ({ url }) => {
        testCalls.push(url || '');
        return url === 'bad-test' ? { ok: false, error: 'failed' } : { ok: true };
      },
    },
    logAdminAction: (_req, payload) => logs.push(payload),
  });

  return { db, logs, testCalls, routes: app.routes, settings };
};

test('admin settings saves auto hide report threshold', async () => {
  const { db, logs, routes, settings } = createHarness();
  const res = await runHandlers(routes.get('POST /api/admin/settings'), {
    body: { autoHideReportThreshold: 3 },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.autoHideReportThreshold, 3);
  assert.equal(settings.getAutoHideReportThreshold(), 3);
  assert.equal(db.prepare('SELECT value FROM app_settings WHERE key = ?').get('auto_hide_report_threshold').value, '3');
  assert.equal(logs.at(-1).after.autoHideReportThreshold, 3);
  db.close();
});

test('后台设置保存企业微信 webhook 时只返回脱敏信息并写入脱敏审计日志', async () => {
  const { db, logs, routes } = createHarness();
  const res = await runHandlers(routes.get('POST /api/admin/settings'), {
    body: { wecomWebhook: { enabled: true, url: VALID_URL } },
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload.wecomWebhook, {
    enabled: true,
    configured: true,
    maskedUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=aaaa...eeee',
  });

  const stored = JSON.parse(db.prepare('SELECT value FROM app_settings WHERE key = ?').get('wecom_webhook').value);
  assert.equal(stored.enabled, true);
  assert.equal(stored.url, VALID_URL);

  const auditJson = JSON.stringify(logs);
  assert.ok(!auditJson.includes('eeeeeeeeeeee'));
  assert.ok(auditJson.includes('aaaa...eeee'));
  db.close();
});

test('后台设置支持清空企业微信 webhook 地址', async () => {
  const { db, routes } = createHarness();
  await runHandlers(routes.get('POST /api/admin/settings'), {
    body: { wecomWebhook: { enabled: true, url: VALID_URL } },
  });

  const res = await runHandlers(routes.get('POST /api/admin/settings'), {
    body: { wecomWebhook: { enabled: false, clearUrl: true } },
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload.wecomWebhook, { enabled: false, configured: false, maskedUrl: '' });
  db.close();
});

test('启用企业微信 webhook 但没有地址时返回 400', async () => {
  const { db, routes } = createHarness();
  const res = await runHandlers(routes.get('POST /api/admin/settings'), {
    body: { wecomWebhook: { enabled: true } },
  });

  assert.equal(res.statusCode, 400);
  assert.match(res.payload.error, /Webhook/);
  db.close();
});

test('企业微信 webhook 测试接口使用当前保存或本次传入地址', async () => {
  const { db, routes, testCalls } = createHarness();
  await runHandlers(routes.get('POST /api/admin/settings'), {
    body: { wecomWebhook: { enabled: true, url: VALID_URL } },
  });

  const savedRes = await runHandlers(routes.get('POST /api/admin/settings/wecom-webhook/test'), { body: {} });
  assert.equal(savedRes.statusCode, 200);
  assert.equal(testCalls.at(-1), '');

  const overrideRes = await runHandlers(routes.get('POST /api/admin/settings/wecom-webhook/test'), {
    body: { url: VALID_URL },
  });
  assert.equal(overrideRes.statusCode, 200);
  assert.equal(testCalls.at(-1), VALID_URL);
  db.close();
});
