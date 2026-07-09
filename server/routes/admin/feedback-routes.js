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
    requireAdminRead = (_req, _res, next) => next(),
    requireAdminManage = (_req, _res, next) => next(),
    logAdminAction,
    resolveBanOptions,
    upsertBan,
    BAN_PERMISSIONS,
    resolveStoredIdentityHash,
    createNotification,
    crypto,
  } = deps;

  const resolveAdminIdentity = ({ fingerprint, sessionId = '', ip = '' }) => buildAdminIdentity({
    fingerprint,
    sessionId,
    ip,
    resolveStoredIdentityHash,
  });

  const buildFeedbackReplyItem = (row) => ({
    id: row.id,
    feedbackId: row.feedback_id,
    content: row.content,
    adminId: row.admin_id || null,
    adminUsername: row.admin_username || null,
    createdAt: row.created_at,
  });

  const buildFeedbackItem = (row, replies = []) => ({
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
    replies,
  });

  const buildFeedbackSearchValues = (item) => [
    item.content,
    item.email,
    item.wechat || '',
    item.qq || '',
    ...buildAdminIdentitySearchValues(item),
  ];

  app.get('/api/admin/feedback', requireAdmin, requireAdminRead, (req, res) => {
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

    const replyRows = rows.length
      ? db
        .prepare(
          `
          SELECT *
          FROM feedback_replies
          WHERE feedback_id IN (${rows.map(() => '?').join(',')})
          ORDER BY created_at ASC, id ASC
          `
        )
        .all(...rows.map((row) => row.id))
      : [];
    const repliesByFeedback = new Map();
    replyRows.forEach((row) => {
      const current = repliesByFeedback.get(row.feedback_id) || [];
      current.push(buildFeedbackReplyItem(row));
      repliesByFeedback.set(row.feedback_id, current);
    });

    let items = rows.map((row) => buildFeedbackItem(row, repliesByFeedback.get(row.id) || []));
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

  app.post('/api/admin/feedback/:id/action', requireAdmin, requireAdminCsrf, requireAdminManage, (req, res) => {
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
      const deleteFeedback = db.transaction((id) => {
        db.prepare('DELETE FROM feedback_replies WHERE feedback_id = ?').run(id);
        db.prepare('DELETE FROM feedback_messages WHERE id = ?').run(id);
      });
      deleteFeedback(feedbackId);
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
    const resolvedIdentity = identityValue ? resolveStoredIdentityHash(identityValue) : null;
    const isIdentityRecord = resolvedIdentity?.type === 'identity';
    const banTargetValue = String(resolvedIdentity?.identityKey || identityValue).trim();
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
        upsertBan('banned_identities', 'identity', banTargetValue, banOptions || {});
        identityBanned = true;
      } else {
        upsertBan('banned_fingerprints', 'fingerprint', banTargetValue, banOptions || {});
        fingerprintBanned = true;
      }
      logAdminAction(req, {
        action: isIdentityRecord ? 'ban_identity' : 'ban_fingerprint',
        targetType: isIdentityRecord ? 'identity' : 'fingerprint',
        targetId: banTargetValue,
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
        identityKey: isIdentityRecord ? banTargetValue || null : null,
        identityHashes: banTargetValue ? [banTargetValue] : [],
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

  app.post('/api/admin/feedback/:id/replies', requireAdmin, requireAdminCsrf, requireAdminManage, (req, res) => {
    const feedbackId = String(req.params.id || '').trim();
    const content = String(req.body?.content || '').trim();

    if (!feedbackId) {
      return res.status(400).json({ error: '留言不存在' });
    }

    if (!content) {
      return res.status(400).json({ error: '回复内容不能为空' });
    }

    if (content.length > 1000) {
      return res.status(400).json({ error: '回复内容不能超过 1000 字' });
    }

    const row = db.prepare('SELECT * FROM feedback_messages WHERE id = ?').get(feedbackId);
    if (!row) {
      return res.status(404).json({ error: '留言不存在' });
    }

    const recipientFingerprint = String(row.fingerprint || '').trim();
    if (!recipientFingerprint) {
      return res.status(400).json({ error: '该留言缺少用户身份，无法发送站内回复' });
    }

    const admin = req.session?.admin || {};
    const now = Date.now();
    const replyId = crypto.randomUUID();
    db.prepare(
      `
      INSERT INTO feedback_replies (
        id,
        feedback_id,
        content,
        admin_id,
        admin_username,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      `
    ).run(
      replyId,
      feedbackId,
      content,
      typeof admin.id === 'number' ? admin.id : null,
      admin.username || null,
      now
    );

    createNotification?.({
      recipientFingerprint,
      type: 'feedback_reply',
      preview: content,
      actorIdentityContext: null,
    });

    logAdminAction(req, {
      action: 'feedback_reply',
      targetType: 'feedback',
      targetId: feedbackId,
      before: null,
      after: { replyId },
      reason: null,
    });

    return res.status(201).json({
      item: buildFeedbackReplyItem({
        id: replyId,
        feedback_id: feedbackId,
        content,
        admin_id: typeof admin.id === 'number' ? admin.id : null,
        admin_username: admin.username || null,
        created_at: now,
      }),
    });
  });
};
