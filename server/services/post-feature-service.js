export class PostFeatureError extends Error {
  constructor(message, status = 400, code = 'invalid_request') {
    super(message);
    this.name = 'PostFeatureError';
    this.status = status;
    this.code = code;
  }
}

const ensureActivePost = (post) => {
  if (!post) {
    throw new PostFeatureError('帖子不存在', 404, 'post_not_found');
  }
  if (post.deleted === 1 || post.hidden === 1) {
    throw new PostFeatureError('帖子当前不可申请加精', 409, 'post_unavailable');
  }
};

export const createPostFeatureService = ({ repository }) => ({
  getRequestEligibility({ postId, identityHashes }) {
    const post = repository.getPost(postId);
    ensureActivePost(post);
    if (post.featured === 1) {
      throw new PostFeatureError('该帖子已经是精华帖', 409, 'already_featured');
    }
    const existing = repository.findRequestForIdentity(postId, identityHashes);
    if (existing) {
      throw new PostFeatureError('你已经申请过该帖子', 409, 'already_requested');
    }
    return { post };
  },

  submitRequest({
    id,
    postId,
    identityKey,
    identityHashes,
    legacyFingerprint,
    requesterIp,
    now = Date.now(),
  }) {
    return repository.runInTransaction(() => {
      const post = repository.getPost(postId);
      ensureActivePost(post);
      if (post.featured === 1) {
        throw new PostFeatureError('该帖子已经是精华帖', 409, 'already_featured');
      }
      if (repository.findRequestForIdentity(postId, identityHashes)) {
        throw new PostFeatureError('你已经申请过该帖子', 409, 'already_requested');
      }
      repository.insertRequest({
        id,
        postId,
        identityKey,
        legacyFingerprint,
        requesterIp,
        createdAt: now,
      });
      return {
        id,
        postId,
        status: 'pending',
        createdAt: now,
      };
    });
  },

  handleAdminAction({ postId, action, reason = '', admin = {}, now = Date.now() }) {
    return repository.runInTransaction(() => {
      const post = repository.getPost(postId);
      if (!post) {
        throw new PostFeatureError('帖子不存在', 404, 'post_not_found');
      }

      const pendingRequests = repository.getPendingRequests(postId);
      const reviewedBy = typeof admin.id === 'number' ? admin.id : null;
      const reviewedByUsername = admin.username || null;
      const before = {
        featured: post.featured === 1,
        featuredAt: post.featured_at || null,
        pendingRequestCount: pendingRequests.length,
      };

      if (action === 'approve' || action === 'add') {
        ensureActivePost(post);
        if (post.featured === 1) {
          throw new PostFeatureError('该帖子已经是精华帖', 409, 'already_featured');
        }
        if (action === 'approve' && pendingRequests.length === 0) {
          throw new PostFeatureError('该帖子没有待审核申请', 409, 'no_pending_request');
        }
        repository.setPostFeatured(postId, true, now);
        if (pendingRequests.length > 0) {
          repository.updatePendingRequests({
            postId,
            status: 'approved',
            reviewedAt: now,
            reviewedBy,
            reviewedByUsername,
            reviewReason: reason,
          });
        }
        return {
          postId,
          action,
          before,
          after: { featured: true, featuredAt: now, pendingRequestCount: 0 },
          affectedRequests: pendingRequests,
        };
      }

      if (action === 'reject') {
        if (pendingRequests.length === 0) {
          throw new PostFeatureError('该帖子没有待审核申请', 409, 'no_pending_request');
        }
        repository.updatePendingRequests({
          postId,
          status: 'rejected',
          reviewedAt: now,
          reviewedBy,
          reviewedByUsername,
          reviewReason: reason,
        });
        return {
          postId,
          action,
          before,
          after: { ...before, pendingRequestCount: 0 },
          affectedRequests: pendingRequests,
        };
      }

      if (action === 'remove') {
        if (post.featured !== 1) {
          throw new PostFeatureError('该帖子当前不是精华帖', 409, 'not_featured');
        }
        repository.setPostFeatured(postId, false, null);
        return {
          postId,
          action,
          before,
          after: { featured: false, featuredAt: null, pendingRequestCount: pendingRequests.length },
          affectedRequests: [],
        };
      }

      throw new PostFeatureError('无效操作', 400, 'invalid_action');
    });
  },
});
