const AUDIT_CATEGORY_ACTIONS = {
  content: [
    'post_create',
    'post_edit',
    'post_delete',
    'post_restore',
    'comment_delete',
    'comment_ban',
    'post_hidden_keep',
    'post_hidden_restore',
    'comment_hidden_keep',
    'comment_hidden_restore',
  ],
  content_review: [
    'report_ignore',
    'report_resolve',
    'report_delete',
    'report_ban',
    'rumor_mark',
    'rumor_reject',
    'rumor_ignore',
    'rumor_clear',
    'post_delete_request_approve',
    'post_delete_request_reject',
  ],
  user_safety: [
    'ban_ip',
    'unban_ip',
    'ban_identity',
    'unban_identity',
    'ban_fingerprint',
    'unban_fingerprint',
    'post_batch_ban',
    'post_batch_unban',
    'feedback_ban',
  ],
  feedback: [
    'feedback_read',
    'feedback_delete',
    'feedback_reply',
  ],
  wiki: [
    'wiki_entry_create',
    'wiki_entry_edit',
    'wiki_entry_delete',
    'wiki_entry_restore',
    'wiki_revision_approve',
    'wiki_revision_reject',
  ],
  publish: [
    'announcement_update',
    'announcement_clear',
    'update_announcement_create',
    'update_announcement_delete',
  ],
  settings: [
    'settings_update',
  ],
  vocabulary: [
    'vocabulary_add',
    'vocabulary_update',
    'vocabulary_toggle',
    'vocabulary_delete',
    'vocabulary_import',
  ],
  admin_users: [
    'admin_user_create',
    'admin_user_permissions_update',
    'admin_user_disable',
    'admin_user_enable',
    'admin_user_password_reset',
  ],
};

const HIGH_RISK_ACTIONS = new Set([
  'announcement_clear',
  'admin_user_create',
  'admin_user_permissions_update',
  'admin_user_disable',
  'admin_user_enable',
  'admin_user_password_reset',
  'ban_ip',
  'ban_identity',
  'ban_fingerprint',
  'comment_ban',
  'comment_delete',
  'feedback_ban',
  'feedback_delete',
  'post_batch_ban',
  'post_batch_unban',
  'post_delete',
  'post_delete_request_approve',
  'report_ban',
  'report_delete',
  'settings_update',
  'unban_ip',
  'unban_identity',
  'unban_fingerprint',
  'update_announcement_delete',
  'vocabulary_delete',
  'wiki_entry_delete',
]);

const ACTION_CATEGORY_MAP = Object.entries(AUDIT_CATEGORY_ACTIONS).reduce((result, [category, actions]) => {
  actions.forEach((action) => {
    result[action] = category;
  });
  return result;
}, {});

const normalizeQueryString = (value) => String(value || '').trim();

const normalizeTimeQuery = (value) => {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
};

const getAuditCategory = (action, targetType) => {
  if (ACTION_CATEGORY_MAP[action]) {
    return ACTION_CATEGORY_MAP[action];
  }
  if (action.startsWith('ban_') || action.startsWith('unban_')) {
    return 'user_safety';
  }
  if (action.startsWith('wiki_')) {
    return 'wiki';
  }
  if (action.startsWith('admin_user_')) {
    return 'admin_users';
  }
  if (action.startsWith('vocabulary_')) {
    return 'vocabulary';
  }
  if (action.startsWith('feedback_')) {
    return 'feedback';
  }
  if (action.startsWith('announcement_') || action.startsWith('update_announcement_')) {
    return 'publish';
  }
  if (action.startsWith('settings_')) {
    return 'settings';
  }
  if (action.startsWith('report_') || action.startsWith('rumor_')) {
    return 'content_review';
  }
  if (action.startsWith('post_delete_request_')) {
    return 'content_review';
  }
  if (['post', 'comment'].includes(targetType)) {
    return 'content';
  }
  return 'other';
};

const getAuditRiskLevel = (action) => {
  if (
    HIGH_RISK_ACTIONS.has(action)
    || action.startsWith('ban_')
    || action.startsWith('unban_')
    || action.endsWith('_delete')
  ) {
    return 'high';
  }
  return 'normal';
};

const addInCondition = (conditions, params, column, values) => {
  const normalizedValues = Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
  if (!normalizedValues.length) {
    conditions.push('1 = 0');
    return;
  }
  conditions.push(`${column} IN (${normalizedValues.map(() => '?').join(', ')})`);
  params.push(...normalizedValues);
};

const addHighRiskCondition = (conditions, params) => {
  const actions = Array.from(HIGH_RISK_ACTIONS);
  const placeholders = actions.map(() => '?').join(', ');
  conditions.push(`(action IN (${placeholders}) OR action LIKE ? OR action LIKE ? OR action LIKE ?)`);
  params.push(...actions, 'ban_%', 'unban_%', '%_delete');
};

export const registerAdminAuditRoutes = (app, deps) => {
  const {
    db,
    requireAdmin,
    requireSuperAdmin = (_req, _res, next) => next(),
    AUDIT_RETENTION_MS,
  } = deps;

  app.get('/api/admin/audit-logs', requireAdmin, requireSuperAdmin, (req, res) => {
    const search = normalizeQueryString(req.query.search);
    const action = normalizeQueryString(req.query.action);
    const category = normalizeQueryString(req.query.category);
    const targetType = normalizeQueryString(req.query.targetType);
    const adminUsername = normalizeQueryString(req.query.adminUsername);
    const riskLevel = normalizeQueryString(req.query.riskLevel);
    const hasReason = normalizeQueryString(req.query.hasReason);
    const from = normalizeTimeQuery(req.query.from);
    const to = normalizeTimeQuery(req.query.to);
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);
    const offset = (page - 1) * limit;
    const now = Date.now();
    db.prepare('DELETE FROM admin_audit_logs WHERE created_at < ?').run(now - AUDIT_RETENTION_MS);

    const conditions = [];
    const params = [];

    if (search) {
      conditions.push('(admin_username LIKE ? OR action LIKE ? OR target_id LIKE ? OR target_type LIKE ? OR reason LIKE ? OR ip LIKE ?)');
      const keyword = `%${search}%`;
      params.push(keyword, keyword, keyword, keyword, keyword, keyword);
    }

    if (action) {
      conditions.push('action = ?');
      params.push(action);
    }

    if (category && category !== 'all') {
      addInCondition(conditions, params, 'action', AUDIT_CATEGORY_ACTIONS[category] || []);
    }

    if (targetType && targetType !== 'all') {
      conditions.push('target_type = ?');
      params.push(targetType);
    }

    if (adminUsername && adminUsername !== 'all') {
      conditions.push('admin_username = ?');
      params.push(adminUsername);
    }

    if (riskLevel === 'high') {
      addHighRiskCondition(conditions, params);
    }

    if (hasReason === 'true') {
      conditions.push("COALESCE(TRIM(reason), '') <> ''");
    } else if (hasReason === 'false') {
      conditions.push("COALESCE(TRIM(reason), '') = ''");
    }

    if (from !== null) {
      conditions.push('created_at >= ?');
      params.push(from);
    }

    if (to !== null) {
      conditions.push('created_at <= ?');
      params.push(to);
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
      category: getAuditCategory(row.action, row.target_type),
      riskLevel: getAuditRiskLevel(row.action),
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
