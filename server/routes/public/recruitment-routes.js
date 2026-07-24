import { recruitmentCatalog } from '../../recruitment-catalog.js';
import { createRecruitmentCrypto } from '../../recruitment-crypto.js';
import { createRecruitmentRepository } from '../../repositories/recruitment-repository.js';
import {
  createRecruitmentService,
  RecruitmentServiceError,
} from '../../services/recruitment-service.js';

const CANONICAL_IDENTITY_ERROR = '匿名身份尚未建立，请刷新后重试';
const PRIVATE_FEATURES_ERROR = '招募密聊功能暂未启用，请稍后再试';

export const requireCanonicalIdentity = (req, res, getRequestIdentityContext) => {
  const context = getRequestIdentityContext(req, res);
  const canonicalHash = String(context?.canonicalHash || '').trim();
  if (!canonicalHash) {
    res.status(400).json({ error: CANONICAL_IDENTITY_ERROR, code: 'canonical_identity_required' });
    return null;
  }
  return canonicalHash;
};

const getOptionalCanonicalIdentity = (req, res, getRequestIdentityContext) => {
  const context = getRequestIdentityContext(req, res);
  return String(context?.canonicalHash || '').trim();
};

const createHandler = (handler) => async (req, res) => {
  try {
    return await handler(req, res);
  } catch (error) {
    if (error instanceof RecruitmentServiceError) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }
    if (String(error?.code || '').includes('SQLITE_CONSTRAINT')) {
      return res.status(409).json({ error: '操作与当前状态冲突，请刷新后重试', code: 'state_conflict' });
    }
    console.error('招募接口执行失败', {
      method: req?.method,
      path: req?.originalUrl || req?.url,
      error: error?.message || String(error),
    });
    return res.status(500).json({ error: '服务暂时不可用', code: 'internal_error' });
  }
};

const requireFunction = (value, name) => {
  if (typeof value !== 'function') {
    throw new TypeError(`registerPublicRecruitmentRoutes 缺少 ${name}`);
  }
  return value;
};

