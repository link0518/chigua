import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { createEquippedCosmeticsService } from '../equipped-cosmetics-service.js';
import { importFramePackage, initFrameService } from '../frame-service.js';
import { initNameStyleService } from '../name-style-service.js';

const createDb = () => {
  const db = new Database(':memory:');
  initFrameService(db);
  initNameStyleService(db);
  db.exec(`
    CREATE TABLE user_cosmetics (
      identity_key TEXT PRIMARY KEY,
      owned_frames_json TEXT NOT NULL DEFAULT '[]',
      equipped_frame_id TEXT,
      owned_name_styles_json TEXT NOT NULL DEFAULT '[]',
      equipped_name_style_id TEXT
    );
  `);
  importFramePackage({
    schemaVersion: 2,
    frame: {
      id: 'timed-frame',
      name: '限时头像框',
      price: 10,
      rarity: 'common',
      status: 'on_sale',
      sort: 1,
      grantOnRegister: false,
    },
    render: {
      engine: 'css-slots-v1',
      html: 'default-v1',
      css: '.fg-root{display:flex}.fg-shell{border:1px solid #000}',
    },
  }, { mode: 'create' });
  return db;
};

test('有效期内的头像框和昵称颜色可以写入新内容快照', () => {
  const db = createDb();
  const now = Date.now();
  db.prepare(`
    INSERT INTO user_cosmetics (
      identity_key, owned_frames_json, equipped_frame_id,
      owned_name_styles_json, equipped_name_style_id
    ) VALUES (?, ?, ?, ?, ?)
  `).run(
    'identity-active',
    JSON.stringify([{ id: 'timed-frame', expiresAt: now + 60_000 }]),
    'timed-frame',
    JSON.stringify([{ id: 'vip-red', expiresAt: now + 60_000 }]),
    'vip-red'
  );

  const service = createEquippedCosmeticsService(db);
  assert.equal(service.getEquippedFrameIdForIdentity('identity-active'), 'timed-frame');
  assert.equal(service.getEquippedNameStyleIdForIdentity('identity-active'), 'vip-red');
  db.close();
});

test('权益过期后残留的装备 ID 不得写入新内容快照', () => {
  const db = createDb();
  const now = Date.now();
  db.prepare(`
    INSERT INTO user_cosmetics (
      identity_key, owned_frames_json, equipped_frame_id,
      owned_name_styles_json, equipped_name_style_id
    ) VALUES (?, ?, ?, ?, ?)
  `).run(
    'identity-expired',
    JSON.stringify([{ id: 'timed-frame', expiresAt: now - 1 }]),
    'timed-frame',
    JSON.stringify([{ id: 'vip-red', expiresAt: now - 1 }]),
    'vip-red'
  );

  const service = createEquippedCosmeticsService(db);
  assert.equal(service.getEquippedFrameIdForIdentity('identity-expired'), null);
  assert.equal(service.getEquippedNameStyleIdForIdentity('identity-expired'), null);
  db.close();
});

test('仅有装备 ID 但没有拥有记录时不得使用装扮', () => {
  const db = createDb();
  db.prepare(`
    INSERT INTO user_cosmetics (
      identity_key, owned_frames_json, equipped_frame_id,
      owned_name_styles_json, equipped_name_style_id
    ) VALUES (?, '[]', ?, '[]', ?)
  `).run('identity-unowned', 'timed-frame', 'vip-red');

  const service = createEquippedCosmeticsService(db);
  assert.equal(service.getEquippedFrameIdForIdentity('identity-unowned'), null);
  assert.equal(service.getEquippedNameStyleIdForIdentity('identity-unowned'), null);
  db.close();
});
