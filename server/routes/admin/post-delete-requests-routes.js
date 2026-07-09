import { buildAdminIdentity } from '../../admin-identity-utils.js';

export const registerAdminPostDeleteRequestsRoutes = (app, deps) => {
  const {
    db,
    requireAdmin,
    requireAdminCsrf,
    requireAdminRead = (_req, _res, next) => next(),
    requireAdminManage = (_req, _res, next) => next(),
    formatRelativeTime = (value) => String(value || ''),
    logAdminAction = () => {},
    createNotification = () => {},
    trimPreview = (value) => String(value || ''),
    resolveStoredIdentityHash,
  } = deps;

  const resolveRequesterIdentity = ({ fingerprint, ip = '' }) => buildAdminIdentity({
    fingerprint,
    ip,
    resolveStoredIdentityHash,
  });

  const buildDeleteRequestItem = (row) => ({
    id: row.id,
    postId: row.post_id,
    postContent: trimPreview(row.post_content || '', 160),
    postDeleted: row.post_deleted === 1,
    postDeletedAt: row.post_deleted_at || null,
    postHidden: row.post_hidden === 1,
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at,
    timestamp: formatRelativeTime(row.created_at),
    requesterFingerprint: row.requester_fingerprint || null,
    requesterIp: row.requester_ip || null,
    reviewedAt: row.reviewed_at || null,
    reviewedBy: row.reviewed_by || null,
    reviewedByUsername: row.reviewed_by_username || null,
    reviewReason: row.review_reason || null,
    ...resolveRequesterIdentity({
      fingerprint: row.requester_fingerprint || '',
      ip: row.requester_ip || '',
    }),
  });

  const getRequestWithPost = (requestId) => db
    .prepare(
      `
      SELECT
        pdr.*,
        posts.content AS post_content,
        posts.deleted AS post_deleted,
        posts.deleted_at AS post_deleted_at,
        posts.hidden AS post_hidden
      FROM post_delete_requests pdr
      LEFT JOIN posts ON posts.id = pdr.post_id
      WHERE pdr.id = ?
      `
    )
    .get(requestId);

  app.get('/api/admin/post-delete-requests', requireAdmin, requireAdminRead, (req, res) => {
    const status = String(req.query.status || 'pending').trim();
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 10), 1), 50);
    const offset = (page - 1) * limit;

    const statusClause = status === 'processed'
      ? "pdr.status IN ('approved', 'rejected')"
      : "pdr.status = 'pending'";
    const orderClause = status === 'processed'
      ? 'COALESCE(pdr.reviewed_at, pdr.created_at) DESC, pdr.created_at DESC'
      : 'pdr.created_at DESC';

    const total = db
      .prepare(
        `
        SELECT COUNT(1) AS count
        FROM post_delete_requests pdr
        WHERE ${statusClause}
        `
      )
      .get()?.count || 0;

    const rows = db
      .prepare(
        `
        SELECT
          pdr.*,
          posts.content AS post_content,
          posts.deleted AS post_deleted,
          posts.deleted_at AS post_deleted_at,
          posts.hidden AS post_hidden
        FROM post_delete_requests pdr
        LEFT JOIN posts ON posts.id = pdr.post_id
        WHERE ${statusClause}
        ORDER BY ${orderClause}
        LIMIT ? OFFSET ?
        `
      )
      .all(limit, offset);

    return res.json({
      items: rows.map(buildDeleteRequestItem),
      total,
      page,
      limit,
    });
  });

  app.post('/api/admin/post-delete-requests/:id/action', requireAdmin, requireAdminCsrf, requireAdminManage, (req, res) => {
    const requestId = String(req.params.id || '').trim();
    const action = String(req.body?.action || '').trim();
    const reviewReason = String(req.body?.reason || '').trim();

    if (!requestId) {
      return res.status(400).json({ error: '删除申请不存在' });
    }

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: '无效操作' });
    }

    if (reviewReason.length > 1000) {
      return res.status(400).json({ error: '审核说明不能超过 1000 字' });
    }

    const existing = getRequestWithPost(requestId);
    if (!existing) {
      return res.status(404).json({ error: '删除申请不存在' });
    }

    if (existing.status !== 'pending') {
      return res.status(409).json({ error: '删除申请已处理' });
    }

    if (action === 'approve' && (existing.post_deleted == null || existing.post_deleted === 1)) {
      return res.status(409).json({ error: '帖子已被处理，无法重复删除' });
    }

    const now = Date.now();
    const admin = req.session?.admin || {};
    const reviewedBy = typeof admin.id === 'number' ? admin.id : null;
    const reviewedByUsername = admin.username || null;

    const applyAction = db.transaction(() => {
      const nextStatus = action === 'approve' ? 'approved' : 'rejected';
      const updateResult = db.prepare(
        `
        UPDATE post_delete_requests
        SET status = ?,
            reviewed_at = ?,
            reviewed_by = ?,
            reviewed_by_username = ?,
            review_reason = ?
        WHERE id = ?
          AND status = 'pending'
        `
      ).run(nextStatus, now, reviewedBy, reviewedByUsername, reviewReason || null, requestId);

      if (updateResult.changes === 0) {
        return null;
      }

      if (action === 'approve') {
        db.prepare('UPDATE posts SET deleted = 1, deleted_at = ? WHERE id = ?')
          .run(now, existing.post_id);
      }

      return getRequestWithPost(requestId);
    });

    const updated = applyAction();
    if (!updated) {
      return res.status(409).json({ error: '删除申请已处理' });
    }

    const approved = action === 'approve';
    createNotification({
      recipientFingerprint: existing.requester_fingerprint,
      type: approved ? 'post_delete_request_approved' : 'post_delete_request_rejected',
      postId: approved ? null : existing.post_id,
      preview: reviewReason || (approved ? '你的帖子删除申请已通过' : '你的帖子删除申请已驳回'),
      actorIdentityContext: null,
    });

    logAdminAction(req, {
      action: approved ? 'post_delete_request_approve' : 'post_delete_request_reject',
      targetType: 'post_delete_request',
      targetId: requestId,
      before: {
        status: existing.status,
        postDeleted: existing.post_deleted === 1,
      },
      after: {
        status: updated.status,
        postDeleted: updated.post_deleted === 1,
      },
      reason: reviewReason || null,
    });

    return res.json({ item: buildDeleteRequestItem(updated) });
  });
};
