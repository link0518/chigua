const toSafeInt = (value, fallback = 0) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.trunc(num);
};

const resolveExpiresAt = (input, durationMinutes) => {
  const now = Date.now();
  if (typeof input === 'number' && Number.isFinite(input) && input > now) {
    return input;
  }
  const minutes = toSafeInt(durationMinutes, 0);
  if (minutes > 0) {
    return now + minutes * 60 * 1000;
  }
  return null;
};

const normalizeFingerprint = (value) => String(value || '').trim();
const normalizeSessionId = (value) => String(value || '').trim();

const mapMuteRow = (row) => ({
  fingerprintHash: row.fingerprint_hash,
  mutedUntil: typeof row.muted_until === 'number' ? row.muted_until : null,
  reason: row.reason || null,
  createdAt: row.created_at,
  createdByAdminId: row.created_by_admin_id || null,
});

export const registerAdminChatRoutes = (app, deps) => {
  const {
    db,
    requireAdmin,
    requireAdminCsrf,
    chatRealtime,
  } = deps;

  app.get('/api/admin/chat/online', requireAdmin, (req, res) => {
    return res.json(chatRealtime.getAdminOnlineSnapshot());
  });

  app.get('/api/admin/chat/config', requireAdmin, (req, res) => {
    return res.json(chatRealtime.getChatConfig());
  });

  app.post('/api/admin/chat/config', requireAdmin, requireAdminCsrf, (req, res) => {
    const result = chatRealtime.updateChatConfigByAdmin({ req, patch: req.body || {} });
    if (!result?.ok) {
      return res.status(400).json({ error: result?.error || '参数格式错误' });
    }
    return res.json(result.config);
  });

  app.get('/api/admin/chat/messages', requireAdmin, (req, res) => {
    const beforeId = toSafeInt(req.query.beforeId, 0);
    const limit = toSafeInt(req.query.limit, 100);
    const includeDeleted = String(req.query.includeDeleted || '1') !== '0';
    const items = chatRealtime.getAdminMessages({ beforeId, limit, includeDeleted });
    return res.json({ items, hasMore: items.length >= Math.min(Math.max(limit, 1), 100) });
  });

  app.get('/api/admin/chat/mutes', requireAdmin, (req, res) => {
    const now = Date.now();
    db.prepare('DELETE FROM chat_mutes WHERE muted_until IS NOT NULL AND muted_until <= ?').run(now);
    const rows = db.prepare(
      `
        SELECT fingerprint_hash, muted_until, reason, created_at, created_by_admin_id
        FROM chat_mutes
        ORDER BY created_at DESC
      `
    ).all();
    return res.json({ items: rows.map(mapMuteRow) });
  });

  app.post('/api/admin/chat/messages/:id/delete', requireAdmin, requireAdminCsrf, (req, res) => {
    const messageId = toSafeInt(req.params.id, 0);
    if (messageId <= 0) {
      return res.status(400).json({ error: '消息 ID 无效' });
    }
    const reason = String(req.body?.reason || '').trim();
    const result = chatRealtime.deleteMessageByAdmin({ req, messageId, reason });
    if (!result.ok) {
      return res.status(404).json({ error: result.error || '消息不存在' });
    }
    return res.json(result);
  });

  app.post('/api/admin/chat/users/:fingerprint/mute', requireAdmin, requireAdminCsrf, (req, res) => {
    const fingerprintHash = normalizeFingerprint(req.params.fingerprint);
    if (!fingerprintHash) {
      return res.status(400).json({ error: '指纹不能为空' });
    }
    const reason = String(req.body?.reason || '').trim();
    const expiresAt = resolveExpiresAt(req.body?.expiresAt, req.body?.durationMinutes);
    const payload = chatRealtime.muteByAdmin({ req, fingerprintHash, reason, expiresAt });
    return res.json(payload);
  });

  app.post('/api/admin/chat/sessions/:sessionId/mute', requireAdmin, requireAdminCsrf, (req, res) => {
    const sessionId = normalizeSessionId(req.params.sessionId);
    if (!sessionId) {
      return res.status(400).json({ error: '会话ID不能为空' });
    }
    const reason = String(req.body?.reason || '').trim();
    const expiresAt = resolveExpiresAt(req.body?.expiresAt, req.body?.durationMinutes);
    const result = chatRealtime.muteSessionByAdmin({ req, sessionId, reason, expiresAt });
    if (!result?.ok) {
      return res.status(404).json({ error: result?.error || '会话不存在' });
    }
    return res.json(result);
  });

  app.post('/api/admin/chat/users/:fingerprint/unmute', requireAdmin, requireAdminCsrf, (req, res) => {
    const fingerprintHash = normalizeFingerprint(req.params.fingerprint);
    if (!fingerprintHash) {
      return res.status(400).json({ error: '指纹不能为空' });
    }
    const reason = String(req.body?.reason || '').trim();
    const payload = chatRealtime.unmuteByAdmin({ req, fingerprintHash, reason });
    return res.json(payload);
  });

  app.post('/api/admin/chat/users/:fingerprint/kick', requireAdmin, requireAdminCsrf, (req, res) => {
    const fingerprintHash = normalizeFingerprint(req.params.fingerprint);
    if (!fingerprintHash) {
      return res.status(400).json({ error: '指纹不能为空' });
    }
    const reason = String(req.body?.reason || '').trim();
    const payload = chatRealtime.kickByAdmin({ req, fingerprintHash, reason });
    return res.json(payload);
  });

  app.post('/api/admin/chat/users/:fingerprint/ban', requireAdmin, requireAdminCsrf, (req, res) => {
    const fingerprintHash = normalizeFingerprint(req.params.fingerprint);
    if (!fingerprintHash) {
      return res.status(400).json({ error: '指纹不能为空' });
    }
    const reason = String(req.body?.reason || '').trim();
    const ip = String(req.body?.ip || '').trim();
    const scope = String(req.body?.scope || 'chat').trim() === 'site' ? 'site' : 'chat';
    const permissions = Array.isArray(req.body?.permissions) ? req.body.permissions : null;
    const expiresAt = resolveExpiresAt(req.body?.expiresAt, req.body?.durationMinutes);
    const payload = chatRealtime.banByAdmin({
      req,
      fingerprintHash,
      reason,
      ip,
      expiresAt,
      scope,
      permissions,
    });
    return res.json(payload);
  });

  app.post('/api/admin/chat/users/:fingerprint/unban', requireAdmin, requireAdminCsrf, (req, res) => {
    const fingerprintHash = normalizeFingerprint(req.params.fingerprint);
    if (!fingerprintHash) {
      return res.status(400).json({ error: '指纹不能为空' });
    }
    const reason = String(req.body?.reason || '').trim();
    const payload = chatRealtime.unbanByAdmin({ req, fingerprintHash, reason });
    return res.json(payload);
  });
};
