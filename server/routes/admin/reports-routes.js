import { createModerationRepository } from '../../repositories/moderation-repository.js';
import { createAdminModerationService } from '../../services/admin-moderation-service.js';
import { buildAdminIdentity, matchesAdminSearch } from '../../admin-identity-utils.js';

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
    chatRealtime,
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

  const resolveAdminIdentity = ({ fingerprint, sessionId = '', ip = '' }) => buildAdminIdentity({
    fingerprint,
    sessionId,
    ip,
    resolveStoredIdentityHash,
  });

  app.get('/api/reports', requireAdmin, (req, res) => {
    const status = String(req.query.status || '').trim();
    const search = String(req.query.search || '').trim();
    const includeRumor = req.query.includeRumor === true
      || req.query.includeRumor === 'true'
      || req.query.includeRumor === '1';
    const parsedLimit = Number(req.query.limit);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(Math.floor(parsedLimit), 50)
      : 0;

    const conditions = [];
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
        db.prepare(`SELECT COUNT(1) AS count FROM reports ${whereClause}`)
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
          chat_messages.text_content AS chat_content,
          chat_messages.ip_snapshot AS chat_ip,
          chat_messages.session_id AS chat_session_id,
          chat_messages.fingerprint_hash AS chat_fingerprint,
          reporter_stats.reporter_count AS reporter_count
        FROM reports
        LEFT JOIN posts ON posts.id = reports.post_id
        LEFT JOIN comments ON comments.id = reports.comment_id
        LEFT JOIN chat_messages ON reports.target_type = 'chat'
          AND reports.post_id LIKE 'chat:%'
          AND chat_messages.id = CAST(SUBSTR(reports.post_id, 6) AS INTEGER)
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
      const isChat = row.target_type === 'chat';
      const postContent = row.post_content || '';
      const commentContent = row.comment_content || '';
      const chatContent = row.chat_content || '';
      const targetIdentity = resolveAdminIdentity({
        fingerprint: isComment ? row.comment_fingerprint || '' : isChat ? row.chat_fingerprint || '' : row.post_fingerprint || '',
        sessionId: isComment ? '' : isChat ? row.chat_session_id || '' : row.post_session_id || '',
        ip: isComment ? row.comment_ip || '' : isChat ? row.chat_ip || '' : row.post_ip || '',
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
        targetContent: isComment ? commentContent : isChat ? chatContent : postContent,
        targetIp: isComment ? row.comment_ip || null : isChat ? row.chat_ip || null : row.post_ip || null,
        targetSessionId: isComment ? null : isChat ? row.chat_session_id || null : row.post_session_id || null,
        targetFingerprint: isComment ? row.comment_fingerprint || null : isChat ? row.chat_fingerprint || null : row.post_fingerprint || null,
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

  app.post('/api/reports/:id/action', requireAdmin, requireAdminCsrf, (req, res) => {
    const reportId = req.params.id;
    const rawAction = String(req.body?.action || '').trim().toLowerCase();
    const action = rawAction === 'muted' || rawAction === 'silence'
      ? 'mute'
      : rawAction;
    const reason = String(req.body?.reason || '').trim();

    if (!['ignore', 'delete', 'mute', 'ban'].includes(action)) {
      return res.status(400).json({ error: '无效操作' });
    }

    const banOptions = action === 'ban' || action === 'mute' ? resolveBanOptions(req) : null;
    const deleteComment = action === 'ban'
      && (req.body?.deleteComment === true
        || req.body?.deleteComment === 'true'
        || req.body?.deleteComment === 1
        || req.body?.deleteComment === '1');
    const deleteChatMessage = action === 'ban'
      && (req.body?.deleteChatMessage === true
        || req.body?.deleteChatMessage === 'true'
        || req.body?.deleteChatMessage === 1
        || req.body?.deleteChatMessage === '1');

    const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(reportId);
    if (!report) {
      return res.status(404).json({ error: '举报不存在' });
    }

    if (report.target_type === 'chat') {
      const nextStatus = action === 'ignore' ? 'ignored' : 'resolved';
      const now = Date.now();

      if (action === 'delete' || action === 'ban' || action === 'mute') {
        const matched = String(report.post_id || '').match(/^chat:(\d+)$/);
        const messageId = matched ? Number(matched[1]) : 0;
        if (messageId <= 0) {
          return res.status(400).json({ error: '无法识别聊天室消息 ID' });
        }

        const chatMessage = db.prepare(
          `
            SELECT id, fingerprint_hash, ip_snapshot, created_at
            FROM chat_messages
            WHERE id = ?
            LIMIT 1
          `
        ).get(messageId);
        if (!chatMessage) {
          return res.status(404).json({ error: '聊天室消息不存在' });
        }

        if (action === 'delete' || (action === 'ban' && deleteChatMessage)) {
          const deleteResult = chatRealtime.deleteMessageByAdmin({
            req,
            messageId,
            reason: reason || '管理员处理聊天室举报删除消息',
          });
          if (!deleteResult?.ok) {
            return res.status(404).json({ error: '聊天室消息不存在' });
          }
        }

        if (action === 'ban' || action === 'mute') {
          const fingerprintHash = String(chatMessage.fingerprint_hash || '').trim();
          if (!fingerprintHash) {
            return res.status(400).json({ error: '无法识别被举报消息作者指纹' });
          }

          if (action === 'ban') {
            const permissions = Array.isArray(banOptions?.permissions) ? banOptions.permissions : null;
            const scope = permissions && permissions.includes('site') ? 'site' : 'chat';
            const resolvedIdentity = resolveStoredIdentityHash(fingerprintHash);
            chatRealtime.banByAdmin({
              req,
              fingerprintHash,
              reason: reason || '管理员处理聊天室举报封禁用户',
              ip: String(chatMessage.ip_snapshot || '').trim(),
              expiresAt: banOptions?.expiresAt || null,
              scope,
              permissions,
              identityType: resolvedIdentity?.type === 'identity' ? 'identity' : 'fingerprint',
            });
          } else {
            chatRealtime.muteByAdmin({
              req,
              fingerprintHash,
              reason: reason || '管理员处理聊天室举报禁言用户',
              expiresAt: banOptions?.expiresAt || null,
            });
          }
        }
      }

      db.prepare('UPDATE reports SET status = ?, action = ?, resolved_at = ? WHERE id = ?')
        .run(nextStatus, action, now, reportId);

      logAdminAction(req, {
        action: `report_${action}`,
        targetType: 'report',
        targetId: reportId,
        before: { status: report.status, action: report.action || null },
        after: { status: nextStatus, action },
        reason,
      });

      return res.json({ status: nextStatus, action });
    }

    if (action === 'mute') {
      return res.status(400).json({ error: '当前举报类型不支持禁言' });
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
