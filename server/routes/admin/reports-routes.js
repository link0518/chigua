import { createModerationRepository } from '../../repositories/moderation-repository.js';
import { createAdminModerationService } from '../../services/admin-moderation-service.js';
import { buildAdminIdentity, matchesAdminSearch } from '../../admin-identity-utils.js';

export const registerAdminReportsRoutes = (app, deps) => {
  const {
    db,
    requireAdmin,
    requireAdminCsrf,
    requireAdminRead = (_req, _res, next) => next(),
    requireAdminManage = (_req, _res, next) => next(),
    formatRelativeTime,
    logAdminAction,
    resolveBanOptions,
    upsertBan,
    BAN_PERMISSIONS,
    resolveStoredIdentityHash,
  } = deps;

  const moderationRepository = createModerationRepository(db);
  const moderationService = createAdminModerationService({
    repository: moderationRepository,
    upsertBan,
    BAN_PERMISSIONS,
    logAdminAction,
    resolveStoredIdentityHash,
  });
  const EXCLUDE_RUMOR_REPORT_SQL = "((reports.reason_code IS NULL OR reports.reason_code != 'rumor') AND NOT (reports.reason_code IS NULL AND reports.reason = '举报谣言'))";
  const REPORT_TARGET_JOINS_SQL = `
    LEFT JOIN posts ON posts.id = reports.post_id
    LEFT JOIN comments ON comments.id = reports.comment_id
  `;
  const ACTIONABLE_PENDING_REPORT_SQL = `(
    reports.status != 'pending'
    OR (
      reports.target_type = 'post'
      AND posts.id IS NOT NULL
      AND COALESCE(posts.deleted, 0) != 1
      AND COALESCE(posts.hidden, 0) != 1
    )
    OR (
      reports.target_type = 'comment'
      AND comments.id IS NOT NULL
      AND COALESCE(comments.deleted, 0) != 1
      AND COALESCE(comments.hidden, 0) != 1
      AND posts.id IS NOT NULL
      AND COALESCE(posts.deleted, 0) != 1
      AND COALESCE(posts.hidden, 0) != 1
    )
  )`;

  const resolveAdminIdentity = ({ fingerprint, sessionId = '', ip = '' }) => buildAdminIdentity({
    fingerprint,
    sessionId,
    ip,
    resolveStoredIdentityHash,
  });

  app.get('/api/reports', requireAdmin, requireAdminRead, (req, res) => {
    const status = String(req.query.status || '').trim();
    const search = String(req.query.search || '').trim();
    const includeRumor = req.query.includeRumor === true
      || req.query.includeRumor === 'true'
      || req.query.includeRumor === '1';
    const parsedLimit = Number(req.query.limit);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(Math.floor(parsedLimit), 50)
      : 0;

    const conditions = ["reports.target_type != 'chat'", ACTIONABLE_PENDING_REPORT_SQL];
    const params = [];

    if (status) {
      conditions.push('status = ?');
      params.push(status);
    }
    if (!includeRumor) {
      conditions.push(EXCLUDE_RUMOR_REPORT_SQL);
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const canUseSqlLimit = limit > 0 && !search;
    const listParams = canUseSqlLimit ? [...params, limit] : params;
    const limitClause = canUseSqlLimit ? 'LIMIT ?' : '';
    const total = canUseSqlLimit
      ? Number(
        db.prepare(`SELECT COUNT(1) AS count FROM reports ${REPORT_TARGET_JOINS_SQL} ${whereClause}`)
          .get(...params)?.count || 0
      )
      : 0;

    const rows = db
      .prepare(
        `
        SELECT reports.*,
          posts.content AS post_content,
          posts.ip AS post_ip,
          posts.session_id AS post_session_id,
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
        ${limitClause}
        `
      )
      .all(...listParams);

    const reports = rows.map((row) => {
      const isComment = row.target_type === 'comment';
      const postContent = row.post_content || '';
      const commentContent = row.comment_content || '';
      const targetIdentity = resolveAdminIdentity({
        fingerprint: isComment ? row.comment_fingerprint || '' : row.post_fingerprint || '',
        sessionId: isComment ? '' : row.post_session_id || '',
        ip: isComment ? row.comment_ip || '' : row.post_ip || '',
      });
      const reporterIdentity = resolveAdminIdentity({
        fingerprint: row.fingerprint || '',
        ip: row.reporter_ip || '',
      });
      return {
        id: row.id,
        targetId: isComment ? row.comment_id : row.post_id,
        targetType: row.target_type || 'post',
        postId: row.post_id,
        reason: row.reason,
        reasonCode: row.reason_code || null,
        evidence: row.evidence || null,
        contentSnippet: row.content_snippet,
        postContent,
        commentContent,
        targetContent: isComment ? commentContent : postContent,
        targetIp: isComment ? row.comment_ip || null : row.post_ip || null,
        targetSessionId: isComment ? null : row.post_session_id || null,
        targetFingerprint: isComment ? row.comment_fingerprint || null : row.post_fingerprint || null,
        targetIdentityKey: targetIdentity.identityKey,
        targetIdentityHashes: targetIdentity.identityHashes,
        reporterIp: row.reporter_ip || null,
        reporterFingerprint: row.fingerprint || null,
        reporterIdentityKey: reporterIdentity.identityKey,
        reporterIdentityHashes: reporterIdentity.identityHashes,
        reporterCount: row.reporter_count ? Number(row.reporter_count) : 0,
        timestamp: formatRelativeTime(row.created_at),
        status: row.status,
        riskLevel: row.risk_level,
      };
    });

    const filteredReports = search
      ? reports.filter((item) => matchesAdminSearch(search, [
        item.id,
        item.contentSnippet,
        item.reason,
        item.reasonCode || '',
        item.evidence || '',
        item.postId,
        item.targetId,
        item.postContent,
        item.commentContent,
        item.targetContent,
        item.targetIp || '',
        item.targetSessionId || '',
        item.targetFingerprint || '',
        item.targetIdentityKey || '',
        ...(item.targetIdentityHashes || []),
        item.reporterIp || '',
        item.reporterFingerprint || '',
        item.reporterIdentityKey || '',
        ...(item.reporterIdentityHashes || []),
      ]))
      : reports;

    return res.json({
      items: filteredReports,
      total: search ? filteredReports.length : (canUseSqlLimit ? total : filteredReports.length),
    });
  });

  app.post('/api/reports/:id/action', requireAdmin, requireAdminCsrf, requireAdminManage, (req, res) => {
    const reportId = req.params.id;
    const rawAction = String(req.body?.action || '').trim().toLowerCase();
    const action = rawAction;
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
    const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(reportId);
    if (!report) {
      return res.status(404).json({ error: '举报不存在' });
    }



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
    if (result.error) {
      const statusCode = result.code === 'already_processed' ? 409 : 400;
      return res.status(statusCode).json({ error: result.error });
    }

    return res.json(result);
  });
  app.post('/api/admin/reports/batch', requireAdmin, requireAdminCsrf, requireAdminManage, (req, res) => {
    const action = String(req.body?.action || '').trim();
    const reason = String(req.body?.reason || '').trim();
    const reportIds = Array.isArray(req.body?.reportIds) ? req.body.reportIds : [];

    if (!['resolve', 'ignore'].includes(action)) {
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
        action,
      })
    );
  });
};
