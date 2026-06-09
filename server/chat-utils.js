export const CHAT_TEXT_MAX_LENGTH = 2000;
export const CHAT_DEFAULT_MESSAGE_INTERVAL_MS = 2000;
export const CHAT_DEFAULT_TEXT_MAX_LENGTH = 500;
export const CHAT_CONFIG_MIN_TEXT_MAX_LENGTH = 20;
export const CHAT_CONFIG_MAX_TEXT_MAX_LENGTH = CHAT_TEXT_MAX_LENGTH;
export const CHAT_CONFIG_MAX_MESSAGE_INTERVAL_MS = 60 * 1000;
export const CHAT_DEFAULT_CONFIG = Object.freeze({
  chatEnabled: true,
  muteAll: false,
  adminOnly: false,
  messageIntervalMs: CHAT_DEFAULT_MESSAGE_INTERVAL_MS,
  maxTextLength: CHAT_DEFAULT_TEXT_MAX_LENGTH,
});
export const CHAT_REPLY_PREVIEW_MAX_LENGTH = 120;

const DEFAULT_IMAGE_HOSTS = Object.freeze(['img.zsix.de', 'ibed.933211.xyz']);

const normalizeImageHost = (value) => {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  try {
    return new URL(text).hostname;
  } catch {
    return text.replace(/^https?:\/\//i, '').split('/')[0].trim();
  }
};

export const normalizeAllowedImageHosts = (hosts = []) => {
  const source = hosts instanceof Set
    ? Array.from(hosts)
    : Array.isArray(hosts)
      ? hosts
      : [hosts];
  return new Set([
    ...DEFAULT_IMAGE_HOSTS,
    ...source
      .map(normalizeImageHost)
      .filter(Boolean),
  ]);
};

export const isAllowedMemePath = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return false;
  const normalized = raw.startsWith('/meme/')
    ? raw
    : raw.startsWith('meme/')
      ? `/${raw}`
      : '';
  if (!normalized || normalized.includes('..')) return false;
  const pathname = normalized.split('?')[0]?.split('#')[0] || '';
  if (!/^\/meme\/[^/]+\/[^/]+/i.test(pathname)) return false;
  return /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(pathname);
};

export const isAllowedImageUrl = (value, allowedImageHosts = DEFAULT_IMAGE_HOSTS) => {
  const text = String(value || '').trim();
  if (!text) return false;
  if (isAllowedMemePath(text)) {
    return true;
  }
  try {
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol)) {
      return false;
    }
    if (!normalizeAllowedImageHosts(allowedImageHosts).has(url.hostname)) {
      return false;
    }
    return /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(url.pathname);
  } catch {
    return false;
  }
};

export const isStickerShortcode = (value) => /^\[:[^\]\n]{1,80}:\]$/.test(String(value || '').trim());

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const toBoolean = (value) => value === true || value === 'true' || value === 1 || value === '1';
export const hasOwn = (target, key) => Object.prototype.hasOwnProperty.call(target || {}, key);

const truncateText = (value, maxLength) => {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
};

export const buildChatReplyPreview = (row) => {
  if (!row) return '';
  const type = String(row.msg_type || 'text');
  if (type === 'image') {
    const text = truncateText(row.text_content, 72);
    return text ? `[图片] ${text}` : '[图片]';
  }
  if (type === 'sticker') {
    return row.sticker_shortcode ? `[表情] ${row.sticker_shortcode}` : '[表情]';
  }
  const text = truncateText(row.text_content, CHAT_REPLY_PREVIEW_MAX_LENGTH);
  return text || '[消息]';
};

export const buildUniqueChatNickname = (onlineNameSet) => {
  for (let i = 0; i < 60; i += 1) {
    const code = Math.floor(Math.random() * 90000) + 10000;
    const next = `侠士${code}`;
    if (!onlineNameSet.has(next)) {
      return next;
    }
  }
  return `侠士${Date.now().toString().slice(-6)}`;
};

export const normalizeMessageIntervalMs = (value, fallback = CHAT_DEFAULT_CONFIG.messageIntervalMs) => {
  const raw = Number(value);
  if (!Number.isFinite(raw)) {
    return fallback;
  }
  return clamp(Math.trunc(raw), 0, CHAT_CONFIG_MAX_MESSAGE_INTERVAL_MS);
};

export const normalizeTextMaxLength = (value, fallback = CHAT_DEFAULT_CONFIG.maxTextLength) => {
  const raw = Number(value);
  if (!Number.isFinite(raw)) {
    return fallback;
  }
  return clamp(Math.trunc(raw), CHAT_CONFIG_MIN_TEXT_MAX_LENGTH, CHAT_CONFIG_MAX_TEXT_MAX_LENGTH);
};

export const normalizeChatRoomConfig = (value, fallback = CHAT_DEFAULT_CONFIG) => {
  const source = value && typeof value === 'object' ? value : {};
  const base = fallback && typeof fallback === 'object' ? fallback : CHAT_DEFAULT_CONFIG;
  return {
    chatEnabled: hasOwn(source, 'chatEnabled') ? toBoolean(source.chatEnabled) : Boolean(base.chatEnabled),
    muteAll: hasOwn(source, 'muteAll') ? toBoolean(source.muteAll) : Boolean(base.muteAll),
    adminOnly: hasOwn(source, 'adminOnly') ? toBoolean(source.adminOnly) : Boolean(base.adminOnly),
    messageIntervalMs: normalizeMessageIntervalMs(
      hasOwn(source, 'messageIntervalMs') ? source.messageIntervalMs : base.messageIntervalMs,
      CHAT_DEFAULT_CONFIG.messageIntervalMs
    ),
    maxTextLength: normalizeTextMaxLength(
      hasOwn(source, 'maxTextLength') ? source.maxTextLength : base.maxTextLength,
      CHAT_DEFAULT_CONFIG.maxTextLength
    ),
  };
};

