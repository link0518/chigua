import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findPresenceByIdentityHashes,
  getChatMessageRateLimitKey,
} from '../chat-realtime-service.js';

test('共享 identity hashes 的连接会复用已有聊天室 presence', () => {
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

  assert.equal(matchedPresence, existingPresence);
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
