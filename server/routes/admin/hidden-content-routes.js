import {
  buildAdminIdentity,
  buildAdminIdentitySearchValues,
  matchesAdminSearch,
} from '../../admin-identity-utils.js';

export const registerAdminHiddenContentRoutes = (app, deps) => {
  const {
    db,
    requireAdmin,
    requireAdminCsrf,
    formatRelativeTime,
    resolveStoredIdentityHash,
    hiddenContentService,
  } = deps;

  const resolveAdminIdentity = ({ fingerprint, sessionId = '', ip = '' }) => buildAdminIdentity({
    fingerprint,
    sessionId,
    ip,
    resolveStoredIdentityHash,
  });

  const normalizeType = (value) => (value === 'comment' ? 'comment' : value === 'post' ? 'post' : 'all');
  const normalizeReview = (value) => (value === 'kept' ? 'kept' : value === 'pending' ? 'pending' : 'all');

  app.get('/api/admin/hidden-content', requireAdmin, (req, res) => {
    const type = normalizeType(String(req.query.type || 'all').trim());
    const review = normalizeReview(String(req.query.review || 'pending').trim());
    const search = String(req.query.search || '').trim();
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 10), 1), 50);
    const offset = (page - 1) * limit;

    const postReviewClause = review === 'all' ? '' : 'AND posts.hidden_review_status = ?';
    const commentReviewClause = review === 'all' ? '' : 'AND comments.hidden_review_status = ?';
    const reviewParams = review === 'all' ? [] : [review];
    const items = [];

    if (type === 'all' || type === 'post') {
      const rows = db.prepare(`
        SELECT
          posts.*,
          (
            SELECT COUNT(1)
            FROM reports
            WHERE reports.target_type = 'post'
              AND reports.post_id = posts.id
              AND reports.status = 'pending'
          ) AS pending_report_count
        FROM posts
        WHERE posts.hidden = 1
          AND posts.deleted = 0
          ${postReviewClause}
        ORDER BY posts.hidden_at DESC, posts.created_at DESC
      `).all(...reviewParams);

      rows.forEach((row) => {
        items.push({
          type: 'post',
          id: row.id,
          content: row.content,
          author: row.author || '匿名',
          timestamp: formatRelativeTime(row.created_at),
          createdAt: row.created_at,
          hiddenAt: row.hidden_at || null,
          hiddenReviewStatus: row.hidden_review_status || 'pending',
          pendingReportCount: Number(row.pending_report_count || 0),
          ip: row.ip || null,
          sessionId: row.session_id || null,
          fingerprint: row.fingerprint || null,
          ...resolveAdminIdentity({
            fingerprint: row.fingerprint || '',
            sessionId: row.session_id || '',
            ip: row.ip || '',
          }),
        });
      });
    }

    if (type === 'all' || type === 'comment') {
      const rows = db.prepare(`
        SELECT
          comments.*,
          posts.content AS post_content,
          (
            SELECT COUNT(1)
            FROM reports
            WHERE reports.target_type = 'comment'
              AND reports.comment_id = comments.id
              AND reports.status = 'pending'
          ) AS pending_report_count
        FROM comments
        LEFT JOIN posts ON posts.id = comments.post_id
        WHERE comments.hidden = 1
          AND comments.deleted = 0
          ${commentReviewClause}
        ORDER BY comments.hidden_at DESC, comments.created_at DESC
      `).all(...reviewParams);

      rows.forEach((row) => {
        items.push({
          type: 'comment',
          id: row.id,
          postId: row.post_id,
          parentId: row.parent_id || null,
          replyToId: row.reply_to_id || null,
          postContent: row.post_content || '',
          content: row.content,
          author: row.author || '匿名',
          timestamp: formatRelativeTime(row.created_at),
          createdAt: row.created_at,
          hiddenAt: row.hidden_at || null,
          hiddenReviewStatus: row.hidden_review_status || 'pending',
          pendingReportCount: Number(row.pending_report_count || 0),
          ip: row.ip || null,
          fingerprint: row.fingerprint || null,
          ...resolveAdminIdentity({
            fingerprint: row.fingerprint || '',
            ip: row.ip || '',
          }),
        });
      });
    }

    const filteredItems = search
      ? items.filter((item) => matchesAdminSearch(search, [
        item.type,
        item.id,
        item.content,
        item.author,
        item.postId || '',
        item.postContent || '',
        item.ip || '',
        item.sessionId || '',
        item.identityKey || '',
        ...(item.identityHashes || []),
        ...buildAdminIdentitySearchValues(item),
      ]))
      : items;

    filteredItems.sort((a, b) => {
      const hiddenAtDiff = Number(b.hiddenAt || 0) - Number(a.hiddenAt || 0);
      if (hiddenAtDiff !== 0) {
        return hiddenAtDiff;
      }
      return Number(b.createdAt || 0) - Number(a.createdAt || 0);
    });

    return res.json({
      items: filteredItems.slice(offset, offset + limit),
      total: filteredItems.length,
      page,
      limit,
    });
  });

  app.post('/api/admin/hidden-content/:type/:id/action', requireAdmin, requireAdminCsrf, (req, res) => {
    const targetType = normalizeType(String(req.params.type || '').trim());
    const targetId = String(req.params.id || '').trim();
    const action = String(req.body?.action || '').trim();
    const reason = String(req.body?.reason || '').trim();

    if (!['post', 'comment'].includes(targetType)) {
      return res.status(400).json({ error: '无效内容类型' });
    }
    if (!targetId) {
      return res.status(400).json({ error: '内容不存在' });
    }
    if (!['keep', 'restore'].includes(action)) {
      return res.status(400).json({ error: '无效操作' });
    }

    const result = hiddenContentService.handleHiddenContentAction({
      req,
      targetType,
      targetId,
      action,
      reason,
    });

    if (!result) {
      return res.status(404).json({ error: '内容不存在' });
    }
    if (result.error) {
      return res.status(400).json({ error: result.error });
    }

    return res.json(result);
  });
};
