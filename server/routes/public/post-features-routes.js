import { createPostFeatureRepository } from '../../repositories/post-feature-repository.js';
import {
  createPostFeatureService,
  PostFeatureError,
} from '../../services/post-feature-service.js';

export const registerPublicPostFeaturesRoutes = (app, deps) => {
  const {
    db,
    requireFingerprint,
    getRequestIdentityContext,
    enforceRateLimit,
    checkBanFor,
    getClientIp,
    crypto,
  } = deps;
  const repository = createPostFeatureRepository(db);
  const service = createPostFeatureService({ repository });

  app.post('/api/posts/:id/feature-requests', (req, res) => {
    const postId = String(req.params.id || '').trim();
    if (!postId) {
      return res.status(400).json({ error: '帖子不存在' });
    }

    const identityKey = requireFingerprint(req, res);
    if (!identityKey) {
      return;
    }
    if (!checkBanFor(req, res, 'post', '你已被限制提交精华申请', identityKey)) {
      return;
    }

    const identityContext = getRequestIdentityContext(req, res);
    const identityHashes = Array.isArray(identityContext?.lookupHashes)
      ? identityContext.lookupHashes
      : [identityKey];

    try {
      // 重复申请先返回明确状态，避免无意义地消耗限流额度。
      service.getRequestEligibility({ postId, identityHashes });
      if (!enforceRateLimit(req, res, 'feature', identityKey)) {
        return;
      }
      const request = service.submitRequest({
        id: crypto.randomUUID(),
        postId,
        identityKey,
        identityHashes,
        legacyFingerprint: identityContext?.legacyFingerprintHash || '',
        requesterIp: getClientIp(req),
      });
      return res.status(201).json({ request });
    } catch (error) {
      if (error instanceof PostFeatureError) {
        return res.status(error.status).json({ error: error.message, code: error.code });
      }
      if (String(error?.code || '').includes('SQLITE_CONSTRAINT')) {
        return res.status(409).json({ error: '你已经申请过该帖子', code: 'already_requested' });
      }
      throw error;
    }
  });
};
