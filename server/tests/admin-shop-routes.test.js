import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { registerAdminShopRoutes } from '../routes/admin/shop-routes.js';
import { initFrameService } from '../frame-service.js';

const createApp = () => {
  const routes = new Map();
  return {
    get(path, ...handlers) {
      routes.set(`GET ${path}`, handlers[handlers.length - 1]);
    },
    post(path, ...handlers) {
      routes.set(`POST ${path}`, handlers[handlers.length - 1]);
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

test('admin shop lookup and adjust coins by fingerprint', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE user_cosmetics (
      identity_key TEXT PRIMARY KEY,
      coins INTEGER NOT NULL DEFAULT 0,
      owned_frames_json TEXT NOT NULL DEFAULT '[]',
      equipped_frame_id TEXT,
      owned_name_styles_json TEXT NOT NULL DEFAULT '[]',
      equipped_name_style_id TEXT,
      last_daily_claim_date TEXT,
      updated_at INTEGER NOT NULL
    );
  `);
  initFrameService(db);

  const actions = [];
  const app = createApp();
  registerAdminShopRoutes(app, {
    db,
    requireAdmin: (_req, _res, next) => next(),
    requireAdminCsrf: (_req, _res, next) => next(),
    requireAdminRead: (_req, _res, next) => next(),
    requireAdminManage: (_req, _res, next) => next(),
    logAdminAction: (_req, entry) => actions.push(entry),
  });

  const getHandler = app.routes.get('GET /api/admin/shop/users');
  const postHandler = app.routes.get('POST /api/admin/shop/users/coins');

  const lookupMissing = createResponse();
  getHandler({ query: { fingerprint: 'fp-user-1' } }, lookupMissing);
  assert.equal(lookupMissing.statusCode, 200);
  assert.equal(lookupMissing.payload.user.exists, false);
  assert.equal(lookupMissing.payload.user.coins, 0);

  const addRes = createResponse();
  postHandler({ body: { fingerprint: 'fp-user-1', delta: 50 } }, addRes);
  assert.equal(addRes.statusCode, 200);
  assert.equal(addRes.payload.afterCoins, 50);
  assert.equal(addRes.payload.user.exists, true);

  const subRes = createResponse();
  postHandler({ body: { fingerprint: 'fp-user-1', delta: -20 } }, subRes);
  assert.equal(subRes.payload.afterCoins, 30);

  const setRes = createResponse();
  postHandler({ body: { fingerprint: 'fp-user-1', coins: 8 } }, setRes);
  assert.equal(setRes.payload.afterCoins, 8);

  assert.ok(actions.some((a) => a.action === 'shop_coins_adjust'));
  db.close();
});
