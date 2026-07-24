const MAX_REASON_LENGTH = 500;
const MAX_EVIDENCE_ITEMS = 20;
const DEFAULT_RECRUITMENT_BAN_PERMISSIONS = ['recruit', 'chat'];

const normalizeId = (value) => String(value || '').trim();

const normalizeReason = (value, required = true) => {
  const reason = String(value || '').trim();
  if (required && !reason) {
    throw new RecruitmentAdminServiceError('请填写处理理由', 400, 'reason_required');
  }
  if (reason.length > MAX_REASON_LENGTH) {
    throw new RecruitmentAdminServiceError('处理理由过长', 400, 'reason_too_long');
  }
  return reason;
};

export class RecruitmentAdminServiceError extends Error {
  constructor(message, status = 400, code = 'invalid_request') {
    super(message);
    this.name = 'RecruitmentAdminServiceError';
    this.status = status;
    this.code = code;
  }
}

const throwNotFound = (message) => {
  throw new RecruitmentAdminServiceError(message, 404, 'not_found');
};

const ensureActionableReport = (report) => {
  if (!report) {
    throwNotFound('举报不存在');
  }
  if (!['pending', 'reviewing'].includes(String(report.status || ''))) {
    throw new RecruitmentAdminServiceError('举报已经处理，不能重复操作', 409, 'report_already_processed');
  }
};

const mapReport = (row) => ({
  id: row.id,
  targetType: row.target_type,
  postId: row.post_id || null,
  threadId: row.thread_id || null,
  messageId: row.message_id || null,
  contactExchangeId: row.contact_exchange_id || null,
  reasonCode: row.reason_code,
  detail: row.detail || '',
  status: row.status,
  action: row.action || null,
  resolution: row.resolution || null,
  createdAt: Number(row.created_at || 0),
  reviewedAt: row.reviewed_at || null,
  reviewedBy: row.reviewed_by || null,
  evidenceCount: Number(row.evidence_count || 0),
  target: {
    post: row.post_id
      ? {
        id: row.post_id,
        xinfaId: row.post_xinfa_id || null,
        contentSnippet: String(row.post_content || '').slice(0, 240),
        status: row.post_status || null,
        moderationStatus: row.post_moderation_status || null,
      }
      : null,
    thread: row.thread_id
      ? {
        id: row.thread_id,
        status: row.thread_status || null,
        lockedAt: row.thread_locked_at || null,
      }
      : null,
    message: row.message_id
      ? {
        id: row.message_id,
        moderationStatus: row.message_moderation_status || null,
        deletedAt: row.message_deleted_at || null,
      }
      : null,
    contactExchange: row.contact_exchange_id
      ? {
        id: row.contact_exchange_id,
        moderationStatus: row.exchange_moderation_status || null,
        deletedAt: row.exchange_deleted_at || null,
      }
      : null,
  },
});

const mapEvidenceItem = (item, index) => {
  // 只挑选后台页面真正需要的字段，避免把身份哈希或密文回传给浏览器。
  const type = item.type || (item.exchangeId ? 'contact_exchange' : 'message');
  const result = {
    id: item.id || item.messageId || item.exchangeId || `evidence-${index + 1}`,
    type,
    position: Number.isInteger(Number(item.position)) ? Number(item.position) : index,
    threadId: item.threadId || null,
    messageId: item.messageId || (type === 'message' ? item.id : null),
    exchangeId: item.exchangeId || (type === 'contact_exchange' ? item.id : null),
    senderRole: item.senderRole || item.ownerRole || null,
    isReportedParty: Boolean(item.isReportedParty),
    content: item.content ?? null,
    createdAt: Number(item.createdAt || item.created_at || 0),
    moderationStatus: item.moderationStatus || item.moderation_status || null,
  };
  return result;
};

const mapContactEvidence = (item) => {
  if (!item) return null;
  return {
    exchangeId: item.exchangeId || item.id || null,
    threadId: item.threadId || null,
    status: item.status || null,
    deleted: Boolean(item.deleted),
    contact: item.contact ?? null,
  };
};

