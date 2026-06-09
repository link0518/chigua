import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildChatReplyPreview,
  buildUniqueChatNickname,
  findPresenceByIdentityHashes,
  getChatMessageRateLimitKey,
  isAllowedImageUrl,
  isStickerShortcode,
  normalizeAllowedImageHosts,
  normalizeChatMessagePayload,
  normalizeChatRoomConfig,
  resolveJoinIdentity,
} from '../chat-utils.js';

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

test('聊天室图片链接只允许本站表情路径和白名单图床图片', () => {
  assert.equal(isAllowedImageUrl('/meme/default/a.png'), true);
  assert.equal(isAllowedImageUrl('https://img.zsix.de/a.webp'), true);
  assert.equal(isAllowedImageUrl('https://example.com/a.webp'), false);
  assert.equal(isAllowedImageUrl('javascript:alert(1)'), false);
});

test('buildUniqueChatNickname avoids names already online', () => {
  const onlineNames = new Set([`侠士10000`]);
  const originalRandom = Math.random;
  try {
    Math.random = () => 0;
    const nickname = buildUniqueChatNickname(onlineNames);
    assert.equal(nickname.includes('10000'), false);
    assert.equal(onlineNames.has(nickname), false);
  } finally {
    Math.random = originalRandom;
  }
});

test('buildChatReplyPreview returns type-aware fallback previews', () => {
  assert.equal(buildChatReplyPreview({ msg_type: 'image', text_content: 'caption' }), '[图片] caption');
  assert.equal(buildChatReplyPreview({ msg_type: 'image', text_content: '' }), '[图片]');
  assert.equal(buildChatReplyPreview({ msg_type: 'sticker', sticker_shortcode: '[:default/happy:]' }), '[表情] [:default/happy:]');
  assert.equal(buildChatReplyPreview({ msg_type: 'text', text_content: '' }), '[消息]');
});

test('custom imgbed host is allowed for chat image payload', () => {
  const allowedImageHosts = normalizeAllowedImageHosts('https://img.example/base');
  assert.equal(isAllowedImageUrl('https://img.example/a.webp', allowedImageHosts), true);
  assert.equal(isAllowedImageUrl('https://other.example/a.webp', allowedImageHosts), false);

  assert.equal(normalizeChatMessagePayload({
    clientMsgId: 'm-imgbed',
    type: 'image',
    imageUrl: 'https://img.example/a.png',
  }, 20, { allowedImageHosts }).ok, true);
});

test('聊天室表情短码限制格式和长度', () => {
  assert.equal(isStickerShortcode('[:默认/开心:]'), true);
  assert.equal(isStickerShortcode('[:bad\n:]'), false);
  assert.equal(isStickerShortcode(`[:${'x'.repeat(81)}:]`), false);
});

test('聊天室配置归一化会限制数值范围并保留布尔开关', () => {
  assert.deepEqual(normalizeChatRoomConfig({
    chatEnabled: 'false',
    muteAll: '1',
    adminOnly: true,
    messageIntervalMs: -1,
    maxTextLength: 99999,
  }), {
    chatEnabled: false,
    muteAll: true,
    adminOnly: true,
    messageIntervalMs: 0,
    maxTextLength: 2000,
  });
});

test('聊天室文本消息 payload 归一化会拒绝空内容和超长内容', () => {
  assert.deepEqual(normalizeChatMessagePayload({ clientMsgId: 'm1', content: '' }, 20), {
    ok: false,
    error: '消息不能为空',
  });

  assert.deepEqual(normalizeChatMessagePayload({ clientMsgId: 'm1', content: 'x'.repeat(21) }, 20), {
    ok: false,
    error: '消息不能超过 20 字',
  });
});

test('聊天室图片消息 payload 归一化会保留回复目标并限制图片域名', () => {
  assert.deepEqual(normalizeChatMessagePayload({
    clientMsgId: 'm1',
    type: 'image',
    imageUrl: 'https://img.zsix.de/a.png',
    content: '配图',
    replyToMessageId: '12',
  }), {
    ok: true,
    data: {
      clientMsgId: 'm1',
      type: 'image',
      textContent: '配图',
      imageUrl: 'https://img.zsix.de/a.png',
      stickerCode: null,
      replyToMessageId: 12,
    },
  });

  assert.deepEqual(normalizeChatMessagePayload({
    clientMsgId: 'm2',
    type: 'image',
    imageUrl: 'https://example.com/a.png',
  }), {
    ok: false,
    error: '图片链接不合法或不在允许域名内',
  });
});

test('聊天室表情消息 payload 归一化会限制短码格式', () => {
  assert.deepEqual(normalizeChatMessagePayload({
    clientMsgId: 'm1',
    type: 'sticker',
    stickerCode: '[:默认/开心:]',
  }), {
    ok: true,
    data: {
      clientMsgId: 'm1',
      type: 'sticker',
      textContent: null,
      imageUrl: null,
      stickerCode: '[:默认/开心:]',
      replyToMessageId: null,
    },
  });

  assert.deepEqual(normalizeChatMessagePayload({
    clientMsgId: 'm2',
    type: 'sticker',
    stickerCode: 'bad',
  }), {
    ok: false,
    error: '表情短码格式不合法',
  });
});
