import crypto from 'crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { buildAdminIdentity } from './admin-identity-utils.js';
import { resolveBanStorageHashes } from './ban-identity.js';
export {
  CHAT_DEFAULT_CONFIG,
  CHAT_TEXT_MAX_LENGTH,
  buildChatReplyPreview,
  buildUniqueChatNickname,
  findPresenceByIdentityHashes,
  getChatMessageRateLimitKey,
  hasOwn,
  isAllowedImageUrl,
  isAllowedMemePath,
  isStickerShortcode,
  normalizeAllowedImageHosts,
  normalizeChatMessagePayload,
  normalizeChatRoomConfig,
  normalizeIdentityHashes,
  normalizeMessageIntervalMs,
  normalizeTextMaxLength,
  resolveJoinIdentity,
  toBoolean,
} from './chat-utils.js';
import {
  CHAT_DEFAULT_CONFIG,
  buildChatReplyPreview,
  buildUniqueChatNickname,
  findPresenceByIdentityHashes,
  getChatMessageRateLimitKey,
  hasOwn,
  normalizeAllowedImageHosts,
  normalizeChatMessagePayload,
  normalizeChatRoomConfig,
  normalizeIdentityHashes,
  normalizeMessageIntervalMs,
  normalizeTextMaxLength,
  resolveJoinIdentity,
  toBoolean,
} from './chat-utils.js';

const CHAT_PATH = '/ws/chat';
const CHAT_HISTORY_MAX_LIMIT = 100;
const CHAT_DEFAULT_HISTORY_LIMIT = 50;
const CHAT_JOIN_CLOSE_CODE = 4003;
const CHAT_KICK_CLOSE_CODE = 4004;
const CHAT_PING_INTERVAL_MS = 30 * 1000;
const CHAT_CONFIG_SETTINGS_KEY = 'chat_room_config';

