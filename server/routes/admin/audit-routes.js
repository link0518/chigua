export const registerAdminAuditRoutes = (app, deps) => {
  const {
    db,
    requireAdmin,
    AUDIT_RETENTION_MS,
  } = deps;

  app.get('/api/admin/audit-logs', requireAdmin, (req, res) => {
    const search = String(req.query.search || '').trim();
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);
    const offset = (page - 1) * limit;
    const now = Date.now();
    db.prepare('DELETE FROM admin_audit_logs WHERE created_at < ?').run(now - AUDIT_RETENTION_MS);

    const conditions = [];
    const params = [];

    if (search) {
      conditions.push('(admin_username LIKE ? OR action LIKE ? OR target_id LIKE ? OR target_type LIKE ?)');
      const keyword = `%${search}%`;
      params.push(keyword, keyword, keyword, keyword);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = db
      .prepare(
        `
        SELECT *
        FROM admin_audit_logs
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
        `
      )
      .all(...params, limit, offset);

    const totalRow = db
      .prepare(`SELECT COUNT(1) AS count FROM admin_audit_logs ${whereClause}`)
      .get(...params);

    const items = rows.map((row) => ({
      id: row.id,
      adminId: row.admin_id,
      adminUsername: row.admin_username,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      before: row.before_json,
      after: row.after_json,
      reason: row.reason,
      ip: row.ip,
      sessionId: row.session_id,
      createdAt: row.created_at,
    }));

    return res.json({
      items,
      total: totalRow?.count || 0,
      page,
      limit,
    });
  });
};
