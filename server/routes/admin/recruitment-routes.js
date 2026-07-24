import { createRecruitmentCrypto } from '../../recruitment-crypto.js';
import { createRecruitmentRepository } from '../../repositories/recruitment-repository.js';
import { createRecruitmentAdminRepository } from '../../repositories/recruitment-admin-repository.js';
import { createRecruitmentService } from '../../services/recruitment-service.js';
import { createRecruitmentAdminService, RecruitmentAdminServiceError } from '../../services/recruitment-admin-service.js';

const missingMiddleware = (name) => (_req, res) => (
  res.status(500).json({ error: `${name} 未配置`, code: 'admin_dependency_missing' })
);

const normalizeAction = (value) => String(value || '').trim().toLowerCase();

const RECRUITMENT_BAN_PERMISSIONS = new Set(['recruit', 'chat', 'site']);

const requireMiddleware = (value, name) => {
  if (typeof value !== 'function') {
    throw new TypeError(`招募后台路由缺少 ${name}`);
  }
  return value;
};

const getActor = (req, getClientIp) => ({
  id: req.session?.admin?.id || null,
  username: req.session?.admin?.username || 'unknown-admin',
  ip: typeof getClientIp === 'function' ? getClientIp(req) : null,
});

const getTargetId = (req, key) => String(req.params?.[key] || req.params?.id || '').trim();

const getReportId = (req) => String(req.body?.reportId || '').trim();

const createHandler = (handler) => async (req, res, next) => {
  try {
    return await handler(req, res);
  } catch (error) {
    if (error instanceof RecruitmentAdminServiceError) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }
    if (Number.isInteger(error?.status) && error?.code) {
      return res.status(error.status).json({ error: error.message || '请求无效', code: error.code });
    }
    if (error?.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
      return res.status(409).json({ error: '招募状态发生变化，请刷新后重试', code: 'state_conflict' });
    }
    // 让 Express 统一处理未知错误，避免静默吞掉数据库故障。
    if (typeof next === 'function') {
      return next(error);
    }
    throw error;
  }
};

const logGlobalAudit = (logAdminAction, req, payload) => {
  if (typeof logAdminAction !== 'function') return;
  try {
    logAdminAction(req, payload);
  } catch (error) {
    // 专用招募审计已在同一事务中写入；全局审计失败不应泄露内容或回滚已完成处置。
    console.error('招募全局审计写入失败:', error);
  }
};

/**
 * 注册招募后台治理接口。
 * 聊天正文没有列表接口；只有带 reportId 的 POST 证据接口能够触发有限解密。
 */
