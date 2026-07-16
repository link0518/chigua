import { createPostFeatureRepository } from '../../repositories/post-feature-repository.js';
import {
  createPostFeatureService,
  PostFeatureError,
} from '../../services/post-feature-service.js';

const trimPreview = (value, maxLength = 220) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
};

export const registerAdminPostFeaturesRoutes = (app, deps) => {
  const {
    db,
    requireAdmin,
    requireAdminCsrf,
    requireAdminRead = (_req, _res, next) => next(),
    requireAdminManage = (_req, _res, next) => next(),
    logAdminAction = () => {},
    createNotification = () => {},
    formatRelativeTime = (value) => String(value || ''),
  } = deps;
  const repository = createPostFeatureRepository(db);
  const service = createPostFeatureService({ repository });

  const mapPendingItem = (row) => ({
    postId: row.post_id,
    postContent: trimPreview(row.post_content),
    postCreatedAt: row.post_created_at,
    postDeleted: row.post_deleted === 1,
    postHidden: row.post_hidden === 1,
    isFeatured: row.post_featured === 1,
    featuredAt: row.post_featured_at || null,
    requestCount: Number(row.request_count || 0),
    requesterCount: Number(row.requester_count || 0),
    firstRequestedAt: row.first_requested_at,
    latestRequestedAt: row.latest_requested_at,
    latestRequestedTime: formatRelativeTime(row.latest_requested_at),
  });

  const mapFeaturedItem = (row) => ({
    postId: row.id,
    postContent: trimPreview(row.content),
    postCreatedAt: row.created_at,
    featuredAt: row.featured_at || null,
    isFeatured: row.featured === 1,
  });

  const mapProcessedItem = (row) => ({
    id: row.id,
    postId: row.post_id,
    postContent: trimPreview(row.post_content),
    status: row.status,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at || null,
    reviewedBy: row.reviewed_by || null,
    reviewedByUsername: row.reviewed_by_username || null,
    reviewReason: row.review_reason || null,
    requesterIdentityKey: row.requester_identity_key || null,
    requesterLegacyFingerprint: row.requester_legacy_fingerprint || null,
    requesterIp: row.requester_ip || null,
    postDeleted: row.post_deleted === 1,
    postHidden: row.post_hidden === 1,
    isFeatured: row.post_featured === 1,
    featuredAt: row.post_featured_at || null,
  });

  app.get('/api/admin/post-features', requireAdmin, requireAdminRead, (req, res) => {
    const mode = String(req.query.mode || 'pending').trim();
    const search = String(req.query.q || '').trim();
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 10), 1), 50);
    if (!['pending', 'featured', 'processed'].includes(mode)) {
      return res.status(400).json({ error: '无效的精华管理视图' });
    }
    if (search.length > 200) {
      return res.status(400).json({ error: '搜索内容不能超过 200 字' });
    }

    const data = mode === 'featured'
      ? repository.listFeatured({ search, page, limit })
      : mode === 'processed'
        ? repository.listProcessed({ search, page, limit })
        : repository.listPending({ search, page, limit });
    const mapper = mode === 'featured'
      ? mapFeaturedItem
      : mode === 'processed'
        ? mapProcessedItem
        : mapPendingItem;
    return res.json({ ...data, items: data.items.map(mapper) });
  });

  app.post(
    '/api/admin/post-features/:postId/action',
    requireAdmin,
    requireAdminCsrf,
    requireAdminManage,
    (req, res) => {
      const postId = String(req.params.postId || '').trim();
      const action = String(req.body?.action || '').trim();
      const reason = String(req.body?.reason || '').trim();
      if (!postId) {
        return res.status(400).json({ error: '帖子不存在' });
      }
      if (!['approve', 'reject', 'add', 'remove'].includes(action)) {
        return res.status(400).json({ error: '无效操作' });
      }
      if (reason.length > 1000) {
        return res.status(400).json({ error: '审核说明不能超过 1000 字' });
      }

      try {
        const result = service.handleAdminAction({
          postId,
          action,
          reason,
          admin: req.session?.admin || {},
        });
        const notificationType = action === 'reject'
          ? 'post_feature_request_rejected'
          : (action === 'approve' || action === 'add')
            ? 'post_feature_request_approved'
            : '';
        if (notificationType) {
          const recipients = new Set(
            result.affectedRequests
              .map((item) => String(
                item.requester_legacy_fingerprint
                || item.requester_identity_key
                || ''
              ).trim())
              .filter(Boolean)
          );
          recipients.forEach((recipientFingerprint) => {
            createNotification({
              recipientFingerprint,
              type: notificationType,
              postId,
              preview: reason || (action === 'reject' ? '你的加精申请未通过' : '你申请的帖子已加精'),
              actorIdentityContext: null,
            });
          });
        }

        const actionNames = {
          approve: 'post_feature_request_approve',
          reject: 'post_feature_request_reject',
          add: 'post_feature_add',
          remove: 'post_feature_remove',
        };
        logAdminAction(req, {
          action: actionNames[action],
          targetType: 'post',
          targetId: postId,
          before: result.before,
          after: result.after,
          reason: reason || null,
        });
        return res.json({
          postId,
          action,
          featured: result.after.featured,
          featuredAt: result.after.featuredAt,
          affectedRequestCount: result.affectedRequests.length,
        });
      } catch (error) {
        if (error instanceof PostFeatureError) {
          return res.status(error.status).json({ error: error.message, code: error.code });
        }
        throw error;
      }
    }
  );
};
