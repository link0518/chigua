const normalizeIdentity = (value) => String(value || '').trim();

const normalizePage = (value, fallback, max) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.min(parsed, max);
};

const normalizeLimit = (value, fallback = 20, max = 100) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.min(parsed, max);
};

export const createRecruitmentRepository = (db) => {
  if (!db || typeof db.prepare !== 'function') {
    throw new TypeError('recruitment repository 需要 SQLite 数据库');
  }

  const getPost = (postId) => db.prepare(`
    SELECT *
    FROM recruitment_posts
    WHERE id = ?
  `).get(String(postId || '').trim());

  const listPosts = ({
    xinfaId = '',
    mineIdentityHash = '',
    viewerIdentityHash = '',
    status = '',
    page = 1,
    limit = 20,
  } = {}) => {
    const normalizedPage = normalizePage(page, 1, 1000000);
    const normalizedLimit = normalizeLimit(limit);
    const offset = (normalizedPage - 1) * normalizedLimit;
    const normalizedXinfaId = String(xinfaId || '').trim();
    const normalizedMineIdentity = String(mineIdentityHash || '').trim();
    const normalizedViewerIdentity = normalizeIdentity(viewerIdentityHash);
    const normalizedStatus = String(status || '').trim();
    const conditions = normalizedMineIdentity
      ? ['p.author_identity_hash = ?']
      : ["p.status = 'open'", "p.moderation_status = 'visible'"];
    const filterParams = normalizedMineIdentity ? [normalizedMineIdentity] : [];
    if (normalizedXinfaId) {
      conditions.push('p.xinfa_id = ?');
      filterParams.push(normalizedXinfaId);
    }
    if (normalizedMineIdentity && normalizedStatus) {
      conditions.push('p.status = ?');
      filterParams.push(normalizedStatus);
    }
    const filter = ` AND ${conditions.join(' AND ')}`;
    const total = Number(db.prepare(`
      SELECT COUNT(1) AS count
      FROM recruitment_posts p
      WHERE 1 = 1${filter}
    `).get(...filterParams)?.count || 0);
    const items = db.prepare(`
      SELECT
        p.id,
        p.author_identity_hash,
        p.xinfa_id,
        p.content,
        p.status,
        p.created_at,
        p.updated_at,
        (
          SELECT COUNT(1)
          FROM recruitment_threads post_thread
          WHERE post_thread.post_id = p.id
        ) AS thread_count,
        (
          SELECT viewer_thread.id
          FROM recruitment_threads viewer_thread
          WHERE viewer_thread.post_id = p.id
            AND viewer_thread.applicant_identity_hash = ?
          LIMIT 1
        ) AS viewer_thread_id
      FROM recruitment_posts p
      WHERE 1 = 1${filter}
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT ? OFFSET ?
    `).all(normalizedViewerIdentity, ...filterParams, normalizedLimit, offset);
    return { items, total, page: normalizedPage, limit: normalizedLimit };
  };

  const insertPost = ({ id, authorIdentityHash, xinfaId, content, createdAt }) => db.prepare(`
    INSERT INTO recruitment_posts (
      id, author_identity_hash, xinfa_id, content, status, moderation_status,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'open', 'visible', ?, ?)
  `).run(id, authorIdentityHash, xinfaId, content, createdAt, createdAt);

  const closePost = ({ postId, authorIdentityHash, now }) => db.prepare(`
    UPDATE recruitment_posts
    SET status = 'closed', updated_at = ?, closed_at = ?
    WHERE id = ? AND author_identity_hash = ? AND status = 'open'
  `).run(now, now, postId, authorIdentityHash);

  const getThread = (threadId) => db.prepare(`
    SELECT
      t.*,
      p.xinfa_id AS post_xinfa_id,
      p.content AS post_content,
      p.status AS post_status,
      p.moderation_status AS post_moderation_status,
      p.created_at AS post_created_at,
      p.author_identity_hash AS post_author_identity_hash
    FROM recruitment_threads t
    INNER JOIN recruitment_posts p ON p.id = t.post_id
    WHERE t.id = ?
  `).get(String(threadId || '').trim());

  const getThreadForMember = (threadId, identityHash) => {
    const normalizedIdentity = normalizeIdentity(identityHash);
    if (!normalizedIdentity) {
      return null;
    }
    return db.prepare(`
      SELECT
        t.*,
        p.xinfa_id AS post_xinfa_id,
        p.content AS post_content,
        p.status AS post_status,
        p.moderation_status AS post_moderation_status,
        p.created_at AS post_created_at,
        p.author_identity_hash AS post_author_identity_hash
      FROM recruitment_threads t
      INNER JOIN recruitment_posts p ON p.id = t.post_id
      WHERE t.id = ?
        AND (t.publisher_identity_hash = ? OR t.applicant_identity_hash = ?)
    `).get(threadId, normalizedIdentity, normalizedIdentity);
  };

  const findThreadByPostApplicant = (postId, applicantIdentityHash) => db.prepare(`
    SELECT *
    FROM recruitment_threads
    WHERE post_id = ? AND applicant_identity_hash = ?
  `).get(postId, applicantIdentityHash);

  const closeThread = ({ threadId, identityHash, now }) => db.prepare(`
    UPDATE recruitment_threads
    SET status = 'closed', updated_at = ?
    WHERE id = ?
      AND status = 'active'
      AND (publisher_identity_hash = ? OR applicant_identity_hash = ?)
  `).run(now, threadId, identityHash, identityHash);

  const closeThreadsByPost = ({ postId, now }) => db.prepare(`
    UPDATE recruitment_threads
    SET status = 'closed', updated_at = ?
    WHERE post_id = ? AND status = 'active'
  `).run(now, postId);

  const hasExpiredOpenPosts = ({ expiresBefore }) => Boolean(db.prepare(`
    SELECT 1
    FROM recruitment_posts
    WHERE status = 'open' AND created_at <= ?
    LIMIT 1
  `).get(expiresBefore));

  const closeExpiredRecruitments = ({ expiresBefore, now }) => {
    const normalizedCutoff = Number(expiresBefore);
    const normalizedNow = Number(now);
    if (!Number.isFinite(normalizedCutoff) || !Number.isFinite(normalizedNow)) {
      throw new TypeError('自动关闭招募需要有效时间');
    }
    return db.transaction(() => {
      const posts = db.prepare(`
        UPDATE recruitment_posts
        SET status = 'closed', updated_at = ?, closed_at = ?
        WHERE status = 'open' AND created_at <= ?
      `).run(normalizedNow, normalizedNow, normalizedCutoff);
      // 招募到期与关联密聊关闭必须处于同一事务，避免出现半关闭状态。
      const threads = db.prepare(`
        UPDATE recruitment_threads
        SET status = 'closed', updated_at = ?
        WHERE status = 'active'
          AND EXISTS (
            SELECT 1
            FROM recruitment_posts p
            WHERE p.id = recruitment_threads.post_id
              AND p.status = 'closed'
              AND p.created_at <= ?
          )
      `).run(normalizedNow, normalizedCutoff);
      return {
        postsClosed: Number(posts.changes || 0),
        threadsClosed: Number(threads.changes || 0),
      };
    }).immediate();
  };

  const insertThread = ({
    id,
    postId,
    publisherIdentityHash,
    applicantIdentityHash,
    applicantXinfaId,
    createdAt,
  }) => db.prepare(`
    INSERT INTO recruitment_threads (
      id, post_id, publisher_identity_hash, applicant_identity_hash,
      applicant_xinfa_id, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
  `).run(
    id,
    postId,
    publisherIdentityHash,
    applicantIdentityHash,
    applicantXinfaId,
    createdAt,
    createdAt,
  );

  const listThreads = ({ identityHash, status = '', page = 1, limit = 20 } = {}) => {
    const normalizedIdentity = normalizeIdentity(identityHash);
    const normalizedStatus = String(status || '').trim();
    const normalizedPage = normalizePage(page, 1, 1000000);
    const normalizedLimit = normalizeLimit(limit);
    const offset = (normalizedPage - 1) * normalizedLimit;
    const statusFilter = normalizedStatus ? ' AND t.status = ?' : '';
    const statusParams = normalizedStatus ? [normalizedStatus] : [];
    const total = Number(db.prepare(`
      SELECT COUNT(1) AS count
      FROM recruitment_threads t
      WHERE (t.publisher_identity_hash = ? OR t.applicant_identity_hash = ?)${statusFilter}
    `).get(normalizedIdentity, normalizedIdentity, ...statusParams)?.count || 0);
    const unreadCount = Number(db.prepare(`
      SELECT COUNT(1) AS count
      FROM recruitment_messages unread
      INNER JOIN recruitment_threads t ON t.id = unread.thread_id
      WHERE (
        t.publisher_identity_hash = ?
        AND unread.sender_identity_hash = t.applicant_identity_hash
        AND unread.seq > t.publisher_last_read_seq
      ) OR (
        t.applicant_identity_hash = ?
        AND unread.sender_identity_hash = t.publisher_identity_hash
        AND unread.seq > t.applicant_last_read_seq
      )
    `).get(normalizedIdentity, normalizedIdentity)?.count || 0);
    const items = db.prepare(`
      SELECT
        t.*,
        p.xinfa_id AS post_xinfa_id,
        p.content AS post_content,
        p.status AS post_status,
        p.moderation_status AS post_moderation_status,
        p.created_at AS post_created_at,
        CASE
          WHEN t.publisher_identity_hash = ? THEN (
            SELECT COUNT(1) FROM recruitment_messages unread
            WHERE unread.thread_id = t.id
              AND unread.sender_identity_hash = t.applicant_identity_hash
              AND unread.seq > t.publisher_last_read_seq
          )
          ELSE (
            SELECT COUNT(1) FROM recruitment_messages unread
            WHERE unread.thread_id = t.id
              AND unread.sender_identity_hash = t.publisher_identity_hash
              AND unread.seq > t.applicant_last_read_seq
          )
        END AS unread_count
      FROM recruitment_threads t
      INNER JOIN recruitment_posts p ON p.id = t.post_id
      WHERE (t.publisher_identity_hash = ? OR t.applicant_identity_hash = ?)${statusFilter}
      ORDER BY t.updated_at DESC, t.id DESC
      LIMIT ? OFFSET ?
    `).all(
      normalizedIdentity,
      normalizedIdentity,
      normalizedIdentity,
      ...statusParams,
      normalizedLimit,
      offset,
    );
    return { items, total, page: normalizedPage, limit: normalizedLimit, unreadCount };
  };

  const getExistingMessageByClientId = ({ threadId, senderIdentityHash, clientMsgId }) => db.prepare(`
    SELECT *
    FROM recruitment_messages
    WHERE thread_id = ? AND sender_identity_hash = ? AND client_msg_id = ?
    LIMIT 1
  `).get(threadId, senderIdentityHash, clientMsgId);

  const insertMessage = ({
    id,
    threadId,
    senderIdentityHash,
    clientMsgId,
    contentCiphertext,
    contentIv,
    contentAuthTag,
    cryptoVersion,
    createdAt,
  }) => {
    const result = db.prepare(`
      INSERT INTO recruitment_messages (
        id, thread_id, sender_identity_hash, client_msg_id,
        content_ciphertext, content_iv, content_auth_tag, crypto_version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      threadId,
      senderIdentityHash,
      clientMsgId,
      contentCiphertext,
      contentIv,
      contentAuthTag,
      cryptoVersion,
      createdAt,
    );
    db.prepare(`
      UPDATE recruitment_threads
      SET last_message_seq = ?, updated_at = ?
      WHERE id = ?
    `).run(Number(result.lastInsertRowid), createdAt, threadId);
    return Number(result.lastInsertRowid);
  };

  const getMessage = (messageId) => db.prepare(`
    SELECT m.*, t.post_id, t.publisher_identity_hash, t.applicant_identity_hash
    FROM recruitment_messages m
    INNER JOIN recruitment_threads t ON t.id = m.thread_id
    WHERE m.id = ?
  `).get(String(messageId || '').trim());

  const getMessageForMember = (messageId, identityHash) => db.prepare(`
    SELECT m.*, t.post_id, t.publisher_identity_hash, t.applicant_identity_hash
    FROM recruitment_messages m
    INNER JOIN recruitment_threads t ON t.id = m.thread_id
    WHERE m.id = ?
      AND (t.publisher_identity_hash = ? OR t.applicant_identity_hash = ?)
  `).get(String(messageId || '').trim(), identityHash, identityHash);

  const getMessageBySeq = (threadId, seq) => db.prepare(`
    SELECT *
    FROM recruitment_messages
    WHERE thread_id = ? AND seq = ?
  `).get(threadId, seq);

  const listMessages = ({ threadId, afterSeq = 0, beforeSeq = 0, limit = 50 } = {}) => {
    const normalizedAfter = Number.isSafeInteger(Number(afterSeq)) && Number(afterSeq) > 0 ? Number(afterSeq) : 0;
    const normalizedBefore = Number.isSafeInteger(Number(beforeSeq)) && Number(beforeSeq) > 0 ? Number(beforeSeq) : 0;
    const normalizedLimit = normalizeLimit(limit, 50, 100);
    let rows;
    let hasMore = false;
    if (normalizedAfter > 0) {
      rows = db.prepare(`
        SELECT * FROM recruitment_messages
        WHERE thread_id = ? AND seq > ?
        ORDER BY seq ASC
        LIMIT ?
      `).all(threadId, normalizedAfter, normalizedLimit + 1);
      hasMore = rows.length > normalizedLimit;
      rows = rows.slice(0, normalizedLimit);
    } else if (normalizedBefore > 0) {
      rows = db.prepare(`
        SELECT * FROM recruitment_messages
        WHERE thread_id = ? AND seq < ?
        ORDER BY seq DESC
        LIMIT ?
      `).all(threadId, normalizedBefore, normalizedLimit + 1);
      hasMore = rows.length > normalizedLimit;
      rows = rows.slice(0, normalizedLimit).reverse();
    } else {
      rows = db.prepare(`
        SELECT * FROM recruitment_messages
        WHERE thread_id = ?
        ORDER BY seq DESC
        LIMIT ?
      `).all(threadId, normalizedLimit + 1);
      hasMore = rows.length > normalizedLimit;
      rows = rows.slice(0, normalizedLimit).reverse();
    }
    return {
      items: rows,
      hasMore,
      nextAfterSeq: rows.length ? rows[rows.length - 1].seq : normalizedAfter,
      oldestSeq: rows.length ? rows[0].seq : null,
    };
  };

  const getMessageModerationCursor = (threadId) => Number(db.prepare(`
    SELECT COALESCE(MAX(seq), 0) AS cursor
    FROM recruitment_message_moderation_events
    WHERE thread_id = ?
  `).get(threadId)?.cursor || 0);

  const listMessageModerationChanges = ({ threadId, afterSeq = 0, limit = 100 } = {}) => {
    const normalizedAfter = Number.isSafeInteger(Number(afterSeq)) && Number(afterSeq) >= 0
      ? Number(afterSeq)
      : 0;
    const normalizedLimit = normalizeLimit(limit, 100, 100);
    const rows = db.prepare(`
      SELECT
        event.seq AS moderation_event_seq,
        m.*
      FROM recruitment_message_moderation_events event
      INNER JOIN recruitment_messages m ON m.id = event.message_id
      WHERE event.thread_id = ? AND event.seq > ?
      ORDER BY event.seq ASC
      LIMIT ?
    `).all(threadId, normalizedAfter, normalizedLimit + 1);
    const hasMore = rows.length > normalizedLimit;
    const items = rows.slice(0, normalizedLimit);
    return {
      items,
      hasMore,
      nextCursor: items.length
        ? Number(items[items.length - 1].moderation_event_seq)
        : normalizedAfter,
    };
  };

  const markThreadRead = ({ threadId, identityHash, seq }) => {
    const thread = getThreadForMember(threadId, identityHash);
    if (!thread) {
      return { changes: 0, thread: null };
    }
    const maxSeq = Number(db.prepare(
      'SELECT COALESCE(MAX(seq), 0) AS max_seq FROM recruitment_messages WHERE thread_id = ?'
    ).get(threadId)?.max_seq || 0);
    const requestedSeq = Number.isSafeInteger(Number(seq)) ? Math.max(0, Number(seq)) : maxSeq;
    const safeSeq = Math.min(requestedSeq, maxSeq);
    const isPublisher = thread.publisher_identity_hash === identityHash;
    const column = isPublisher ? 'publisher_last_read_seq' : 'applicant_last_read_seq';
    const result = db.prepare(`
      UPDATE recruitment_threads
      SET ${column} = ?
      WHERE id = ?
        AND (${isPublisher ? 'publisher_identity_hash' : 'applicant_identity_hash'} = ?)
        AND ${column} < ?
    `).run(safeSeq, threadId, identityHash, safeSeq);
    return { changes: result.changes, thread: getThread(threadId), seq: safeSeq };
  };

  const getExchange = (exchangeId) => db.prepare(`
    SELECT e.*, t.post_id, t.publisher_identity_hash, t.applicant_identity_hash
    FROM recruitment_contact_exchanges e
    INNER JOIN recruitment_threads t ON t.id = e.thread_id
    WHERE e.id = ?
  `).get(String(exchangeId || '').trim());

  const getExchangeForMember = (exchangeId, identityHash) => db.prepare(`
    SELECT e.*, t.post_id, t.publisher_identity_hash, t.applicant_identity_hash
    FROM recruitment_contact_exchanges e
    INNER JOIN recruitment_threads t ON t.id = e.thread_id
    WHERE e.id = ?
      AND (t.publisher_identity_hash = ? OR t.applicant_identity_hash = ?)
  `).get(String(exchangeId || '').trim(), identityHash, identityHash);

  const getExchangeForOwner = (threadId, ownerIdentityHash) => db.prepare(`
    SELECT * FROM recruitment_contact_exchanges
    WHERE thread_id = ? AND owner_identity_hash = ?
  `).get(threadId, ownerIdentityHash);

  const listExchanges = (threadId) => db.prepare(`
    SELECT
      e.id,
      e.thread_id,
      e.owner_identity_hash,
      e.payload_ciphertext,
      e.payload_iv,
      e.payload_auth_tag,
      e.crypto_version,
      e.status,
      e.moderation_status,
      e.created_at,
      e.updated_at,
      e.unlocked_at,
      e.deleted_at,
      e.deleted_by,
      e.deletion_reason,
      COUNT(c.identity_hash) AS consent_count
    FROM recruitment_contact_exchanges e
    LEFT JOIN recruitment_exchange_consents c ON c.exchange_id = e.id
    WHERE e.thread_id = ?
    GROUP BY e.id
    ORDER BY e.created_at ASC, e.id ASC
  `).all(threadId);

  const insertExchange = ({
    id,
    threadId,
    ownerIdentityHash,
    payloadCiphertext,
    payloadIv,
    payloadAuthTag,
    cryptoVersion,
    createdAt,
  }) => db.prepare(`
    INSERT INTO recruitment_contact_exchanges (
      id, thread_id, owner_identity_hash, payload_ciphertext, payload_iv,
      payload_auth_tag, crypto_version, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(
    id,
    threadId,
    ownerIdentityHash,
    payloadCiphertext,
    payloadIv,
    payloadAuthTag,
    cryptoVersion,
    createdAt,
    createdAt,
  );

  const updateExchangePayload = ({
    exchangeId,
    payloadCiphertext,
    payloadIv,
    payloadAuthTag,
    cryptoVersion,
    updatedAt,
  }) => db.prepare(`
    UPDATE recruitment_contact_exchanges
    SET payload_ciphertext = ?, payload_iv = ?, payload_auth_tag = ?,
        crypto_version = ?, status = 'pending', updated_at = ?, unlocked_at = NULL
    WHERE id = ?
  `).run(
    payloadCiphertext,
    payloadIv,
    payloadAuthTag,
    cryptoVersion,
    updatedAt,
    exchangeId,
  );

  const clearExchangeConsents = (exchangeId) => db.prepare(
    'DELETE FROM recruitment_exchange_consents WHERE exchange_id = ?'
  ).run(exchangeId);

  const upsertExchangeConsent = ({ exchangeId, identityHash, consentedAt }) => db.prepare(`
    INSERT INTO recruitment_exchange_consents (exchange_id, identity_hash, consented_at)
    VALUES (?, ?, ?)
    ON CONFLICT(exchange_id, identity_hash) DO UPDATE SET consented_at = excluded.consented_at
  `).run(exchangeId, identityHash, consentedAt);

  const getExchangeConsentCount = (exchangeId) => Number(db.prepare(`
    SELECT COUNT(1) AS count
    FROM recruitment_exchange_consents
    WHERE exchange_id = ?
      AND identity_hash IN (
        SELECT publisher_identity_hash FROM recruitment_threads t
        INNER JOIN recruitment_contact_exchanges e ON e.thread_id = t.id
        WHERE e.id = ?
        UNION
        SELECT applicant_identity_hash FROM recruitment_threads t
        INNER JOIN recruitment_contact_exchanges e ON e.thread_id = t.id
        WHERE e.id = ?
      )
  `).get(exchangeId, exchangeId, exchangeId)?.count || 0);

  const hasExchangeConsent = (exchangeId, identityHash) => Boolean(db.prepare(`
    SELECT 1
    FROM recruitment_exchange_consents
    WHERE exchange_id = ? AND identity_hash = ?
    LIMIT 1
  `).get(exchangeId, identityHash));

  const setExchangeUnlocked = ({ exchangeId, unlocked, now }) => db.prepare(`
    UPDATE recruitment_contact_exchanges
    SET status = ?, unlocked_at = ?, updated_at = ?
    WHERE id = ? AND moderation_status = 'visible'
  `).run(unlocked ? 'unlocked' : 'pending', unlocked ? now : null, now, exchangeId);

  const setThreadExchangesPending = ({ threadId, now }) => db.prepare(`
    UPDATE recruitment_contact_exchanges
    SET status = 'pending', unlocked_at = NULL, updated_at = ?
    WHERE thread_id = ? AND moderation_status = 'visible'
  `).run(now, threadId);

  const listNotifications = ({ identityHash, afterSeq = 0, page = 1, limit = 30 } = {}) => {
    const normalizedPage = normalizePage(page, 1, 1000000);
    const normalizedLimit = normalizeLimit(limit, 30, 100);
    const normalizedAfter = Number.isSafeInteger(Number(afterSeq)) && Number(afterSeq) > 0
      ? Number(afterSeq)
      : 0;
    const offset = normalizedAfter ? 0 : (normalizedPage - 1) * normalizedLimit;
    const afterClause = normalizedAfter ? ' AND seq > ?' : '';
    const order = normalizedAfter ? 'ASC' : 'DESC';
    const params = normalizedAfter
      ? [identityHash, normalizedAfter, normalizedLimit + 1, 0]
      : [identityHash, normalizedLimit + 1, offset];
    const rows = db.prepare(`
      SELECT seq, id, type, post_id, thread_id, exchange_id, created_at, read_at
      FROM recruitment_notifications
      WHERE recipient_identity_hash = ?
        AND type != 'recruitment_application'${afterClause}
      ORDER BY seq ${order}
      LIMIT ? OFFSET ?
    `).all(...params);
    const unreadCount = Number(db.prepare(`
      SELECT COUNT(1) AS count
      FROM recruitment_notifications
      WHERE recipient_identity_hash = ?
        AND type != 'recruitment_application'
        AND read_at IS NULL
    `).get(identityHash)?.count || 0);
    const hasMore = rows.length > normalizedLimit;
    return {
      items: rows.slice(0, normalizedLimit),
      hasMore,
      unreadCount,
      page: normalizedPage,
      limit: normalizedLimit,
      nextAfterSeq: rows.length
        ? Math.max(...rows.slice(0, normalizedLimit).map((row) => Number(row.seq)))
        : normalizedAfter,
    };
  };

  const insertNotification = ({ id, recipientIdentityHash, type, postId, threadId, exchangeId, createdAt }) => db.prepare(`
    INSERT INTO recruitment_notifications (
      id, recipient_identity_hash, type, post_id, thread_id, exchange_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, recipientIdentityHash, type, postId || null, threadId || null, exchangeId || null, createdAt);

  const markNotificationsRead = ({ identityHash, notificationIds = [], upToSeq = 0, now }) => {
    const ids = Array.from(new Set(notificationIds.map((id) => String(id || '').trim()).filter(Boolean)));
    let result = { changes: 0 };
    if (ids.length) {
      const placeholders = ids.map(() => '?').join(', ');
      result = db.prepare(`
        UPDATE recruitment_notifications
        SET read_at = COALESCE(read_at, ?)
        WHERE recipient_identity_hash = ? AND id IN (${placeholders})
      `).run(now, identityHash, ...ids);
    }
    const normalizedUpToSeq = Number.isSafeInteger(Number(upToSeq)) && Number(upToSeq) > 0
      ? Number(upToSeq)
      : 0;
    if (normalizedUpToSeq) {
      const rangeResult = db.prepare(`
        UPDATE recruitment_notifications
        SET read_at = COALESCE(read_at, ?)
        WHERE recipient_identity_hash = ? AND seq <= ?
      `).run(now, identityHash, normalizedUpToSeq);
      result = { changes: result.changes + rangeResult.changes };
    }
    return result;
  };

  const getReport = (reportId) => db.prepare(`
      SELECT * FROM recruitment_reports WHERE id = ?
  `).get(reportId);

  const getReportEvidence = (reportId) => db.prepare(`
    SELECT
      e.report_id,
      e.position,
      e.added_at,
      m.id,
      m.thread_id,
      m.sender_identity_hash,
      m.content_ciphertext,
      m.content_iv,
      m.content_auth_tag,
      m.crypto_version,
      m.moderation_status,
      m.deleted_at,
      m.created_at
    FROM recruitment_report_evidence e
    INNER JOIN recruitment_messages m ON m.id = e.message_id
    WHERE e.report_id = ?
    ORDER BY e.position ASC
  `).all(reportId);

  const insertReport = ({
    id,
    reporterIdentityHash,
    reportedIdentityHash,
    targetType,
    postId,
    threadId,
    messageId,
    contactExchangeId,
    reasonCode,
    detail,
    contactPayloadCiphertext,
    contactPayloadIv,
    contactPayloadAuthTag,
    contactCryptoVersion,
    contactWasUnlocked,
    createdAt,
  }) => db.prepare(`
    INSERT INTO recruitment_reports (
      id, reporter_identity_hash, reported_identity_hash, target_type,
      post_id, thread_id, message_id, contact_exchange_id, reason_code, detail,
      contact_payload_ciphertext, contact_payload_iv, contact_payload_auth_tag,
      contact_crypto_version, contact_was_unlocked, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    reporterIdentityHash,
    reportedIdentityHash,
    targetType,
    postId || null,
    threadId || null,
    messageId || null,
    contactExchangeId || null,
    reasonCode,
    detail || null,
    contactPayloadCiphertext || null,
    contactPayloadIv || null,
    contactPayloadAuthTag || null,
    contactCryptoVersion || null,
    contactWasUnlocked ? 1 : 0,
    createdAt,
  );

  const insertReportEvidence = ({ reportId, messageId, position, addedAt }) => db.prepare(`
    INSERT INTO recruitment_report_evidence (report_id, message_id, position, added_at)
    VALUES (?, ?, ?, ?)
  `).run(reportId, messageId, position, addedAt);

  const runInTransaction = (operation) => db.transaction(operation)();
  const runImmediateTransaction = (operation) => db.transaction(operation).immediate();

  return {
    getPost,
    listPosts,
    insertPost,
    closePost,
    getThread,
    getThreadForMember,
    findThreadByPostApplicant,
    closeThread,
    closeThreadsByPost,
    hasExpiredOpenPosts,
    closeExpiredRecruitments,
    insertThread,
    listThreads,
    getExistingMessageByClientId,
    insertMessage,
    getMessage,
    getMessageForMember,
    getMessageBySeq,
    listMessages,
    getMessageModerationCursor,
    listMessageModerationChanges,
    markThreadRead,
    getExchange,
    getExchangeForMember,
    getExchangeForOwner,
    listExchanges,
    insertExchange,
    updateExchangePayload,
    clearExchangeConsents,
    upsertExchangeConsent,
    getExchangeConsentCount,
    hasExchangeConsent,
    setExchangeUnlocked,
    setThreadExchangesPending,
    listNotifications,
    insertNotification,
    markNotificationsRead,
    getReport,
    getReportEvidence,
    insertReport,
    insertReportEvidence,
    runInTransaction,
    runImmediateTransaction,
  };
};

export default createRecruitmentRepository;