const toSafeInt = (value, fallback = 0) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.trunc(num);
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
    resolveSocketIdentity,
    getLookupHashesForIdentityHash,
    getStableLegacyFingerprintHashForIdentityHashes,
    resolveStoredIdentityHash,
    getClientIp,
    containsSensitiveWord,
    isBannedFor,
    upsertBan,
    BAN_PERMISSIONS,
    logAdminAction,
    getAdminFromRequest,
    adminNickname,
    getRuntimeConfig,
  } = deps;
  const getAllowedImageHosts = () => normalizeAllowedImageHosts(getRuntimeConfig?.()?.imgbedBaseUrl);
  const ADMIN_NICKNAME = String(adminNickname || '闰土').trim() || '闰土';

  const resolveAdminIdentity = ({ fingerprintHash = '', identityHashes = [], sessionId = '', ip = '' }) => buildAdminIdentity({
    identityHash: fingerprintHash,
    identityHashes,
    fingerprint: fingerprintHash,
    sessionId,
    ip,
    resolveStoredIdentityHash,
    getLookupHashesForIdentityHash,
    getStableLegacyFingerprintHashForIdentityHashes,
  });

  const resolveAdminIdentityHashes = ({ fingerprintHash = '', identityHashes = [] }) => {
    const summary = resolveAdminIdentity({ fingerprintHash, identityHashes });
    return summary.identityHashes;
  };

  const connectionBySocket = new Map();
  const presenceByFingerprint = new Map();
  const lastMessageSentAtByRateKey = new Map();

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
  const deleteIdentityBanStmt = db.prepare('DELETE FROM banned_identities WHERE identity = ?');
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
  const getLatestMessageCreatedAtByFingerprintStmt = db.prepare(
    `
      SELECT created_at
      FROM chat_messages
      WHERE fingerprint_hash = ?
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
  const getLatestSessionJoinedAtByFingerprintStmt = db.prepare(
    `
      SELECT joined_at
      FROM chat_sessions
      WHERE fingerprint_hash = ?
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
      const identity = resolveAdminIdentity({
        fingerprintHash: row.fingerprint_hash || '',
        sessionId: row.session_id || '',
        ip: row.ip_snapshot || '',
      });
      return {
        ...mapped,
        fingerprintHash: row.fingerprint_hash || '',
        identityKey: identity.identityKey,
        identityHashes: identity.identityHashes,
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
    const candidates = normalizeIdentityHashes(fingerprintHash);
    for (const candidate of candidates) {
      const row = getMuteRowStmt.get(candidate);
      if (!row) {
        continue;
      }
      const mutedUntil = typeof row.muted_until === 'number' ? row.muted_until : null;
      if (mutedUntil && mutedUntil <= Date.now()) {
        deleteMuteStmt.run(candidate);
        continue;
      }
      return {
        fingerprintHash: row.fingerprint_hash,
        identityKey: resolveAdminIdentity({ fingerprintHash: row.fingerprint_hash || '' }).identityKey,
        identityHashes: resolveAdminIdentity({ fingerprintHash: row.fingerprint_hash || '' }).identityHashes,
        mutedUntil,
        reason: row.reason || null,
        createdAt: row.created_at,
        createdByAdminId: row.created_by_admin_id || null,
      };
    }
    return null;
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
      presence.baseNickname = buildUniqueChatNickname(collectOnlineNicknameSet(presence.fingerprintHash));
    }
    if (!presence.isAdmin) {
      return presence.baseNickname;
    }
    if (presence.adminAnonymous) {
      if (!presence.adminAlias) {
        const onlineNameSet = collectOnlineNicknameSet(presence.fingerprintHash);
        onlineNameSet.add(presence.baseNickname);
        presence.adminAlias = buildUniqueChatNickname(onlineNameSet);
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
      const identity = resolveAdminIdentity({
        fingerprintHash: item.fingerprintHash,
        identityHashes: item.identityHashes,
        sessionId: item.sessionId,
      });
      mapped.fingerprintHash = item.fingerprintHash;
      mapped.identityKey = identity.identityKey;
      mapped.identityHashes = identity.identityHashes;
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

  const getPresenceByConnection = (connection) => findPresenceByIdentityHashes(
    presenceByFingerprint.values(),
    connection?.fingerprintHash,
    connection?.identityHashes
  );

  const releaseConnection = (connection, reason) => {
    if (!connection || connection.released) {
      return;
    }
    connection.released = true;
    connectionBySocket.delete(connection.socket);

    if (!connection.joined || !connection.fingerprintHash) {
      return;
    }

    const presence = getPresenceByConnection(connection);
    if (!presence) {
      return;
    }

    presence.connections.delete(connection);
    presence.lastActiveAt = Date.now();

    if (presence.connections.size === 0) {
      closeChatSessionStmt.run(Date.now(), reason || 'disconnect', presence.sessionId);
      presenceByFingerprint.delete(presence.fingerprintHash);
      lastMessageSentAtByRateKey.delete(getChatMessageRateLimitKey(connection, presence));
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

  const getConnectionsByFingerprintHash = (fingerprintHash) => {
    const normalizedFingerprintHash = String(fingerprintHash || '').trim();
    if (!normalizedFingerprintHash) {
      return [];
    }
    const presence = presenceByFingerprint.get(normalizedFingerprintHash);
    if (!presence) {
      return [];
    }
    return Array.from(presence.connections);
  };

  const disconnectFingerprintConnections = (fingerprintHash, event, payload, closeCode, closeReason) => {
    const targets = getConnectionsByFingerprintHash(fingerprintHash);
    targets.forEach((connection) => {
      sendEvent(connection.socket, event, payload);
      closeSocket(connection.socket, closeCode, closeReason);
    });
    return targets.length;
  };

  const notifyFingerprintConnections = (fingerprintHash, event, payload) => {
    const targets = getConnectionsByFingerprintHash(fingerprintHash);
    targets.forEach((connection) => {
      sendEvent(connection.socket, event, payload);
    });
    return targets.length;
  };

  const disconnectIdentityConnections = (identityHashes, event, payload, closeCode, closeReason) => {
    const normalizedIdentityHashes = normalizeIdentityHashes(identityHashes);
    const seenConnectionIds = new Set();
    let disconnected = 0;
    normalizedIdentityHashes.forEach((identityHash) => {
      const targets = getConnectionsByFingerprintHash(identityHash);
      targets.forEach((connection) => {
        if (seenConnectionIds.has(connection.id)) {
          return;
        }
        seenConnectionIds.add(connection.id);
        sendEvent(connection.socket, event, payload);
        closeSocket(connection.socket, closeCode, closeReason);
        disconnected += 1;
      });
    });
    return disconnected;
  };

  const notifyIdentityConnections = (identityHashes, event, payload) => {
    const normalizedIdentityHashes = normalizeIdentityHashes(identityHashes);
    const seenConnectionIds = new Set();
    let notified = 0;
    normalizedIdentityHashes.forEach((identityHash) => {
      const targets = getConnectionsByFingerprintHash(identityHash);
      targets.forEach((connection) => {
        if (seenConnectionIds.has(connection.id)) {
          return;
        }
        seenConnectionIds.add(connection.id);
        sendEvent(connection.socket, event, payload);
        notified += 1;
      });
    });
    return notified;
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

  const joinWithResolvedIdentity = async (connection, payload, fingerprintHash, identityHashes) => {
    if (isBannedFor(connection.ip, identityHashes.length ? identityHashes : [fingerprintHash], 'chat')) {
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
    const normalizedIdentityHashes = normalizeIdentityHashes([fingerprintHash, identityHashes]);
    let presence = findPresenceByIdentityHashes(
      presenceByFingerprint.values(),
      fingerprintHash,
      normalizedIdentityHashes
    );
    if (!presence) {
      const baseNickname = buildUniqueChatNickname(collectOnlineNicknameSet());
      const sessionId = crypto.randomUUID();
      presence = {
        fingerprintHash,
        identityHashes: normalizedIdentityHashes,
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
    presence.identityHashes = normalizeIdentityHashes([
      presence.fingerprintHash,
      presence.identityHashes,
      identityHashes,
    ]);

    if (connection.isAdmin) {
      presence.isAdmin = true;
      presence.adminAnonymous = requestAnonymous;
      presence.hiddenInOnline = requestHiddenInOnline;
      if (presence.adminAnonymous && !presence.adminAlias) {
        const onlineNameSet = collectOnlineNicknameSet(presence.fingerprintHash);
        onlineNameSet.add(presence.baseNickname);
        presence.adminAlias = buildUniqueChatNickname(onlineNameSet);
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
    presence.connections.forEach((item) => {
      item.identityHashes = presence.identityHashes.slice();
    });
    presence.lastActiveAt = now;
    const currentNickname = syncPresenceConnections(presence);
    updateSessionPeakStmt.run(presence.connections.size, presence.sessionId, presence.connections.size);

    connection.joined = true;
    connection.fingerprintHash = presence.fingerprintHash;
    connection.identityHashes = presence.identityHashes.length ? presence.identityHashes.slice() : [fingerprintHash];
    connection.nickname = connection.isAdmin ? currentNickname : presence.baseNickname;
    connection.sessionId = presence.sessionId;
    connection.joinedAt = now;
    connection.lastSeen = now;

    const mute = resolveActiveMute([connection.fingerprintHash, connection.identityHashes]);
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

  const handleJoin = async (connection, payload) => {
    if (connection.joined) {
      sendEvent(connection.socket, 'chat.error', { message: '已在聊天室内' });
      return;
    }

    const resolvedIdentity = typeof resolveSocketIdentity === 'function'
      ? resolveSocketIdentity(connection.request)
      : null;
    const joinIdentity = resolveJoinIdentity({
      resolvedIdentity,
      rawFingerprint: payload?.fingerprint,
      hashFingerprint,
    });
    const resolvedFingerprintHash = joinIdentity.fingerprintHash;
    const resolvedIdentityHashes = joinIdentity.identityHashes;
    if (!resolvedFingerprintHash) {
      sendEvent(connection.socket, 'chat.error', { message: '缺少身份标识，请刷新页面后重试' });
      closeSocket(connection.socket, CHAT_JOIN_CLOSE_CODE, 'identity_required');
      return;
    }
    await joinWithResolvedIdentity(connection, payload, resolvedFingerprintHash, resolvedIdentityHashes);
  };

  const handleSendMessage = (connection, payload) => {
    if (!connection.joined || !connection.fingerprintHash || !connection.sessionId) {
      sendEvent(connection.socket, 'chat.error', { message: '请先进入聊天室' });
      return;
    }

    if (isBannedFor(connection.ip, connection.identityHashes?.length ? connection.identityHashes : [connection.fingerprintHash], 'chat')) {
      sendEvent(connection.socket, 'chat.banned', { message: '账号已被封禁，无法发言' });
      closeSocket(connection.socket, CHAT_JOIN_CLOSE_CODE, 'banned');
      return;
    }

    const mute = resolveActiveMute([connection.fingerprintHash, connection.identityHashes]);
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

    const normalized = normalizeChatMessagePayload(payload, currentConfig.maxTextLength, {
      allowedImageHosts: getAllowedImageHosts(),
    });
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
        preview: buildChatReplyPreview(replied),
      };
    }

    const presence = getPresenceByConnection(connection);
    const messageNickname = resolveMessageNickname(connection, presence);
    const messageIsAdmin = Boolean(connection.isAdmin);
    const messageAdminAnonymous = Boolean(connection.isAdmin && presence?.adminAnonymous);
    const now = Date.now();
    const intervalMs = normalizeMessageIntervalMs(
      currentConfig.messageIntervalMs,
      CHAT_DEFAULT_CONFIG.messageIntervalMs
    );
    if (intervalMs > 0) {
      const messageRateLimitKey = getChatMessageRateLimitKey(connection, presence);
      const lastSentAt = toSafeInt(lastMessageSentAtByRateKey.get(messageRateLimitKey), 0);
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
      lastMessageSentAtByRateKey.set(getChatMessageRateLimitKey(connection, presence), now);
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
        lastMessageSentAtByRateKey.set(getChatMessageRateLimitKey(connection, presence), now);
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
    const presence = getPresenceByConnection(connection);
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
      presence.adminAlias = buildUniqueChatNickname(onlineNameSet);
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
      identityHashes: [],
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

  const resolveBanIp = (fingerprintHash, providedIp = '', identityHashes = []) => {
    const inputIp = String(providedIp || '').trim();
    if (inputIp) {
      return inputIp;
    }
    const candidates = resolveAdminIdentityHashes({ fingerprintHash, identityHashes });
    for (const candidate of candidates) {
      const row = getLatestMessageIpByFingerprintStmt.get(candidate);
      if (row?.ip_snapshot) {
        return String(row.ip_snapshot);
      }
    }
    return '';
  };

  const resolveChatBanType = (fingerprintHash, requestedType = '') => {
    const normalizedRequestedType = String(requestedType || '').trim();
    if (normalizedRequestedType === 'identity' || normalizedRequestedType === 'fingerprint') {
      return normalizedRequestedType;
    }
    const normalizedFingerprintHash = String(fingerprintHash || '').trim();
    if (!normalizedFingerprintHash) {
      return 'fingerprint';
    }
    const resolvedIdentity = typeof resolveStoredIdentityHash === 'function'
      ? resolveStoredIdentityHash(normalizedFingerprintHash)
      : null;
    return resolvedIdentity?.type === 'identity' ? 'identity' : 'fingerprint';
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
      const identity = resolveAdminIdentity({ fingerprintHash });
      const identityKey = String(identity.identityKey || fingerprintHash || '').trim();
      const identityHashes = identity.identityHashes.length ? identity.identityHashes : [identityKey].filter(Boolean);
      const now = Date.now();
      const mutedUntil = typeof expiresAt === "number" && expiresAt > now ? expiresAt : null;
      identityHashes.forEach((identityHash) => {
        upsertMuteStmt.run(
          identityHash,
          mutedUntil,
          reason || null,
          now,
          req.session?.admin?.id || null
        );
      });

      const payload = {
        fingerprintHash: identityKey,
        identityKey,
        identityHashes,
        mutedUntil,
        reason: reason || null,
      };
      disconnectIdentityConnections(
        identityHashes,
        "chat.muted",
        payload,
        CHAT_KICK_CLOSE_CODE,
        "muted"
      );
      if (typeof logAdminAction === "function") {
        logAdminAction(req, {
          action: "chat_mute",
          targetType: "chat_user",
          targetId: identityKey,
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
      const identity = resolveAdminIdentity({ fingerprintHash });
      const identityKey = String(identity.identityKey || fingerprintHash || '').trim();
      const identityHashes = identity.identityHashes.length ? identity.identityHashes : [identityKey].filter(Boolean);
      let removed = false;
      identityHashes.forEach((identityHash) => {
        removed = deleteMuteStmt.run(identityHash).changes > 0 || removed;
      });
      const notifiedConnections = notifyIdentityConnections(
        identityHashes,
        "chat.unmuted",
        {
          fingerprintHash: identityKey,
          identityKey,
          identityHashes,
          reason: reason || null,
          muteActive: false,
        }
      );
      const payload = {
        fingerprintHash: identityKey,
        identityKey,
        identityHashes,
        removed,
        notifiedConnections,
      };
      if (typeof logAdminAction === "function") {
        logAdminAction(req, {
          action: "chat_unmute",
          targetType: "chat_user",
          targetId: identityKey,
          after: payload,
          reason: reason || null,
        });
      }
      return payload;
    },
    kickByAdmin({ req, fingerprintHash, reason }) {
      const identity = resolveAdminIdentity({ fingerprintHash });
      const identityKey = String(identity.identityKey || fingerprintHash || '').trim();
      const kicked = disconnectIdentityConnections(
        identity.identityHashes,
        "chat.kicked",
        { message: reason || '你已被管理员移出聊天室' },
        CHAT_KICK_CLOSE_CODE,
        "kicked"
      );
      if (typeof logAdminAction === "function") {
        logAdminAction(req, {
          action: "chat_kick",
          targetType: "chat_user",
          targetId: identityKey,
          after: {
            identityKey,
            identityHashes: identity.identityHashes,
            kickedConnections: kicked,
          },
          reason: reason || null,
        });
      }
      return {
        fingerprintHash: identityKey,
        identityKey,
        identityHashes: identity.identityHashes,
        kickedConnections: kicked,
      };
    },
    banByAdmin({
      req,
      fingerprintHash,
      reason,
      expiresAt,
      scope = "chat",
      permissions: requestedPermissions,
      ip = "",
      identityType = "",
    }) {
      const identity = resolveAdminIdentity({ fingerprintHash });
      const identityKey = String(identity.identityKey || fingerprintHash || '').trim();
      const identityHashes = identity.identityHashes.length ? identity.identityHashes : [identityKey].filter(Boolean);
      const now = Date.now();
      const normalizedScope = scope === "site" ? "site" : "chat";
      const permissions = normalizeBanPermissions(requestedPermissions, normalizedScope);
      const effectiveExpiresAt = typeof expiresAt === "number" && expiresAt > now ? expiresAt : null;
      const resolvedIp = resolveBanIp(identityKey, ip, identityHashes);
      const banType = resolveChatBanType(identityKey, identityType);
      const banStorageHashes = resolveBanStorageHashes({
        value: identityHashes,
        banType,
        fallbackHash: banType === "identity" ? identityKey : (fingerprintHash || identityKey),
        resolveStoredIdentityHash,
      });
      banStorageHashes.forEach((storageHash) => {
        upsertBan(banType === "identity" ? "banned_identities" : "banned_fingerprints", banType === "identity" ? "identity" : "fingerprint", storageHash, {
          permissions,
          expiresAt: effectiveExpiresAt,
          reason: reason || null,
        });
      });
      identityHashes.forEach((identityHash) => {
        if (resolvedIp) {
          upsertChatBanSyncStmt.run(identityHash, resolvedIp, now);
        } else {
          deleteChatBanSyncStmt.run(identityHash);
        }
      });
      if (resolvedIp) {
        upsertBan("banned_ips", "ip", resolvedIp, {
          permissions,
          expiresAt: effectiveExpiresAt,
          reason: reason || null,
        });
      }
      const kicked = disconnectIdentityConnections(
        identityHashes,
        "chat.banned",
        { message: reason || '你已被封禁，无法进入聊天室' },
        CHAT_JOIN_CLOSE_CODE,
        "banned"
      );
      if (typeof logAdminAction === "function") {
        logAdminAction(req, {
          action: normalizedScope === "site" ? "chat_ban_site" : "chat_ban",
          targetType: "chat_user",
          targetId: identityKey,
          after: {
            identityKey,
            identityHashes,
            identityType: banType,
            permissions,
            kickedConnections: kicked,
            syncedBan: {
              identity: banStorageHashes.length,
              ip: Boolean(resolvedIp),
            },
          },
          reason: reason || null,
        });
      }
      return {
        fingerprintHash: identityKey,
        identityKey,
        identityHashes,
        identityType: banType,
        ip: resolvedIp || null,
        permissions,
        kickedConnections: kicked,
        syncedBan: {
          identity: banStorageHashes.length,
          ip: Boolean(resolvedIp),
        },
      };
    },
    unbanByAdmin({ req, fingerprintHash, reason, ip = "", identityType = "" }) {
      const identity = resolveAdminIdentity({ fingerprintHash });
      const identityKey = String(identity.identityKey || fingerprintHash || '').trim();
      const identityHashes = identity.identityHashes.length ? identity.identityHashes : [identityKey].filter(Boolean);
      const banType = resolveChatBanType(identityKey, identityType);
      const banStorageHashes = resolveBanStorageHashes({
        value: identityHashes,
        banType,
        fallbackHash: banType === "identity" ? identityKey : (fingerprintHash || identityKey),
        resolveStoredIdentityHash,
      });
      let removed = false;
      const syncedIps = [];
      banStorageHashes.forEach((storageHash) => {
        removed = (
          banType === "identity"
            ? deleteIdentityBanStmt.run(storageHash).changes > 0
            : deleteBanStmt.run(storageHash).changes > 0
        ) || removed;
      });
      identityHashes.forEach((identityHash) => {
        const syncedIpRow = getChatBanSyncIpStmt.get(identityHash);
        const syncedIp = syncedIpRow?.ip ? String(syncedIpRow.ip).trim() : "";
        if (syncedIp) {
          syncedIps.push(syncedIp);
        }
        deleteChatBanSyncStmt.run(identityHash);
      });
      const providedIp = String(ip || "").trim();
      const fallbackIp = resolveBanIp(identityKey, providedIp, identityHashes);
      const candidateIps = Array.from(new Set([providedIp, fallbackIp, ...syncedIps].filter(Boolean)));
      let removedIp = false;
      candidateIps.forEach((candidateIp) => {
        removedIp = deleteIpBanStmt.run(candidateIp).changes > 0 || removedIp;
      });
      if (typeof logAdminAction === "function") {
        logAdminAction(req, {
          action: "chat_unban",
          targetType: "chat_user",
          targetId: identityKey,
          after: {
            identityKey,
            identityHashes,
            identityType: banType,
            removed,
            removedIp,
            ip: candidateIps[0] || null,
            ipCandidates: candidateIps,
          },
          reason: reason || null,
        });
      }
      return {
        fingerprintHash: identityKey,
        identityKey,
        identityHashes,
        identityType: banType,
        removed,
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
