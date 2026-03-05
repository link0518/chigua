import crypto from 'crypto';
import { WebSocket, WebSocketServer } from 'ws';

const CHAT_PATH = '/ws/chat';
const CHAT_TEXT_MAX_LENGTH = 2000;
const CHAT_HISTORY_MAX_LIMIT = 100;
const CHAT_DEFAULT_HISTORY_LIMIT = 50;
const CHAT_JOIN_CLOSE_CODE = 4003;
const CHAT_KICK_CLOSE_CODE = 4004;
const CHAT_PING_INTERVAL_MS = 30 * 1000;
const CHAT_REPLY_PREVIEW_MAX_LENGTH = 120;
const CHAT_CONFIG_SETTINGS_KEY = 'chat_room_config';
const CHAT_DEFAULT_MESSAGE_INTERVAL_MS = 2000;
const CHAT_DEFAULT_TEXT_MAX_LENGTH = 500;
const CHAT_CONFIG_MIN_TEXT_MAX_LENGTH = 20;
const CHAT_CONFIG_MAX_TEXT_MAX_LENGTH = CHAT_TEXT_MAX_LENGTH;
const CHAT_CONFIG_MAX_MESSAGE_INTERVAL_MS = 60 * 1000;
const CHAT_DEFAULT_CONFIG = Object.freeze({
  chatEnabled: true,
  muteAll: false,
  adminOnly: false,
  messageIntervalMs: CHAT_DEFAULT_MESSAGE_INTERVAL_MS,
  maxTextLength: CHAT_DEFAULT_TEXT_MAX_LENGTH,
});
const IMAGE_HOSTS = new Set(['img.zsix.de', 'ibed.933211.xyz']);

const isAllowedMemePath = (value) => {
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

const isAllowedImageUrl = (value) => {
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
    if (!IMAGE_HOSTS.has(url.hostname)) {
      return false;
    }
    return /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(url.pathname);
  } catch {
    return false;
  }
};

const isStickerShortcode = (value) => /^\[:[^\]\n]{1,80}:\]$/.test(String(value || '').trim());

