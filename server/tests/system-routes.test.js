import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { getNotificationRecipientValues } from '../routes/public/system-routes.js';

const createNotificationsDb = () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE notifications (
      id TEXT PRIMARY KEY,
      recipient_fingerprint TEXT,
      created_at INTEGER,
      read_at INTEGER
    );
  `);
  return db;
};

const buildIdentityMatch = (column, values) => {
  const normalizedValues = Array.from(new Set(
    (Array.isArray(values) ? values : [values])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  ));
  if (!normalizedValues.length) {
    return { clause: '1 = 0', params: [] };
  }
  if (normalizedValues.length === 1) {
    return { clause: `${column} = ?`, params: normalizedValues };
  }
  return {
    clause: `${column} IN (${normalizedValues.map(() => '?').join(', ')})`,
    params: normalizedValues,
  };
};

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