export const registerAdminRecruitmentRoutes = (app, deps = {}) => {
  if (!app || typeof app.get !== 'function' || typeof app.post !== 'function') {
    throw new TypeError('招募后台路由需要 Express app');
  }
  const {
    db,
    requireAdmin,
    requireAdminCsrf,
    requireAdminRead,
    requireAdminManage,
    requireUserSafetyManage = missingMiddleware('user_safety:manage'),
    getClientIp,
    logAdminAction,
    resolveBanOptions,
    upsertBan,
    resolveStoredIdentityHash,
    sessionSecret,
    recruitmentCrypto,
    recruitmentRepository,
    recruitmentService,
    evidenceService: injectedEvidenceService,
    adminRepository,
    adminService,
    service: injectedAdminService,
  } = deps;

  const adminMiddleware = requireMiddleware(requireAdmin, 'requireAdmin');
  const adminCsrfMiddleware = requireMiddleware(requireAdminCsrf, 'requireAdminCsrf');
  const adminReadMiddleware = requireMiddleware(requireAdminRead, 'requireAdminRead');
  const adminManageMiddleware = requireMiddleware(requireAdminManage, 'requireAdminManage');
  const userSafetyManageMiddleware = typeof requireUserSafetyManage === 'function'
    ? requireUserSafetyManage
    : missingMiddleware('user_safety:manage');

  const coreRepository = recruitmentRepository || (db ? createRecruitmentRepository(db) : null);
  const coreCrypto = recruitmentCrypto || (sessionSecret
    ? createRecruitmentCrypto({ sessionSecret })
    : null);
  const evidenceService = injectedEvidenceService || recruitmentService || (
    coreRepository && coreCrypto
      ? createRecruitmentService({ repository: coreRepository, recruitmentCrypto: coreCrypto })
      : {
        getReportEvidenceForAdmin() {
          throw new RecruitmentAdminServiceError('有限证据服务未配置', 503, 'evidence_dependency_missing');
        },
      }
  );
  const moderationRepository = adminRepository || (db ? createRecruitmentAdminRepository(db) : null);
  const service = adminService || injectedAdminService || createRecruitmentAdminService({
    repository: moderationRepository,
    evidenceService,
    upsertBan,
    resolveStoredIdentityHash,
  });

  const requireBanPermission = (req, res, next) => {
    if (normalizeAction(req.body?.action) !== 'ban') {
      return next();
    }
    return userSafetyManageMiddleware(req, res, next);
  };

  const resolveRecruitmentBanOptions = (req) => {
    if (typeof resolveBanOptions !== 'function') {
      throw new RecruitmentAdminServiceError('封禁依赖未配置', 500, 'ban_dependency_missing');
    }
    const supplied = Array.isArray(req.body?.permissions)
      ? Array.from(new Set(req.body.permissions.map((value) => String(value || '').trim()).filter(Boolean)))
      : [];
    if (supplied.some((permission) => !RECRUITMENT_BAN_PERMISSIONS.has(permission))) {
      throw new RecruitmentAdminServiceError('招募封禁权限无效', 400, 'invalid_ban_permissions');
    }
    const permissions = supplied.length ? supplied : ['recruit', 'chat'];
    return {
      ...resolveBanOptions(req),
      permissions,
    };
  };

  app.get('/api/admin/recruitment/reports', adminMiddleware, adminReadMiddleware, createHandler((req, res) => (
    res.json(service.listReports({
      status: req.query?.status,
      targetType: req.query?.targetType,
      page: req.query?.page,
      limit: req.query?.limit,
    }))
  )));

  app.post(
    '/api/admin/recruitment/reports/:id/evidence',
    adminMiddleware,
    adminCsrfMiddleware,
    adminManageMiddleware,
    createHandler((req, res) => {
      const reportId = getTargetId(req, 'reportId');
      const result = service.getReportEvidence({
        reportId,
        reason: req.body?.reason,
        actor: getActor(req, getClientIp),
      });
      logGlobalAudit(logAdminAction, req, {
        action: 'recruitment_report_evidence_view',
        targetType: 'recruitment_report',
        targetId: reportId,
        after: {
          evidenceCount: result.evidence.length,
          contactAccessed: Boolean(result.contact?.contact),
        },
        reason: req.body?.reason,
      });
      return res.json(result);
    }),
  );

  app.post(
    '/api/admin/recruitment/reports/:id/action',
    adminMiddleware,
    adminCsrfMiddleware,
    adminManageMiddleware,
    requireBanPermission,
    createHandler((req, res) => {
      const reportId = getTargetId(req, 'reportId');
      const action = normalizeAction(req.body?.action);
      if (action === 'ban' && typeof resolveBanOptions !== 'function') {
        throw new RecruitmentAdminServiceError('封禁依赖未配置', 500, 'ban_dependency_missing');
      }
      const result = service.applyReportAction({
        reportId,
        action,
        reason: req.body?.reason,
        actor: getActor(req, getClientIp),
        banOptions: action === 'ban' ? resolveRecruitmentBanOptions(req) : null,
      });
      logGlobalAudit(logAdminAction, req, {
        action: `recruitment_report_${result.action}`,
        targetType: 'recruitment_report',
        targetId: reportId,
        after: { status: result.report.status, resolution: result.report.resolution },
        reason: req.body?.reason,
      });
      return res.json(result);
    }),
  );

  app.post(
    '/api/admin/recruitment/posts/:id/action',
    adminMiddleware,
    adminCsrfMiddleware,
    adminManageMiddleware,
    createHandler((req, res) => {
      const postId = getTargetId(req, 'postId');
      const result = service.applyPostAction({
        reportId: getReportId(req),
        postId,
        action: normalizeAction(req.body?.action),
        reason: req.body?.reason,
        actor: getActor(req, getClientIp),
      });
      logGlobalAudit(logAdminAction, req, {
        action: `recruitment_post_${result.action === 'restore' ? 'restore' : 'remove'}`,
        targetType: 'recruitment_post',
        targetId: postId,
        after: result.target,
        reason: req.body?.reason,
      });
      return res.json(result);
    }),
  );

  app.post(
    '/api/admin/recruitment/threads/:id/action',
    adminMiddleware,
    adminCsrfMiddleware,
    adminManageMiddleware,
    createHandler((req, res) => {
      const threadId = getTargetId(req, 'threadId');
      const result = service.applyThreadAction({
        reportId: getReportId(req),
        threadId,
        action: normalizeAction(req.body?.action),
        reason: req.body?.reason,
        actor: getActor(req, getClientIp),
      });
      logGlobalAudit(logAdminAction, req, {
        action: `recruitment_thread_${result.action}`,
        targetType: 'recruitment_thread',
        targetId: threadId,
        after: result.target,
        reason: req.body?.reason,
      });
      return res.json(result);
    }),
  );

  app.post(
    '/api/admin/recruitment/messages/:id/action',
    adminMiddleware,
    adminCsrfMiddleware,
    adminManageMiddleware,
    createHandler((req, res) => {
      const messageId = getTargetId(req, 'messageId');
      const result = service.applyMessageAction({
        reportId: getReportId(req),
        messageId,
        action: normalizeAction(req.body?.action),
        reason: req.body?.reason,
        actor: getActor(req, getClientIp),
      });
      logGlobalAudit(logAdminAction, req, {
        action: `recruitment_message_${result.action === 'restore' ? 'restore' : 'remove'}`,
        targetType: 'recruitment_message',
        targetId: messageId,
        after: result.target,
        reason: req.body?.reason,
      });
      return res.json(result);
    }),
  );

  // 联系方式本身也可被治理；不提供任何按 thread 浏览联系方式的接口。
  app.post(
    '/api/admin/recruitment/contact-exchanges/:id/action',
    adminMiddleware,
    adminCsrfMiddleware,
    adminManageMiddleware,
    createHandler((req, res) => {
      const exchangeId = getTargetId(req, 'exchangeId');
      const result = service.applyContactExchangeAction({
        reportId: getReportId(req),
        exchangeId,
        action: normalizeAction(req.body?.action),
        reason: req.body?.reason,
        actor: getActor(req, getClientIp),
      });
      logGlobalAudit(logAdminAction, req, {
        action: `recruitment_contact_exchange_${result.action === 'restore' ? 'restore' : 'remove'}`,
        targetType: 'recruitment_contact_exchange',
        targetId: exchangeId,
        after: result.target,
        reason: req.body?.reason,
      });
      return res.json(result);
    }),
  );

  return { service, repository: moderationRepository, evidenceService };
};

export default registerAdminRecruitmentRoutes;
