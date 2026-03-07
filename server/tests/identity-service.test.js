import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createIdentityService } from '../identity-service.js';

const createCookieLib = () => ({
  parse(header) {
    return String(header || '')
      .split(';')
      .map((item) => item.trim())
      .filter(Boolean)
      .reduce((accumulator, item) => {
        const separatorIndex = item.indexOf('=');
        if (separatorIndex <= 0) {
          return accumulator;
        }
        const key = item.slice(0, separatorIndex).trim();
        const value = item.slice(separatorIndex + 1).trim();
        if (key) {
          accumulator[key] = value;
        }
        return accumulator;
      }, {});
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

    CREATE INDEX idx_identity_aliases_canonical_hash
      ON identity_aliases(canonical_hash, last_seen_at DESC);
    CREATE INDEX idx_identity_aliases_legacy_hash
      ON identity_aliases(legacy_fingerprint_hash, last_seen_at DESC);
  `);
};

const createResponse = () => {
  const cookies = [];
  return {
    cookies,
    cookie(name, value, options) {
      cookies.push({ name, value, options });
    },
  };
};

const buildCookieHeader = (response) => response.cookies
  .map((item) => `${item.name}=${item.value}`)
  .join('; ');

const createHarness = () => {
  const db = new Database(':memory:');
  createSchema(db);
  const service = createIdentityService({
    db,
    cookie: createCookieLib(),
    sessionSecret: 'test-session-secret',
    fingerprintSalt: 'test-fingerprint-salt',
    fingerprintHeader: 'x-client-fingerprint',
  });
  return { db, service };
};

test('同一 legacy 指纹在 Cookie 轮换后仍能找回历史 canonical', () => {
  const { db, service } = createHarness();

  const firstResponse = createResponse();
  const firstContext = service.ensureRequestIdentity({
    headers: { 'x-client-fingerprint': 'legacy-device-fingerprint' },
  }, firstResponse);

  const secondResponse = createResponse();
  const secondContext = service.ensureRequestIdentity({
    headers: { 'x-client-fingerprint': 'legacy-device-fingerprint' },
  }, secondResponse);

  assert.notEqual(firstContext.canonicalHash, secondContext.canonicalHash);
  assert.ok(secondContext.lookupHashes.includes(firstContext.canonicalHash));
  assert.ok(secondContext.lookupHashes.includes(secondContext.canonicalHash));
  assert.ok(secondContext.lookupHashes.includes(firstContext.legacyFingerprintHash));

  const legacyOnlyLookupHashes = service.getRequestIdentityLookupHashes({
    headers: { 'x-client-fingerprint': 'legacy-device-fingerprint' },
  }, null);

  assert.ok(legacyOnlyLookupHashes.includes(firstContext.canonicalHash));
  assert.ok(legacyOnlyLookupHashes.includes(secondContext.canonicalHash));
  assert.ok(legacyOnlyLookupHashes.includes(firstContext.legacyFingerprintHash));

  const socketIdentity = service.resolveSocketIdentity({
    headers: { cookie: buildCookieHeader(secondResponse) },
  });

  assert.equal(socketIdentity.preferredFingerprintHash, firstContext.legacyFingerprintHash);
  assert.ok(socketIdentity.lookupHashes.includes(firstContext.canonicalHash));
  assert.ok(socketIdentity.lookupHashes.includes(secondContext.canonicalHash));
  assert.ok(socketIdentity.lookupHashes.includes(firstContext.legacyFingerprintHash));

  db.close();
});

test('共享同一 legacy 指纹的 canonical 会被识别为同一身份', () => {
  const { db, service } = createHarness();

  const firstResponse = createResponse();
  const firstContext = service.ensureRequestIdentity({
    headers: { 'x-client-fingerprint': 'legacy-device-fingerprint' },
  }, firstResponse);

  const secondResponse = createResponse();
  const secondContext = service.ensureRequestIdentity({
    headers: { 'x-client-fingerprint': 'legacy-device-fingerprint' },
  }, secondResponse);

  assert.equal(
    service.sharesIdentityHashes(firstContext.canonicalHash, secondContext.canonicalHash),
    true
  );
  assert.equal(
    service.sharesIdentityHashes(firstContext.canonicalHash, firstContext.legacyFingerprintHash),
    true
  );

  db.close();
});

test('稳定身份键会复用整个 identity graph 中最早关联的 legacy 指纹', () => {
  const { db, service } = createHarness();

  const firstResponse = createResponse();
  const firstContext = service.ensureRequestIdentity({
    headers: { 'x-client-fingerprint': 'legacy-old' },
  }, firstResponse);

  const cookieHeader = buildCookieHeader(firstResponse);
  const secondContext = service.ensureRequestIdentity({
    headers: {
      cookie: cookieHeader,
      'x-client-fingerprint': 'legacy-new',
    },
  }, null);

  const stableIdentityKey = service.getRequestStableIdentityKey({
    headers: {
      cookie: cookieHeader,
      'x-client-fingerprint': 'legacy-new',
    },
  }, null);
  const socketIdentity = service.resolveSocketIdentity({
    headers: { cookie: cookieHeader },
  });

  assert.equal(secondContext.canonicalHash, firstContext.canonicalHash);
  assert.notEqual(secondContext.legacyFingerprintHash, firstContext.legacyFingerprintHash);
  assert.equal(stableIdentityKey, firstContext.legacyFingerprintHash);
  assert.equal(socketIdentity.stableIdentityHash, firstContext.legacyFingerprintHash);

  db.close();
});
