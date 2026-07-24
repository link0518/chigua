const normalizeId = (value) => String(value || '').trim();

const normalizePage = (value) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
};

const normalizeLimit = (value) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, 50) : 20;
};

const REPORT_STATUSES = new Set(['pending', 'reviewing', 'resolved', 'dismissed']);
const REPORT_TARGET_TYPES = new Set(['post', 'thread', 'message', 'contact_exchange']);

export class RecruitmentAdminRepositoryError extends Error {
  constructor(message, code = 'invalid_request') {
    super(message);
    this.name = 'RecruitmentAdminRepositoryError';
    this.status = 400;
    this.code = code;
  }
}

/**
 * 招募后台专用数据访问层。
 * 这里不提供按 thread 列出消息的能力；聊天证据只能通过 report_evidence 白名单读取。
 */
export const createRecruitmentAdminRepository = (db) => {
  if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
    throw new TypeError('招募后台 repository 需要 SQLite 数据库');
  }

  const getReport = (reportId) => db.prepare(`
    SELECT *
    FROM recruitment_reports
    WHERE id = ?
  `).get(normalizeId(reportId));

  const listReports = ({ status = 'pending', targetType = 'all', page = 1, limit = 20 } = {}) => {
    const normalizedStatus = String(status || 'pending').trim().toLowerCase();
    const normalizedTargetType = String(targetType || 'all').trim().toLowerCase();
    if (normalizedStatus !== 'all' && !REPORT_STATUSES.has(normalizedStatus)) {
      throw new RecruitmentAdminRepositoryError('举报状态无效', 'invalid_report_status');
    }
    if (normalizedTargetType !== 'all' && !REPORT_TARGET_TYPES.has(normalizedTargetType)) {
      throw new RecruitmentAdminRepositoryError('举报目标类型无效', 'invalid_report_target');
    }

    const normalizedPage = normalizePage(page);
    const normalizedLimit = normalizeLimit(limit);
    const offset = (normalizedPage - 1) * normalizedLimit;
    const conditions = [];
    const params = [];
    if (normalizedStatus !== 'all') {
      conditions.push('r.status = ?');
      params.push(normalizedStatus);
    }
    if (normalizedTargetType !== 'all') {
      conditions.push('r.target_type = ?');
      params.push(normalizedTargetType);
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const total = Number(db.prepare(`
      SELECT COUNT(1) AS count
      FROM recruitment_reports r
      ${whereClause}
    `).get(...params)?.count || 0);
    const rows = db.prepare(`
      SELECT
        r.id,
        r.reporter_identity_hash,
        r.reported_identity_hash,
        r.target_type,
        r.post_id,
        r.thread_id,
        r.message_id,
        r.contact_exchange_id,
        r.reason_code,
        r.detail,
        r.status,
        r.created_at,
        r.reviewed_at,
        r.reviewed_by,
        r.resolution,
        r.action,
        p.xinfa_id AS post_xinfa_id,
        p.content AS post_content,
        p.status AS post_status,
        p.moderation_status AS post_moderation_status,
        t.status AS thread_status,
        t.locked_at AS thread_locked_at,
        m.moderation_status AS message_moderation_status,
        m.deleted_at AS message_deleted_at,
        e.moderation_status AS exchange_moderation_status,
        e.deleted_at AS exchange_deleted_at,
        (
          SELECT COUNT(1)
          FROM recruitment_report_evidence evidence
          WHERE evidence.report_id = r.id
        ) AS evidence_count
      FROM recruitment_reports r
      LEFT JOIN recruitment_posts p ON p.id = r.post_id
      LEFT JOIN recruitment_threads t ON t.id = r.thread_id
      LEFT JOIN recruitment_messages m ON m.id = r.message_id
      LEFT JOIN recruitment_contact_exchanges e ON e.id = r.contact_exchange_id
      ${whereClause}
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT ? OFFSET ?
    `).all(...params, normalizedLimit, offset);

    return {
      items: rows,
      total,
      page: normalizedPage,
      limit: normalizedLimit,
    };
  };

  const getPost = (postId) => db.prepare(`
    SELECT *
    FROM recruitment_posts
    WHERE id = ?
  `).get(normalizeId(postId));

  const getThread = (threadId) => db.prepare(`
    SELECT *
    FROM recruitment_threads
    WHERE id = ?
  `).get(normalizeId(threadId));

  const getMessage = (messageId) => db.prepare(`
    SELECT *
    FROM recruitment_messages
    WHERE id = ?
  `).get(normalizeId(messageId));

  const getContactExchange = (exchangeId) => db.prepare(`
    SELECT *
    FROM recruitment_contact_exchanges
    WHERE id = ?
  `).get(normalizeId(exchangeId));

  /**
   * 所有密聊治理动作都必须能追溯到具体举报。消息既可以是举报主目标，
   * 也可以是该举报明确选入的证据；其它资源必须与举报 target_type 一致，
   * 不能借 post_id、thread_id 等上下文字段扩大治理范围。
   */
  const isTargetAuthorizedByReport = ({ reportId, targetType, targetId }) => {
    const normalizedReportId = normalizeId(reportId);
    const normalizedTargetId = normalizeId(targetId);
    if (!normalizedReportId || !normalizedTargetId) return false;
    if (targetType === 'post') {
      return Boolean(db.prepare(`
        SELECT 1
        FROM recruitment_reports
        WHERE id = ? AND target_type = 'post' AND post_id = ?
      `).get(normalizedReportId, normalizedTargetId));
    }
    if (targetType === 'thread') {
      return Boolean(db.prepare(`
        SELECT 1
        FROM recruitment_reports
        WHERE id = ? AND target_type = 'thread' AND thread_id = ?
      `).get(normalizedReportId, normalizedTargetId));
    }
    if (targetType === 'message') {
      return Boolean(db.prepare(`
        SELECT 1
        FROM recruitment_reports r
        WHERE r.id = ?
          AND (
            (r.target_type = 'message' AND r.message_id = ?)
            OR EXISTS (
              SELECT 1
              FROM recruitment_report_evidence evidence
              WHERE evidence.report_id = r.id AND evidence.message_id = ?
            )
          )
      `).get(normalizedReportId, normalizedTargetId, normalizedTargetId));
    }
    if (targetType === 'contact_exchange') {
      return Boolean(db.prepare(`
        SELECT 1
        FROM recruitment_reports
        WHERE id = ? AND target_type = 'contact_exchange' AND contact_exchange_id = ?
      `).get(normalizedReportId, normalizedTargetId));
    }
    return false;
  };

  const updatePostModeration = ({ postId, moderationStatus, expectedStatus, adminUsername, reason, now }) => db.prepare(`
    UPDATE recruitment_posts
    SET moderation_status = ?, moderated_at = ?, moderated_by = ?, moderation_reason = ?, updated_at = ?
    WHERE id = ? AND moderation_status = ?
  `).run(moderationStatus, now, adminUsername || null, reason || null, now, normalizeId(postId), expectedStatus);

  const updateThreadLock = ({ threadId, locked, expectedLocked, adminUsername, reason, now }) => db.prepare(`
    UPDATE recruitment_threads
    SET locked_at = ?, locked_by = ?, lock_reason = ?, updated_at = ?
    WHERE id = ? AND (locked_at IS NULL) = ?
  `).run(
    locked ? now : null,
    locked ? (adminUsername || null) : null,
    locked ? (reason || null) : null,
    now,
    normalizeId(threadId),
    expectedLocked ? 0 : 1,
  );

  const updateMessageModeration = ({ messageId, moderationStatus, expectedStatus, adminUsername, reason, now }) => db.prepare(`
    UPDATE recruitment_messages
    SET moderation_status = ?, deleted_at = ?, deleted_by = ?, deletion_reason = ?
    WHERE id = ? AND moderation_status = ?
  `).run(
    moderationStatus,
    moderationStatus === 'removed' ? now : null,
    moderationStatus === 'removed' ? (adminUsername || null) : null,
    moderationStatus === 'removed' ? (reason || null) : null,
    normalizeId(messageId),
    expectedStatus,
  );

  const insertMessageModerationEvent = ({ messageId, threadId, moderationStatus, createdAt }) => db.prepare(`
    INSERT INTO recruitment_message_moderation_events (
      message_id, thread_id, moderation_status, created_at
    ) VALUES (?, ?, ?, ?)
  `).run(normalizeId(messageId), normalizeId(threadId), moderationStatus, createdAt);

  const updateContactExchangeModeration = ({ exchangeId, moderationStatus, expectedStatus, adminUsername, reason, now }) => db.prepare(`
    UPDATE recruitment_contact_exchanges
    SET moderation_status = ?, deleted_at = ?, deleted_by = ?, deletion_reason = ?, updated_at = ?
    WHERE id = ? AND moderation_status = ?
  `).run(
    moderationStatus,
    moderationStatus === 'removed' ? now : null,
    moderationStatus === 'removed' ? (adminUsername || null) : null,
    moderationStatus === 'removed' ? (reason || null) : null,
    now,
    normalizeId(exchangeId),
    expectedStatus,
  );

  const updateReport = ({ reportId, status, action, resolution, expectedStatuses = ['pending', 'reviewing'], adminUsername, now }) => db.prepare(`
    UPDATE recruitment_reports
    SET status = ?, reviewed_at = ?, reviewed_by = ?, action = ?, resolution = ?
    WHERE id = ? AND status IN (?, ?)
  `).run(
    status,
    now,
    adminUsername || null,
    action || null,
    resolution || null,
    normalizeId(reportId),
    expectedStatuses[0],
    expectedStatuses[1],
  );

  const insertAudit = ({
    adminId,
    adminUsername,
    action,
    targetType,
    targetId,
    reportId,
    before,
    after,
    reason,
    ip,
    createdAt,
  }) => db.prepare(`
    INSERT INTO recruitment_admin_audit_logs (
      admin_id,
      admin_username,
      action,
      target_type,
      target_id,
      report_id,
      before_json,
      after_json,
      reason,
      ip,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    adminId || null,
    String(adminUsername || 'unknown-admin'),
    action,
    targetType,
    targetId,
    reportId || null,
    before ? JSON.stringify(before) : null,
    after ? JSON.stringify(after) : null,
    reason || null,
    ip || null,
    createdAt,
  );

  const runImmediateTransaction = (operation) => db.transaction(operation).immediate();

  return {
    getReport,
    listReports,
    getPost,
    getThread,
    getMessage,
    getContactExchange,
    isTargetAuthorizedByReport,
    updatePostModeration,
    updateThreadLock,
    updateMessageModeration,
    insertMessageModerationEvent,
    updateContactExchangeModeration,
    updateReport,
    insertAudit,
    runImmediateTransaction,
  };
};

export default createRecruitmentAdminRepository;
