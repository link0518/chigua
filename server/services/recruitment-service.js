import crypto from 'node:crypto';

import { recruitmentCatalog, RecruitmentCatalogError } from '../recruitment-catalog.js';

const POST_CONTENT_MAX_LENGTH = 100;
const RECRUITMENT_POST_LIFETIME_MS = 24 * 60 * 60 * 1000;
const MESSAGE_MAX_LENGTH = 100;
const CONTACT_VALUE_MAX_LENGTH = 300;
const CONTACT_LABEL_MAX_LENGTH = 40;
const REPORT_DETAIL_MAX_LENGTH = 1000;
const MAX_REPORT_EVIDENCE_MESSAGES = 20;
const CLIENT_MSG_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const CONTACT_TYPES = new Set(['qq', 'wechat', 'phone', 'email', 'game', 'other']);
const REPORT_REASONS = new Set(['spam', 'harassment', 'privacy', 'scam', 'other']);

export class RecruitmentServiceError extends Error {
  constructor(message, status = 400, code = 'invalid_request') {
    super(message);
    this.name = 'RecruitmentServiceError';
    this.status = status;
    this.code = code;
  }
}

const normalizeIdentity = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new RecruitmentServiceError('缺少匿名身份，请刷新后重试', 400, 'canonical_identity_required');
  }
  return normalized;
};

const normalizeText = (value, { field, maxLength, required = true }) => {
  const normalized = String(value ?? '').trim();
  if (required && !normalized) {
    throw new RecruitmentServiceError(`${field}不能为空`, 400, 'invalid_content');
  }
  if (normalized.length > maxLength) {
    throw new RecruitmentServiceError(`${field}超过长度限制`, 400, 'content_too_long');
  }
  return normalized;
};

const getMemberRole = (thread, identityHash) => {
  if (thread?.publisher_identity_hash === identityHash) {
    return 'publisher';
  }
  if (thread?.applicant_identity_hash === identityHash) {
    return 'applicant';
  }
  return '';
};

const getOtherMember = (thread, identityHash) => (
  thread.publisher_identity_hash === identityHash
    ? thread.applicant_identity_hash
    : thread.publisher_identity_hash
);

const getThreadWriteState = (thread) => {
  if (thread?.status !== 'active') {
    return { writable: false, reason: 'thread_closed' };
  }
  if (thread?.locked_at) {
    return { writable: false, reason: 'thread_locked' };
  }
  if (thread?.post_status !== 'open' || thread?.post_moderation_status !== 'visible') {
    return { writable: false, reason: 'post_unavailable' };
  }
  return { writable: true, reason: null };
};

const toXinfa = (catalog, xinfaId) => catalog.getById(xinfaId) || null;

const translateCatalogError = (error) => {
  if (error instanceof RecruitmentCatalogError) {
    throw new RecruitmentServiceError(error.message, 400, error.code);
  }
  throw error;
};