export const registerPublicRecruitmentRoutes = (app, deps = {}) => {
  const {
    db,
    sessionSecret,
    getRequestIdentityContext,
    checkBanFor,
    enforceRateLimit,
    verifyTurnstile,
    onNotification,
    privateFeaturesEnabled = false,
    sessionSecretConfigured = false,
  } = deps;
  requireFunction(getRequestIdentityContext, 'getRequestIdentityContext');
  requireFunction(checkBanFor, 'checkBanFor');
  requireFunction(enforceRateLimit, 'enforceRateLimit');
  requireFunction(verifyTurnstile, 'verifyTurnstile');

  const repository = deps.repository || createRecruitmentRepository(db);
  const privateFeaturesAvailable = privateFeaturesEnabled === true && sessionSecretConfigured === true;
  const unavailableCrypto = {
    encryptMessage: () => {
      throw new RecruitmentServiceError(PRIVATE_FEATURES_ERROR, 503, 'private_features_unavailable');
    },
    decryptMessage: () => {
      throw new RecruitmentServiceError(PRIVATE_FEATURES_ERROR, 503, 'private_features_unavailable');
    },
    encryptContact: () => {
      throw new RecruitmentServiceError(PRIVATE_FEATURES_ERROR, 503, 'private_features_unavailable');
    },
    decryptContact: () => {
      throw new RecruitmentServiceError(PRIVATE_FEATURES_ERROR, 503, 'private_features_unavailable');
    },
  };
  const recruitmentCrypto = deps.recruitmentCrypto
    || (!deps.service && privateFeaturesAvailable ? createRecruitmentCrypto({ sessionSecret }) : unavailableCrypto);
  const service = deps.service || createRecruitmentService({
    repository,
    catalog: deps.catalog || recruitmentCatalog,
    recruitmentCrypto,
    randomUUID: deps.randomUUID,
    now: deps.now,
    onNotification,
  });

  const requireIdentity = (req, res) => requireCanonicalIdentity(req, res, getRequestIdentityContext);
  const allowWrite = (req, res, action, identityHash) => enforceRateLimit(req, res, action, identityHash);
  // 风控必须拿到完整 identity context，而不是只拿 canonicalHash；否则
  // 同一浏览器留下的 legacy 指纹封禁会被招募接口绕过。
  const allowPermission = (req, res, permission, message) => (
    checkBanFor(req, res, permission, message, getRequestIdentityContext(req, res))
  );
  const isEnabledQuery = (value) => ['1', 'true'].includes(String(value || '').trim().toLowerCase());
  const setPrivateResponseHeaders = (res) => {
    if (typeof res.set === 'function') {
      res.set('Cache-Control', 'private, no-store, max-age=0');
      res.set('Pragma', 'no-cache');
    } else if (typeof res.setHeader === 'function') {
      res.setHeader('Cache-Control', 'private, no-store, max-age=0');
      res.setHeader('Pragma', 'no-cache');
    }
    if (typeof res.vary === 'function') {
      res.vary('Cookie');
      res.vary('X-Client-Fingerprint');
    }
  };
  const requirePrivateFeatures = (res) => {
    // 私密响应包含成员关系、消息或联系方式，禁止浏览器和共享代理缓存。
    setPrivateResponseHeaders(res);
    if (privateFeaturesAvailable) {
      return true;
    }
    res.status(503).json({ error: PRIVATE_FEATURES_ERROR, code: 'private_features_unavailable' });
    return false;
  };

  const sendCatalog = createHandler((_req, res) => res.json(service.getCatalog()));
  app.get('/api/recruitment/catalog', sendCatalog);
  // 同时提供领域语义更明确的 /xinfa 路径。
  app.get('/api/recruitment/xinfa', sendCatalog);

  app.get('/api/recruitment/posts', createHandler((req, res) => {
    // 列表会按当前身份回显 viewerThreadId，因此即使是公开招募也不能进入共享缓存。
    setPrivateResponseHeaders(res);
    const isMine = ['1', 'true'].includes(String(req.query?.mine || '').trim().toLowerCase());
    if (isMine && !requirePrivateFeatures(res)) return;
    const viewerIdentityHash = isMine
      ? requireCanonicalIdentity(req, res, getRequestIdentityContext)
      : getOptionalCanonicalIdentity(req, res, getRequestIdentityContext);
    if (isMine && !viewerIdentityHash) return;
    return res.json(service.listPosts({
      viewerIdentityHash,
      xinfaId: req.query?.xinfaId,
      status: req.query?.status,
      mine: isMine,
      page: req.query?.page,
      limit: req.query?.limit,
    }));
  }));

  app.get('/api/recruitment/posts/:postId', createHandler((req, res) => {
    // 详情同样包含当前身份的申请会话 ID，响应必须按身份隔离。
    setPrivateResponseHeaders(res);
    const viewerIdentityHash = getOptionalCanonicalIdentity(req, res, getRequestIdentityContext);
    return res.json({
      post: service.getPost({ postId: req.params.postId, viewerIdentityHash }),
    });
  }));

  app.post('/api/recruitment/posts', createHandler(async (req, res) => {
    if (!requirePrivateFeatures(res)) return;
    const identityHash = requireIdentity(req, res);
    if (!identityHash) return;
    if (!allowPermission(req, res, 'recruit', '你已被限制发布招募')) return;
    if (!allowWrite(req, res, 'recruitment_publish', identityHash)) return;
    const verification = await verifyTurnstile(req.body?.turnstileToken, req, 'recruitment');
    if (!verification.ok) {
      return res.status(verification.status).json({ error: verification.error });
    }
    const post = service.createPost({
      identityHash,
      xinfaId: req.body?.xinfaId,
      content: req.body?.content,
    });
    return res.status(201).json({ post });
  }));

  app.post('/api/recruitment/posts/:postId/close', createHandler((req, res) => {
    if (!requirePrivateFeatures(res)) return;
    const identityHash = requireIdentity(req, res);
    if (!identityHash) return;
    if (!allowWrite(req, res, 'recruitment_close', identityHash)) return;
    return res.json({ post: service.closePost({ postId: req.params.postId, identityHash }) });
  }));

  app.post('/api/recruitment/posts/:postId/applications', createHandler((req, res) => {
    if (!requirePrivateFeatures(res)) return;
    const identityHash = requireIdentity(req, res);
    if (!identityHash) return;
    if (!allowPermission(req, res, 'recruit', '你已被限制申请招募')) return;
    if (!allowWrite(req, res, 'recruitment_apply', identityHash)) return;
    const result = service.applyToPost({
      postId: req.params.postId,
      identityHash,
      xinfaId: req.body?.xinfaId,
    });
    return res.status(result.created ? 201 : 200).json(result);
  }));

  app.get('/api/recruitment/threads', createHandler((req, res) => {
    if (!requirePrivateFeatures(res)) return;
    const identityHash = requireIdentity(req, res);
    if (!identityHash) return;
    return res.json(service.listThreads({
      identityHash,
      status: req.query?.status,
      page: req.query?.page,
      limit: req.query?.limit,
    }));
  }));

  app.get('/api/recruitment/threads/:threadId', createHandler((req, res) => {
    if (!requirePrivateFeatures(res)) return;
    const identityHash = requireIdentity(req, res);
    if (!identityHash) return;
    return res.json({ thread: service.getThread({ threadId: req.params.threadId, identityHash }) });
  }));

  app.post('/api/recruitment/threads/:threadId/close', createHandler((req, res) => {
    if (!requirePrivateFeatures(res)) return;
    const identityHash = requireIdentity(req, res);
    if (!identityHash) return;
    if (!allowWrite(req, res, 'recruitment_close', identityHash)) return;
    return res.json({
      thread: service.closeThread({ threadId: req.params.threadId, identityHash }),
    });
  }));

  app.get('/api/recruitment/threads/:threadId/messages', createHandler((req, res) => {
    if (!requirePrivateFeatures(res)) return;
    const identityHash = requireIdentity(req, res);
    if (!identityHash) return;
    return res.json(service.listMessages({
      threadId: req.params.threadId,
      identityHash,
      afterSeq: req.query?.afterSeq,
      beforeSeq: req.query?.beforeSeq,
      afterModerationSeq: req.query?.afterModerationSeq,
      includeContactExchanges: isEnabledQuery(req.query?.includeContactExchanges),
      limit: req.query?.limit,
    }));
  }));

  app.post('/api/recruitment/threads/:threadId/messages', createHandler((req, res) => {
    if (!requirePrivateFeatures(res)) return;
    const identityHash = requireIdentity(req, res);
    if (!identityHash) return;
    const clientMsgId = req.body?.clientMsgId;
    const existing = service.getExistingMessageForSender({
      threadId: req.params.threadId,
      identityHash,
      clientMsgId,
    });
    if (existing) {
      return res.json({ message: existing, created: false });
    }
    if (!allowPermission(req, res, 'chat', '你已被限制发送密聊')) return;
    if (!allowWrite(req, res, 'recruitment_message', identityHash)) return;
    const result = service.sendMessage({
      threadId: req.params.threadId,
      identityHash,
      clientMsgId,
      content: req.body?.content,
    });
    return res.status(result.created ? 201 : 200).json(result);
  }));

  app.post('/api/recruitment/threads/:threadId/read', createHandler((req, res) => {
    if (!requirePrivateFeatures(res)) return;
    const identityHash = requireIdentity(req, res);
    if (!identityHash) return;
    if (!allowWrite(req, res, 'recruitment_read', identityHash)) return;
    return res.json(service.markThreadRead({
      threadId: req.params.threadId,
      identityHash,
      lastMessageSeq: req.body?.lastMessageSeq,
    }));
  }));

  app.get('/api/recruitment/threads/:threadId/contact-exchanges', createHandler((req, res) => {
    if (!requirePrivateFeatures(res)) return;
    const identityHash = requireIdentity(req, res);
    if (!identityHash) return;
    return res.json({
      items: service.listContactExchanges({ threadId: req.params.threadId, identityHash }),
    });
  }));

  app.post('/api/recruitment/threads/:threadId/contact-exchanges', createHandler((req, res) => {
    if (!requirePrivateFeatures(res)) return;
    const identityHash = requireIdentity(req, res);
    if (!identityHash) return;
    if (!allowPermission(req, res, 'chat', '你已被限制交换联系方式')) return;
    if (!allowWrite(req, res, 'recruitment_contact', identityHash)) return;
    const exchange = service.putContactExchange({
      threadId: req.params.threadId,
      identityHash,
      contact: req.body?.contact,
    });
    return res.status(201).json(exchange);
  }));

  app.post('/api/recruitment/contact-exchanges/:exchangeId/consent', createHandler((req, res) => {
    if (!requirePrivateFeatures(res)) return;
    const identityHash = requireIdentity(req, res);
    if (!identityHash) return;
    if (!allowPermission(req, res, 'chat', '你已被限制交换联系方式')) return;
    if (!allowWrite(req, res, 'recruitment_contact', identityHash)) return;
    return res.json(service.consentToContactExchange({
      exchangeId: req.params.exchangeId,
      identityHash,
      contact: req.body?.contact,
    }));
  }));

  app.get('/api/recruitment/notifications', createHandler((req, res) => {
    if (!requirePrivateFeatures(res)) return;
    const identityHash = requireIdentity(req, res);
    if (!identityHash) return;
    return res.json(service.listNotifications({
      identityHash,
      afterSeq: req.query?.afterSeq,
      page: req.query?.page,
      limit: req.query?.limit,
    }));
  }));

  app.post('/api/recruitment/notifications/read', createHandler((req, res) => {
    if (!requirePrivateFeatures(res)) return;
    const identityHash = requireIdentity(req, res);
    if (!identityHash) return;
    if (!allowWrite(req, res, 'recruitment_notification_read', identityHash)) return;
    return res.json(service.markNotificationsRead({
      identityHash,
      notificationIds: req.body?.notificationIds,
      upToSeq: req.body?.upToSeq,
    }));
  }));

  app.post('/api/recruitment/reports', createHandler(async (req, res) => {
    if (!requirePrivateFeatures(res)) return;
    const identityHash = requireIdentity(req, res);
    if (!identityHash) return;
    if (!allowWrite(req, res, 'recruitment_report', identityHash)) return;
    const verification = await verifyTurnstile(req.body?.turnstileToken, req, 'recruitment_report');
    if (!verification.ok) {
      return res.status(verification.status).json({ error: verification.error });
    }
    const report = service.submitReport({
      identityHash,
      targetType: req.body?.targetType,
      targetId: req.body?.targetId,
      reasonCode: req.body?.reasonCode,
      detail: req.body?.detail,
      evidenceMessageIds: req.body?.evidenceMessageIds,
    });
    return res.status(201).json({ report });
  }));

  return { repository, recruitmentCrypto, service };
};

export default registerPublicRecruitmentRoutes;