const mapState = (row, kind) => {
  if (!row) return null;
  if (kind === 'post') {
    return {
      id: row.id,
      moderationStatus: row.moderation_status || null,
      moderationReason: row.moderation_reason || null,
      moderatedAt: row.moderated_at || null,
      moderatedBy: row.moderated_by || null,
    };
  }
  if (kind === 'thread') {
    return {
      id: row.id,
      status: row.status || null,
      lockReason: row.lock_reason || null,
      lockedAt: row.locked_at || null,
      lockedBy: row.locked_by || null,
    };
  }
  return {
    id: row.id,
    moderationStatus: row.moderation_status || null,
    deletionReason: row.deletion_reason || null,
    deletedAt: row.deleted_at || null,
    deletedBy: row.deleted_by || null,
  };
};

export const createRecruitmentAdminService = ({
  repository,
  evidenceService,
  upsertBan,
  resolveStoredIdentityHash,
  now = () => Date.now(),
} = {}) => {
  if (!repository) {
    throw new TypeError('招募后台 service 需要 repository');
  }
  if (!evidenceService || typeof evidenceService.getReportEvidenceForAdmin !== 'function') {
    throw new TypeError('招募后台 service 需要有限证据读取服务');
  }

  const actorFields = (actor = {}) => ({
    adminId: actor.id || null,
    adminUsername: actor.username || 'unknown-admin',
    ip: actor.ip || null,
  });

  const requireAuthorizedTarget = ({ reportId, targetType, targetId }) => {
    const normalizedReportId = normalizeId(reportId);
    if (!normalizedReportId) {
      throw new RecruitmentAdminServiceError('治理动作必须关联具体举报', 400, 'report_required');
    }
    if (!repository.isTargetAuthorizedByReport({
      reportId: normalizedReportId,
      targetType,
      targetId,
    })) {
      // 不区分举报不存在与目标未关联，避免直接资源 ID 成为存在性探针。
      throw new RecruitmentAdminServiceError('举报不存在或未关联该目标', 404, 'report_target_not_found');
    }
    return normalizedReportId;
  };

  const banReportedIdentity = (identityHash, banOptions) => {
    if (typeof upsertBan !== 'function' || typeof resolveStoredIdentityHash !== 'function') {
      throw new RecruitmentAdminServiceError('封禁依赖未配置', 500, 'ban_dependency_missing');
    }
    const resolved = resolveStoredIdentityHash(identityHash) || {};
    const rawIdentity = String(identityHash || '').trim();
    const canonicalHash = String(
      resolved.type === 'identity'
        ? (resolved.canonicalHash || resolved.identityKey || '')
        : (resolved.canonicalHash || '')
    ).trim();
    if (!canonicalHash && !rawIdentity) {
      throw new RecruitmentAdminServiceError('举报缺少被举报身份', 409, 'reported_identity_missing');
    }
    if (canonicalHash) {
      upsertBan('banned_identities', 'identity', canonicalHash, banOptions);
    }
    const legacyHashes = new Set([
      !canonicalHash ? rawIdentity : '',
      resolved.legacyFingerprintHash,
      ...(Array.isArray(resolved.identityHashes) ? resolved.identityHashes : []),
    ].map((value) => String(value || '').trim()).filter((value) => value && value !== canonicalHash));
    legacyHashes.forEach((legacyHash) => {
      upsertBan('banned_fingerprints', 'fingerprint', legacyHash, banOptions);
    });
  };

  const listReports = (params) => {
    const result = repository.listReports(params);
    return {
      ...result,
      items: result.items.map(mapReport),
    };
  };

  const getReportEvidence = ({ reportId, reason, actor } = {}) => {
    const normalizedReportId = normalizeId(reportId);
    if (!normalizedReportId) {
      throw new RecruitmentAdminServiceError('举报不存在', 400, 'report_required');
    }
    const normalizedReason = normalizeReason(reason);
    const loaded = evidenceService.getReportEvidenceForAdmin({
      reportId: normalizedReportId,
      includeContact: true,
    });
    if (!loaded?.report) {
      throwNotFound('举报不存在');
    }
    const rawEvidence = Array.isArray(loaded.evidence) ? loaded.evidence : [];
    if (rawEvidence.length > MAX_EVIDENCE_ITEMS) {
      throw new RecruitmentAdminServiceError('举报证据数量异常', 500, 'evidence_limit_violation');
    }
    const evidence = rawEvidence.map(mapEvidenceItem);
    const contact = mapContactEvidence(loaded.contact);
    const auditAt = now();
    const actorData = actorFields(actor);
    repository.runImmediateTransaction(() => {
      repository.insertAudit({
        ...actorData,
        action: 'recruitment_report_evidence_view',
        targetType: 'recruitment_report',
        targetId: normalizedReportId,
        reportId: normalizedReportId,
        before: null,
        after: {
          targetType: loaded.report.target_type || null,
          evidenceCount: evidence.length,
          evidenceIds: evidence.map((item) => item.id),
          contactExchangeId: contact?.exchangeId || null,
          contactAccessed: Boolean(contact?.contact),
        },
        reason: normalizedReason,
        createdAt: auditAt,
      });
    });
    return {
      report: mapReport({ ...loaded.report, evidence_count: evidence.length }),
      evidence,
      contact,
      auditedAt: auditAt,
    };
  };

  const applyReportAction = ({ reportId, action, reason, actor, banOptions } = {}) => {
    const normalizedReportId = normalizeId(reportId);
    if (!normalizedReportId) {
      throw new RecruitmentAdminServiceError('举报不存在', 400, 'report_required');
    }
    const normalizedAction = String(action || '').trim().toLowerCase();
    const normalizedReason = normalizeReason(reason);
    const actionMap = {
      ignore: { status: 'dismissed', resolution: 'ignored' },
      dismiss: { status: 'dismissed', resolution: 'ignored' },
      resolve: { status: 'resolved', resolution: 'resolved' },
      handle: { status: 'resolved', resolution: 'resolved' },
      ban: { status: 'resolved', resolution: 'banned' },
    };
    const mapped = actionMap[normalizedAction];
    if (!mapped) {
      throw new RecruitmentAdminServiceError('举报操作无效', 400, 'invalid_report_action');
    }
    const report = repository.getReport(normalizedReportId);
    ensureActionableReport(report);
    const actorData = actorFields(actor);
    const updatedAt = now();
    let result;
    repository.runImmediateTransaction(() => {
      if (normalizedAction === 'ban') {
        const identityHash = String(report.reported_identity_hash || '').trim();
        if (!identityHash) {
          throw new RecruitmentAdminServiceError('举报缺少被举报身份', 409, 'reported_identity_missing');
        }
        banReportedIdentity(
          identityHash,
          banOptions || {
            permissions: DEFAULT_RECRUITMENT_BAN_PERMISSIONS,
            reason: normalizedReason,
          },
        );
      }
      const updateResult = repository.updateReport({
        reportId: normalizedReportId,
        status: mapped.status,
        action: normalizedAction,
        resolution: mapped.resolution,
        expectedStatuses: ['pending', 'reviewing'],
        adminUsername: actorData.adminUsername,
        now: updatedAt,
      });
      if (updateResult && Number(updateResult.changes || 0) !== 1) {
        throw new RecruitmentAdminServiceError('举报已经处理，不能重复操作', 409, 'report_already_processed');
      }
      repository.insertAudit({
        ...actorData,
        action: `recruitment_report_${normalizedAction}`,
        targetType: 'recruitment_report',
        targetId: normalizedReportId,
        reportId: normalizedReportId,
        before: { status: report.status, action: report.action || null },
        after: { status: mapped.status, action: normalizedAction, resolution: mapped.resolution },
        reason: normalizedReason,
        createdAt: updatedAt,
      });
      result = repository.getReport(normalizedReportId);
    });
    return { report: mapReport(result), action: normalizedAction, updatedAt };
  };

  const applyPostAction = ({ reportId, postId, action, reason, actor } = {}) => {
    const normalizedReportId = requireAuthorizedTarget({
      reportId,
      targetType: 'post',
      targetId: postId,
    });
    const normalizedId = normalizeId(postId);
    const normalizedAction = String(action || '').trim().toLowerCase();
    const target = repository.getPost(normalizedId);
    if (!target) throwNotFound('招募不存在');
    const moderationStatus = ['delete', 'remove'].includes(normalizedAction) ? 'removed'
      : normalizedAction === 'restore' ? 'visible' : null;
    if (!moderationStatus) {
      throw new RecruitmentAdminServiceError('招募操作无效', 400, 'invalid_post_action');
    }
    if (target.moderation_status === moderationStatus) {
      throw new RecruitmentAdminServiceError('招募已处于目标状态', 409, 'post_state_conflict');
    }
    const normalizedReason = normalizeReason(reason);
    const actorData = actorFields(actor);
    const updatedAt = now();
    let result;
    repository.runImmediateTransaction(() => {
      const updateResult = repository.updatePostModeration({
        postId: normalizedId,
        moderationStatus,
        expectedStatus: target.moderation_status,
        adminUsername: actorData.adminUsername,
        reason: normalizedReason,
        now: updatedAt,
      });
      if (updateResult && Number(updateResult.changes || 0) !== 1) {
        throw new RecruitmentAdminServiceError('招募状态发生变化，请刷新后重试', 409, 'post_state_conflict');
      }
      repository.insertAudit({
        ...actorData,
        action: `recruitment_post_${moderationStatus === 'removed' ? 'remove' : 'restore'}`,
        targetType: 'recruitment_post',
        targetId: normalizedId,
        reportId: normalizedReportId,
        before: mapState(target, 'post'),
        after: mapState(repository.getPost(normalizedId), 'post'),
        reason: normalizedReason,
        createdAt: updatedAt,
      });
      result = repository.getPost(normalizedId);
    });
    return { target: mapState(result, 'post'), action: normalizedAction, updatedAt };
  };

  const applyThreadAction = ({ reportId, threadId, action, reason, actor } = {}) => {
    const normalizedReportId = requireAuthorizedTarget({
      reportId,
      targetType: 'thread',
      targetId: threadId,
    });
    const normalizedId = normalizeId(threadId);
    const normalizedAction = String(action || '').trim().toLowerCase();
    const target = repository.getThread(normalizedId);
    if (!target) throwNotFound('会话不存在');
    const shouldLock = normalizedAction === 'lock' ? true : normalizedAction === 'unlock' ? false : null;
    if (shouldLock === null) {
      throw new RecruitmentAdminServiceError('会话操作无效', 400, 'invalid_thread_action');
    }
    if (
      (shouldLock && target.locked_at)
      || (!shouldLock && !target.locked_at)
    ) {
      throw new RecruitmentAdminServiceError('会话已处于目标状态', 409, 'thread_state_conflict');
    }
    const normalizedReason = normalizeReason(reason);
    const actorData = actorFields(actor);
    const updatedAt = now();
    let result;
    repository.runImmediateTransaction(() => {
      const updateResult = repository.updateThreadLock({
        threadId: normalizedId,
        locked: shouldLock,
        expectedLocked: Boolean(target.locked_at),
        adminUsername: actorData.adminUsername,
        reason: normalizedReason,
        now: updatedAt,
      });
      if (updateResult && Number(updateResult.changes || 0) !== 1) {
        throw new RecruitmentAdminServiceError('会话状态发生变化，请刷新后重试', 409, 'thread_state_conflict');
      }
      repository.insertAudit({
        ...actorData,
        action: `recruitment_thread_${normalizedAction}`,
        targetType: 'recruitment_thread',
        targetId: normalizedId,
        reportId: normalizedReportId,
        before: mapState(target, 'thread'),
        after: mapState(repository.getThread(normalizedId), 'thread'),
        reason: normalizedReason,
        createdAt: updatedAt,
      });
      result = repository.getThread(normalizedId);
    });
    return { target: mapState(result, 'thread'), action: normalizedAction, updatedAt };
  };

  const applyMessageAction = ({ reportId, messageId, action, reason, actor } = {}) => {
    const normalizedReportId = requireAuthorizedTarget({
      reportId,
      targetType: 'message',
      targetId: messageId,
    });
    const normalizedId = normalizeId(messageId);
    const normalizedAction = String(action || '').trim().toLowerCase();
    const target = repository.getMessage(normalizedId);
    if (!target) throwNotFound('消息不存在');
    const moderationStatus = ['delete', 'remove'].includes(normalizedAction) ? 'removed'
      : normalizedAction === 'restore' ? 'visible' : null;
    if (!moderationStatus) {
      throw new RecruitmentAdminServiceError('消息操作无效', 400, 'invalid_message_action');
    }
    if (target.moderation_status === moderationStatus) {
      throw new RecruitmentAdminServiceError('消息已处于目标状态', 409, 'message_state_conflict');
    }
    const normalizedReason = normalizeReason(reason);
    const actorData = actorFields(actor);
    const updatedAt = now();
    let result;
    repository.runImmediateTransaction(() => {
      const updateResult = repository.updateMessageModeration({
        messageId: normalizedId,
        moderationStatus,
        expectedStatus: target.moderation_status,
        adminUsername: actorData.adminUsername,
        reason: normalizedReason,
        now: updatedAt,
      });
      if (updateResult && Number(updateResult.changes || 0) !== 1) {
        throw new RecruitmentAdminServiceError('消息状态发生变化，请刷新后重试', 409, 'message_state_conflict');
      }
      // 事件与治理状态处于同一事务，供已打开的密聊按游标同步删除/恢复。
      repository.insertMessageModerationEvent({
        messageId: normalizedId,
        threadId: target.thread_id,
        moderationStatus,
        createdAt: updatedAt,
      });
      repository.insertAudit({
        ...actorData,
        action: `recruitment_message_${moderationStatus === 'removed' ? 'remove' : 'restore'}`,
        targetType: 'recruitment_message',
        targetId: normalizedId,
        reportId: normalizedReportId,
        before: mapState(target, 'message'),
        after: mapState(repository.getMessage(normalizedId), 'message'),
        reason: normalizedReason,
        createdAt: updatedAt,
      });
      result = repository.getMessage(normalizedId);
    });
    return { target: mapState(result, 'message'), action: normalizedAction, updatedAt };
  };

  const applyContactExchangeAction = ({ reportId, exchangeId, action, reason, actor } = {}) => {
    const normalizedReportId = requireAuthorizedTarget({
      reportId,
      targetType: 'contact_exchange',
      targetId: exchangeId,
    });
    const normalizedId = normalizeId(exchangeId);
    const normalizedAction = String(action || '').trim().toLowerCase();
    const target = repository.getContactExchange(normalizedId);
    if (!target) throwNotFound('联系方式记录不存在');
    const moderationStatus = ['delete', 'remove'].includes(normalizedAction) ? 'removed'
      : normalizedAction === 'restore' ? 'visible' : null;
    if (!moderationStatus) {
      throw new RecruitmentAdminServiceError('联系方式操作无效', 400, 'invalid_exchange_action');
    }
    if (target.moderation_status === moderationStatus) {
      throw new RecruitmentAdminServiceError('联系方式已处于目标状态', 409, 'exchange_state_conflict');
    }
    const normalizedReason = normalizeReason(reason);
    const actorData = actorFields(actor);
    const updatedAt = now();
    let result;
    repository.runImmediateTransaction(() => {
      const updateResult = repository.updateContactExchangeModeration({
        exchangeId: normalizedId,
        moderationStatus,
        expectedStatus: target.moderation_status,
        adminUsername: actorData.adminUsername,
        reason: normalizedReason,
        now: updatedAt,
      });
      if (updateResult && Number(updateResult.changes || 0) !== 1) {
        throw new RecruitmentAdminServiceError('联系方式状态发生变化，请刷新后重试', 409, 'exchange_state_conflict');
      }
      repository.insertAudit({
        ...actorData,
        action: `recruitment_contact_exchange_${moderationStatus === 'removed' ? 'remove' : 'restore'}`,
        targetType: 'recruitment_contact_exchange',
        targetId: normalizedId,
        reportId: normalizedReportId,
        before: mapState(target, 'message'),
        after: mapState(repository.getContactExchange(normalizedId), 'message'),
        reason: normalizedReason,
        createdAt: updatedAt,
      });
      result = repository.getContactExchange(normalizedId);
    });
    return { target: mapState(result, 'message'), action: normalizedAction, updatedAt };
  };

  return {
    listReports,
    getReportEvidence,
    applyReportAction,
    applyPostAction,
    applyThreadAction,
    applyMessageAction,
    applyContactExchangeAction,
  };
};

export default createRecruitmentAdminService;