export const createRecruitmentService = ({
  repository,
  catalog = recruitmentCatalog,
  recruitmentCrypto,
  randomUUID = () => crypto.randomUUID(),
  now = () => Date.now(),
  onNotification,
} = {}) => {
  if (!repository) {
    throw new TypeError('recruitment service 需要 repository');
  }
  if (!catalog || typeof catalog.requireId !== 'function') {
    throw new TypeError('recruitment service 需要 DPS 心法目录');
  }
  if (
    !recruitmentCrypto
    || typeof recruitmentCrypto.encryptMessage !== 'function'
    || typeof recruitmentCrypto.decryptMessage !== 'function'
    || typeof recruitmentCrypto.encryptContact !== 'function'
    || typeof recruitmentCrypto.decryptContact !== 'function'
  ) {
    throw new TypeError('recruitment service 需要加密服务');
  }

  const requireXinfaId = (value) => {
    try {
      return catalog.requireId(value);
    } catch (error) {
      return translateCatalogError(error);
    }
  };

  const requirePost = (postId) => {
    const post = repository.getPost(String(postId || '').trim());
    if (!post) {
      throw new RecruitmentServiceError('招募不存在', 404, 'post_not_found');
    }
    return post;
  };

  const requireThreadMember = (threadId, identityHash) => {
    const normalizedIdentity = normalizeIdentity(identityHash);
    const thread = repository.getThreadForMember(String(threadId || '').trim(), normalizedIdentity);
    if (!thread) {
      // 不区分“会话不存在”和“不是成员”，避免泄露密聊存在性。
      throw new RecruitmentServiceError('会话不存在或无权访问', 404, 'thread_not_found');
    }
    return { thread, identityHash: normalizedIdentity, role: getMemberRole(thread, normalizedIdentity) };
  };

  const requireWritableThread = (threadId, identityHash) => {
    const context = requireThreadMember(threadId, identityHash);
    const writeState = getThreadWriteState(context.thread);
    if (!writeState.writable) {
      const messages = {
        thread_closed: '会话已关闭',
        thread_locked: '会话已被管理员锁定',
        post_unavailable: '关联招募当前不可用',
      };
      throw new RecruitmentServiceError(
        messages[writeState.reason] || '会话当前不可写',
        409,
        writeState.reason || 'thread_unavailable',
      );
    }
    return context;
  };

  const createNotification = ({ recipientIdentityHash, type, postId, threadId, exchangeId, createdAt }) => {
    const notification = {
      id: randomUUID(),
      recipientIdentityHash,
      type,
      postId: postId || null,
      threadId: threadId || null,
      exchangeId: exchangeId || null,
      createdAt,
    };
    repository.insertNotification(notification);
    return notification;
  };

  const emitNotifications = (notifications) => {
    if (typeof onNotification !== 'function') {
      return;
    }
    notifications.forEach((notification) => {
      // hook 只收到类型和资源 ID，禁止携带招募或密聊正文。
      void onNotification({ ...notification });
    });
  };

  const synchronizeExpiredRecruitments = () => {
    const synchronizedAt = now();
    const expiresBefore = synchronizedAt - RECRUITMENT_POST_LIFETIME_MS;
    // 无到期数据时保持纯读路径，避免密聊轮询反复获取 SQLite 写锁。
    if (!repository.hasExpiredOpenPosts({ expiresBefore })) {
      return { postsClosed: 0, threadsClosed: 0 };
    }
    return repository.closeExpiredRecruitments({ expiresBefore, now: synchronizedAt });
  };

  const mapPost = (post, viewerIdentityHash = '') => ({
    id: post.id,
    xinfaId: post.xinfa_id,
    xinfa: toXinfa(catalog, post.xinfa_id),
    content: post.content,
    status: post.status,
    createdAt: post.created_at,
    updatedAt: post.updated_at,
    threadCount: Number(post.thread_count || 0),
    isOwner: Boolean(viewerIdentityHash && post.author_identity_hash === viewerIdentityHash),
    // 只由按当前匿名身份过滤的查询返回，用于刷新后继续原有密聊。
    viewerThreadId: post.viewer_thread_id || null,
  });

  const mapThread = (thread, identityHash) => {
    const role = getMemberRole(thread, identityHash);
    const writeState = getThreadWriteState(thread);
    return {
      id: thread.id,
      postId: thread.post_id,
      role,
      status: thread.status,
      locked: Boolean(thread.locked_at),
      publisherXinfaId: thread.post_xinfa_id,
      publisherXinfa: toXinfa(catalog, thread.post_xinfa_id),
      applicantXinfaId: thread.applicant_xinfa_id,
      applicantXinfa: toXinfa(catalog, thread.applicant_xinfa_id),
      postContent: thread.post_content,
      postStatus: thread.post_status,
      postModerationStatus: thread.post_moderation_status,
      writable: writeState.writable,
      writeBlockedReason: writeState.reason,
      createdAt: thread.created_at,
      updatedAt: thread.updated_at,
      lastMessageSeq: Number(thread.last_message_seq || 0),
      unreadCount: Number(thread.unread_count || 0),
    };
  };

  const mapMessage = (row, thread, { includeRemoved = false } = {}) => {
    const removed = row.moderation_status === 'removed' || Boolean(row.deleted_at);
    if (removed && !includeRemoved) {
      return {
        id: row.id,
        seq: Number(row.seq),
        threadId: row.thread_id,
        senderRole: row.sender_identity_hash === thread.publisher_identity_hash ? 'publisher' : 'applicant',
        clientMsgId: row.client_msg_id,
        content: null,
        deleted: true,
        createdAt: row.created_at,
      };
    }
    let content;
    try {
      content = recruitmentCrypto.decryptMessage({
        ciphertext: row.content_ciphertext,
        iv: row.content_iv,
        authTag: row.content_auth_tag,
        cryptoVersion: row.crypto_version,
      });
    } catch (error) {
      console.error('招募密聊消息解密失败', {
        messageId: row.id,
        threadId: row.thread_id,
        error: error?.message || String(error),
      });
      throw new RecruitmentServiceError('消息暂时无法读取', 500, 'message_decryption_failed');
    }
    return {
      id: row.id,
      seq: Number(row.seq),
      threadId: row.thread_id,
      senderRole: row.sender_identity_hash === thread.publisher_identity_hash ? 'publisher' : 'applicant',
      clientMsgId: row.client_msg_id,
      content,
      deleted: removed,
      createdAt: row.created_at,
    };
  };

  const normalizeContact = (contact) => {
    const type = String(contact?.type || '').trim().toLowerCase();
    if (!CONTACT_TYPES.has(type)) {
      throw new RecruitmentServiceError('联系方式类型无效', 400, 'invalid_contact_type');
    }
    return {
      type,
      value: normalizeText(contact?.value, {
        field: '联系方式',
        maxLength: CONTACT_VALUE_MAX_LENGTH,
      }),
      label: normalizeText(contact?.label, {
        field: '联系方式备注',
        maxLength: CONTACT_LABEL_MAX_LENGTH,
        required: false,
      }),
    };
  };

  const decryptContact = (row) => {
    try {
      return JSON.parse(recruitmentCrypto.decryptContact({
        ciphertext: row.payload_ciphertext,
        iv: row.payload_iv,
        authTag: row.payload_auth_tag,
        cryptoVersion: row.crypto_version,
      }));
    } catch (error) {
      console.error('招募结构化联系方式解密失败', {
        exchangeId: row.id,
        threadId: row.thread_id,
        error: error?.message || String(error),
      });
      throw new RecruitmentServiceError('联系方式暂时无法读取', 500, 'contact_decryption_failed');
    }
  };

  const mapExchange = (row, thread, identityHash) => {
    const isOwner = row.owner_identity_hash === identityHash;
    const unlocked = row.status === 'unlocked';
    const removed = row.moderation_status === 'removed' || Boolean(row.deleted_at);
    return {
      id: row.id,
      threadId: row.thread_id,
      ownerRole: row.owner_identity_hash === thread.publisher_identity_hash ? 'publisher' : 'applicant',
      status: row.status,
      deleted: removed,
      consentCount: Number(row.consent_count ?? repository.getExchangeConsentCount(row.id)),
      consentedByMe: repository.hasExchangeConsent(row.id, identityHash),
      contact: !removed && (isOwner || unlocked) ? decryptContact(row) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      unlockedAt: row.unlocked_at,
    };
  };

  const mapNotification = (row) => ({
    seq: Number(row.seq || 0),
    id: row.id,
    type: row.type,
    postId: row.post_id || null,
    threadId: row.thread_id || null,
    exchangeId: row.exchange_id || null,
    createdAt: Number(row.created_at || 0),
    readAt: row.read_at == null ? null : Number(row.read_at),
  });

  const service = {
    getCatalog() {
      return {
        items: catalog.list(),
        optionCount: catalog.size,
        sourceRecordCount: catalog.sourceRecordCount,
      };
    },

    listPosts({ viewerIdentityHash = '', xinfaId = '', status = '', mine = false, page = 1, limit = 20 } = {}) {
      const normalizedXinfaId = String(xinfaId || '').trim();
      if (normalizedXinfaId) {
        requireXinfaId(normalizedXinfaId);
      }
      const normalizedViewerIdentity = String(viewerIdentityHash || '').trim();
      const mineIdentityHash = mine ? normalizeIdentity(normalizedViewerIdentity) : '';
      const normalizedStatus = mine ? String(status || '').trim() : '';
      if (normalizedStatus && !['open', 'closed'].includes(normalizedStatus)) {
        throw new RecruitmentServiceError('招募状态筛选无效', 400, 'invalid_post_status');
      }
      synchronizeExpiredRecruitments();
      const result = repository.listPosts({
        xinfaId: normalizedXinfaId,
        mineIdentityHash,
        viewerIdentityHash: normalizedViewerIdentity,
        status: normalizedStatus,
        page,
        limit,
      });
      return { ...result, items: result.items.map((row) => mapPost(row, viewerIdentityHash)) };
    },

    getPost({ postId, viewerIdentityHash = '' }) {
      synchronizeExpiredRecruitments();
      const post = requirePost(postId);
      const isOwner = Boolean(viewerIdentityHash && post.author_identity_hash === viewerIdentityHash);
      if (post.moderation_status !== 'visible' && !isOwner) {
        throw new RecruitmentServiceError('招募不存在', 404, 'post_not_found');
      }
      return mapPost(post, viewerIdentityHash);
    },

    createPost({ identityHash, xinfaId, content }) {
      const normalizedIdentity = normalizeIdentity(identityHash);
      const normalizedXinfaId = requireXinfaId(xinfaId);
      const normalizedContent = normalizeText(content, {
        field: '招募正文',
        maxLength: POST_CONTENT_MAX_LENGTH,
      });
      synchronizeExpiredRecruitments();
      const createdAt = now();
      const id = randomUUID();
      repository.insertPost({
        id,
        authorIdentityHash: normalizedIdentity,
        xinfaId: normalizedXinfaId,
        content: normalizedContent,
        createdAt,
      });
      return mapPost(repository.getPost(id), normalizedIdentity);
    },

    closePost({ postId, identityHash }) {
      const normalizedIdentity = normalizeIdentity(identityHash);
      synchronizeExpiredRecruitments();
      const closedAt = now();
      const post = repository.runImmediateTransaction(() => {
        const current = requirePost(postId);
        if (current.author_identity_hash !== normalizedIdentity) {
          throw new RecruitmentServiceError('无权关闭该招募', 403, 'post_owner_required');
        }
        if (current.status !== 'closed') {
          repository.closePost({
            postId: current.id,
            authorIdentityHash: normalizedIdentity,
            now: closedAt,
          });
        }
        // 已关闭招募也执行一次，修复历史上“招募已结束但会话仍 active”的不一致数据。
        repository.closeThreadsByPost({ postId: current.id, now: closedAt });
        return repository.getPost(current.id);
      });
      return mapPost(post, normalizedIdentity);
    },

    applyToPost({ postId, identityHash, xinfaId }) {
      const normalizedIdentity = normalizeIdentity(identityHash);
      const applicantXinfaId = requireXinfaId(xinfaId);
      synchronizeExpiredRecruitments();
      return repository.runImmediateTransaction(() => {
        const post = requirePost(postId);
        if (post.status !== 'open' || post.moderation_status !== 'visible') {
          throw new RecruitmentServiceError('该招募当前不可申请', 409, 'post_unavailable');
        }
        if (post.author_identity_hash === normalizedIdentity) {
          throw new RecruitmentServiceError('不能申请自己发布的招募', 409, 'self_application');
        }
        const existing = repository.findThreadByPostApplicant(post.id, normalizedIdentity);
        if (existing) {
          const thread = repository.getThread(existing.id);
          return { thread: mapThread(thread, normalizedIdentity), created: false };
        }
        const createdAt = now();
        const threadId = randomUUID();
        repository.insertThread({
          id: threadId,
          postId: post.id,
          publisherIdentityHash: post.author_identity_hash,
          applicantIdentityHash: normalizedIdentity,
          applicantXinfaId,
          createdAt,
        });
        return { thread: mapThread(repository.getThread(threadId), normalizedIdentity), created: true };
      });
    },

    listThreads({ identityHash, status = '', page = 1, limit = 20 }) {
      const normalizedIdentity = normalizeIdentity(identityHash);
      const normalizedStatus = String(status || '').trim();
      if (normalizedStatus && !['active', 'closed'].includes(normalizedStatus)) {
        throw new RecruitmentServiceError('密聊状态筛选无效', 400, 'invalid_thread_status');
      }
      synchronizeExpiredRecruitments();
      const result = repository.listThreads({
        identityHash: normalizedIdentity,
        status: normalizedStatus,
        page,
        limit,
      });
      return { ...result, items: result.items.map((row) => mapThread(row, normalizedIdentity)) };
    },

    getThread({ threadId, identityHash }) {
      synchronizeExpiredRecruitments();
      const context = requireThreadMember(threadId, identityHash);
      return mapThread(context.thread, context.identityHash);
    },

    closeThread({ threadId, identityHash }) {
      synchronizeExpiredRecruitments();
      const context = requireThreadMember(threadId, identityHash);
      if (context.thread.status !== 'closed') {
        repository.closeThread({
          threadId: context.thread.id,
          identityHash: context.identityHash,
          now: now(),
        });
      }
      return mapThread(repository.getThread(context.thread.id), context.identityHash);
    },

    getExistingMessageForSender({ threadId, identityHash, clientMsgId }) {
      synchronizeExpiredRecruitments();
      const context = requireThreadMember(threadId, identityHash);
      const normalizedClientMsgId = String(clientMsgId || '').trim();
      if (!CLIENT_MSG_ID_PATTERN.test(normalizedClientMsgId)) {
        throw new RecruitmentServiceError('clientMsgId 无效', 400, 'invalid_client_msg_id');
      }
      const existing = repository.getExistingMessageByClientId({
        threadId: context.thread.id,
        senderIdentityHash: context.identityHash,
        clientMsgId: normalizedClientMsgId,
      });
      return existing ? mapMessage(existing, context.thread) : null;
    },

    sendMessage({ threadId, identityHash, clientMsgId, content }) {
      synchronizeExpiredRecruitments();
      const context = requireWritableThread(threadId, identityHash);
      const normalizedClientMsgId = String(clientMsgId || '').trim();
      if (!CLIENT_MSG_ID_PATTERN.test(normalizedClientMsgId)) {
        throw new RecruitmentServiceError('clientMsgId 无效', 400, 'invalid_client_msg_id');
      }
      const normalizedContent = normalizeText(content, {
        field: '消息',
        maxLength: MESSAGE_MAX_LENGTH,
      });
      const existing = repository.getExistingMessageByClientId({
        threadId: context.thread.id,
        senderIdentityHash: context.identityHash,
        clientMsgId: normalizedClientMsgId,
      });
      if (existing) {
        return { message: mapMessage(existing, context.thread), created: false };
      }
      const encrypted = recruitmentCrypto.encryptMessage(normalizedContent);
      const notifications = [];
      try {
        const result = repository.runImmediateTransaction(() => {
          // 事务内再次校验成员和幂等键，覆盖并发重试与会话状态变化。
          const fresh = requireWritableThread(context.thread.id, context.identityHash);
          const duplicate = repository.getExistingMessageByClientId({
            threadId: fresh.thread.id,
            senderIdentityHash: fresh.identityHash,
            clientMsgId: normalizedClientMsgId,
          });
          if (duplicate) {
            return { message: mapMessage(duplicate, fresh.thread), created: false };
          }
          const createdAt = now();
          const messageId = randomUUID();
          const seq = repository.insertMessage({
            id: messageId,
            threadId: fresh.thread.id,
            senderIdentityHash: fresh.identityHash,
            clientMsgId: normalizedClientMsgId,
            contentCiphertext: encrypted.ciphertext,
            contentIv: encrypted.iv,
            contentAuthTag: encrypted.authTag,
            cryptoVersion: encrypted.cryptoVersion,
            createdAt,
          });
          notifications.push(createNotification({
            recipientIdentityHash: getOtherMember(fresh.thread, fresh.identityHash),
            type: 'recruitment_message',
            postId: fresh.thread.post_id,
            threadId: fresh.thread.id,
            createdAt,
          }));
          const row = repository.getMessageBySeq(fresh.thread.id, seq);
          return { message: mapMessage(row, fresh.thread), created: true };
        });
        emitNotifications(notifications);
        return result;
      } catch (error) {
        if (String(error?.code || '').includes('SQLITE_CONSTRAINT')) {
          const duplicate = repository.getExistingMessageByClientId({
            threadId: context.thread.id,
            senderIdentityHash: context.identityHash,
            clientMsgId: normalizedClientMsgId,
          });
          if (duplicate) {
            return { message: mapMessage(duplicate, context.thread), created: false };
          }
        }
        throw error;
      }
    },

    listMessages({
      threadId,
      identityHash,
      afterSeq = 0,
      beforeSeq = 0,
      afterModerationSeq,
      includeContactExchanges = false,
      limit = 50,
    }) {
      synchronizeExpiredRecruitments();
      const context = requireThreadMember(threadId, identityHash);
      if (Number(afterSeq) > 0 && Number(beforeSeq) > 0) {
        throw new RecruitmentServiceError('afterSeq 与 beforeSeq 不能同时使用', 400, 'invalid_cursor');
      }
      const hasModerationCursor = afterModerationSeq !== undefined
        && afterModerationSeq !== null
        && String(afterModerationSeq).trim() !== '';
      const currentModerationCursor = repository.getMessageModerationCursor(context.thread.id);
      const moderationChanges = hasModerationCursor
        ? repository.listMessageModerationChanges({
          threadId: context.thread.id,
          afterSeq: afterModerationSeq,
        })
        : {
          items: [],
          hasMore: false,
          nextCursor: currentModerationCursor,
        };
      const result = repository.listMessages({ threadId: context.thread.id, afterSeq, beforeSeq, limit });
      const contactExchanges = includeContactExchanges
        ? repository.listExchanges(context.thread.id)
          .map((row) => mapExchange(row, context.thread, context.identityHash))
        : undefined;
      return {
        ...result,
        thread: mapThread(context.thread, context.identityHash),
        items: result.items.map((row) => mapMessage(row, context.thread)),
        moderationItems: moderationChanges.items.map((row) => mapMessage(row, context.thread)),
        moderationCursor: moderationChanges.nextCursor,
        moderationHasMore: moderationChanges.hasMore,
        ...(contactExchanges ? { contactExchanges } : {}),
      };
    },

    markThreadRead({ threadId, identityHash, lastMessageSeq }) {
      synchronizeExpiredRecruitments();
      const context = requireThreadMember(threadId, identityHash);
      const result = repository.markThreadRead({
        threadId: context.thread.id,
        identityHash: context.identityHash,
        seq: lastMessageSeq,
      });
      return { threadId: context.thread.id, lastReadSeq: result.seq };
    },

    putContactExchange({ threadId, identityHash, contact }) {
      synchronizeExpiredRecruitments();
      const context = requireWritableThread(threadId, identityHash);
      const normalizedContact = normalizeContact(contact);
      const encrypted = recruitmentCrypto.encryptContact(JSON.stringify(normalizedContact));
      const notifications = [];
      const result = repository.runImmediateTransaction(() => {
        const fresh = requireWritableThread(context.thread.id, context.identityHash);
        const updatedAt = now();
        let row = repository.getExchangeForOwner(fresh.thread.id, fresh.identityHash);
        const existed = Boolean(row);
        if (row) {
          if (row.moderation_status === 'removed' || row.deleted_at) {
            throw new RecruitmentServiceError('联系方式已被移除，暂不可重新提交', 409, 'exchange_removed');
          }
          repository.updateExchangePayload({
            exchangeId: row.id,
            payloadCiphertext: encrypted.ciphertext,
            payloadIv: encrypted.iv,
            payloadAuthTag: encrypted.authTag,
            cryptoVersion: encrypted.cryptoVersion,
            updatedAt,
          });
          repository.clearExchangeConsents(row.id);
        } else {
          const exchangeId = randomUUID();
          repository.insertExchange({
            id: exchangeId,
            threadId: fresh.thread.id,
            ownerIdentityHash: fresh.identityHash,
            payloadCiphertext: encrypted.ciphertext,
            payloadIv: encrypted.iv,
            payloadAuthTag: encrypted.authTag,
            cryptoVersion: encrypted.cryptoVersion,
            createdAt: updatedAt,
          });
          row = repository.getExchange(exchangeId);
        }
        repository.setThreadExchangesPending({ threadId: fresh.thread.id, now: updatedAt });
        // 提交自己的联系方式即表示本人同意本次具体密文，修改内容后旧同意会被清空。
        repository.upsertExchangeConsent({
          exchangeId: row.id,
          identityHash: fresh.identityHash,
          consentedAt: updatedAt,
        });
        const otherIdentityHash = getOtherMember(fresh.thread, fresh.identityHash);
        const otherExchange = repository.getExchangeForOwner(fresh.thread.id, otherIdentityHash);
        let unlocked = false;
        // 第二位成员首次提交联系方式时，双方此前的提交共同构成对本次交换的同意。
        if (
          !existed
          && otherExchange
          && otherExchange.moderation_status !== 'removed'
          && !otherExchange.deleted_at
        ) {
          [row, otherExchange].forEach((exchangeRow) => {
            [fresh.thread.publisher_identity_hash, fresh.thread.applicant_identity_hash].forEach((memberIdentityHash) => {
              repository.upsertExchangeConsent({
                exchangeId: exchangeRow.id,
                identityHash: memberIdentityHash,
                consentedAt: updatedAt,
              });
            });
            repository.setExchangeUnlocked({ exchangeId: exchangeRow.id, unlocked: true, now: updatedAt });
          });
          unlocked = true;
        }
        notifications.push(createNotification({
          recipientIdentityHash: otherIdentityHash,
          type: unlocked ? 'recruitment_contact_unlocked' : 'recruitment_contact_proposed',
          postId: fresh.thread.post_id,
          threadId: fresh.thread.id,
          exchangeId: row.id,
          createdAt: updatedAt,
        }));
        if (unlocked) {
          notifications.push(createNotification({
            recipientIdentityHash: fresh.identityHash,
            type: 'recruitment_contact_unlocked',
            postId: fresh.thread.post_id,
            threadId: fresh.thread.id,
            exchangeId: row.id,
            createdAt: updatedAt,
          }));
        }
        const items = repository.listExchanges(fresh.thread.id)
          .map((exchangeRow) => mapExchange(exchangeRow, fresh.thread, fresh.identityHash));
        return { items, exchange: items.find((item) => item.id === row.id) || null };
      });
      emitNotifications(notifications);
      return result;
    },

    listContactExchanges({ threadId, identityHash }) {
      synchronizeExpiredRecruitments();
      const context = requireThreadMember(threadId, identityHash);
      return repository.listExchanges(context.thread.id)
        .map((row) => mapExchange(row, context.thread, context.identityHash));
    },

    consentToContactExchange({ exchangeId, identityHash, contact }) {
      const normalizedIdentity = normalizeIdentity(identityHash);
      const normalizedContact = normalizeContact(contact);
      synchronizeExpiredRecruitments();
      const encrypted = recruitmentCrypto.encryptContact(JSON.stringify(normalizedContact));
      const notifications = [];
      const result = repository.runImmediateTransaction(() => {
        const exchange = repository.getExchange(exchangeId);
        if (!exchange) {
          throw new RecruitmentServiceError('联系方式交换不存在', 404, 'exchange_not_found');
        }
        const context = requireWritableThread(exchange.thread_id, normalizedIdentity);
        if (exchange.moderation_status === 'removed' || exchange.deleted_at) {
          throw new RecruitmentServiceError('联系方式交换已被移除', 409, 'exchange_removed');
        }
        if (exchange.owner_identity_hash === normalizedIdentity) {
          throw new RecruitmentServiceError('请等待对方确认联系方式交换', 409, 'counterparty_consent_required');
        }
        const consentedAt = now();
        let ownExchange = repository.getExchangeForOwner(context.thread.id, normalizedIdentity);
        if (ownExchange) {
          if (ownExchange.moderation_status === 'removed' || ownExchange.deleted_at) {
            throw new RecruitmentServiceError('联系方式已被移除，暂不可重新提交', 409, 'exchange_removed');
          }
          repository.updateExchangePayload({
            exchangeId: ownExchange.id,
            payloadCiphertext: encrypted.ciphertext,
            payloadIv: encrypted.iv,
            payloadAuthTag: encrypted.authTag,
            cryptoVersion: encrypted.cryptoVersion,
            updatedAt: consentedAt,
          });
          repository.clearExchangeConsents(ownExchange.id);
        } else {
          const ownExchangeId = randomUUID();
          repository.insertExchange({
            id: ownExchangeId,
            threadId: context.thread.id,
            ownerIdentityHash: normalizedIdentity,
            payloadCiphertext: encrypted.ciphertext,
            payloadIv: encrypted.iv,
            payloadAuthTag: encrypted.authTag,
            cryptoVersion: encrypted.cryptoVersion,
            createdAt: consentedAt,
          });
          ownExchange = repository.getExchange(ownExchangeId);
        }
        const exchanges = [repository.getExchange(exchange.id), repository.getExchange(ownExchange.id)];
        exchanges.forEach((exchangeRow) => {
          [context.thread.publisher_identity_hash, context.thread.applicant_identity_hash].forEach((memberIdentityHash) => {
            repository.upsertExchangeConsent({
              exchangeId: exchangeRow.id,
              identityHash: memberIdentityHash,
              consentedAt,
            });
          });
          repository.setExchangeUnlocked({ exchangeId: exchangeRow.id, unlocked: true, now: consentedAt });
        });
        [context.thread.publisher_identity_hash, context.thread.applicant_identity_hash].forEach((recipientIdentityHash) => {
          notifications.push(createNotification({
            recipientIdentityHash,
            type: 'recruitment_contact_unlocked',
            postId: context.thread.post_id,
            threadId: context.thread.id,
            exchangeId: exchange.id,
            createdAt: consentedAt,
          }));
        });
        return {
          changed: true,
          items: repository.listExchanges(context.thread.id)
            .map((row) => mapExchange(row, context.thread, normalizedIdentity)),
        };
      });
      emitNotifications(notifications);
      return result;
    },

    listNotifications({ identityHash, afterSeq = 0, page = 1, limit = 30 }) {
      const normalizedIdentity = normalizeIdentity(identityHash);
      const result = repository.listNotifications({
        identityHash: normalizedIdentity,
        afterSeq,
        page,
        limit,
      });
      return { ...result, items: result.items.map(mapNotification) };
    },

    markNotificationsRead({ identityHash, notificationIds = [], upToSeq = 0 }) {
      const normalizedIdentity = normalizeIdentity(identityHash);
      const ids = Array.isArray(notificationIds) ? notificationIds : [];
      if (ids.length > 100) {
        throw new RecruitmentServiceError('单次最多标记 100 条通知', 400, 'too_many_notifications');
      }
      const result = repository.markNotificationsRead({
        identityHash: normalizedIdentity,
        notificationIds: ids,
        upToSeq,
        now: now(),
      });
      return { updated: result.changes };
    },

    submitReport({
      identityHash,
      targetType,
      targetId,
      reasonCode,
      detail = '',
      evidenceMessageIds = [],
    }) {
      const reporterIdentityHash = normalizeIdentity(identityHash);
      const normalizedTargetType = String(targetType || '').trim();
      const normalizedTargetId = String(targetId || '').trim();
      const normalizedReasonCode = String(reasonCode || '').trim().toLowerCase();
      if (!['post', 'thread', 'message', 'contact_exchange'].includes(normalizedTargetType) || !normalizedTargetId) {
        throw new RecruitmentServiceError('举报目标无效', 400, 'invalid_report_target');
      }
      if (!REPORT_REASONS.has(normalizedReasonCode)) {
        throw new RecruitmentServiceError('举报原因无效', 400, 'invalid_report_reason');
      }
      synchronizeExpiredRecruitments();
      const normalizedDetail = normalizeText(detail, {
        field: '举报说明',
        maxLength: REPORT_DETAIL_MAX_LENGTH,
        required: normalizedReasonCode === 'other',
      });
      const suppliedEvidenceIds = Array.isArray(evidenceMessageIds) ? evidenceMessageIds : [];
      const uniqueEvidenceIds = Array.from(new Set(
        suppliedEvidenceIds.map((id) => String(id || '').trim()).filter(Boolean)
      ));
      if (uniqueEvidenceIds.length > MAX_REPORT_EVIDENCE_MESSAGES) {
        throw new RecruitmentServiceError('举报证据消息过多', 400, 'too_many_evidence_messages');
      }

      return repository.runImmediateTransaction(() => {
        let postId = null;
        let threadId = null;
        let messageId = null;
        let reportedIdentityHash = '';
        let evidenceIds = uniqueEvidenceIds;

        let contactExchangeId = null;
        let contactSnapshot = null;
        if (normalizedTargetType === 'post') {
          const post = requirePost(normalizedTargetId);
          postId = post.id;
          reportedIdentityHash = post.author_identity_hash;
          if (evidenceIds.length) {
            throw new RecruitmentServiceError('招募举报不能附带密聊证据', 400, 'invalid_report_evidence');
          }
        } else if (normalizedTargetType === 'thread') {
          const context = requireThreadMember(normalizedTargetId, reporterIdentityHash);
          postId = context.thread.post_id;
          threadId = context.thread.id;
          reportedIdentityHash = getOtherMember(context.thread, reporterIdentityHash);
          if (!evidenceIds.length) {
            throw new RecruitmentServiceError('举报会话时请至少选择一条证据消息', 400, 'evidence_required');
          }
        } else if (normalizedTargetType === 'message') {
          const message = repository.getMessageForMember(normalizedTargetId, reporterIdentityHash);
          if (!message) {
            throw new RecruitmentServiceError('举报消息不存在或无权访问', 404, 'message_not_found');
          }
          const context = requireThreadMember(message.thread_id, reporterIdentityHash);
          postId = message.post_id;
          threadId = message.thread_id;
          messageId = message.id;
          reportedIdentityHash = message.sender_identity_hash;
          evidenceIds = Array.from(new Set([message.id, ...evidenceIds]));
          if (evidenceIds.length > MAX_REPORT_EVIDENCE_MESSAGES) {
            throw new RecruitmentServiceError('举报证据消息过多', 400, 'too_many_evidence_messages');
          }
        } else {
          const exchange = repository.getExchangeForMember(normalizedTargetId, reporterIdentityHash);
          if (!exchange) {
            throw new RecruitmentServiceError('联系方式交换不存在或无权访问', 404, 'exchange_not_found');
          }
          const context = requireThreadMember(exchange.thread_id, reporterIdentityHash);
          if (exchange.owner_identity_hash === reporterIdentityHash) {
            throw new RecruitmentServiceError('不能举报自己的联系方式', 409, 'self_report');
          }
          if (exchange.status !== 'unlocked') {
            throw new RecruitmentServiceError('联系方式尚未完成交换，不能单独举报', 409, 'contact_not_unlocked');
          }
          postId = context.thread.post_id;
          threadId = context.thread.id;
          contactExchangeId = exchange.id;
          reportedIdentityHash = exchange.owner_identity_hash;
          // 联系方式可以被拥有者后续修改，因此举报时复制一份加密快照，
          // 防止后台查看前原始证据被覆盖；数据库中仍不会出现明文。
          contactSnapshot = {
            ciphertext: exchange.payload_ciphertext,
            iv: exchange.payload_iv,
            authTag: exchange.payload_auth_tag,
            cryptoVersion: exchange.crypto_version,
          };
          if (evidenceIds.length) {
            throw new RecruitmentServiceError('联系方式举报无需附带消息证据', 400, 'invalid_report_evidence');
          }
        }

        if (reportedIdentityHash === reporterIdentityHash) {
          throw new RecruitmentServiceError('不能举报自己', 409, 'self_report');
        }

        const evidenceRows = evidenceIds.map((id) => {
          const message = repository.getMessage(id);
          if (!message || message.thread_id !== threadId) {
            throw new RecruitmentServiceError('举报证据不属于目标会话', 400, 'invalid_report_evidence');
          }
          return message;
        });
        if (
          normalizedTargetType === 'thread'
          && !evidenceRows.some((message) => message.sender_identity_hash === reportedIdentityHash)
        ) {
          throw new RecruitmentServiceError(
            '会话举报至少需要一条对方发送的消息作为证据',
            400,
            'reported_party_evidence_required',
          );
        }
        const createdAt = now();
        const reportId = randomUUID();
        repository.insertReport({
          id: reportId,
          reporterIdentityHash,
          reportedIdentityHash,
          targetType: normalizedTargetType,
          postId,
          threadId,
          messageId,
          contactExchangeId,
          reasonCode: normalizedReasonCode,
          detail: normalizedDetail,
          contactPayloadCiphertext: contactSnapshot?.ciphertext,
          contactPayloadIv: contactSnapshot?.iv,
          contactPayloadAuthTag: contactSnapshot?.authTag,
          contactCryptoVersion: contactSnapshot?.cryptoVersion,
          contactWasUnlocked: Boolean(contactSnapshot),
          createdAt,
        });
        evidenceRows.forEach((message, position) => {
          repository.insertReportEvidence({
            reportId,
            messageId: message.id,
            position,
            addedAt: createdAt,
          });
        });
        return {
          id: reportId,
          targetType: normalizedTargetType,
          targetId: normalizedTargetId,
          status: 'pending',
          evidenceCount: evidenceRows.length,
          createdAt,
        };
      });
    },

    /**
     * 仅供已鉴权后台路由使用。它只能按 reportId 解密证据白名单，不能按 threadId 浏览密聊。
     */
    getReportEvidenceForAdmin({ reportId, includeContact = false }) {
      const report = repository.getReport(String(reportId || '').trim());
      if (!report) {
        throw new RecruitmentServiceError('举报不存在', 404, 'report_not_found');
      }
      const evidence = repository.getReportEvidence(report.id).map((row) => {
        const thread = repository.getThread(row.thread_id);
        return {
          id: row.id,
          position: row.position,
          threadId: row.thread_id,
          senderRole: row.sender_identity_hash === thread?.publisher_identity_hash ? 'publisher' : 'applicant',
          isReportedParty: row.sender_identity_hash === report.reported_identity_hash,
          moderationStatus: row.moderation_status,
          deleted: row.moderation_status === 'removed' || Boolean(row.deleted_at),
          content: mapMessage(row, {
            publisher_identity_hash: thread?.publisher_identity_hash,
          }, { includeRemoved: true }).content,
          createdAt: row.created_at,
        };
      });
      let contact = null;
      if (report.target_type === 'contact_exchange' && report.contact_exchange_id) {
        const exchange = repository.getExchange(report.contact_exchange_id);
        const snapshot = report.contact_was_unlocked && report.contact_payload_ciphertext
          ? {
            payload_ciphertext: report.contact_payload_ciphertext,
            payload_iv: report.contact_payload_iv,
            payload_auth_tag: report.contact_payload_auth_tag,
            crypto_version: report.contact_crypto_version,
            id: report.contact_exchange_id,
            thread_id: report.thread_id,
          }
          : null;
        contact = {
          exchangeId: report.contact_exchange_id,
          threadId: report.thread_id,
          ownerIdentityHash: exchange?.owner_identity_hash || report.reported_identity_hash,
          status: exchange?.status || null,
          deleted: Boolean(exchange?.deleted_at || exchange?.moderation_status === 'removed'),
          contact: includeContact && snapshot
            ? decryptContact(snapshot)
            : null,
        };
      }
      return { report, evidence, contact };
    },
  };

  return service;
};

export default createRecruitmentService;
