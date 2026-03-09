import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getNotificationActorHashes,
  matchesNotificationActor,
  resolveNotificationActorFingerprint,
} from '../notification-identity.js';

test('通知自我识别按当前身份集合判断，不依赖创建时间', () => {
  const identityContext = {
    canonicalHash: 'canonical-owner',
    legacyFingerprintHash: 'legacy-owner',
    effectiveHash: 'canonical-owner',
    lookupHashes: ['canonical-owner', 'legacy-owner'],
  };

  assert.deepEqual(getNotificationActorHashes(identityContext), ['canonical-owner', 'legacy-owner']);
  assert.equal(matchesNotificationActor(identityContext, 'canonical-owner'), true);
  assert.equal(matchesNotificationActor(identityContext, 'legacy-owner'), true);
  assert.equal(matchesNotificationActor(identityContext, 'another-user'), false);
});

test('通知记录优先写入与接收者同形态的 actor_fingerprint', () => {
  const identityContext = {
    canonicalHash: 'canonical-owner',
    legacyFingerprintHash: 'legacy-owner',
    effectiveHash: 'canonical-owner',
    lookupHashes: ['canonical-owner', 'legacy-owner'],
  };

  assert.equal(
    resolveNotificationActorFingerprint(identityContext, 'legacy-owner'),
    'legacy-owner'
  );
  assert.equal(
    resolveNotificationActorFingerprint(identityContext, 'canonical-owner'),
    'canonical-owner'
  );
  assert.equal(
    resolveNotificationActorFingerprint(identityContext, 'legacy-recipient'),
    'canonical-owner'
  );
});
