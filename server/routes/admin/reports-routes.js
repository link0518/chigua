import { createModerationRepository } from '../../repositories/moderation-repository.js';
import { createAdminModerationService } from '../../services/admin-moderation-service.js';

export const registerAdminReportsRoutes = (app, deps) => {
  const {
    db,
    requireAdmin,
    requireAdminCsrf,
    formatRelativeTime,
    logAdminAction,
    resolveBanOptions,
    upsertBan,
    BAN_PERMISSIONS,
  } = deps;

  const moderationRepository = createModerationRepository(db);
  const moderationService = createAdminModerationService({
    repository: moderationRepository,
    upsertBan,
    BAN_PERMISSIONS,
    logAdminAction,
  });

  app.get('/api/reports', requireAdmin, (req, res) => {
    const status = String(req.query.status || '').trim();
    const search = String(req.query.search || '').trim();

    const conditions = [];
    const params = [];

    if (status) {
      conditions.push('status = ?');
      params.push(status);
    }

    if (search) {
      conditions.push(
        '(reports.id LIKE ? OR reports.content_snippet LIKE ? OR reports.reason LIKE ? OR reports.post_id LIKE ? OR reports.comment_id LIKE ? OR posts.content LIKE ? OR comments.content LIKE ? OR posts.ip LIKE ? OR comments.ip LIKE ? OR posts.fingerprint LIKE ? OR comments.fingerprint LIKE ?)'
      );
      const keyword = `%${search}%`;
      params.push(keyword, keyword, keyword, keyword, keyword, keyword, keyword, keyword, keyword, keyword, keyword);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = db
      .prepare(
        `
        SELECT reports.*,
          posts.content AS post_content,
          posts.ip AS post_ip,
          posts.fingerprint AS post_fingerprint,
          comments.content AS comment_content,
          comments.ip AS comment_ip,
          comments.fingerprint AS comment_fingerprint,
          reporter_stats.reporter_count AS reporter_count
        FROM reports
        LEFT JOIN posts ON posts.id = reports.post_id
        LEFT JOIN comments ON comments.id = reports.comment_id
        LEFT JOIN (
          SELECT fingerprint, COUNT(1) AS reporter_count
          FROM reports
          GROUP BY fingerprint
        ) reporter_stats ON reporter_stats.fingerprint = reports.fingerprint
        ${whereClause}
        ORDER BY reports.created_at DESC
        `
      )
      .all(...params);

    const reports = rows.map((row) => {
      const isComment = row.target_type === 'comment';
      const postContent = row.post_content || '';
      const commentContent = row.comment_content || '';
      return {
        id: row.id,
        targetId: isComment ? row.comment_id : row.post_id,
        targetType: row.target_type || 'post',
        postId: row.post_id,
        reason: row.reason,
        contentSnippet: row.content_snippet,
        postContent,
        commentContent,
        targetContent: isComment ? commentContent : postContent,
        targetIp: isComment ? row.comment_ip || null : row.post_ip || null,
        targetFingerprint: isComment ? row.comment_fingerprint || null : row.post_fingerprint || null,
        reporterIp: row.reporter_ip || null,
        reporterFingerprint: row.fingerprint || null,
        reporterCount: row.reporter_count ? Number(row.reporter_count) : 0,
        timestamp: formatRelativeTime(row.created_at),
        status: row.status,
        riskLevel: row.risk_level,
      };
    });

    return res.json({ items: reports });
  });

  app.post('/api/reports/:id/action', requireAdmin, requireAdminCsrf, (req, res) => {
    const reportId = req.params.id;
    const action = String(req.body?.action || '').trim();
    const reason = String(req.body?.reason || '').trim();

    if (!['ignore', 'delete', 'ban'].includes(action)) {
      return res.status(400).json({ error: '无效操作' });
    }

    const banOptions = action === 'ban' ? resolveBanOptions(req) : null;
    const deleteComment = action === 'ban'
      && (req.body?.deleteComment === true
        || req.body?.deleteComment === 'true'
        || req.body?.deleteComment === 1
        || req.body?.deleteComment === '1');
    const result = moderationService.executeReportAction({
      req,
      reportId,
      action,
      reason,
      banOptions,
      deleteComment,
    });

    if (!result) {
      return res.status(404).json({ error: '举报不存在' });
    }

    return res.json(result);
  });

  app.post('/api/admin/reports/batch', requireAdmin, requireAdminCsrf, (req, res) => {
    const action = String(req.body?.action || '').trim();
    const reason = String(req.body?.reason || '').trim();
    const reportIds = Array.isArray(req.body?.reportIds) ? req.body.reportIds : [];

    if (action !== 'resolve') {
      return res.status(400).json({ error: '无效操作' });
    }

    const ids = Array.from(new Set(reportIds.map((id) => String(id || '').trim()).filter(Boolean)));
    if (!ids.length) {
      return res.status(400).json({ error: '未选择举报' });
    }
    if (ids.length > 200) {
      return res.status(400).json({ error: '批量操作数量过多' });
    }

    return res.json(
      moderationService.executeReportBatchResolve({
        req,
        ids,
        reason,
      })
    );
  });
};
