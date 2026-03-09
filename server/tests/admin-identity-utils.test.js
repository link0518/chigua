import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createIdentityService } from '../identity-service.js';
import { buildAdminIdentity, buildAdminIdentitySearchValues } from '../admin-identity-utils.js';

const createCookieLib = () => ({
  parse() {
    return {};
  },
});

const createSchema = (db) => {
  db.exec(`
    CREATE TABLE identity_aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      canonical_hash TEXT NOT NULL,
      legacy_fingerprint_hash TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'request',
      first_seen_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      UNIQUE (canonical_hash, legacy_fingerprint_hash)
    );
  `);
};

const createHarness = () => {
  const db = new Database(':memory:');
  createSchema(db);
  const identityService = createIdentityService({
    db,
    cookie: createCookieLib(),
    sessionSecret: 'test-session-secret',
    fingerprintSalt: 'test-fingerprint-salt',
    fingerprintHeader: 'x-client-fingerprint',
  });
  return { db, identityService };
};

test('后台身份摘要在存在新身份映射时优先返回 identityKey=canonical', () => {
  const { db, identityService } = createHarness();
  identityService.upsertIdentityAlias('canonical-user', 'legacy-user', 'test');

  const summary = buildAdminIdentity({
    fingerprint: 'legacy-user',
    resolveStoredIdentityHash: identityService.resolveStoredIdentityHash,
  });

  assert.equal(summary.identityKey, 'canonical-user');
  assert.equal(summary.identityType, 'identity');
  assert.equal(summary.fingerprint, 'legacy-user');
  assert.deepEqual(summary.identityHashes, ['canonical-user', 'legacy-user']);
  assert.deepEqual(
    buildAdminIdentitySearchValues(summary),
    ['canonical-user', 'legacy-user']
  );

  db.close();
});

test('后台身份摘要在没有新身份映射时回落到指纹', () => {
  const { db, identityService } = createHarness();

  const summary = buildAdminIdentity({
    fingerprint: 'legacy-only',
    resolveStoredIdentityHash: identityService.resolveStoredIdentityHash,
  });

  assert.equal(summary.identityKey, 'legacy-only');
  assert.equal(summary.identityType, 'fingerprint');
  assert.equal(summary.fingerprint, 'legacy-only');
  assert.deepEqual(summary.identityHashes, ['legacy-only']);

  db.close();
});
