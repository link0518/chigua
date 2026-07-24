import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

test('数据库启动幂等创建招募表、软删除字段、外键与索引', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chigua-recruitment-db-'));
  const dbModuleUrl = pathToFileURL(path.resolve(process.cwd(), 'server', 'db.js')).href;
  const script = `
    const mod = await import(${JSON.stringify(dbModuleUrl)});
    const names = mod.db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'recruitment_%' ORDER BY name"
    ).all().map((row) => row.name);
    const indexes = mod.db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_recruitment_%' ORDER BY name"
    ).all().map((row) => row.name);
    const expiryQueryPlan = mod.db.prepare(
      "EXPLAIN QUERY PLAN SELECT 1 FROM recruitment_posts WHERE status = 'open' AND created_at <= ? LIMIT 1"
    ).all(Date.now()).map((row) => row.detail);
    const columns = (table) => mod.db.prepare('PRAGMA table_info(' + table + ')').all().map((row) => row.name);
    const payload = {
      names,
      indexes,
      expiryQueryPlan,
      messageColumns: columns('recruitment_messages'),
      threadColumns: columns('recruitment_threads'),
      contactColumns: columns('recruitment_contact_exchanges'),
      reportColumns: columns('recruitment_reports'),
      notificationColumns: columns('recruitment_notifications'),
      foreignKeyErrors: mod.db.pragma('foreign_key_check'),
      integrity: mod.db.pragma('integrity_check', { simple: true }),
    };
    mod.db.close();
    console.log(JSON.stringify(payload));
  `;
  const runBootstrap = () => spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: tempDir,
    encoding: 'utf8',
  });

  try {
    const first = runBootstrap();
    assert.equal(first.status, 0, first.stderr || first.stdout);
    const payload = JSON.parse(first.stdout.trim());
    assert.ok(payload.names.includes('recruitment_posts'));
    assert.ok(payload.names.includes('recruitment_report_evidence'));
    assert.ok(payload.names.includes('recruitment_message_moderation_events'));
    assert.equal(payload.names.includes('recruitment_bans'), false);
    assert.ok(payload.messageColumns.includes('moderation_status'));
    assert.ok(payload.messageColumns.includes('deleted_at'));
    assert.ok(payload.threadColumns.includes('locked_at'));
    assert.ok(payload.contactColumns.includes('deleted_at'));
    assert.ok(payload.reportColumns.includes('contact_exchange_id'));
    assert.equal(payload.notificationColumns.includes('preview'), false);
    assert.ok(payload.indexes.includes('idx_recruitment_posts_open_expiry'));
    assert.ok(payload.indexes.includes('idx_recruitment_messages_thread_seq'));
    assert.ok(payload.indexes.includes('idx_recruitment_message_moderation_events_thread_seq'));
    assert.ok(
      payload.expiryQueryPlan.some((detail) => detail.includes('idx_recruitment_posts_open_expiry')),
      `过期查询未使用开放招募索引：${payload.expiryQueryPlan.join('; ')}`,
    );
    assert.deepEqual(payload.foreignKeyErrors, []);
    assert.equal(payload.integrity, 'ok');

    const second = runBootstrap();
    assert.equal(second.status, 0, second.stderr || second.stdout);
    assert.deepEqual(JSON.parse(second.stdout.trim()), payload);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