const toSafeInt = (value, fallback = 0) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.trunc(num);
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const toBoolean = (value) => value === true || value === 'true' || value === 1 || value === '1';
const hasOwn = (target, key) => Object.prototype.hasOwnProperty.call(target || {}, key);
const normalizeMessageIntervalMs = (value, fallback = CHAT_DEFAULT_CONFIG.messageIntervalMs) => {
  const raw = Number(value);
  if (!Number.isFinite(raw)) {
    return fallback;
  }
  return clamp(Math.trunc(raw), 0, CHAT_CONFIG_MAX_MESSAGE_INTERVAL_MS);
};
const normalizeTextMaxLength = (value, fallback = CHAT_DEFAULT_CONFIG.maxTextLength) => {
  const raw = Number(value);
  if (!Number.isFinite(raw)) {
    return fallback;
  }
  return clamp(Math.trunc(raw), CHAT_CONFIG_MIN_TEXT_MAX_LENGTH, CHAT_CONFIG_MAX_TEXT_MAX_LENGTH);
};
const normalizeChatRoomConfig = (value, fallback = CHAT_DEFAULT_CONFIG) => {
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

const truncateText = (value, maxLength) => {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
};

const buildReplyPreview = (row) => {
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

const buildUniqueNickname = (onlineNameSet) => {
  for (let i = 0; i < 60; i += 1) {
    const code = Math.floor(Math.random() * 90000) + 10000;
    const next = `侠士${code}`;
    if (!onlineNameSet.has(next)) {
      return next;
    }
  }
  return `侠士${Date.now().toString().slice(-6)}`;
};

const parseWsMessage = (raw) => {
  try {
    const parsed = JSON.parse(String(raw || ''));
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const closeSocket = (socket, code, reason) => {
  if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
    try {
      socket.close(code, reason);
    } catch {
      // ignore
    }
  }
};

export const createChatRealtimeService = (deps) => {
  const {
    server,
    db,
    hashFingerprint,
    getClientIp,
    containsSensitiveWord,
    isBannedFor,
    upsertBan,
    BAN_PERMISSIONS,
    logAdminAction,
    getAdminFromRequest,
    adminNickname,
  } = deps;
  const ADMIN_NICKNAME = String(adminNickname || '闰土').trim() || '闰土';

  const connectionBySocket = new Map();
  const presenceByFingerprint = new Map();
  const lastMessageSentAtByFingerprint = new Map();

  const insertChatSessionStmt = db.prepare(
    `
      INSERT INTO chat_sessions (
        id,
        fingerprint_hash,
        nickname,
        joined_at,
        connection_count_peak
      ) VALUES (?, ?, ?, ?, ?)
    `
  );
  const closeChatSessionStmt = db.prepare(
    'UPDATE chat_sessions SET left_at = ?, left_reason = ? WHERE id = ? AND left_at IS NULL'
  );
  const updateSessionPeakStmt = db.prepare(
    'UPDATE chat_sessions SET connection_count_peak = ? WHERE id = ? AND connection_count_peak < ?'
  );
  const insertChatMessageStmt = db.prepare(
    `
      INSERT INTO chat_messages (
        session_id,
        fingerprint_hash,
        ip_snapshot,
        nickname_snapshot,
        is_admin,
        admin_anonymous,
        msg_type,
        text_content,
        image_url,
        sticker_shortcode,
        reply_to_message_id,
        reply_to_nickname,
        reply_preview,
        client_msg_id,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  );
  const getChatMessageByIdStmt = db.prepare(
    `
      SELECT
        id,
        session_id,
        fingerprint_hash,
        ip_snapshot,
        nickname_snapshot,
        is_admin,
        admin_anonymous,
        msg_type,
        text_content,
        image_url,
        sticker_shortcode,
        reply_to_message_id,
        reply_to_nickname,
        reply_preview,
        client_msg_id,
        created_at,
        deleted,
        deleted_at,
        deleted_by_admin_id,
        delete_reason
      FROM chat_messages
      WHERE id = ?
    `
  );
  const getChatMessageByClientIdStmt = db.prepare(
    `
      SELECT
        id,
        session_id,
        fingerprint_hash,
        ip_snapshot,
        nickname_snapshot,
        is_admin,
        admin_anonymous,
        msg_type,
        text_content,
        image_url,
        sticker_shortcode,
        reply_to_message_id,
        reply_to_nickname,
        reply_preview,
        client_msg_id,
        created_at,
        deleted,
        deleted_at,
        deleted_by_admin_id,
        delete_reason
      FROM chat_messages
      WHERE fingerprint_hash = ? AND client_msg_id = ?
      LIMIT 1
    `
  );
  const deleteChatMessageStmt = db.prepare(
    `
      UPDATE chat_messages
      SET deleted = 1,
          deleted_at = ?,
          deleted_by_admin_id = ?,
          delete_reason = ?
      WHERE id = ? AND deleted = 0
    `
  );
  const getMuteRowStmt = db.prepare(
    `
      SELECT fingerprint_hash, muted_until, reason, created_at, created_by_admin_id
      FROM chat_mutes
      WHERE fingerprint_hash = ?
      LIMIT 1
    `
  );
  const upsertMuteStmt = db.prepare(
    `
      INSERT INTO chat_mutes (fingerprint_hash, muted_until, reason, created_at, created_by_admin_id)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(fingerprint_hash) DO UPDATE SET
        muted_until = excluded.muted_until,
        reason = excluded.reason,
        created_at = excluded.created_at,
        created_by_admin_id = excluded.created_by_admin_id
    `
  );
  const deleteMuteStmt = db.prepare('DELETE FROM chat_mutes WHERE fingerprint_hash = ?');
  const deleteBanStmt = db.prepare('DELETE FROM banned_fingerprints WHERE fingerprint = ?');
  const deleteIpBanStmt = db.prepare('DELETE FROM banned_ips WHERE ip = ?');
  const upsertChatBanSyncStmt = db.prepare(
    `
      INSERT INTO chat_ban_sync (fingerprint_hash, ip, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(fingerprint_hash) DO UPDATE SET
        ip = excluded.ip,
        updated_at = excluded.updated_at
    `
  );
  const getChatBanSyncIpStmt = db.prepare(
    `
      SELECT ip
      FROM chat_ban_sync
      WHERE fingerprint_hash = ?
      LIMIT 1
    `
  );
  const deleteChatBanSyncStmt = db.prepare('DELETE FROM chat_ban_sync WHERE fingerprint_hash = ?');
  const getLatestMessageIpByFingerprintStmt = db.prepare(
    `
      SELECT ip_snapshot
      FROM chat_messages
      WHERE fingerprint_hash = ? AND ip_snapshot IS NOT NULL AND ip_snapshot != ''
      ORDER BY created_at DESC
      LIMIT 1
    `
  );
  const getSessionByIdStmt = db.prepare(
    `
      SELECT id, fingerprint_hash, nickname, joined_at
      FROM chat_sessions
      WHERE id = ?
      ORDER BY joined_at DESC
      LIMIT 1
    `
  );
  const getAppSettingStmt = db.prepare('SELECT value FROM app_settings WHERE key = ? LIMIT 1');
  const upsertAppSettingStmt = db.prepare(
    `
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `
  );

  const persistChatConfig = (nextConfig) => {
    const normalized = normalizeChatRoomConfig(nextConfig, CHAT_DEFAULT_CONFIG);
    upsertAppSettingStmt.run(CHAT_CONFIG_SETTINGS_KEY, JSON.stringify(normalized), Date.now());
    return normalized;
  };

  const loadChatConfig = () => {
    const row = getAppSettingStmt.get(CHAT_CONFIG_SETTINGS_KEY);
    if (!row?.value) {
      return persistChatConfig(CHAT_DEFAULT_CONFIG);
    }
    try {
      const parsed = JSON.parse(String(row.value));
      return persistChatConfig(parsed);
    } catch {
      return persistChatConfig(CHAT_DEFAULT_CONFIG);
    }
  };

  let chatConfig = loadChatConfig();

  const mapMessageRow = (row, includeFingerprint = false) => {
    if (!row) return null;
    const replyToMessageId = toSafeInt(row.reply_to_message_id, 0);
    const mapped = {
      id: Number(row.id),
      sessionId: row.session_id,
      nickname: row.nickname_snapshot || '匿名',
      isAdmin: row.is_admin === 1 && row.admin_anonymous !== 1,
      type: row.msg_type || 'text',
      content: row.text_content || '',
      imageUrl: row.image_url || '',
      stickerCode: row.sticker_shortcode || '',
      clientMsgId: row.client_msg_id || '',
      createdAt: row.created_at,
      deleted: row.deleted === 1,
      deletedAt: row.deleted_at || null,
      deleteReason: row.delete_reason || null,
      replyTo: replyToMessageId > 0 ? {
        id: replyToMessageId,
        nickname: String(row.reply_to_nickname || '匿名'),
        preview: String(row.reply_preview || ''),
      } : null,
    };
    if (includeFingerprint) {
      return {
        ...mapped,
        fingerprintHash: row.fingerprint_hash || '',
        ip: row.ip_snapshot || '',
      };
    }
    return mapped;
  };

  const queryMessages = ({ beforeId, limit, includeDeleted, includeFingerprint }) => {
    const safeLimit = clamp(toSafeInt(limit, CHAT_DEFAULT_HISTORY_LIMIT), 1, CHAT_HISTORY_MAX_LIMIT);
    const safeBeforeId = toSafeInt(beforeId, 0);
    const where = [];
    const params = [];
    if (safeBeforeId > 0) {
      where.push('id < ?');
      params.push(safeBeforeId);
    }
    if (!includeDeleted) {
      where.push('deleted = 0');
    }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = db.prepare(
      `
        SELECT
          id,
          session_id,
          fingerprint_hash,
          ip_snapshot,
          nickname_snapshot,
          is_admin,
          admin_anonymous,
          msg_type,
          text_content,
          image_url,
          sticker_shortcode,
          reply_to_message_id,
          reply_to_nickname,
          reply_preview,
          client_msg_id,
          created_at,
          deleted,
          deleted_at,
          deleted_by_admin_id,
          delete_reason
        FROM chat_messages
        ${whereClause}
        ORDER BY id DESC
        LIMIT ?
      `
    ).all(...params, safeLimit);
    return rows.reverse().map((row) => mapMessageRow(row, includeFingerprint));
  };

  const resolveActiveMute = (fingerprintHash) => {
    if (!fingerprintHash) return null;
    const row = getMuteRowStmt.get(fingerprintHash);
    if (!row) return null;
    const mutedUntil = typeof row.muted_until === 'number' ? row.muted_until : null;
    if (mutedUntil && mutedUntil <= Date.now()) {
      deleteMuteStmt.run(fingerprintHash);
      return null;
    }
    return {
      fingerprintHash: row.fingerprint_hash,
      mutedUntil,
      reason: row.reason || null,
      createdAt: row.created_at,
      createdByAdminId: row.created_by_admin_id || null,
    };
  };

  const collectOnlineNicknameSet = (excludeFingerprint = '') => {
    const nicknameSet = new Set();
    presenceByFingerprint.forEach((item, fingerprintHash) => {
      if (excludeFingerprint && fingerprintHash === excludeFingerprint) {
        return;
      }
      if (item.baseNickname) {
        nicknameSet.add(item.baseNickname);
      }
      if (item.adminAlias) {
        nicknameSet.add(item.adminAlias);
      }
      if (item.isAdmin && !item.adminAnonymous) {
        nicknameSet.add(ADMIN_NICKNAME);
      }
    });
    return nicknameSet;
  };

  const resolvePresenceNickname = (presence) => {
    if (!presence) {
      return '匿名';
    }
    if (!presence.baseNickname) {
      presence.baseNickname = buildUniqueNickname(collectOnlineNicknameSet(presence.fingerprintHash));
    }
    if (!presence.isAdmin) {
      return presence.baseNickname;
    }
    if (presence.adminAnonymous) {
      if (!presence.adminAlias) {
        const onlineNameSet = collectOnlineNicknameSet(presence.fingerprintHash);
        onlineNameSet.add(presence.baseNickname);
        presence.adminAlias = buildUniqueNickname(onlineNameSet);
      }
      return presence.adminAlias;
    }
    return ADMIN_NICKNAME;
  };

  const syncPresenceConnections = (presence) => {
    const nickname = resolvePresenceNickname(presence);
    presence.nickname = nickname;
    presence.connections.forEach((item) => {
      item.nickname = nickname;
      if (item.isAdmin) {
        item.adminAnonymous = Boolean(presence.adminAnonymous);
        item.hiddenInOnline = Boolean(presence.hiddenInOnline);
      } else {
        item.adminAnonymous = false;
        item.hiddenInOnline = false;
      }
    });
    return nickname;
  };

  const mapPresenceToOnlineUser = (item, options = {}) => {
    const includeHidden = Boolean(options.includeHidden);
    const includeFingerprint = Boolean(options.includeFingerprint);
    const hiddenInOnline = Boolean(item.isAdmin && item.hiddenInOnline);
    if (!includeHidden && hiddenInOnline) {
      return null;
    }
    const mapped = {
      sessionId: item.sessionId,
      nickname: resolvePresenceNickname(item),
      joinedAt: item.joinedAt,
      lastActiveAt: item.lastActiveAt,
      connections: item.connections.size,
      isAdmin: Boolean(item.isAdmin && !item.adminAnonymous),
    };
    if (includeHidden) {
      mapped.hiddenInOnline = hiddenInOnline;
    }
    if (includeFingerprint) {
      mapped.fingerprintHash = item.fingerprintHash;
    }
    return mapped;
  };

  const getOnlineUsersInternal = (options = {}) => {
    return Array.from(presenceByFingerprint.values())
      .map((item) => mapPresenceToOnlineUser(item, options))
      .filter(Boolean)
      .sort((a, b) => {
        if (a.joinedAt !== b.joinedAt) {
          return a.joinedAt - b.joinedAt;
        }
        return a.nickname.localeCompare(b.nickname, 'zh-CN');
      });
  };

  const getPublicOnlineSnapshot = () => {
    const users = getOnlineUsersInternal({ includeHidden: false, includeFingerprint: false });
    const onlineCount = users.reduce((total, item) => total + item.connections, 0);
    return {
      roomId: 'main',
      onlineCount,
      users,
    };
  };

  const getAdminOnlineSnapshot = () => {
    const users = getOnlineUsersInternal({ includeHidden: true, includeFingerprint: true });
    const onlineCount = users.reduce((total, item) => total + item.connections, 0);
    return {
      roomId: 'main',
      onlineCount,
      users,
    };
  };

  const sendEvent = (socket, event, payload = {}) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(JSON.stringify({ event, payload }));
    } catch {
      // ignore
    }
  };

  const broadcastEvent = (event, payload = {}, options = {}) => {
    const excludedSocket = options.excludeSocket || null;
    connectionBySocket.forEach((connection, socket) => {
      if (excludedSocket && socket === excludedSocket) {
        return;
      }
      sendEvent(socket, event, payload);
    });
  };

  const broadcastOnlineChanged = () => {
    const snapshot = getPublicOnlineSnapshot();
    broadcastEvent('chat.online.changed', snapshot);
  };

  const releaseConnection = (connection, reason) => {
    if (!connection || connection.released) {
      return;
    }
    connection.released = true;
    connectionBySocket.delete(connection.socket);

    if (!connection.joined || !connection.fingerprintHash) {
      return;
    }

    const presence = presenceByFingerprint.get(connection.fingerprintHash);
    if (!presence) {
      return;
    }

    presence.connections.delete(connection);
    presence.lastActiveAt = Date.now();

    if (presence.connections.size === 0) {
      closeChatSessionStmt.run(Date.now(), reason || 'disconnect', presence.sessionId);
      presenceByFingerprint.delete(connection.fingerprintHash);
      lastMessageSentAtByFingerprint.delete(connection.fingerprintHash);
    } else {
      const hasAdminConnection = Array.from(presence.connections).some((item) => item.isAdmin);
      if (!hasAdminConnection) {
        presence.isAdmin = false;
        presence.adminAnonymous = false;
        presence.hiddenInOnline = false;
      }
      syncPresenceConnections(presence);
    }

    broadcastOnlineChanged();
  };

  const disconnectFingerprintConnections = (fingerprintHash, event, payload, closeCode, closeReason) => {
    const presence = presenceByFingerprint.get(fingerprintHash);
    if (!presence) {
      return 0;
    }
    const targets = Array.from(presence.connections);
    targets.forEach((connection) => {
      sendEvent(connection.socket, event, payload);
      closeSocket(connection.socket, closeCode, closeReason);
    });
    return targets.length;
  };

  const notifyFingerprintConnections = (fingerprintHash, event, payload) => {
    const presence = presenceByFingerprint.get(fingerprintHash);
    if (!presence) {
      return 0;
    }
    const targets = Array.from(presence.connections);
    targets.forEach((connection) => {
      sendEvent(connection.socket, event, payload);
    });
    return targets.length;
  };

  const disconnectAllConnections = (event, payload, closeCode, closeReason) => {
    const targets = Array.from(connectionBySocket.values());
    targets.forEach((connection) => {
      sendEvent(connection.socket, event, payload);
      closeSocket(connection.socket, closeCode, closeReason);
    });
    return targets.length;
  };

  const buildChatConfigPayload = () => ({ ...chatConfig });

  const validateChatConfigPatch = (patch) => {
    if (!patch || typeof patch !== 'object') {
      return { ok: false, error: '参数格式错误' };
    }
    const next = { ...chatConfig };
    let changed = false;

    if (hasOwn(patch, 'chatEnabled')) {
      if (typeof patch.chatEnabled !== 'boolean') {
        return { ok: false, error: '聊天室开关参数必须为布尔值' };
      }
      next.chatEnabled = patch.chatEnabled;
      changed = true;
    }

    if (hasOwn(patch, 'muteAll')) {
      if (typeof patch.muteAll !== 'boolean') {
        return { ok: false, error: '全体禁言参数必须为布尔值' };
      }
      next.muteAll = patch.muteAll;
      changed = true;
    }

    if (hasOwn(patch, 'adminOnly')) {
      if (typeof patch.adminOnly !== 'boolean') {
        return { ok: false, error: '仅管理员发言参数必须为布尔值' };
      }
      next.adminOnly = patch.adminOnly;
      changed = true;
    }

    if (hasOwn(patch, 'messageIntervalMs')) {
      const rawInterval = Number(patch.messageIntervalMs);
      if (!Number.isFinite(rawInterval)) {
        return { ok: false, error: '发言频率参数必须为数字' };
      }
      next.messageIntervalMs = normalizeMessageIntervalMs(rawInterval, chatConfig.messageIntervalMs);
      changed = true;
    }

    if (hasOwn(patch, 'maxTextLength')) {
      const rawMaxTextLength = Number(patch.maxTextLength);
      if (!Number.isFinite(rawMaxTextLength)) {
        return { ok: false, error: '字数限制参数必须为数字' };
      }
      next.maxTextLength = normalizeTextMaxLength(rawMaxTextLength, chatConfig.maxTextLength);
      changed = true;
    }

    if (!changed) {
      return { ok: false, error: '缺少更新参数' };
    }

    return { ok: true, config: normalizeChatRoomConfig(next, chatConfig) };
  };

  const normalizeMessagePayload = (payload, textMaxLength = CHAT_TEXT_MAX_LENGTH) => {
    const safeTextMaxLength = normalizeTextMaxLength(textMaxLength, CHAT_DEFAULT_CONFIG.maxTextLength);
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
      if (!imageUrl || !isAllowedImageUrl(imageUrl)) {
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

  const buildAdminStatePayload = (presence) => ({
    isAdmin: true,
    anonymous: Boolean(presence?.adminAnonymous),
    hiddenInOnline: Boolean(presence?.hiddenInOnline),
    nickname: resolvePresenceNickname(presence),
  });

  const resolveMessageNickname = (connection, presence) => {
    if (connection.isAdmin) {
      return resolvePresenceNickname(presence);
    }
    if (presence?.baseNickname) {
      return presence.baseNickname;
    }
    return connection.nickname || '匿名';
  };

  const handleJoin = async (connection, payload) => {
    if (connection.joined) {
      sendEvent(connection.socket, 'chat.error', { message: '已在聊天室内' });
      return;
    }

    const rawFingerprint = String(payload?.fingerprint || '').trim();
    if (!rawFingerprint) {
      sendEvent(connection.socket, 'chat.error', { message: '缺少指纹标识' });
      closeSocket(connection.socket, CHAT_JOIN_CLOSE_CODE, 'fingerprint_required');
      return;
    }

    const fingerprintHash = hashFingerprint(rawFingerprint);
    if (!fingerprintHash) {
      sendEvent(connection.socket, 'chat.error', { message: '指纹计算失败' });
      closeSocket(connection.socket, CHAT_JOIN_CLOSE_CODE, 'fingerprint_invalid');
      return;
    }

    if (isBannedFor(connection.ip, fingerprintHash, 'chat')) {
      sendEvent(connection.socket, 'chat.banned', { message: '账号已被封禁，无法进入聊天室' });
      closeSocket(connection.socket, CHAT_JOIN_CLOSE_CODE, 'banned');
      return;
    }

    const currentConfig = buildChatConfigPayload();
    if (!currentConfig.chatEnabled) {
      sendEvent(connection.socket, 'chat.closed', { message: '聊天室已关闭' });
      closeSocket(connection.socket, CHAT_JOIN_CLOSE_CODE, 'chat_closed');
      return;
    }

    const adminProfile = typeof getAdminFromRequest === 'function'
      ? await getAdminFromRequest(connection.request).catch(() => null)
      : null;
    connection.isAdmin = Boolean(adminProfile?.id);
    connection.adminId = connection.isAdmin ? Number(adminProfile.id) : null;
    connection.adminUsername = connection.isAdmin ? String(adminProfile.username || '') : '';

    const requestAnonymous = toBoolean(payload?.adminAnonymous);
    const requestHiddenInOnline = toBoolean(payload?.hiddenInOnline);
    const now = Date.now();
    let presence = presenceByFingerprint.get(fingerprintHash);
    if (!presence) {
      const baseNickname = buildUniqueNickname(collectOnlineNicknameSet());
      const sessionId = crypto.randomUUID();
      presence = {
        fingerprintHash,
        sessionId,
        baseNickname,
        adminAlias: '',
        nickname: baseNickname,
        joinedAt: now,
        lastActiveAt: now,
        connections: new Set(),
        isAdmin: false,
        adminAnonymous: false,
        hiddenInOnline: false,
      };
      presenceByFingerprint.set(fingerprintHash, presence);
      insertChatSessionStmt.run(sessionId, fingerprintHash, baseNickname, now, 1);
    }

    if (connection.isAdmin) {
      presence.isAdmin = true;
      presence.adminAnonymous = requestAnonymous;
      presence.hiddenInOnline = requestHiddenInOnline;
      if (presence.adminAnonymous && !presence.adminAlias) {
        const onlineNameSet = collectOnlineNicknameSet(fingerprintHash);
        onlineNameSet.add(presence.baseNickname);
        presence.adminAlias = buildUniqueNickname(onlineNameSet);
      }
    } else {
      const hasAdminConnection = Array.from(presence.connections).some((item) => item.isAdmin);
      if (!hasAdminConnection) {
        presence.isAdmin = false;
        presence.adminAnonymous = false;
        presence.hiddenInOnline = false;
      }
    }

    presence.connections.add(connection);
    presence.lastActiveAt = now;
    const currentNickname = syncPresenceConnections(presence);
    updateSessionPeakStmt.run(presence.connections.size, presence.sessionId, presence.connections.size);

    connection.joined = true;
    connection.fingerprintHash = fingerprintHash;
    connection.nickname = connection.isAdmin ? currentNickname : presence.baseNickname;
    connection.sessionId = presence.sessionId;
    connection.joinedAt = now;
    connection.lastSeen = now;

    const mute = resolveActiveMute(fingerprintHash);
    const joinedPayload = {
      roomId: 'main',
      sessionId: presence.sessionId,
      nickname: connection.nickname,
      history: queryMessages({ limit: CHAT_DEFAULT_HISTORY_LIMIT, includeDeleted: false, includeFingerprint: false }),
      ...getPublicOnlineSnapshot(),
      mutedUntil: mute?.mutedUntil || null,
      mutedReason: mute?.reason || null,
      muteActive: Boolean(mute),
      chatConfig: buildChatConfigPayload(),
      serverTime: now,
    };
    if (connection.isAdmin) {
      joinedPayload.adminState = buildAdminStatePayload(presence);
    }
    sendEvent(connection.socket, 'chat.joined', joinedPayload);
    broadcastOnlineChanged();
  };

  const handleSendMessage = (connection, payload) => {
    if (!connection.joined || !connection.fingerprintHash || !connection.sessionId) {
      sendEvent(connection.socket, 'chat.error', { message: '请先进入聊天室' });
      return;
    }

    if (isBannedFor(connection.ip, connection.fingerprintHash, 'chat')) {
      sendEvent(connection.socket, 'chat.banned', { message: '账号已被封禁，无法发言' });
      closeSocket(connection.socket, CHAT_JOIN_CLOSE_CODE, 'banned');
      return;
    }

    const mute = resolveActiveMute(connection.fingerprintHash);
    if (mute) {
      sendEvent(connection.socket, 'chat.muted', {
        message: '你已被禁言',
        mutedUntil: mute.mutedUntil,
        reason: mute.reason,
        muteActive: true,
      });
      return;
    }

    const currentConfig = buildChatConfigPayload();
    if (!currentConfig.chatEnabled) {
      sendEvent(connection.socket, 'chat.closed', { message: '聊天室已关闭' });
      closeSocket(connection.socket, CHAT_JOIN_CLOSE_CODE, 'chat_closed');
      return;
    }
    if (currentConfig.muteAll) {
      sendEvent(connection.socket, 'chat.error', { message: '聊天室已开启全体禁言' });
      return;
    }
    if (currentConfig.adminOnly && !connection.isAdmin) {
      sendEvent(connection.socket, 'chat.error', { message: '当前仅管理员可发言' });
      return;
    }

    const normalized = normalizeMessagePayload(payload, currentConfig.maxTextLength);
    if (!normalized.ok) {
      sendEvent(connection.socket, 'chat.error', { message: normalized.error });
      return;
    }
    const messagePayload = normalized.data;

    if (messagePayload.textContent && containsSensitiveWord(messagePayload.textContent)) {
      sendEvent(connection.socket, 'chat.error', { message: '消息包含敏感词，请修改后再发送' });
      return;
    }

    let replyMeta = null;
    if (messagePayload.replyToMessageId) {
      const replied = getChatMessageByIdStmt.get(messagePayload.replyToMessageId);
      if (!replied || replied.deleted === 1) {
        sendEvent(connection.socket, 'chat.error', { message: '引用的消息不存在或已删除' });
        return;
      }
      replyMeta = {
        id: Number(replied.id),
        nickname: replied.nickname_snapshot || '匿名',
        preview: buildReplyPreview(replied),
      };
    }

    const presence = presenceByFingerprint.get(connection.fingerprintHash);
    const messageNickname = resolveMessageNickname(connection, presence);
    const messageIsAdmin = Boolean(connection.isAdmin);
    const messageAdminAnonymous = Boolean(connection.isAdmin && presence?.adminAnonymous);
    const now = Date.now();
    const intervalMs = normalizeMessageIntervalMs(
      currentConfig.messageIntervalMs,
      CHAT_DEFAULT_CONFIG.messageIntervalMs
    );
    if (intervalMs > 0) {
      const lastSentAt = toSafeInt(lastMessageSentAtByFingerprint.get(connection.fingerprintHash), 0);
      const elapsedMs = now - lastSentAt;
      if (elapsedMs < intervalMs) {
        const retryAfterSeconds = Math.max(1, Math.ceil((intervalMs - elapsedMs) / 1000));
        sendEvent(connection.socket, 'chat.error', { message: `发送过于频繁，请 ${retryAfterSeconds} 秒后重试` });
        return;
      }
    }
    try {
      const result = insertChatMessageStmt.run(
        connection.sessionId,
        connection.fingerprintHash,
        connection.ip || null,
        messageNickname,
        messageIsAdmin ? 1 : 0,
        messageAdminAnonymous ? 1 : 0,
        messagePayload.type,
        messagePayload.textContent,
        messagePayload.imageUrl,
        messagePayload.stickerCode,
        replyMeta?.id || null,
        replyMeta?.nickname || null,
        replyMeta?.preview || null,
        messagePayload.clientMsgId,
        now
      );
      const inserted = getChatMessageByIdStmt.get(result.lastInsertRowid);
      const mapped = mapMessageRow(inserted, false);
      if (!mapped) {
        sendEvent(connection.socket, 'chat.error', { message: '消息写入失败' });
        return;
      }
      lastMessageSentAtByFingerprint.set(connection.fingerprintHash, now);
      broadcastEvent('chat.message.new', mapped);
      sendEvent(connection.socket, 'chat.send.ack', {
        clientMsgId: messagePayload.clientMsgId,
        messageId: mapped.id,
      });
    } catch (error) {
      const isUniqueConflict = /UNIQUE|constraint/i.test(String(error?.message || ''));
      if (!isUniqueConflict) {
        sendEvent(connection.socket, 'chat.error', { message: '发送失败，请稍后重试' });
        return;
      }
      const duplicated = getChatMessageByClientIdStmt.get(connection.fingerprintHash, messagePayload.clientMsgId);
      const mapped = mapMessageRow(duplicated, false);
      if (mapped) {
        lastMessageSentAtByFingerprint.set(connection.fingerprintHash, now);
        sendEvent(connection.socket, 'chat.send.ack', {
          clientMsgId: messagePayload.clientMsgId,
          messageId: mapped.id,
        });
      } else {
        sendEvent(connection.socket, 'chat.error', { message: '消息重复提交' });
      }
    }
  };

  const handleAdminStateUpdate = (connection, payload) => {
    if (!connection.joined || !connection.fingerprintHash) {
      sendEvent(connection.socket, 'chat.error', { message: '请先进入聊天室' });
      return;
    }
    if (!connection.isAdmin) {
      sendEvent(connection.socket, 'chat.error', { message: '无管理员权限' });
      return;
    }
    const presence = presenceByFingerprint.get(connection.fingerprintHash);
    if (!presence) {
      sendEvent(connection.socket, 'chat.error', { message: '聊天室状态异常' });
      return;
    }

    const hasAnonymous = Object.prototype.hasOwnProperty.call(payload || {}, 'anonymous');
    const hasHiddenInOnline = Object.prototype.hasOwnProperty.call(payload || {}, 'hiddenInOnline');
    if (!hasAnonymous && !hasHiddenInOnline) {
      sendEvent(connection.socket, 'chat.error', { message: '缺少更新参数' });
      return;
    }

    if (hasAnonymous) {
      presence.adminAnonymous = toBoolean(payload.anonymous);
    }
    if (hasHiddenInOnline) {
      presence.hiddenInOnline = toBoolean(payload.hiddenInOnline);
    }
    if (presence.adminAnonymous && !presence.adminAlias) {
      const onlineNameSet = collectOnlineNicknameSet(connection.fingerprintHash);
      onlineNameSet.add(presence.baseNickname);
      presence.adminAlias = buildUniqueNickname(onlineNameSet);
    }

    syncPresenceConnections(presence);
    connection.nickname = resolveMessageNickname(connection, presence);
    sendEvent(connection.socket, 'chat.admin.state', buildAdminStatePayload(presence));
    broadcastOnlineChanged();
  };

  const handleClientLeave = (connection) => {
    if (!connection.joined) {
      closeSocket(connection.socket, 1000, 'leave');
      return;
    }
    closeSocket(connection.socket, 1000, 'leave');
  };

  const wsServer = new WebSocketServer({ server, path: CHAT_PATH });

  wsServer.on('connection', (socket, request) => {
    const connection = {
      id: crypto.randomUUID(),
      socket,
      request,
      ip: getClientIp(request),
      joined: false,
      fingerprintHash: '',
      nickname: '',
      sessionId: '',
      isAdmin: false,
      adminId: null,
      adminUsername: '',
      adminAnonymous: false,
      hiddenInOnline: false,
      joinedAt: 0,
      lastSeen: Date.now(),
      alive: true,
      released: false,
    };
    connectionBySocket.set(socket, connection);

    sendEvent(socket, 'chat.ready', { roomId: 'main', serverTime: Date.now() });

    socket.on('pong', () => {
      connection.alive = true;
      connection.lastSeen = Date.now();
    });
    socket.on('message', (raw) => {
      connection.lastSeen = Date.now();
      const data = parseWsMessage(raw);
      if (!data || typeof data.event !== 'string') {
        sendEvent(socket, 'chat.error', { message: '消息格式错误' });
        return;
      }
      const event = String(data.event || '').trim();
      const payload = data.payload || {};
      const dispatch = async () => {
        if (event === 'chat.join') {
          await handleJoin(connection, payload);
          return;
        }
        if (event === 'chat.send') {
          handleSendMessage(connection, payload);
          return;
        }
        if (event === 'chat.admin.update') {
          handleAdminStateUpdate(connection, payload);
          return;
        }
        if (event === 'chat.leave') {
          handleClientLeave(connection);
          return;
        }
        sendEvent(socket, 'chat.error', { message: `不支持的事件: ${event}` });
      };
      dispatch().catch(() => {
        sendEvent(socket, 'chat.error', { message: '聊天室操作失败' });
      });
    });

    socket.on('close', () => {
      releaseConnection(connection, 'disconnect');
    });

    socket.on('error', () => {
      releaseConnection(connection, 'error');
    });
  });

  const pingTimer = setInterval(() => {
    connectionBySocket.forEach((connection, socket) => {
      if (!connection.alive) {
        closeSocket(socket, CHAT_KICK_CLOSE_CODE, 'heartbeat_timeout');
        releaseConnection(connection, 'heartbeat_timeout');
        return;
      }
      connection.alive = false;
      if (socket.readyState === WebSocket.OPEN) {
        try {
          socket.ping();
        } catch {
          // ignore
        }
      }
    });
  }, CHAT_PING_INTERVAL_MS);
  pingTimer.unref?.();

  const requireMessage = (messageId) => {
    const id = toSafeInt(messageId, 0);
    if (id <= 0) {
      return null;
    }
    return getChatMessageByIdStmt.get(id) || null;
  };

  const resolveSessionFingerprint = (sessionId) => {
    const id = String(sessionId || '').trim();
    if (!id) {
      return '';
    }
    const online = Array.from(presenceByFingerprint.values()).find((item) => item.sessionId === id);
    if (online?.fingerprintHash) {
      return online.fingerprintHash;
    }
    const row = getSessionByIdStmt.get(id);
    return row?.fingerprint_hash ? String(row.fingerprint_hash) : '';
  };

  const normalizeBanPermissions = (requestedPermissions, scope) => {
    if (Array.isArray(requestedPermissions)) {
      const cleaned = requestedPermissions
        .map((item) => String(item || '').trim())
        .filter((item) => BAN_PERMISSIONS.includes(item));
      if (cleaned.length > 0) {
        return Array.from(new Set(cleaned));
      }
    }
    return scope === 'site' ? BAN_PERMISSIONS : ['chat'];
  };

  const resolveBanIp = (fingerprintHash, providedIp = '') => {
    const inputIp = String(providedIp || '').trim();
    if (inputIp) {
      return inputIp;
    }
    const row = getLatestMessageIpByFingerprintStmt.get(fingerprintHash);
    return row?.ip_snapshot ? String(row.ip_snapshot) : '';
  };

  return {
    getPublicOnlineSnapshot,
    getPublicHistory({ beforeId, limit }) {
      return queryMessages({
        beforeId,
        limit,
        includeDeleted: false,
        includeFingerprint: false,
      });
    },
    getAdminOnlineSnapshot,
    getAdminMessages({ beforeId, limit, includeDeleted = true }) {
      return queryMessages({
        beforeId,
        limit,
        includeDeleted: Boolean(includeDeleted),
        includeFingerprint: true,
      });
    },
    getActiveMute(fingerprintHash) {
      return resolveActiveMute(fingerprintHash);
    },
    getChatConfig() {
      return buildChatConfigPayload();
    },
    updateChatConfigByAdmin({ req, patch }) {
      const validated = validateChatConfigPatch(patch);
      if (!validated.ok) {
        return validated;
      }
      const before = buildChatConfigPayload();
      chatConfig = persistChatConfig(validated.config);
      const after = buildChatConfigPayload();
      broadcastEvent('chat.config', after);
      if (before.chatEnabled && !after.chatEnabled) {
        disconnectAllConnections(
          'chat.closed',
          { message: '聊天室已关闭' },
          CHAT_KICK_CLOSE_CODE,
          'chat_closed'
        );
      }
      if (typeof logAdminAction === 'function') {
        logAdminAction(req, {
          action: 'chat_config_update',
          targetType: 'chat_config',
          targetId: 'main',
          before,
          after,
        });
      }
      return { ok: true, config: after };
    },
    muteByAdmin({ req, fingerprintHash, reason, expiresAt }) {
      const now = Date.now();
      const mutedUntil = typeof expiresAt === 'number' && expiresAt > now ? expiresAt : null;
      upsertMuteStmt.run(
        fingerprintHash,
        mutedUntil,
        reason || null,
        now,
        req.session?.admin?.id || null
      );

      const payload = {
        fingerprintHash,
        mutedUntil,
        reason: reason || null,
      };
      disconnectFingerprintConnections(
        fingerprintHash,
        'chat.muted',
        payload,
        CHAT_KICK_CLOSE_CODE,
        'muted'
      );
      if (typeof logAdminAction === 'function') {
        logAdminAction(req, {
          action: 'chat_mute',
          targetType: 'chat_user',
          targetId: fingerprintHash,
          after: payload,
          reason: reason || null,
        });
      }
      return payload;
    },
    muteSessionByAdmin({ req, sessionId, reason, expiresAt }) {
      const fingerprintHash = resolveSessionFingerprint(sessionId);
      if (!fingerprintHash) {
        return { ok: false, error: '会话不存在或已失效' };
      }
      const payload = this.muteByAdmin({ req, fingerprintHash, reason, expiresAt });
      return {
        ok: true,
        sessionId,
        ...payload,
      };
    },
    unmuteByAdmin({ req, fingerprintHash, reason }) {
      const result = deleteMuteStmt.run(fingerprintHash);
      const notifiedConnections = notifyFingerprintConnections(
        fingerprintHash,
        'chat.unmuted',
        {
          fingerprintHash,
          reason: reason || null,
          muteActive: false,
        }
      );
      const payload = {
        fingerprintHash,
        removed: result.changes > 0,
        notifiedConnections,
      };
      if (typeof logAdminAction === 'function') {
        logAdminAction(req, {
          action: 'chat_unmute',
          targetType: 'chat_user',
          targetId: fingerprintHash,
          after: payload,
          reason: reason || null,
        });
      }
      return payload;
    },
    kickByAdmin({ req, fingerprintHash, reason }) {
      const kicked = disconnectFingerprintConnections(
        fingerprintHash,
        'chat.kicked',
        { message: reason || '你已被管理员移出聊天室' },
        CHAT_KICK_CLOSE_CODE,
        'kicked'
      );
      if (typeof logAdminAction === 'function') {
        logAdminAction(req, {
          action: 'chat_kick',
          targetType: 'chat_user',
          targetId: fingerprintHash,
          after: { kickedConnections: kicked },
          reason: reason || null,
        });
      }
      return { fingerprintHash, kickedConnections: kicked };
    },
    banByAdmin({
      req,
      fingerprintHash,
      reason,
      expiresAt,
      scope = 'chat',
      permissions: requestedPermissions,
      ip = '',
    }) {
      const now = Date.now();
      const normalizedScope = scope === 'site' ? 'site' : 'chat';
      const permissions = normalizeBanPermissions(requestedPermissions, normalizedScope);
      const resolvedIp = resolveBanIp(fingerprintHash, ip);
      upsertBan('banned_fingerprints', 'fingerprint', fingerprintHash, {
        permissions,
        expiresAt: typeof expiresAt === 'number' && expiresAt > now ? expiresAt : null,
        reason: reason || null,
      });
      if (resolvedIp) {
        upsertBan('banned_ips', 'ip', resolvedIp, {
          permissions,
          expiresAt: typeof expiresAt === 'number' && expiresAt > now ? expiresAt : null,
          reason: reason || null,
        });
        upsertChatBanSyncStmt.run(fingerprintHash, resolvedIp, now);
      } else {
        deleteChatBanSyncStmt.run(fingerprintHash);
      }
      const kicked = disconnectFingerprintConnections(
        fingerprintHash,
        'chat.banned',
        { message: reason || '你已被封禁，无法进入聊天室' },
        CHAT_JOIN_CLOSE_CODE,
        'banned'
      );
      if (typeof logAdminAction === 'function') {
        logAdminAction(req, {
          action: normalizedScope === 'site' ? 'chat_ban_site' : 'chat_ban',
          targetType: 'chat_user',
          targetId: fingerprintHash,
          after: {
            permissions,
            kickedConnections: kicked,
            syncedBan: {
              fingerprint: true,
              ip: Boolean(resolvedIp),
            },
          },
          reason: reason || null,
        });
      }
      return {
        fingerprintHash,
        ip: resolvedIp || null,
        permissions,
        kickedConnections: kicked,
        syncedBan: {
          fingerprint: true,
          ip: Boolean(resolvedIp),
        },
      };
    },
    unbanByAdmin({ req, fingerprintHash, reason, ip = '' }) {
      const result = deleteBanStmt.run(fingerprintHash);
      const providedIp = String(ip || '').trim();
      const syncedIpRow = getChatBanSyncIpStmt.get(fingerprintHash);
      const syncedIp = syncedIpRow?.ip ? String(syncedIpRow.ip).trim() : '';
      const fallbackIp = resolveBanIp(fingerprintHash, providedIp);
      const candidateIps = Array.from(new Set([providedIp, syncedIp, fallbackIp].filter(Boolean)));
      let removedIp = false;
      candidateIps.forEach((candidateIp) => {
        removedIp = deleteIpBanStmt.run(candidateIp).changes > 0 || removedIp;
      });
      deleteChatBanSyncStmt.run(fingerprintHash);
      if (typeof logAdminAction === 'function') {
        logAdminAction(req, {
          action: 'chat_unban',
          targetType: 'chat_user',
          targetId: fingerprintHash,
          after: {
            removed: result.changes > 0,
            removedIp,
            ip: candidateIps[0] || null,
            ipCandidates: candidateIps,
          },
          reason: reason || null,
        });
      }
      return {
        fingerprintHash,
        removed: result.changes > 0,
        removedIp,
        ip: candidateIps[0] || null,
        ipCandidates: candidateIps,
      };
    },
    deleteMessageByAdmin({ req, messageId, reason }) {
      const existing = requireMessage(messageId);
      if (!existing) {
        return { ok: false, error: '消息不存在' };
      }
      if (existing.deleted === 1) {
        return { ok: true, message: mapMessageRow(existing, true), alreadyDeleted: true };
      }
      const now = Date.now();
      deleteChatMessageStmt.run(
        now,
        req.session?.admin?.id || null,
        reason || null,
        Number(existing.id)
      );
      const next = requireMessage(existing.id);
      const mapped = mapMessageRow(next, true);
      broadcastEvent('chat.message.deleted', {
        id: Number(existing.id),
        deletedAt: now,
      });
      if (typeof logAdminAction === 'function') {
        logAdminAction(req, {
          action: 'chat_delete_message',
          targetType: 'chat_message',
          targetId: String(existing.id),
          before: mapMessageRow(existing, true),
          after: mapped,
          reason: reason || null,
        });
      }
      return { ok: true, message: mapped };
    },
    shutdown() {
      clearInterval(pingTimer);
      wsServer.clients.forEach((socket) => {
        closeSocket(socket, 1001, 'server_shutdown');
      });
      wsServer.close();
    },
  };
};


