import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { initFrameService, getEquippedFrameIdIfValid, importFramePackage } from '../frame-service.js';

/**
 * 模拟 mapPostRow 的 authorFrameId 规则：只使用帖子快照列，不回查当前装备。
 */
const mapPostAuthorFrame = (row) => ({
  id: row.id,
  authorFrameId: row.author_frame_id || null,
});

test('post authorFrameId is snapshot-only; old posts stay null', () => {
  const db = new Database(':memory:');
  initFrameService(db);

  db.exec(`
    CREATE TABLE posts (
      id TEXT PRIMARY KEY,
      content TEXT,
      author TEXT,
      author_frame_id TEXT,
      fingerprint TEXT
    );
    CREATE TABLE user_cosmetics (
      identity_key TEXT PRIMARY KEY,
      equipped_frame_id TEXT
    );
  `);

  importFramePackage({
    schemaVersion: 2,
    frame: {
      id: 'snap-frame',
      name: '快照框',
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

  // 旧帖：无快照
  db.prepare('INSERT INTO posts (id, content, author, author_frame_id, fingerprint) VALUES (?, ?, ?, ?, ?)')
    .run('old-post', 'old', '匿名', null, 'fp-1');

  // 用户装备后新帖写入快照
  db.prepare('INSERT INTO user_cosmetics (identity_key, equipped_frame_id) VALUES (?, ?)')
    .run('fp-1', 'snap-frame');
  const equipped = getEquippedFrameIdIfValid(
    db.prepare('SELECT equipped_frame_id FROM user_cosmetics WHERE identity_key = ?').get('fp-1')?.equipped_frame_id
  );
  assert.equal(equipped, 'snap-frame');

  db.prepare('INSERT INTO posts (id, content, author, author_frame_id, fingerprint) VALUES (?, ?, ?, ?, ?)')
    .run('new-post', 'new', '匿名', equipped, 'fp-1');

  // 换装不影响旧帖与已快照帖
  db.prepare('UPDATE user_cosmetics SET equipped_frame_id = NULL WHERE identity_key = ?').run('fp-1');

  const oldMapped = mapPostAuthorFrame(db.prepare('SELECT * FROM posts WHERE id = ?').get('old-post'));
  const newMapped = mapPostAuthorFrame(db.prepare('SELECT * FROM posts WHERE id = ?').get('new-post'));

  assert.equal(oldMapped.authorFrameId, null);
  assert.equal(newMapped.authorFrameId, 'snap-frame');
});
