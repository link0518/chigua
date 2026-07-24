import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { createRecruitmentCrypto } from '../recruitment-crypto.js';
import { createRecruitmentRepository } from '../repositories/recruitment-repository.js';
import {
  createRecruitmentService,
  RecruitmentServiceError,
} from '../services/recruitment-service.js';

const createDb = () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE recruitment_posts (
      id TEXT PRIMARY KEY,
      author_identity_hash TEXT NOT NULL,
      xinfa_id TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      moderation_status TEXT NOT NULL DEFAULT 'visible',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      closed_at INTEGER,
      moderated_at INTEGER,
      moderated_by TEXT,
      moderation_reason TEXT
    );
    CREATE TABLE recruitment_threads (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      publisher_identity_hash TEXT NOT NULL,
      applicant_identity_hash TEXT NOT NULL,
      applicant_xinfa_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_message_seq INTEGER NOT NULL DEFAULT 0,
      publisher_last_read_seq INTEGER NOT NULL DEFAULT 0,
      applicant_last_read_seq INTEGER NOT NULL DEFAULT 0,
      locked_at INTEGER,
      locked_by TEXT,
      lock_reason TEXT,
      UNIQUE (post_id, applicant_identity_hash),
      FOREIGN KEY (post_id) REFERENCES recruitment_posts(id) ON DELETE CASCADE
    );
    CREATE TABLE recruitment_messages (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      thread_id TEXT NOT NULL,
      sender_identity_hash TEXT NOT NULL,
      client_msg_id TEXT NOT NULL,
      content_ciphertext TEXT NOT NULL,
      content_iv TEXT NOT NULL,
      content_auth_tag TEXT NOT NULL,
      crypto_version INTEGER NOT NULL DEFAULT 1,
      moderation_status TEXT NOT NULL DEFAULT 'visible',
      deleted_at INTEGER,
      deleted_by TEXT,
      deletion_reason TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE (thread_id, sender_identity_hash, client_msg_id),
      FOREIGN KEY (thread_id) REFERENCES recruitment_threads(id) ON DELETE CASCADE
    );
    CREATE TABLE recruitment_message_moderation_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      moderation_status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (message_id) REFERENCES recruitment_messages(id) ON DELETE CASCADE,
      FOREIGN KEY (thread_id) REFERENCES recruitment_threads(id) ON DELETE CASCADE
    );
    CREATE TABLE recruitment_contact_exchanges (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      owner_identity_hash TEXT NOT NULL,
      payload_ciphertext TEXT NOT NULL,
      payload_iv TEXT NOT NULL,
      payload_auth_tag TEXT NOT NULL,
      crypto_version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'pending',
      moderation_status TEXT NOT NULL DEFAULT 'visible',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      unlocked_at INTEGER,
      deleted_at INTEGER,
      deleted_by TEXT,
      deletion_reason TEXT,
      UNIQUE (thread_id, owner_identity_hash),
      FOREIGN KEY (thread_id) REFERENCES recruitment_threads(id) ON DELETE CASCADE
    );
    CREATE TABLE recruitment_exchange_consents (
      exchange_id TEXT NOT NULL,
      identity_hash TEXT NOT NULL,
      consented_at INTEGER NOT NULL,
      PRIMARY KEY (exchange_id, identity_hash),
      FOREIGN KEY (exchange_id) REFERENCES recruitment_contact_exchanges(id) ON DELETE CASCADE
    );
    CREATE TABLE recruitment_notifications (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      recipient_identity_hash TEXT NOT NULL,
      type TEXT NOT NULL,
      post_id TEXT,
      thread_id TEXT,
      exchange_id TEXT,
      created_at INTEGER NOT NULL,
      read_at INTEGER
    );
    CREATE TABLE recruitment_reports (
      id TEXT PRIMARY KEY,
      reporter_identity_hash TEXT NOT NULL,
      reported_identity_hash TEXT NOT NULL,
      target_type TEXT NOT NULL,
      post_id TEXT,
      thread_id TEXT,
      message_id TEXT,
      contact_exchange_id TEXT,
      reason_code TEXT NOT NULL,
      detail TEXT,
      contact_payload_ciphertext TEXT,
      contact_payload_iv TEXT,
      contact_payload_auth_tag TEXT,
      contact_crypto_version INTEGER,
      contact_was_unlocked INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      reviewed_at INTEGER,
      reviewed_by TEXT,
      resolution TEXT,
      action TEXT
    );
    CREATE TABLE recruitment_report_evidence (
      report_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      added_at INTEGER NOT NULL,
      PRIMARY KEY (report_id, message_id),
      UNIQUE (report_id, position),
      FOREIGN KEY (report_id) REFERENCES recruitment_reports(id) ON DELETE CASCADE,
      FOREIGN KEY (message_id) REFERENCES recruitment_messages(id) ON DELETE RESTRICT
    );
  `);
  return db;
};

const createHarness = ({ now: nowOverride } = {}) => {
  const db = createDb();
  const repository = createRecruitmentRepository(db);
  let id = 0;
  let timestamp = 1000;
  const service = createRecruitmentService({
    repository,
    recruitmentCrypto: createRecruitmentCrypto({ sessionSecret: 'service-test-secret' }),
    randomUUID: () => `generated-${++id}`,
    now: nowOverride || (() => ++timestamp),
  });
  return { db, repository, service };
};

const createThread = (service) => {
  const post = service.createPost({
    identityHash: 'publisher-canonical',
    xinfaId: '10003',
    content: '来一个稳定队友',
  });
  const application = service.applyToPost({
    postId: post.id,
    identityHash: 'applicant-canonical',
    xinfaId: '10015',
  });
  return { post, thread: application.thread };
};

test('招募正文和密聊消息最多允许 100 字', () => {
  const { db, service } = createHarness();
  const acceptedPost = service.createPost({
    identityHash: 'length-publisher-canonical',
    xinfaId: '10003',
    content: '招'.repeat(100),
  });
  assert.equal(acceptedPost.content.length, 100);
  assert.throws(
    () => service.createPost({
      identityHash: 'length-publisher-canonical',
      xinfaId: '10003',
      content: '招'.repeat(101),
    }),
    (error) => error instanceof RecruitmentServiceError && error.code === 'content_too_long',
  );

  const { thread } = createThread(service);
  const acceptedMessage = service.sendMessage({
    threadId: thread.id,
    identityHash: 'applicant-canonical',
    clientMsgId: 'length-message-100',
    content: '聊'.repeat(100),
  });
  assert.equal(acceptedMessage.message.content.length, 100);
  assert.throws(
    () => service.sendMessage({
      threadId: thread.id,
      identityHash: 'applicant-canonical',
      clientMsgId: 'length-message-101',
      content: '聊'.repeat(101),
    }),
    (error) => error instanceof RecruitmentServiceError && error.code === 'content_too_long',
  );
  db.close();
});

test('同一招募和申请者只创建一个会话，且不能申请自己的招募', () => {
  const { db, service } = createHarness();
  const { post, thread } = createThread(service);
  const duplicate = service.applyToPost({
    postId: post.id,
    identityHash: 'applicant-canonical',
    xinfaId: '10015',
  });

  assert.equal(duplicate.created, false);
  assert.equal(duplicate.thread.id, thread.id);
  assert.equal(db.prepare('SELECT COUNT(1) AS count FROM recruitment_threads').get().count, 1);
  assert.throws(
    () => service.applyToPost({
      postId: post.id,
      identityHash: 'publisher-canonical',
      xinfaId: '10014',
    }),
    (error) => error instanceof RecruitmentServiceError && error.code === 'self_application',
  );
  db.close();
});

test('申请只建立密聊，实际发送消息后才创建提醒', () => {
  const { db, service } = createHarness();
  const { thread } = createThread(service);

  assert.equal(
    db.prepare('SELECT COUNT(1) AS count FROM recruitment_notifications').get().count,
    0,
  );

  service.sendMessage({
    threadId: thread.id,
    identityHash: 'applicant-canonical',
    clientMsgId: 'first-message-after-application',
    content: '你好，想一起组队',
  });
  const notification = db.prepare(
    'SELECT recipient_identity_hash, type FROM recruitment_notifications'
  ).get();
  assert.deepEqual(notification, {
    recipient_identity_hash: 'publisher-canonical',
    type: 'recruitment_message',
  });
  db.close();
});

test('招募列表为已申请用户回显原会话，其他用户看不到会话 ID', () => {
  const { db, service } = createHarness();
  const { post, thread } = createThread(service);

  const applicantPost = service.listPosts({
    viewerIdentityHash: 'applicant-canonical',
  }).items.find((item) => item.id === post.id);
  const outsiderPost = service.listPosts({
    viewerIdentityHash: 'outsider-canonical',
  }).items.find((item) => item.id === post.id);

  assert.equal(applicantPost.viewerThreadId, thread.id);
  assert.equal(outsiderPost.viewerThreadId, null);
  db.close();
});

test('mine 只按 canonical 作者过滤并包含本人已关闭招募', () => {
  const { db, service } = createHarness();
  const mine = service.createPost({
    identityHash: 'publisher-canonical',
    xinfaId: '10003',
    content: '我的招募',
  });
  service.createPost({
    identityHash: 'other-canonical',
    xinfaId: '10014',
    content: '其他人的招募',
  });
  service.closePost({ postId: mine.id, identityHash: 'publisher-canonical' });

  const mineResult = service.listPosts({
    viewerIdentityHash: 'publisher-canonical',
    mine: true,
  });
  assert.equal(mineResult.total, 1);
  assert.equal(mineResult.items[0].id, mine.id);
  assert.equal(mineResult.items[0].status, 'closed');
  assert.equal(service.listPosts().total, 1);
  db.close();
});

test('我的招募可按进行中和已结束状态筛选', () => {
  const { db, service } = createHarness();
  const activePost = service.createPost({
    identityHash: 'publisher-canonical',
    xinfaId: '10003',
    content: '进行中的招募',
  });
  const closedPost = service.createPost({
    identityHash: 'publisher-canonical',
    xinfaId: '10014',
    content: '准备结束的招募',
  });
  service.closePost({ postId: closedPost.id, identityHash: 'publisher-canonical' });

  const activeResult = service.listPosts({
    viewerIdentityHash: 'publisher-canonical',
    mine: true,
    status: 'open',
  });
  const closedResult = service.listPosts({
    viewerIdentityHash: 'publisher-canonical',
    mine: true,
    status: 'closed',
  });

  assert.deepEqual(activeResult.items.map((item) => item.id), [activePost.id]);
  assert.deepEqual(closedResult.items.map((item) => item.id), [closedPost.id]);
  assert.throws(
    () => service.listPosts({
      viewerIdentityHash: 'publisher-canonical',
      mine: true,
      status: 'invalid',
    }),
    (error) => error instanceof RecruitmentServiceError && error.code === 'invalid_post_status',
  );
  db.close();
});

test('招募发布满 24 小时后自动关闭招募及其关联密聊', () => {
  const lifetimeMs = 24 * 60 * 60 * 1000;
  let currentTime = 1_700_000_000_000;
  const { db, service } = createHarness({ now: () => currentTime });
  const post = service.createPost({
    identityHash: 'publisher-canonical',
    xinfaId: '10003',
    content: '一天内有效的招募',
  });
  const thread = service.applyToPost({
    postId: post.id,
    identityHash: 'applicant-canonical',
    xinfaId: '10015',
  }).thread;

  currentTime += lifetimeMs - 1;
  assert.equal(service.listPosts().total, 1);
  assert.equal(service.listThreads({ identityHash: 'publisher-canonical', status: 'active' }).total, 1);

  currentTime += 1;
  assert.equal(service.listPosts().total, 0);
  const closedPosts = service.listPosts({
    viewerIdentityHash: 'publisher-canonical',
    mine: true,
    status: 'closed',
  });
  assert.equal(closedPosts.total, 1);
  assert.equal(closedPosts.items[0].status, 'closed');
  assert.equal(service.listThreads({ identityHash: 'publisher-canonical', status: 'active' }).total, 0);
  assert.equal(service.listThreads({ identityHash: 'publisher-canonical', status: 'closed' }).total, 1);
  assert.equal(db.prepare('SELECT closed_at FROM recruitment_posts WHERE id = ?').get(post.id).closed_at, currentTime);
  assert.equal(db.prepare('SELECT status FROM recruitment_threads WHERE id = ?').get(thread.id).status, 'closed');

  assert.throws(
    () => service.applyToPost({
      postId: post.id,
      identityHash: 'late-applicant-canonical',
      xinfaId: '10014',
    }),
    (error) => error instanceof RecruitmentServiceError && error.code === 'post_unavailable',
  );
  assert.throws(
    () => service.sendMessage({
      threadId: thread.id,
      identityHash: 'publisher-canonical',
      clientMsgId: 'expired-post-message',
      content: '到期后不能继续发送',
    }),
    (error) => error instanceof RecruitmentServiceError && error.code === 'thread_closed',
  );
  db.close();
});

test('密聊列表可按进行中和已结束状态筛选，未读总数不受筛选影响', () => {
  const { db, service } = createHarness();
  const post = service.createPost({
    identityHash: 'publisher-canonical',
    xinfaId: '10003',
    content: '筛选密聊状态',
  });
  const activeThread = service.applyToPost({
    postId: post.id,
    identityHash: 'active-applicant-canonical',
    xinfaId: '10015',
  }).thread;
  const closedThread = service.applyToPost({
    postId: post.id,
    identityHash: 'closed-applicant-canonical',
    xinfaId: '10014',
  }).thread;
  service.sendMessage({
    threadId: closedThread.id,
    identityHash: 'closed-applicant-canonical',
    clientMsgId: 'closed-thread-unread-message',
    content: '关闭前发送的未读消息',
  });
  service.closeThread({
    threadId: closedThread.id,
    identityHash: 'closed-applicant-canonical',
  });

  const activeResult = service.listThreads({
    identityHash: 'publisher-canonical',
    status: 'active',
  });
  const closedResult = service.listThreads({
    identityHash: 'publisher-canonical',
    status: 'closed',
  });

  assert.deepEqual(activeResult.items.map((item) => item.id), [activeThread.id]);
  assert.deepEqual(closedResult.items.map((item) => item.id), [closedThread.id]);
  assert.equal(activeResult.unreadCount, 1);
  assert.equal(closedResult.unreadCount, 1);
  assert.throws(
    () => service.listThreads({ identityHash: 'publisher-canonical', status: 'invalid' }),
    (error) => error instanceof RecruitmentServiceError && error.code === 'invalid_thread_status',
  );
  db.close();
});

test('结束招募会原子关闭其下全部密聊，重复结束也会修复遗留 active 会话', () => {
  const { db, service } = createHarness();
  const post = service.createPost({
    identityHash: 'publisher-canonical',
    xinfaId: '10003',
    content: '关闭全部关联密聊',
  });
  const firstThread = service.applyToPost({
    postId: post.id,
    identityHash: 'first-applicant-canonical',
    xinfaId: '10015',
  }).thread;
  service.applyToPost({
    postId: post.id,
    identityHash: 'second-applicant-canonical',
    xinfaId: '10014',
  });

  const closedPost = service.closePost({
    postId: post.id,
    identityHash: 'publisher-canonical',
  });
  const statuses = db.prepare(`
    SELECT status
    FROM recruitment_threads
    WHERE post_id = ?
    ORDER BY id
  `).all(post.id).map((row) => row.status);

  assert.equal(closedPost.status, 'closed');
  assert.deepEqual(statuses, ['closed', 'closed']);
  assert.equal(service.listThreads({ identityHash: 'publisher-canonical', status: 'active' }).total, 0);
  assert.equal(service.listThreads({ identityHash: 'publisher-canonical', status: 'closed' }).total, 2);
  assert.throws(
    () => service.sendMessage({
      threadId: firstThread.id,
      identityHash: 'publisher-canonical',
      clientMsgId: 'post-closed-thread-message',
      content: '结束招募后不能继续发送',
    }),
    (error) => error instanceof RecruitmentServiceError && error.code === 'thread_closed',
  );

  db.prepare("UPDATE recruitment_threads SET status = 'active' WHERE id = ?").run(firstThread.id);
  service.closePost({ postId: post.id, identityHash: 'publisher-canonical' });
  assert.equal(db.prepare('SELECT status FROM recruitment_threads WHERE id = ?').get(firstThread.id).status, 'closed');
  db.close();
});

test('通知首次分页返回最新记录，afterSeq=0 保持同样语义并可继续增量轮询', () => {
  const { db, repository, service } = createHarness();
  for (let index = 1; index <= 4; index += 1) {
    repository.insertNotification({
      id: `notification-${index}`,
      recipientIdentityHash: 'publisher-canonical',
      type: `type-${index}`,
      postId: `post-${index}`,
      threadId: `thread-${index}`,
      exchangeId: `exchange-${index}`,
      createdAt: index,
    });
  }

  const initial = service.listNotifications({
    identityHash: 'publisher-canonical',
    limit: 2,
  });
  const explicitZero = service.listNotifications({
    identityHash: 'publisher-canonical',
    afterSeq: 0,
    limit: 2,
  });
  assert.deepEqual(initial.items.map((item) => item.id), ['notification-4', 'notification-3']);
  assert.deepEqual(explicitZero.items.map((item) => item.id), initial.items.map((item) => item.id));
  assert.equal(initial.hasMore, true);
  assert.equal(initial.unreadCount, 4);
  assert.equal(initial.nextAfterSeq, 4);
  assert.deepEqual(initial.items[0], {
    seq: 4,
    id: 'notification-4',
    type: 'type-4',
    postId: 'post-4',
    threadId: 'thread-4',
    exchangeId: 'exchange-4',
    createdAt: 4,
    readAt: null,
  });
  assert.equal(initial.items[0].thread_id, undefined);

  service.markNotificationsRead({
    identityHash: 'publisher-canonical',
    notificationIds: ['notification-4'],
  });
  const afterRead = service.listNotifications({
    identityHash: 'publisher-canonical',
    limit: 1,
  });
  assert.equal(afterRead.items[0].readAt, 1001);
  assert.equal(afterRead.unreadCount, 3);

  repository.insertNotification({
    id: 'notification-5',
    recipientIdentityHash: 'publisher-canonical',
    type: 'type-5',
    createdAt: 5,
  });
  const delta = service.listNotifications({
    identityHash: 'publisher-canonical',
    afterSeq: initial.nextAfterSeq,
    limit: 10,
  });
  assert.deepEqual(delta.items.map((item) => item.id), ['notification-5']);
  assert.equal(delta.unreadCount, 4);
  assert.equal(delta.nextAfterSeq, 5);
  db.close();
});

test('历史申请通知不再展示或计入未读', () => {
  const { db, repository, service } = createHarness();
  repository.insertNotification({
    id: 'legacy-application-notification',
    recipientIdentityHash: 'publisher-canonical',
    type: 'recruitment_application',
    postId: 'post-1',
    threadId: 'thread-1',
    createdAt: 1,
  });
  repository.insertNotification({
    id: 'message-notification',
    recipientIdentityHash: 'publisher-canonical',
    type: 'recruitment_message',
    postId: 'post-1',
    threadId: 'thread-1',
    createdAt: 2,
  });

  const result = service.listNotifications({
    identityHash: 'publisher-canonical',
    limit: 20,
  });
  assert.deepEqual(result.items.map((item) => item.id), ['message-notification']);
  assert.equal(result.unreadCount, 1);
  db.close();
});

test('密聊按成员授权、加密存储，并通过 clientMsgId 保证幂等', () => {
  const { db, repository, service } = createHarness();
  const { thread } = createThread(service);
  const content = '可以，直接加我微信 abc_123';
  const first = service.sendMessage({
    threadId: thread.id,
    identityHash: 'applicant-canonical',
    clientMsgId: 'client-message-1',
    content,
  });
  const retry = service.sendMessage({
    threadId: thread.id,
    identityHash: 'applicant-canonical',
    clientMsgId: 'client-message-1',
    content: '重试时正文即使变化也不能新建消息',
  });

  assert.equal(first.created, true);
  assert.equal(retry.created, false);
  assert.equal(retry.message.id, first.message.id);
  const stored = db.prepare('SELECT * FROM recruitment_messages').get();
  assert.equal(db.prepare('SELECT COUNT(1) AS count FROM recruitment_messages').get().count, 1);
  assert.equal(stored.content_ciphertext.includes(content), false);
  const publisherMessages = service.listMessages({
    threadId: thread.id,
    identityHash: 'publisher-canonical',
  });
  assert.equal(publisherMessages.items[0].content, content);
  assert.equal(publisherMessages.thread.status, 'active');
  assert.throws(
    () => service.listMessages({ threadId: thread.id, identityHash: 'outsider-canonical' }),
    (error) => error instanceof RecruitmentServiceError && error.code === 'thread_not_found',
  );

  assert.equal(service.listThreads({ identityHash: 'publisher-canonical' }).items[0].unreadCount, 1);
  service.markThreadRead({
    threadId: thread.id,
    identityHash: 'publisher-canonical',
    lastMessageSeq: first.message.seq,
  });
  assert.equal(service.listThreads({ identityHash: 'publisher-canonical' }).items[0].unreadCount, 0);
  assert.equal(repository.markThreadRead({
    threadId: thread.id,
    identityHash: 'publisher-canonical',
    seq: first.message.seq,
  }).changes, 0);
  db.close();
});

test('密聊轮询可在同一响应中返回联系方式，避免额外请求', () => {
  const { db, service } = createHarness();
  const { thread } = createThread(service);
  service.putContactExchange({
    threadId: thread.id,
    identityHash: 'applicant-canonical',
    contact: { type: 'qq', value: '778899', label: '游戏号' },
  });

  const messagesOnly = service.listMessages({
    threadId: thread.id,
    identityHash: 'publisher-canonical',
  });
  const combined = service.listMessages({
    threadId: thread.id,
    identityHash: 'publisher-canonical',
    includeContactExchanges: true,
  });

  assert.equal(Object.hasOwn(messagesOnly, 'contactExchanges'), false);
  assert.equal(combined.contactExchanges.length, 1);
  assert.equal(combined.contactExchanges[0].ownerRole, 'applicant');
  assert.equal(combined.contactExchanges[0].contact, null);
  db.close();
});

test('密聊通过治理事件游标同步已加载消息的删除与恢复状态', () => {
  const { db, service } = createHarness();
  const { thread } = createThread(service);
  const sent = service.sendMessage({
    threadId: thread.id,
    identityHash: 'applicant-canonical',
    clientMsgId: 'moderation-sync-message',
    content: '需要被治理的消息',
  }).message;
  const initial = service.listMessages({
    threadId: thread.id,
    identityHash: 'publisher-canonical',
  });
  assert.equal(initial.moderationCursor, 0);

  db.transaction(() => {
    db.prepare(`
      UPDATE recruitment_messages
      SET moderation_status = 'removed', deleted_at = 2000
      WHERE id = ?
    `).run(sent.id);
    db.prepare(`
      INSERT INTO recruitment_message_moderation_events (
        message_id, thread_id, moderation_status, created_at
      ) VALUES (?, ?, 'removed', 2000)
    `).run(sent.id, thread.id);
  })();
  const removed = service.listMessages({
    threadId: thread.id,
    identityHash: 'publisher-canonical',
    afterSeq: sent.seq,
    afterModerationSeq: initial.moderationCursor,
  });
  assert.deepEqual(removed.items, []);
  assert.equal(removed.moderationItems.length, 1);
  assert.equal(removed.moderationItems[0].id, sent.id);
  assert.equal(removed.moderationItems[0].deleted, true);
  assert.equal(removed.moderationItems[0].content, null);

  db.transaction(() => {
    db.prepare(`
      UPDATE recruitment_messages
      SET moderation_status = 'visible', deleted_at = NULL
      WHERE id = ?
    `).run(sent.id);
    db.prepare(`
      INSERT INTO recruitment_message_moderation_events (
        message_id, thread_id, moderation_status, created_at
      ) VALUES (?, ?, 'visible', 3000)
    `).run(sent.id, thread.id);
  })();
  const restored = service.listMessages({
    threadId: thread.id,
    identityHash: 'publisher-canonical',
    afterSeq: sent.seq,
    afterModerationSeq: removed.moderationCursor,
  });
  assert.equal(restored.moderationItems.length, 1);
  assert.equal(restored.moderationItems[0].deleted, false);
  assert.equal(restored.moderationItems[0].content, '需要被治理的消息');
  db.close();
});

test('会话双方都能关闭密聊，关闭后双方均不能继续发送消息', () => {
  const { db, service } = createHarness();
  const { thread } = createThread(service);

  const closedByApplicant = service.closeThread({
    threadId: thread.id,
    identityHash: 'applicant-canonical',
  });
  const repeatedByPublisher = service.closeThread({
    threadId: thread.id,
    identityHash: 'publisher-canonical',
  });

  assert.equal(closedByApplicant.status, 'closed');
  assert.equal(repeatedByPublisher.status, 'closed');
  assert.equal(service.listMessages({
    threadId: thread.id,
    identityHash: 'publisher-canonical',
  }).thread.status, 'closed');
  assert.throws(
    () => service.sendMessage({
      threadId: thread.id,
      identityHash: 'publisher-canonical',
      clientMsgId: 'closed-thread-message',
      content: '关闭后不能发出',
    }),
    (error) => error instanceof RecruitmentServiceError && error.code === 'thread_closed',
  );
  assert.throws(
    () => service.closeThread({ threadId: thread.id, identityHash: 'outsider-canonical' }),
    (error) => error instanceof RecruitmentServiceError && error.code === 'thread_not_found',
  );
  db.close();
});

test('结构化联系方式在双方同意前锁定，并始终以密文落库', () => {
  const { db, service } = createHarness();
  const { thread } = createThread(service);
  const proposed = service.putContactExchange({
    threadId: thread.id,
    identityHash: 'applicant-canonical',
    contact: { type: 'qq', value: '778899', label: '游戏号' },
  });

  assert.equal(proposed.exchange.status, 'pending');
  assert.equal(proposed.exchange.consentedByMe, true);
  const beforeConsent = service.listContactExchanges({
    threadId: thread.id,
    identityHash: 'publisher-canonical',
  })[0];
  assert.equal(beforeConsent.contact, null);
  const stored = db.prepare('SELECT payload_ciphertext FROM recruitment_contact_exchanges').get();
  assert.equal(stored.payload_ciphertext.includes('778899'), false);

  const consent = service.consentToContactExchange({
    exchangeId: proposed.exchange.id,
    identityHash: 'publisher-canonical',
    contact: { type: 'wechat', value: 'publisher_wechat', label: '队长号' },
  });
  assert.equal(consent.changed, true);
  assert.equal(consent.items.length, 2);
  assert.equal(consent.items.every((item) => item.status === 'unlocked'), true);
  const applicantItem = consent.items.find((item) => item.ownerRole === 'applicant');
  const publisherItem = consent.items.find((item) => item.ownerRole === 'publisher');
  assert.equal(applicantItem.contact.value, '778899');
  assert.equal(publisherItem.contact.value, 'publisher_wechat');
  assert.equal(db.prepare('SELECT COUNT(1) AS count FROM recruitment_exchange_consents').get().count, 4);

  const changed = service.putContactExchange({
    threadId: thread.id,
    identityHash: 'applicant-canonical',
    contact: { type: 'qq', value: '778899-new', label: '新游戏号' },
  });
  assert.equal(changed.items.every((item) => item.status === 'pending'), true);
  const confirmedAgain = service.consentToContactExchange({
    exchangeId: proposed.exchange.id,
    identityHash: 'publisher-canonical',
    contact: { type: 'wechat', value: 'publisher_wechat', label: '队长号' },
  });
  assert.equal(confirmedAgain.items.every((item) => item.status === 'unlocked'), true);
  assert.equal(
    confirmedAgain.items.find((item) => item.ownerRole === 'applicant').contact.value,
    '778899-new',
  );
  db.close();
});

test('后台只能按举报 ID 解密被选入证据链的密聊消息', () => {
  const { db, service } = createHarness();
  const { thread } = createThread(service);
  const selected = service.sendMessage({
    threadId: thread.id,
    identityHash: 'applicant-canonical',
    clientMsgId: 'evidence-selected',
    content: '这是被举报的消息',
  }).message;
  service.sendMessage({
    threadId: thread.id,
    identityHash: 'applicant-canonical',
    clientMsgId: 'evidence-not-selected',
    content: '这条不应出现在证据链',
  });
  const report = service.submitReport({
    identityHash: 'publisher-canonical',
    targetType: 'message',
    targetId: selected.id,
    reasonCode: 'harassment',
  });

  db.prepare(`
    UPDATE recruitment_messages
    SET moderation_status = 'removed', deleted_at = 2000, deleted_by = 'admin'
    WHERE id = ?
  `).run(selected.id);
  const memberView = service.listMessages({
    threadId: thread.id,
    identityHash: 'publisher-canonical',
  }).items.find((item) => item.id === selected.id);
  assert.equal(memberView.deleted, true);
  assert.equal(memberView.content, null);

  const adminView = service.getReportEvidenceForAdmin({ reportId: report.id });
  assert.equal(adminView.evidence.length, 1);
  assert.equal(adminView.evidence[0].content, '这是被举报的消息');
  assert.throws(
    () => service.submitReport({
      identityHash: 'outsider-canonical',
      targetType: 'message',
      targetId: selected.id,
      reasonCode: 'spam',
    }),
    (error) => error instanceof RecruitmentServiceError && error.code === 'message_not_found',
  );
  db.close();
});

test('会话举报不能只提交举报人自己发送的消息作为证据', () => {
  const { db, service } = createHarness();
  const { thread } = createThread(service);
  const ownMessage = service.sendMessage({
    threadId: thread.id,
    identityHash: 'publisher-canonical',
    clientMsgId: 'reporter-only-evidence',
    content: '这是举报人自己发送的消息',
  }).message;

  assert.throws(
    () => service.submitReport({
      identityHash: 'publisher-canonical',
      targetType: 'thread',
      targetId: thread.id,
      reasonCode: 'harassment',
      evidenceMessageIds: [ownMessage.id],
    }),
    (error) => error instanceof RecruitmentServiceError
      && error.code === 'reported_party_evidence_required',
  );
  assert.equal(db.prepare('SELECT COUNT(1) AS count FROM recruitment_reports').get().count, 0);
  db.close();
});

test('未解锁联系方式不可举报，解锁后的举报保留不可覆盖的加密快照', () => {
  const { db, service } = createHarness();
  const { thread } = createThread(service);
  const proposed = service.putContactExchange({
    threadId: thread.id,
    identityHash: 'applicant-canonical',
    contact: { type: 'wechat', value: 'sensitive_wechat', label: '本人' },
  });

  assert.throws(
    () => service.submitReport({
      identityHash: 'publisher-canonical',
      targetType: 'contact_exchange',
      targetId: proposed.exchange.id,
      reasonCode: 'privacy',
    }),
    (error) => error instanceof RecruitmentServiceError && error.code === 'contact_not_unlocked',
  );

  service.consentToContactExchange({
    exchangeId: proposed.exchange.id,
    identityHash: 'publisher-canonical',
    contact: { type: 'qq', value: 'publisher_contact', label: '队长' },
  });
  const report = service.submitReport({
    identityHash: 'publisher-canonical',
    targetType: 'contact_exchange',
    targetId: proposed.exchange.id,
    reasonCode: 'privacy',
  });

  const storedReport = db.prepare('SELECT * FROM recruitment_reports WHERE id = ?').get(report.id);
  assert.equal(storedReport.contact_exchange_id, proposed.exchange.id);
  assert.equal(storedReport.contact_was_unlocked, 1);
  assert.equal(JSON.stringify(storedReport).includes('sensitive_wechat'), false);

  service.putContactExchange({
    threadId: thread.id,
    identityHash: 'applicant-canonical',
    contact: { type: 'wechat', value: 'changed_after_report', label: '新联系方式' },
  });

  const redacted = service.getReportEvidenceForAdmin({ reportId: report.id });
  assert.equal(redacted.contact.contact, null);
  const explicit = service.getReportEvidenceForAdmin({ reportId: report.id, includeContact: true });
  assert.equal(explicit.contact.contact.value, 'sensitive_wechat');
  assert.notEqual(explicit.contact.contact.value, 'changed_after_report');
  db.close();
});

test('后台锁定会话或隐藏招募后拒绝继续发送消息与交换联系方式', () => {
  const { db, service } = createHarness();
  const { post, thread } = createThread(service);
  db.prepare('UPDATE recruitment_threads SET locked_at = 3000, locked_by = ? WHERE id = ?')
    .run('admin', thread.id);
  const lockedThread = service.getThread({
    threadId: thread.id,
    identityHash: 'publisher-canonical',
  });
  assert.equal(lockedThread.writable, false);
  assert.equal(lockedThread.writeBlockedReason, 'thread_locked');
  assert.throws(
    () => service.sendMessage({
      threadId: thread.id,
      identityHash: 'publisher-canonical',
      clientMsgId: 'blocked-by-lock',
      content: '不能发出',
    }),
    (error) => error instanceof RecruitmentServiceError && error.code === 'thread_locked',
  );
  db.prepare('UPDATE recruitment_threads SET locked_at = NULL, locked_by = NULL WHERE id = ?').run(thread.id);
  db.prepare("UPDATE recruitment_posts SET moderation_status = 'hidden' WHERE id = ?").run(post.id);
  const hiddenPostThread = service.getThread({
    threadId: thread.id,
    identityHash: 'publisher-canonical',
  });
  assert.equal(hiddenPostThread.writable, false);
  assert.equal(hiddenPostThread.writeBlockedReason, 'post_unavailable');
  assert.throws(
    () => service.putContactExchange({
      threadId: thread.id,
      identityHash: 'publisher-canonical',
      contact: { type: 'qq', value: '12345' },
    }),
    (error) => error instanceof RecruitmentServiceError && error.code === 'post_unavailable',
  );
  db.close();
});
