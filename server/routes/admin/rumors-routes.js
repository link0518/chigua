import { buildAdminIdentity, matchesAdminSearch } from '../../admin-identity-utils.js';

const RUMOR_REASON_SQL = "(reason_code = 'rumor' OR (reason_code IS NULL AND reason = '举报谣言'))";

export const registerAdminRumorsRoutes = (app, deps) => {
  const {
    db,
    requireAdmin,
    requireAdminCsrf,
    logAdminAction,
    resolveStoredIdentityHash,
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

  app.get('/api/admin/rumors', requireAdmin, (req, res) => {
    const status = normalizeViewStatus(req.query.status);
    const targetType = normalizeTargetType(req.query.targetType);
    const search = String(req.query.q || req.query.search || '').trim();
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 10), 1), 50);
    const offset = (page - 1) * limit;

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

    const total = items.length;
    const pagedItems = items.slice(offset, offset + limit);

    return res.json({
      items: pagedItems,
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
    if (!['mark', 'reject', 'clear'].includes(action)) {
      return res.status(400).json({ error: '无效操作' });
    }

    const table = targetType === 'comment' ? 'comments' : 'posts';
    const target = db.prepare(`SELECT id, rumor_status FROM ${table} WHERE id = ?`).get(targetId);
    if (!target) {
      return res.status(404).json({ error: '目标不存在' });
    }

    const now = Date.now();
    const nextRumorStatus = action === 'mark'
      ? 'suspected'
      : action === 'reject'
        ? 'rejected'
        : null;

    db.prepare(`UPDATE ${table} SET rumor_status = ?, rumor_status_updated_at = ? WHERE id = ?`)
      .run(nextRumorStatus, now, targetId);

    let resolvedCount = 0;
    if (action !== 'clear') {
      const targetWhereClause = targetType === 'comment'
        ? 'reports.comment_id = ? AND reports.target_type = \'comment\''
        : 'reports.post_id = ? AND reports.target_type = \'post\'';
      const updateResult = db.prepare(`
        UPDATE reports
        SET status = 'resolved',
            action = ?,
            resolved_at = ?
        WHERE ${targetWhereClause}
          AND ${RUMOR_REASON_SQL}
          AND status = 'pending'
      `).run(
        action === 'mark' ? 'rumor_marked' : 'rumor_rejected',
        now,
        targetId
      );
      resolvedCount = Number(updateResult?.changes || 0);
    }

    logAdminAction(req, {
      action: action === 'mark' ? 'rumor_mark' : action === 'reject' ? 'rumor_reject' : 'rumor_clear',
      targetType,
      targetId,
      before: { rumorStatus: target.rumor_status || null },
      after: { rumorStatus: nextRumorStatus, resolvedCount },
      reason,
    });

    return res.json({
      targetType,
      targetId,
      rumorStatus: nextRumorStatus,
      resolvedCount,
      updatedAt: now,
    });
  });
};
