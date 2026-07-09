import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { initFrameService, importFramePackage, patchFrame } from '../frame-service.js';
import { createNameStyle, initNameStyleService, patchNameStyle } from '../name-style-service.js';
import { registerPublicShopRoutes } from '../routes/public/shop-routes.js';

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

const createDb = () => {
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
  initNameStyleService(db);
  return db;
};

const validFramePackage = (id) => ({
  schemaVersion: 2,
  frame: {
    id,
    name: '下架测试框',
    price: 20,
    rarity: 'rare',
    status: 'on_sale',
    sort: 1,
    grantOnRegister: false,
  },
  render: {
    engine: 'css-slots-v1',
    html: 'default-v1',
    css: '.fg-root{display:inline-flex}.fg-shell{border:1px solid #000}',
  },
});

const registerShopHarness = (db, extras = {}) => {
  const app = createApp();
  registerPublicShopRoutes(app, {
    db,
    requireFingerprint: () => 'identity-1',
    formatDateKey: () => '2026-07-09',
    getShopEnabled: () => true,
    ...extras,
  });
  return app.routes;
};

test('me shop includes owned off-sale cosmetics as inventory items', () => {
  const db = createDb();

  importFramePackage(validFramePackage('off-sale-frame'), { mode: 'create' });
  patchFrame('off-sale-frame', { status: 'off_sale' });
  createNameStyle({
    id: 'off-sale-name',
    name: '下架昵称',
    price: 30,
    rarity: 'rare',
    status: 'on_sale',
    color: { r: 37, g: 99, b: 235 },
  });
  patchNameStyle('off-sale-name', { status: 'off_sale' });

  db.prepare(`
    INSERT INTO user_cosmetics (
      identity_key, coins, owned_frames_json, equipped_frame_id,
      owned_name_styles_json, equipped_name_style_id,
      last_daily_claim_date, updated_at
    ) VALUES (?, 100, ?, ?, ?, ?, NULL, ?)
  `).run(
    'identity-1',
    JSON.stringify(['off-sale-frame']),
    'off-sale-frame',
    JSON.stringify(['off-sale-name']),
    'off-sale-name',
    Date.now(),
  );

  const routes = registerShopHarness(db);
  const handler = routes.get('GET /api/me/shop');
  const res = createResponse();

  handler({}, res);

  assert.equal(res.statusCode, 200);
  const frame = res.payload.catalog.find((item) => item.id === 'off-sale-frame');
  assert.ok(frame, 'owned off-sale frame should stay visible in inventory');
  assert.equal(frame.owned, true);
  assert.equal(frame.equipped, true);

  const nameStyle = res.payload.nameStyles.find((item) => item.id === 'off-sale-name');
  assert.ok(nameStyle, 'owned off-sale name style should stay visible in inventory');
  assert.equal(nameStyle.owned, true);
  assert.equal(nameStyle.equipped, true);

  db.close();
});

test('shop closed returns 403', () => {
  const db = createDb();
  const routes = registerShopHarness(db, { getShopEnabled: () => false });
  const handler = routes.get('GET /api/me/shop');
  const res = createResponse();
  handler({}, res);
  assert.equal(res.statusCode, 403);
  assert.match(String(res.payload?.error || ''), /商城/);
  db.close();
});

test('redeem frame with price tier', () => {
  const db = createDb();
  importFramePackage(validFramePackage('tier-frame'), { mode: 'create' });
  patchFrame('tier-frame', {
    priceTiers: [
      { price: 10, durationDays: 1 },
      { price: 70, durationDays: 7 },
    ],
  });

  db.prepare(`
    INSERT INTO user_cosmetics (
      identity_key, coins, owned_frames_json, equipped_frame_id,
      owned_name_styles_json, equipped_name_style_id,
      last_daily_claim_date, updated_at
    ) VALUES (?, 100, '[]', NULL, '[]', NULL, NULL, ?)
  `).run('identity-1', Date.now());

  const routes = registerShopHarness(db);
  const listHandler = routes.get('GET /api/me/shop');
  const listRes = createResponse();
  listHandler({}, listRes);
  const item = listRes.payload.catalog.find((f) => f.id === 'tier-frame');
  assert.ok(item);
  assert.equal(item.priceTiers.length, 2);

  const weekTier = item.priceTiers.find((t) => t.durationDays === 7);
  assert.ok(weekTier);

  const redeem = routes.get('POST /api/me/shop/redeem');
  const redeemRes = createResponse();
  redeem({ body: { frameId: 'tier-frame', tierId: weekTier.id } }, redeemRes);
  assert.equal(redeemRes.statusCode, 200);
  assert.equal(redeemRes.payload.coins, 30); // 100 - 70
  const owned = redeemRes.payload.catalog.find((f) => f.id === 'tier-frame');
  assert.equal(owned.owned, true);
  assert.ok(owned.expiresAt > Date.now());

  db.close();
});
