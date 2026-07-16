import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import Database from 'better-sqlite3';

test('database bootstrap does not require cosmetic catalog tables to exist first', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chigua-db-startup-'));
  const dbModuleUrl = pathToFileURL(path.resolve(process.cwd(), 'server', 'db.js')).href;
  const script = `
    const mod = await import(${JSON.stringify(dbModuleUrl)});
    const tables = mod.db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('post_feature_requests', 'posts', 'user_cosmetics') ORDER BY name"
    ).all().map((row) => row.name);
    const postColumns = mod.db.prepare('PRAGMA table_info(posts)').all().map((row) => row.name);
    const featureRequestColumns = mod.db.prepare('PRAGMA table_info(post_feature_requests)').all().map((row) => row.name);
    mod.db.close();
    console.log(JSON.stringify({ tables, postColumns, featureRequestColumns }));
  `;

  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: tempDir,
    encoding: 'utf8',
  });

  try {
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout.trim());
    assert.deepEqual(payload.tables, ['post_feature_requests', 'posts', 'user_cosmetics']);
    assert.ok(payload.postColumns.includes('featured'));
    assert.ok(payload.postColumns.includes('featured_at'));
    assert.ok(payload.featureRequestColumns.includes('requester_legacy_fingerprint'));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('database bootstrap migrates legacy Wiki rows with empty related posts and attachments idempotently', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chigua-db-wiki-migration-'));
  const dataDir = path.join(tempDir, 'server', 'data');
  const databasePath = path.join(dataDir, 'app.db');
  fs.mkdirSync(dataDir, { recursive: true });
  const legacyDb = new Database(databasePath);
  legacyDb.exec(`
    CREATE TABLE wiki_entries (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      narrative TEXT NOT NULL,
      tags TEXT,
      display_order INTEGER,
      status TEXT NOT NULL DEFAULT 'approved',
      current_revision_id TEXT,
      version_number INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0,
      deleted_at INTEGER
    );
    INSERT INTO wiki_entries (
      id,
      slug,
      name,
      narrative,
      tags,
      display_order,
      status,
      current_revision_id,
      version_number,
      created_at,
      updated_at,
      deleted,
      deleted_at
    ) VALUES (
      'legacy-wiki-entry',
      'legacy-wiki-entry',
      '旧瓜条',
      '旧数据保持不变',
      '["旧数据"]',
      7,
      'approved',
      'legacy-revision',
      3,
      100,
      200,
      0,
      NULL
    );
  `);
  legacyDb.close();

  const dbModuleUrl = pathToFileURL(path.resolve(process.cwd(), 'server', 'db.js')).href;
  const script = `
    const mod = await import(${JSON.stringify(dbModuleUrl)});
    const columns = mod.db.prepare('PRAGMA table_info(wiki_entries)').all().map((row) => row.name);
    const row = mod.db.prepare(
      'SELECT id, version_number, related_post_ids_json, attachments_json FROM wiki_entries WHERE id = ?'
    ).get('legacy-wiki-entry');
    const integrity = mod.db.pragma('integrity_check', { simple: true });
    const count = mod.db.prepare('SELECT COUNT(1) AS count FROM wiki_entries').get().count;
    mod.db.close();
    console.log(JSON.stringify({ columns, row, integrity, count }));
  `;

  const runBootstrap = () => spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: tempDir,
    encoding: 'utf8',
  });

  try {
    const first = runBootstrap();
    assert.equal(first.status, 0, first.stderr || first.stdout);
    const firstResult = JSON.parse(first.stdout.trim());
    assert.ok(firstResult.columns.includes('related_post_ids_json'));
    assert.ok(firstResult.columns.includes('attachments_json'));
    assert.deepEqual(firstResult.row, {
      id: 'legacy-wiki-entry',
      version_number: 3,
      related_post_ids_json: '[]',
      attachments_json: '[]',
    });
    assert.equal(firstResult.count, 1);
    assert.equal(firstResult.integrity, 'ok');

    const second = runBootstrap();
    assert.equal(second.status, 0, second.stderr || second.stdout);
    const secondResult = JSON.parse(second.stdout.trim());
    assert.deepEqual(secondResult.row, firstResult.row);
    assert.equal(secondResult.count, 1);
    assert.equal(secondResult.integrity, 'ok');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
