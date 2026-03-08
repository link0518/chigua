import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findPresenceByIdentityHashes,
  getChatMessageRateLimitKey,
  resolveJoinIdentity,
} from '../chat-realtime-service.js';

test('聊天室在线态只按当前主键命中，不再因为共享 identity hashes 复用旧 presence', () => {
  const existingPresence = {
    fingerprintHash: 'legacy-old',
    identityHashes: ['canonical-1', 'legacy-old'],
    sessionId: 'session-1',
    connections: new Set(),
  };

  const matchedPresence = findPresenceByIdentityHashes(
    [existingPresence],
    'legacy-new',
    ['canonical-1', 'legacy-old', 'legacy-new']
  );

  assert.equal(matchedPresence, null);
});

test('聊天室发言频控优先复用同一 sessionId', () => {
  const presence = {
    sessionId: 'session-1',
    fingerprintHash: 'legacy-old',
  };
  const connection = {
    sessionId: 'session-1',
    fingerprintHash: 'legacy-new',
  };

  assert.equal(getChatMessageRateLimitKey(connection, presence), 'session:session-1');
});

test('聊天室 join 会保留 canonical 主键并补充旧指纹用于兼容旧处罚', () => {
  const identity = resolveJoinIdentity({
    resolvedIdentity: {
      stableIdentityHash: 'canonical-1',
      preferredFingerprintHash: 'canonical-1',
      canonicalHash: 'canonical-1',
      lookupHashes: ['canonical-1'],
    },
    rawFingerprint: 'legacy-device',
    hashFingerprint: () => 'legacy-1',
  });

  assert.equal(identity.fingerprintHash, 'canonical-1');
  assert.deepEqual(identity.identityHashes, ['canonical-1', 'legacy-1']);
});

test('聊天室 join 在没有新身份时回退到旧指纹主键', () => {
  const identity = resolveJoinIdentity({
    resolvedIdentity: null,
    rawFingerprint: 'legacy-device',
    hashFingerprint: () => 'legacy-1',
  });

  assert.equal(identity.fingerprintHash, 'legacy-1');
  assert.deepEqual(identity.identityHashes, ['legacy-1']);
});
