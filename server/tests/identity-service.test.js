import assert from 'node:assert/strict';
import test from 'node:test';
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

test('请求身份上下文只保留当前 canonical 与当前 legacy 两个键', () => {
  const { db, service } = createHarness();

  const response = createResponse();
  const context = service.ensureRequestIdentity({
    headers: { 'x-client-fingerprint': 'legacy-device-fingerprint' },
  }, response);

  assert.equal(context.lookupHashes.length, 2);
  assert.deepEqual(context.lookupHashes, [
    context.canonicalHash,
    context.legacyFingerprintHash,
  ]);

  const legacyOnlyLookupHashes = service.getRequestIdentityLookupHashes({
    headers: { 'x-client-fingerprint': 'legacy-device-fingerprint' },
  }, null);

  assert.deepEqual(legacyOnlyLookupHashes, [context.legacyFingerprintHash]);
  assert.equal(
    db.prepare('SELECT COUNT(1) AS count FROM identity_aliases').get().count,
    1
  );

  db.close();
});

test('sharesIdentityHashes 改为严格相等判断，不再按 alias 图扩散', () => {
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
    false
  );
  assert.equal(
    service.sharesIdentityHashes(firstContext.canonicalHash, firstContext.canonicalHash),
    true
  );

  db.close();
});

test('稳定身份键优先返回当前 canonical，socket 侧也只复用当前 canonical', () => {
  const { db, service } = createHarness();

  const response = createResponse();
  const firstContext = service.ensureRequestIdentity({
    headers: { 'x-client-fingerprint': 'legacy-old' },
  }, response);
  const cookieHeader = buildCookieHeader(response);

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
  assert.equal(stableIdentityKey, firstContext.canonicalHash);
  assert.equal(socketIdentity.stableIdentityHash, firstContext.canonicalHash);
  assert.deepEqual(socketIdentity.lookupHashes, [firstContext.canonicalHash]);

  db.close();
});
