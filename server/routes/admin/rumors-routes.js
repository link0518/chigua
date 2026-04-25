import { buildAdminIdentity, matchesAdminSearch } from '../../admin-identity-utils.js';

const RUMOR_REASON_SQL = "(reason_code = 'rumor' OR (reason_code IS NULL AND reason = '举报谣言'))";

export const registerAdminRumorsRoutes = (app, deps) => {
  const {
    db,
    requireAdmin,
    requireAdminCsrf,
    logAdminAction,
    resolveStoredIdentityHash,
    createNotification,
  } = deps;

  const resolveAdminIdentity = ({ fingerprint, sessionId = '', ip = '' }) => buildAdminIdentity({
    fingerprint,
    sessionId,
    ip,
    resolveStoredIdentityHash,
  });

  const normalizeViewStatus = (value) => {
    const status = String(value || '').trim().toLowerCase();
    return ['pending', 'suspected', 'rejected', 'all'].includes(status) ? status : 'pending';
  };

  const normalizeTargetType = (value) => {
    const targetType = String(value || '').trim().toLowerCase();
    return ['post', 'comment', 'all'].includes(targetType) ? targetType : 'all';
  };

  const getPendingRumorReports = (targetType, targetId) => {
    const targetWhereClause = targetType === 'comment'
      ? "comment_id = ? AND target_type = 'comment'"
      : "post_id = ? AND target_type = 'post'";

    return db.prepare(`
      SELECT id, post_id, comment_id, fingerprint, content_snippet
      FROM reports
      WHERE ${targetWhereClause}
        AND ${RUMOR_REASON_SQL}
        AND status = 'pending'
      ORDER BY created_at DESC
    `).all(targetId);
  };

  const applyRumorAction = db.transaction(({ action, reason, table, target, targetId, targetType }) => {
    const now = Date.now();
    const pendingReports = action === 'clear' ? [] : getPendingRumorReports(targetType, targetId);
    const nextRumorStatus = action === 'mark'
      ? 'suspected'
      : action === 'reject'
        ? 'rejected'
        : action === 'clear'
          ? null
          : (target.rumor_status || null);

    if (action !== 'ignore') {
      db.prepare(`UPDATE ${table} SET rumor_status = ?, rumor_status_updated_at = ? WHERE id = ?`)
        .run(nextRumorStatus, now, targetId);
    }

    let resolvedCount = 0;
    let notifiedCount = 0;
    if (action === 'mark' || action === 'reject') {
      const notificationType = action === 'mark' ? 'rumor_marked' : 'rumor_rejected';
      const summary = String(
        pendingReports.find((item) => String(item.content_snippet || '').trim())?.content_snippet
        || target.content
        || ''
      ).trim();
      const preview = action === 'mark'
        ? summary
        : `驳回理由：${reason}`;
      const uniqueRecipients = Array.from(new Map(
        pendingReports
          .map((item) => [String(item.fingerprint || '').trim(), item])
          .filter(([fingerprint]) => Boolean(fingerprint))
      ).values());

      uniqueRecipients.forEach((item) => {
        createNotification?.({
          recipientFingerprint: item.fingerprint,
          type: notificationType,
          postId: targetType === 'comment' ? (item.post_id || target.post_id || null) : (item.post_id || target.id || null),
          commentId: targetType === 'comment' ? (item.comment_id || target.id || null) : null,
          preview,
        });
      });
      notifiedCount = uniqueRecipients.length;
    }

    if (action === 'mark' || action === 'reject' || action === 'ignore') {
      const targetWhereClause = targetType === 'comment'
        ? "reports.comment_id = ? AND reports.target_type = 'comment'"
        : "reports.post_id = ? AND reports.target_type = 'post'";
      const updateResult = db.prepare(`
        UPDATE reports
        SET status = ?,
            action = ?,
            resolved_at = ?
        WHERE ${targetWhereClause}
          AND ${RUMOR_REASON_SQL}
          AND status = 'pending'
      `).run(
        action === 'ignore' ? 'ignored' : 'resolved',
        action === 'mark' ? 'rumor_marked' : action === 'reject' ? 'rumor_rejected' : 'rumor_ignored',
        now,
        targetId
      );
      resolvedCount = Number(updateResult?.changes || 0);
    }

    return {
      now,
      nextRumorStatus,
      resolvedCount,
      notifiedCount,
    };
  });

  const listRumorReviewItems = ({ status, targetType, search }) => {
    const rows = db.prepare(`
      SELECT
        reports.*,
        posts.content AS post_content,
        posts.ip AS post_ip,
        posts.session_id AS post_session_id,
        posts.fingerprint AS post_fingerprint,
        posts.rumor_status AS post_rumor_status,
        posts.rumor_status_updated_at AS post_rumor_status_updated_at,
        comments.content AS comment_content,
        comments.ip AS comment_ip,
        comments.fingerprint AS comment_fingerprint,
        comments.rumor_status AS comment_rumor_status,
        comments.rumor_status_updated_at AS comment_rumor_status_updated_at
      FROM reports
      LEFT JOIN posts ON posts.id = reports.post_id
      LEFT JOIN comments ON comments.id = reports.comment_id
      WHERE ${RUMOR_REASON_SQL}
      ORDER BY reports.created_at DESC
    `).all();

    const grouped = new Map();

    rows.forEach((row) => {
      const isComment = row.target_type === 'comment';
      const currentTargetType = isComment ? 'comment' : 'post';
      if (targetType !== 'all' && targetType !== currentTargetType) {
        return;
      }

      const currentTargetId = isComment ? String(row.comment_id || '').trim() : String(row.post_id || '').trim();
      if (!currentTargetId) {
        return;
      }

      const key = `${currentTargetType}:${currentTargetId}`;
      const targetIdentity = resolveAdminIdentity({
        fingerprint: isComment ? row.comment_fingerprint || '' : row.post_fingerprint || '',
        sessionId: isComment ? '' : row.post_session_id || '',
        ip: isComment ? row.comment_ip || '' : row.post_ip || '',
      });

      if (!grouped.has(key)) {
        grouped.set(key, {
          id: key,
          targetId: currentTargetId,
          targetType: currentTargetType,
          postId: String(row.post_id || '').trim() || null,
          postContent: row.post_content || '',
          commentContent: row.comment_content || '',
          targetContent: isComment ? (row.comment_content || '') : (row.post_content || ''),
          rumorStatus: isComment ? (row.comment_rumor_status || null) : (row.post_rumor_status || null),
          rumorStatusUpdatedAt: Number(isComment ? row.comment_rumor_status_updated_at || 0 : row.post_rumor_status_updated_at || 0) || null,
          reportCount: 0,
          pendingReportCount: 0,
          reporterKeys: new Set(),
          reporterCount: 0,
          latestReportedAt: 0,
          reportIds: [],
          evidenceSamples: [],
          reasons: [],
          targetIp: isComment ? row.comment_ip || null : row.post_ip || null,
          targetSessionId: isComment ? null : row.post_session_id || null,
          targetFingerprint: isComment ? row.comment_fingerprint || null : row.post_fingerprint || null,
          targetIdentityKey: targetIdentity.identityKey,
          targetIdentityHashes: targetIdentity.identityHashes,
        });
      }

      const item = grouped.get(key);
      item.reportCount += 1;
      if (row.status === 'pending') {
        item.pendingReportCount += 1;
      }
      const reporterKey = String(row.fingerprint || row.reporter_ip || '').trim();
      if (reporterKey) {
        item.reporterKeys.add(reporterKey);
      }
      item.reporterCount = item.reporterKeys.size;
      item.latestReportedAt = Math.max(item.latestReportedAt, Number(row.created_at || 0));
      item.reportIds.push(row.id);

      const reasonText = String(row.reason || '').trim();
      if (reasonText && !item.reasons.includes(reasonText)) {
        item.reasons.push(reasonText);
      }

      const evidenceText = String(row.evidence || '').trim();
      if (evidenceText && !item.evidenceSamples.some((entry) => entry.content === evidenceText)) {
        item.evidenceSamples.push({
          reportId: row.id,
          content: evidenceText,
          createdAt: Number(row.created_at || 0),
        });
        item.evidenceSamples.sort((a, b) => b.createdAt - a.createdAt);
        item.evidenceSamples = item.evidenceSamples.slice(0, 3);
      }
    });

    let items = Array.from(grouped.values()).map((item) => ({
      ...item,
      reporterKeys: undefined,
    }));

    items = items.filter((item) => {
      if (status === 'pending') {
        return item.pendingReportCount > 0;
      }
      if (status === 'suspected') {
        return item.rumorStatus === 'suspected';
      }
      if (status === 'rejected') {
        return item.rumorStatus === 'rejected';
      }
      return true;
    });

    if (search) {
      items = items.filter((item) => matchesAdminSearch(search, [
        item.id,
        item.targetId,
        item.targetType,
        item.postId || '',
        item.postContent,
        item.commentContent,
        item.targetContent,
        item.targetIp || '',
        item.targetSessionId || '',
        item.targetFingerprint || '',
        item.targetIdentityKey || '',
        ...(item.targetIdentityHashes || []),
        ...(item.reasons || []),
        ...item.evidenceSamples.map((entry) => entry.content),
      ]));
    }

    items.sort((a, b) => {
      if ((b.pendingReportCount || 0) !== (a.pendingReportCount || 0)) {
        return (b.pendingReportCount || 0) - (a.pendingReportCount || 0);
      }
      return (b.latestReportedAt || 0) - (a.latestReportedAt || 0);
    });

    return items;
  };

  const loadRumorTarget = (targetType, targetId) => {
    const table = targetType === 'comment' ? 'comments' : 'posts';
    const target = targetType === 'comment'
      ? db.prepare('SELECT id, post_id, content, rumor_status FROM comments WHERE id = ?').get(targetId)
      : db.prepare('SELECT id, content, rumor_status FROM posts WHERE id = ?').get(targetId);
    return { table, target };
  };

  const getRumorLogAction = (action) => {
    if (action === 'mark') return 'rumor_mark';
    if (action === 'reject') return 'rumor_reject';
    if (action === 'ignore') return 'rumor_ignore';
    return 'rumor_clear';
  };

  const runRumorAction = ({ req, targetType, targetId, action, reason }) => {
    const { table, target } = loadRumorTarget(targetType, targetId);
    if (!target) {
      return null;
    }

    const result = applyRumorAction({
      action,
      reason,
      table,
      target,
      targetId,
      targetType,
    });

    logAdminAction(req, {
      action: getRumorLogAction(action),
      targetType,
      targetId,
      before: { rumorStatus: target.rumor_status || null },
      after: {
        rumorStatus: result.nextRumorStatus,
        resolvedCount: result.resolvedCount,
        notifiedCount: result.notifiedCount,
      },
      reason,
    });

    return {
      targetType,
      targetId,
      rumorStatus: result.nextRumorStatus,
      resolvedCount: result.resolvedCount,
      notifiedCount: result.notifiedCount,
      updatedAt: result.now,
    };
  };

  app.get('/api/admin/rumors', requireAdmin, (req, res) => {
    const status = normalizeViewStatus(req.query.status);
    const targetType = normalizeTargetType(req.query.targetType);
    const search = String(req.query.q || req.query.search || '').trim();
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 10), 1), 50);
    const offset = (page - 1) * limit;
    const items = listRumorReviewItems({ status, targetType, search });
    const total = items.length;

    return res.json({
      items: items.slice(offset, offset + limit),
      total,
      page,
      limit,
    });
  });

  app.post('/api/admin/rumors/:targetType/:targetId/action', requireAdmin, requireAdminCsrf, (req, res) => {
    const targetType = normalizeTargetType(req.params.targetType);
    const targetId = String(req.params.targetId || '').trim();
    const action = String(req.body?.action || '').trim().toLowerCase();
    const reason = String(req.body?.reason || '').trim();

    if (!['post', 'comment'].includes(targetType) || !targetId) {
      return res.status(400).json({ error: '无效目标' });
    }
    if (!['mark', 'reject', 'clear', 'ignore'].includes(action)) {
      return res.status(400).json({ error: '无效操作' });
    }
    if (action === 'reject' && !reason) {
      return res.status(400).json({ error: '请输入驳回理由' });
    }

    const result = runRumorAction({ req, targetType, targetId, action, reason });
    if (!result) {
      return res.status(404).json({ error: '目标不存在' });
    }

    return res.json(result);
  });

  app.post('/api/admin/rumors/batch', requireAdmin, requireAdminCsrf, (req, res) => {
    const action = String(req.body?.action || '').trim().toLowerCase();
    const reason = String(req.body?.reason || '').trim();
    const scope = String(req.body?.scope || 'selected').trim().toLowerCase();

    if (action !== 'ignore') {
      return res.status(400).json({ error: '无效操作' });
    }

    let targets = [];
    if (scope === 'filter') {
      const status = normalizeViewStatus(req.body?.status || 'pending');
      const targetType = normalizeTargetType(req.body?.targetType);
      const search = String(req.body?.q || req.body?.search || '').trim();
      // 批量忽略只处理仍有待审举报的目标，避免误改历史审核状态。
      targets = listRumorReviewItems({ status, targetType, search })
        .filter((item) => item.pendingReportCount > 0)
        .map((item) => ({ targetType: item.targetType, targetId: item.targetId }));
    } else {
      const rawTargets = Array.isArray(req.body?.targets) ? req.body.targets : [];
      targets = rawTargets
        .map((item) => ({
          targetType: normalizeTargetType(item?.targetType),
          targetId: String(item?.targetId || '').trim(),
        }))
        .filter((item) => ['post', 'comment'].includes(item.targetType) && item.targetId);
    }

    const dedupedTargets = Array.from(new Map(
      targets.map((item) => [`${item.targetType}:${item.targetId}`, item])
    ).values());

    if (!dedupedTargets.length) {
      return res.status(400).json({ error: '未选择谣言举报' });
    }
    if (dedupedTargets.length > 500) {
      return res.status(400).json({ error: '批量操作数量过多' });
    }

    let updated = 0;
    let targetCount = 0;
    dedupedTargets.forEach((item) => {
      const result = runRumorAction({
        req,
        targetType: item.targetType,
        targetId: item.targetId,
        action,
        reason,
      });
      if (result?.resolvedCount > 0) {
        updated += result.resolvedCount;
        targetCount += 1;
      }
    });

    return res.json({ updated, targetCount });
  });
};