export const normalizeIdentityHashes = (value) => {
  const source = Array.isArray(value) ? value : [value];
  return Array.from(new Set(
    source
      .flatMap((item) => (Array.isArray(item) ? item : [item]))
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  ));
};

export const resolveJoinIdentity = ({
  resolvedIdentity = null,
  rawFingerprint = '',
  hashFingerprint = null,
}) => {
  const resolvedFingerprintHash = String(
    resolvedIdentity?.stableIdentityHash
    || resolvedIdentity?.preferredFingerprintHash
    || resolvedIdentity?.canonicalHash
    || ''
  ).trim();
  const fallbackFingerprintHash = String(rawFingerprint || '').trim() && typeof hashFingerprint === 'function'
    ? String(hashFingerprint(rawFingerprint) || '').trim()
    : '';
  const identityHashes = normalizeIdentityHashes([
    Array.isArray(resolvedIdentity?.lookupHashes) ? resolvedIdentity.lookupHashes : [],
    fallbackFingerprintHash,
  ]);
  return {
    fingerprintHash: resolvedFingerprintHash || fallbackFingerprintHash,
    identityHashes,
  };
};

export const findPresenceByIdentityHashes = (presences, fingerprintHash) => {
  const normalizedFingerprintHash = String(fingerprintHash || '').trim();
  if (!normalizedFingerprintHash) {
    return null;
  }
  const iterable = presences instanceof Map ? presences.values() : presences;
  for (const presence of iterable || []) {
    if (!presence) {
      continue;
    }
    const presenceFingerprintHash = String(presence.fingerprintHash || '').trim();
    if (presenceFingerprintHash === normalizedFingerprintHash) {
      return presence;
    }
  }
  return null;
};

export const getChatMessageRateLimitKey = (connection, presence) => {
  const sessionId = String(presence?.sessionId || connection?.sessionId || '').trim();
  if (sessionId) {
    return `session:${sessionId}`;
  }
  const fingerprintHash = String(presence?.fingerprintHash || connection?.fingerprintHash || '').trim();
  if (fingerprintHash) {
    return `fingerprint:${fingerprintHash}`;
  }
  return '';
};

const toSafeInt = (value, fallback = 0) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.trunc(num);
};

export const normalizeChatMessagePayload = (payload, textMaxLength = CHAT_TEXT_MAX_LENGTH, options = {}) => {
  const safeTextMaxLength = normalizeTextMaxLength(textMaxLength, CHAT_DEFAULT_CONFIG.maxTextLength);
  const allowedImageHosts = options?.allowedImageHosts || DEFAULT_IMAGE_HOSTS;
  const clientMsgId = String(payload?.clientMsgId || '').trim();
  if (!clientMsgId || clientMsgId.length > 80) {
    return { ok: false, error: '消息标识无效' };
  }

  const rawType = String(payload?.type || 'text').trim();
  const type = ['text', 'image', 'sticker'].includes(rawType) ? rawType : 'text';
  const textContent = String(payload?.content || '').trim();
  const imageUrl = String(payload?.imageUrl || '').trim();
  const stickerCode = String(payload?.stickerCode || '').trim();
  const replyToMessageId = toSafeInt(payload?.replyToMessageId, 0);
  const normalizedReplyToMessageId = replyToMessageId > 0 ? replyToMessageId : null;

  if (type === 'text') {
    if (!textContent) {
      return { ok: false, error: '消息不能为空' };
    }
    if (textContent.length > safeTextMaxLength) {
      return { ok: false, error: `消息不能超过 ${safeTextMaxLength} 字` };
    }
    return {
      ok: true,
      data: {
        clientMsgId,
        type,
        textContent,
        imageUrl: null,
        stickerCode: null,
        replyToMessageId: normalizedReplyToMessageId,
      },
    };
  }

  if (type === 'image') {
    if (!imageUrl || !isAllowedImageUrl(imageUrl, allowedImageHosts)) {
      return { ok: false, error: '图片链接不合法或不在允许域名内' };
    }
    if (textContent && textContent.length > safeTextMaxLength) {
      return { ok: false, error: `消息不能超过 ${safeTextMaxLength} 字` };
    }
    return {
      ok: true,
      data: {
        clientMsgId,
        type,
        textContent: textContent || null,
        imageUrl,
        stickerCode: null,
        replyToMessageId: normalizedReplyToMessageId,
      },
    };
  }

  if (!stickerCode || !isStickerShortcode(stickerCode)) {
    return { ok: false, error: '表情短码格式不合法' };
  }
  if (textContent && textContent.length > safeTextMaxLength) {
    return { ok: false, error: `消息不能超过 ${safeTextMaxLength} 字` };
  }
  return {
    ok: true,
    data: {
      clientMsgId,
      type,
      textContent: textContent || null,
      imageUrl: null,
      stickerCode,
      replyToMessageId: normalizedReplyToMessageId,
    },
  };
};
