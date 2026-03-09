import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createIdentityService } from '../identity-service.js';
import {
  resolveBanIdentityCandidates,
  resolveBanStorageHashes,
} from '../ban-identity.js';

const createCookieLib = () => ({
  parse() {
    return {};
  },
});

const createHarness = () => {
  const db = new Database(':memory:');
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
  const identityService = createIdentityService({
    db,
    cookie: createCookieLib(),
    sessionSecret: 'test-session-secret',
    fingerprintSalt: 'test-fingerprint-salt',
    fingerprintHeader: 'x-client-fingerprint',
  });
  return { db, identityService };
};

test('legacy-only 请求会补出 canonical 以命中新身份封禁', () => {
  const { db, identityService } = createHarness();

  identityService.upsertIdentityAlias('canonical-1', 'legacy-1', 'test');
  const candidates = resolveBanIdentityCandidates(
    {
      legacyFingerprintHash: 'legacy-1',
      effectiveHash: 'legacy-1',
      lookupHashes: ['legacy-1'],
    },
    identityService.resolveStoredIdentityHash
  );

  assert.deepEqual(candidates.canonicalHashes, ['canonical-1']);
  assert.deepEqual(candidates.legacyFingerprintHashes, ['legacy-1']);

  db.close();
});

test('有新身份时 identity 封禁只写 canonical，fingerprint 封禁只写 legacy', () => {
  const { db, identityService } = createHarness();

  identityService.upsertIdentityAlias('canonical-2', 'legacy-2', 'test');
  const identityStorageHashes = resolveBanStorageHashes({
    value: ['canonical-2', 'legacy-2'],
    banType: 'identity',
    fallbackHash: 'canonical-2',
    resolveStoredIdentityHash: identityService.resolveStoredIdentityHash,
  });
  const fingerprintStorageHashes = resolveBanStorageHashes({
    value: ['canonical-2', 'legacy-2'],
    banType: 'fingerprint',
    fallbackHash: 'legacy-2',
    resolveStoredIdentityHash: identityService.resolveStoredIdentityHash,
  });

  assert.deepEqual(identityStorageHashes, ['canonical-2']);
  assert.deepEqual(fingerprintStorageHashes, ['legacy-2']);

  db.close();
});

test('没有新身份的旧数据继续按指纹处理', () => {
  const { db, identityService } = createHarness();

  const candidates = resolveBanIdentityCandidates(
    'legacy-only',
    identityService.resolveStoredIdentityHash
  );
  const fingerprintStorageHashes = resolveBanStorageHashes({
    value: 'legacy-only',
    banType: 'fingerprint',
    fallbackHash: 'legacy-only',
    resolveStoredIdentityHash: identityService.resolveStoredIdentityHash,
  });

  assert.deepEqual(candidates.canonicalHashes, []);
  assert.deepEqual(candidates.legacyFingerprintHashes, ['legacy-only']);
  assert.deepEqual(fingerprintStorageHashes, ['legacy-only']);

  db.close();
});
