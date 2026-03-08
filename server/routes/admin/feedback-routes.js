import {
  buildAdminIdentity,
  buildAdminIdentitySearchValues,
  matchesAdminSearch,
} from '../../admin-identity-utils.js';

export const registerAdminFeedbackRoutes = (app, deps) => {
  const {
    db,
    requireAdmin,
    requireAdminCsrf,
    logAdminAction,
    resolveBanOptions,
    upsertBan,
    BAN_PERMISSIONS,
    identityCutoverAt,
  } = deps;

  const resolveAdminIdentity = ({ fingerprint, sessionId = '', ip = '' }) => buildAdminIdentity({
    fingerprint,
    sessionId,
    ip,
  });

  const buildFeedbackItem = (row) => ({
    id: row.id,
    content: row.content,
    email: row.email,
    wechat: row.wechat,
    qq: row.qq,
    createdAt: row.created_at,
    readAt: row.read_at,
    sessionId: row.session_id || null,
    ip: row.ip || null,
    fingerprint: row.fingerprint || null,
    ...resolveAdminIdentity({
      fingerprint: row.fingerprint || '',
      sessionId: row.session_id || '',
      ip: row.ip || '',
    }),
  });

  const buildFeedbackSearchValues = (item) => [
    item.content,
    item.email,
    item.wechat || '',
    item.qq || '',
    ...buildAdminIdentitySearchValues(item),
  ];

  app.get('/api/admin/feedback', requireAdmin, (req, res) => {
    const status = String(req.query.status || 'unread').trim();
    const search = String(req.query.search || '').trim();
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 10), 1), 50);
    const offset = (page - 1) * limit;

    const conditions = [];
    const params = [];

    if (status === 'unread') {
      conditions.push('read_at IS NULL');
    } else if (status === 'read') {
      conditions.push('read_at IS NOT NULL');
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    let rows;
    let total = 0;

    if (search) {
      rows = db
        .prepare(
          `
          SELECT *
          FROM feedback_messages
          ${whereClause}
          ORDER BY created_at DESC
          `
        )
        .all(...params);
    } else {
      total = db
        .prepare(
          `
          SELECT COUNT(1) AS count
          FROM feedback_messages
          ${whereClause}
          `
        )
        .get(...params)?.count || 0;

      rows = db
        .prepare(
          `
          SELECT *
          FROM feedback_messages
          ${whereClause}
          ORDER BY created_at DESC
          LIMIT ? OFFSET ?
          `
        )
        .all(...params, limit, offset);
    }

    let items = rows.map((row) => buildFeedbackItem(row));
    if (search) {
      items = items.filter((item) => matchesAdminSearch(search, buildFeedbackSearchValues(item)));
      total = items.length;
      items = items.slice(offset, offset + limit);
    }

    return res.json({
      items,
      total,
      page,
      limit,
    });
  });

  app.post('/api/admin/feedback/:id/action', requireAdmin, requireAdminCsrf, (req, res) => {
    const feedbackId = String(req.params.id || '').trim();
    const action = String(req.body?.action || '').trim();
    const reason = String(req.body?.reason || '').trim();

    if (!feedbackId) {
      return res.status(400).json({ error: '留言不存在' });
    }

    if (!['read', 'delete', 'ban'].includes(action)) {
      return res.status(400).json({ error: '无效操作' });
    }

    const row = db.prepare('SELECT * FROM feedback_messages WHERE id = ?').get(feedbackId);
    if (!row) {
      return res.status(404).json({ error: '留言不存在' });
    }

    const now = Date.now();
    const banOptions = action === 'ban' ? resolveBanOptions(req) : null;

    if (action === 'read') {
      if (!row.read_at) {
        db.prepare('UPDATE feedback_messages SET read_at = ? WHERE id = ?').run(now, feedbackId);
      }
      logAdminAction(req, {
        action: 'feedback_read',
        targetType: 'feedback',
        targetId: feedbackId,
        before: { readAt: row.read_at || null },
        after: { readAt: row.read_at || now },
        reason,
      });
      return res.json({ id: feedbackId, readAt: row.read_at || now });
    }

    if (action === 'delete') {
      db.prepare('DELETE FROM feedback_messages WHERE id = ?').run(feedbackId);
      logAdminAction(req, {
        action: 'feedback_delete',
        targetType: 'feedback',
        targetId: feedbackId,
        before: {
          content: row.content,
          email: row.email,
          wechat: row.wechat,
          qq: row.qq,
          readAt: row.read_at || null,
        },
        after: null,
        reason,
      });
      return res.json({ id: feedbackId, deleted: true });
    }

    const ip = String(row.ip || '').trim();
    const identityValue = String(row.fingerprint || '').trim();
    const isIdentityRecord = Number(row.created_at || 0) >= identityCutoverAt;
    if (!ip && !identityValue) {
      return res.status(400).json({ error: '无法获取可封禁的身份标识（IP/身份）' });
    }

    if (ip) {
      upsertBan('banned_ips', 'ip', ip, banOptions || {});
      logAdminAction(req, {
        action: 'ban_ip',
        targetType: 'ip',
        targetId: ip,
        before: null,
        after: { banned: true, permissions: banOptions?.permissions || BAN_PERMISSIONS, expiresAt: banOptions?.expiresAt || null },
        reason,
      });
    }

    let identityBanned = false;
    let fingerprintBanned = false;
    if (identityValue) {
      if (isIdentityRecord) {
        upsertBan('banned_identities', 'identity', identityValue, banOptions || {});
        identityBanned = true;
      } else {
        upsertBan('banned_fingerprints', 'fingerprint', identityValue, banOptions || {});
        fingerprintBanned = true;
      }
      logAdminAction(req, {
        action: isIdentityRecord ? 'ban_identity' : 'ban_fingerprint',
        targetType: isIdentityRecord ? 'identity' : 'fingerprint',
        targetId: identityValue,
        before: null,
        after: { banned: true, permissions: banOptions?.permissions || BAN_PERMISSIONS, expiresAt: banOptions?.expiresAt || null },
        reason,
      });
    }

    logAdminAction(req, {
      action: 'feedback_ban',
      targetType: 'feedback',
      targetId: feedbackId,
      before: null,
      after: {
        ip: ip || null,
        identityKey: isIdentityRecord ? identityValue || null : null,
        identityHashes: identityValue ? [identityValue] : [],
      },
      reason,
    });

    return res.json({
      id: feedbackId,
      ipBanned: Boolean(ip),
      identityBanned,
      fingerprintBanned,
    });
  });
};
