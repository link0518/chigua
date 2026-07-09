import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

test('database bootstrap does not require cosmetic catalog tables to exist first', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chigua-db-startup-'));
  const dbModuleUrl = pathToFileURL(path.resolve(process.cwd(), 'server', 'db.js')).href;
  const script = `
    const mod = await import(${JSON.stringify(dbModuleUrl)});
    const tables = mod.db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('posts', 'user_cosmetics') ORDER BY name"
    ).all().map((row) => row.name);
    mod.db.close();
    console.log(JSON.stringify(tables));
  `;

  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: tempDir,
    encoding: 'utf8',
  });

  try {
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(JSON.parse(result.stdout.trim()), ['posts', 'user_cosmetics']);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
