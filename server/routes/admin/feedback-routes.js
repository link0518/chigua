export const registerAdminFeedbackRoutes = (app, deps) => {
  const {
    db,
    requireAdmin,
    requireAdminCsrf,
    logAdminAction,
    resolveBanOptions,
    upsertBan,
    BAN_PERMISSIONS,
  } = deps;

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

    if (search) {
      conditions.push('(content LIKE ? OR email LIKE ? OR wechat LIKE ? OR qq LIKE ? OR session_id LIKE ? OR ip LIKE ? OR fingerprint LIKE ?)');
      const keyword = `%${search}%`;
      params.push(keyword, keyword, keyword, keyword, keyword, keyword, keyword);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = db
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

    const totalRow = db
      .prepare(`SELECT COUNT(1) AS count FROM feedback_messages ${whereClause}`)
      .get(...params);

    const items = rows.map((row) => ({
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
    }));

    return res.json({
      items,
      total: totalRow?.count || 0,
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

    const ip = row.ip;
    const fingerprint = row.fingerprint;
    if (!ip && !fingerprint) {
      return res.status(400).json({ error: '无法获取封禁标识（IP/指纹）' });
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
    if (fingerprint) {
      upsertBan('banned_fingerprints', 'fingerprint', fingerprint, banOptions || {});
      logAdminAction(req, {
        action: 'ban_fingerprint',
        targetType: 'fingerprint',
        targetId: fingerprint,
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
      after: { ip: ip || null, fingerprint: fingerprint || null },
      reason,
    });

    return res.json({
      id: feedbackId,
      ipBanned: Boolean(ip),
      fingerprintBanned: Boolean(fingerprint),
    });
  });
};
