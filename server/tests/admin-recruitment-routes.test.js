import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { registerAdminRecruitmentRoutes } from '../routes/admin/recruitment-routes.js';

const createDb = () => {
  const db = new Database(':memory:');
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE recruitment_posts (
      id TEXT PRIMARY KEY,
      author_identity_hash TEXT NOT NULL,
      xinfa_id TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      moderation_status TEXT NOT NULL DEFAULT 'visible',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
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
      locked_at INTEGER,
      locked_by TEXT,
      lock_reason TEXT,
      FOREIGN KEY (post_id) REFERENCES recruitment_posts(id)
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
      FOREIGN KEY (thread_id) REFERENCES recruitment_threads(id)
    );
    CREATE TABLE recruitment_message_moderation_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      moderation_status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (message_id) REFERENCES recruitment_messages(id),
      FOREIGN KEY (thread_id) REFERENCES recruitment_threads(id)
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
      deleted_at INTEGER,
      deleted_by TEXT,
      deletion_reason TEXT,
      FOREIGN KEY (thread_id) REFERENCES recruitment_threads(id)
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
      UNIQUE (report_id, position)
    );
    CREATE TABLE recruitment_admin_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER,
      admin_username TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      report_id TEXT,
      before_json TEXT,
      after_json TEXT,
      reason TEXT,
      ip TEXT,
      created_at INTEGER NOT NULL
    );
  `);
  return db;
};

const createApp = () => {
  const routes = new Map();
  return {
    get(path, ...handlers) {
      routes.set(`GET ${path}`, handlers);
    },
    post(path, ...handlers) {
      routes.set(`POST ${path}`, handlers);
    },
    routes,
  };
};

const createResponse = () => {
  let statusCode = 200;
  let payload;
  return {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      payload = data;
      return this;
    },
    get statusCode() {
      return statusCode;
    },
    get payload() {
      return payload;
    },
  };
};

const runHandlers = async (handlers, req) => {
  const res = createResponse();
  let index = -1;
  let nextError = null;
  const next = async (error) => {
    if (error) {
      nextError = error;
      return;
    }
    index += 1;
    const handler = handlers[index];
    if (!handler) return;
    return handler.length >= 3 ? handler(req, res, next) : handler(req, res);
  };
  await next();
  if (nextError) throw nextError;
  return res;
};

const pass = (_req, _res, next) => next();

const seed = (db) => {
  db.prepare(`
    INSERT INTO recruitment_posts (id, author_identity_hash, xinfa_id, content, created_at, updated_at)
    VALUES ('post-1', 'identity-author', '10003', '招募正文，不应出现在密聊证据列表', 1000, 1000)
  `).run();
  db.prepare(`
    INSERT INTO recruitment_threads (
      id, post_id, publisher_identity_hash, applicant_identity_hash, applicant_xinfa_id,
      created_at, updated_at
    ) VALUES ('thread-1', 'post-1', 'identity-author', 'identity-applicant', '10014', 1000, 1000)
  `).run();
  db.prepare(`
    INSERT INTO recruitment_messages (
      id, thread_id, sender_identity_hash, client_msg_id,
      content_ciphertext, content_iv, content_auth_tag, created_at
    ) VALUES ('message-1', 'thread-1', 'identity-applicant', 'client-1', 'cipher', 'iv', 'tag', 1100)
  `).run();
  db.prepare(`
    INSERT INTO recruitment_reports (
      id, reporter_identity_hash, reported_identity_hash, target_type,
      post_id, thread_id, message_id, reason_code, detail, created_at
    ) VALUES ('report-1', 'identity-author', 'identity-applicant', 'thread', 'post-1', 'thread-1', NULL, 'harassment', '需要查看上下文', 1200)
  `).run();
  db.prepare(`
    INSERT INTO recruitment_report_evidence (report_id, message_id, position, added_at)
    VALUES ('report-1', 'message-1', 0, 1200)
  `).run();
};

const defaultResolveStoredIdentityHash = (identityHash) => ({
  type: 'identity',
  identityKey: identityHash,
  canonicalHash: identityHash,
  legacyFingerprintHash: `${identityHash}-legacy`,
  identityHashes: [identityHash, `${identityHash}-legacy`],
});

const createHarness = ({ resolveStoredIdentityHash = defaultResolveStoredIdentityHash } = {}) => {
  const db = createDb();
  seed(db);
  const app = createApp();
  const evidenceCalls = [];
  const bans = [];
  let safetyChecks = 0;
  let recruitmentManageChecks = 0;
  const evidenceService = {
    getReportEvidenceForAdmin(payload) {
      evidenceCalls.push(payload);
      const report = db.prepare('SELECT * FROM recruitment_reports WHERE id = ?').get(payload.reportId);
      if (report?.target_type === 'contact_exchange') {
        return {
          report,
          evidence: [],
          contact: {
            exchangeId: report.contact_exchange_id,
            threadId: report.thread_id,
            ownerIdentityHash: report.reported_identity_hash,
            status: 'unlocked',
            deleted: false,
            contact: payload.includeContact ? { type: 'qq', value: '123456' } : null,
          },
        };
      }
      return {
        report,
        evidence: [{
          id: 'message-1',
          type: 'message',
          position: 0,
          threadId: 'thread-1',
          senderIdentityHash: 'identity-applicant',
          senderRole: 'applicant',
          isReportedParty: true,
          content: '有限证据正文',
          createdAt: 1100,
        }],
        contact: null,
      };
    },
  };
  registerAdminRecruitmentRoutes(app, {
    db,
    evidenceService,
    requireAdmin: pass,
    requireAdminCsrf: pass,
    requireAdminRead: pass,
    requireAdminManage: (_req, _res, next) => {
      recruitmentManageChecks += 1;
      next();
    },
    requireUserSafetyManage: (_req, _res, next) => {
      safetyChecks += 1;
      next();
    },
    getClientIp: () => '127.0.0.9',
    resolveBanOptions: (req) => ({
      permissions: req.body?.permissions,
      reason: req.body?.reason,
    }),
    upsertBan: (...args) => bans.push(args),
    resolveStoredIdentityHash,
  });
  return {
    db,
    routes: app.routes,
    evidenceCalls,
    bans,
    get safetyChecks() { return safetyChecks; },
    get recruitmentManageChecks() { return recruitmentManageChecks; },
  };
};

test('招募举报列表只返回有限目标摘要，不提供全量密聊读取', async () => {
  const harness = createHarness();
  const response = await runHandlers(harness.routes.get('GET /api/admin/recruitment/reports'), {
    query: { status: 'pending', page: '1', limit: '20' },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.total, 1);
  assert.equal(response.payload.items[0].evidenceCount, 1);
  assert.equal(response.payload.items[0].target.thread.id, 'thread-1');
  assert.equal(response.payload.items[0].target.thread.content, undefined);
  assert.equal(harness.routes.has('GET /api/admin/recruitment/threads/:threadId/messages'), false);
  harness.db.close();
});

test('按举报 ID POST 获取证据，显式传递联系方式开关并写专用隐私审计', async () => {
  const harness = createHarness();
  const response = await runHandlers(harness.routes.get('POST /api/admin/recruitment/reports/:id/evidence'), {
    params: { id: 'report-1' },
    body: { reason: '核实骚扰举报上下文' },
    session: { admin: { id: 7, username: 'moderator' } },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(harness.evidenceCalls[0].includeContact, true);
  assert.equal(response.payload.evidence[0].content, '有限证据正文');
  assert.equal(response.payload.evidence[0].senderIdentityHash, undefined);
  assert.equal(response.payload.evidence[0].senderRole, 'applicant');
  assert.equal(response.payload.evidence[0].isReportedParty, true);
  const audit = harness.db.prepare('SELECT action, admin_id, admin_username, report_id, reason FROM recruitment_admin_audit_logs').get();
  assert.equal(audit.action, 'recruitment_report_evidence_view');
  assert.equal(audit.admin_id, 7);
  assert.equal(audit.admin_username, 'moderator');
  assert.equal(audit.report_id, 'report-1');
  assert.equal(audit.reason, '核实骚扰举报上下文');
  harness.db.close();
});

test('缺少查看理由时不会触发证据解密或写入伪造的成功审计', async () => {
  const harness = createHarness();
  const response = await runHandlers(harness.routes.get('POST /api/admin/recruitment/reports/:id/evidence'), {
    params: { id: 'report-1' },
    body: { reason: '   ' },
    session: { admin: { id: 7, username: 'moderator' } },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.payload.code, 'reason_required');
  assert.equal(harness.evidenceCalls.length, 0);
  assert.equal(harness.db.prepare('SELECT COUNT(1) AS count FROM recruitment_admin_audit_logs').get().count, 0);
  harness.db.close();
});

test('不同资源类型使用各自举报，证据消息仍可单独治理', async () => {
  const harness = createHarness();
  const actor = { admin: { id: 7, username: 'moderator' } };
  harness.db.prepare(`
    INSERT INTO recruitment_reports (
      id, reporter_identity_hash, reported_identity_hash, target_type,
      post_id, reason_code, detail, created_at
    ) VALUES (
      'report-post', 'identity-applicant', 'identity-author', 'post',
      'post-1', 'spam', '招募正文违规', 1250
    )
  `).run();

  let response = await runHandlers(harness.routes.get('POST /api/admin/recruitment/posts/:id/action'), {
    params: { id: 'post-1' }, body: { action: 'remove', reason: '违规招募', reportId: 'report-post' }, session: actor,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(harness.db.prepare('SELECT moderation_status FROM recruitment_posts WHERE id = ?').get('post-1').moderation_status, 'removed');

  response = await runHandlers(harness.routes.get('POST /api/admin/recruitment/posts/:id/action'), {
    params: { id: 'post-1' }, body: { action: 'restore', reason: '复核后恢复', reportId: 'report-post' }, session: actor,
  });
  assert.equal(response.statusCode, 200);

  response = await runHandlers(harness.routes.get('POST /api/admin/recruitment/threads/:id/action'), {
    params: { id: 'thread-1' }, body: { action: 'lock', reason: '需要人工复核', reportId: 'report-1' }, session: actor,
  });
  assert.equal(response.statusCode, 200);
  const locked = harness.db.prepare('SELECT status, locked_by FROM recruitment_threads WHERE id = ?').get('thread-1');
  assert.equal(locked.status, 'active');
  assert.equal(locked.locked_by, 'moderator');

  response = await runHandlers(harness.routes.get('POST /api/admin/recruitment/threads/:id/action'), {
    params: { id: 'thread-1' }, body: { action: 'unlock', reason: '复核结束', reportId: 'report-1' }, session: actor,
  });
  assert.equal(response.statusCode, 200);

  response = await runHandlers(harness.routes.get('POST /api/admin/recruitment/messages/:id/action'), {
    params: { id: 'message-1' }, body: { action: 'remove', reason: '消息违规', reportId: 'report-1' }, session: actor,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(harness.db.prepare('SELECT moderation_status FROM recruitment_messages WHERE id = ?').get('message-1').moderation_status, 'removed');

  response = await runHandlers(harness.routes.get('POST /api/admin/recruitment/messages/:id/action'), {
    params: { id: 'message-1' }, body: { action: 'restore', reason: '误判恢复', reportId: 'report-1' }, session: actor,
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(
    harness.db.prepare(`
      SELECT moderation_status
      FROM recruitment_message_moderation_events
      WHERE message_id = ?
      ORDER BY seq ASC
    `).all('message-1').map((row) => row.moderation_status),
    ['removed', 'visible'],
  );
  const actionAudits = harness.db.prepare(`
    SELECT report_id
    FROM recruitment_admin_audit_logs
    WHERE action != 'recruitment_report_evidence_view'
    ORDER BY id ASC
  `).all();
  assert.equal(actionAudits.length, 6);
  assert.deepEqual(
    actionAudits.map((item) => item.report_id),
    ['report-post', 'report-post', 'report-1', 'report-1', 'report-1', 'report-1'],
  );
  harness.db.close();
});

test('同一上下文中的其它类型举报不能扩大资源治理范围', async () => {
  const harness = createHarness();
  const actor = { admin: { id: 7, username: 'moderator' } };

  // report-1 举报的是会话；即使记录了所属 post_id，也不能据此下架整条招募。
  let response = await runHandlers(harness.routes.get('POST /api/admin/recruitment/posts/:id/action'), {
    params: { id: 'post-1' },
    body: { action: 'remove', reason: '目标类型不匹配', reportId: 'report-1' },
    session: actor,
  });
  assert.equal(response.statusCode, 404);
  assert.equal(response.payload.code, 'report_target_not_found');
  assert.equal(
    harness.db.prepare('SELECT moderation_status FROM recruitment_posts WHERE id = ?').get('post-1').moderation_status,
    'visible',
  );

  harness.db.prepare(`
    INSERT INTO recruitment_reports (
      id, reporter_identity_hash, reported_identity_hash, target_type,
      post_id, thread_id, message_id, reason_code, detail, created_at
    ) VALUES (
      'report-message', 'identity-author', 'identity-applicant', 'message',
      'post-1', 'thread-1', 'message-1', 'harassment', '单条消息违规', 1300
    )
  `).run();

  // 消息举报虽然记录了 thread_id，也不能据此锁定整个会话。
  response = await runHandlers(harness.routes.get('POST /api/admin/recruitment/threads/:id/action'), {
    params: { id: 'thread-1' },
    body: { action: 'lock', reason: '目标类型不匹配', reportId: 'report-message' },
    session: actor,
  });
  assert.equal(response.statusCode, 404);
  assert.equal(response.payload.code, 'report_target_not_found');
  assert.equal(harness.db.prepare('SELECT locked_at FROM recruitment_threads WHERE id = ?').get('thread-1').locked_at, null);

  // 目标类型和 ID 都匹配时，消息举报仍可治理其主消息。
  response = await runHandlers(harness.routes.get('POST /api/admin/recruitment/messages/:id/action'), {
    params: { id: 'message-1' },
    body: { action: 'remove', reason: '处理被举报消息', reportId: 'report-message' },
    session: actor,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(
    harness.db.prepare('SELECT moderation_status FROM recruitment_messages WHERE id = ?').get('message-1').moderation_status,
    'removed',
  );
  const audits = harness.db.prepare('SELECT report_id FROM recruitment_admin_audit_logs ORDER BY id ASC').all();
  assert.deepEqual(audits.map((item) => item.report_id), ['report-message']);
  harness.db.close();
});

test('举报封禁同时经过 user_safety:manage，并同时覆盖 canonical 与 legacy 身份', async () => {
  const harness = createHarness();
  const response = await runHandlers(harness.routes.get('POST /api/admin/recruitment/reports/:id/action'), {
    params: { id: 'report-1' },
    body: { action: 'ban', reason: '确认骚扰行为', permissions: ['recruit', 'chat'] },
    session: { admin: { id: 7, username: 'moderator' } },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(harness.recruitmentManageChecks, 1);
  assert.equal(harness.safetyChecks, 1);
  assert.equal(harness.bans.length, 2);
  assert.deepEqual(harness.bans[0].slice(0, 3), ['banned_identities', 'identity', 'identity-applicant']);
  assert.deepEqual(harness.bans[1].slice(0, 3), ['banned_fingerprints', 'fingerprint', 'identity-applicant-legacy']);
  assert.deepEqual(harness.bans[0][3].permissions, ['recruit', 'chat']);
  assert.equal(harness.db.prepare('SELECT status, action FROM recruitment_reports WHERE id = ?').get('report-1').action, 'ban');
  harness.db.close();
});

test('联系方式只在具体举报证据 POST 中解密，并从响应和审计中剔除身份哈希', async () => {
  const harness = createHarness();
  harness.db.prepare(`
    INSERT INTO recruitment_contact_exchanges (
      id, thread_id, owner_identity_hash, payload_ciphertext, payload_iv,
      payload_auth_tag, status, created_at, updated_at
    ) VALUES ('exchange-1', 'thread-1', 'identity-applicant', 'cipher', 'iv', 'tag', 'unlocked', 1300, 1300)
  `).run();
  harness.db.prepare(`
    INSERT INTO recruitment_reports (
      id, reporter_identity_hash, reported_identity_hash, target_type,
      post_id, thread_id, contact_exchange_id, reason_code, detail, created_at
    ) VALUES (
      'report-contact', 'identity-author', 'identity-applicant', 'contact_exchange',
      'post-1', 'thread-1', 'exchange-1', 'privacy', '联系方式风险', 1400
    )
  `).run();

  const response = await runHandlers(harness.routes.get('POST /api/admin/recruitment/reports/:id/evidence'), {
    params: { id: 'report-contact' },
    body: { reason: '核实联系方式举报' },
    session: { admin: { id: 7, username: 'moderator' } },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.payload.contact.contact, { type: 'qq', value: '123456' });
  assert.equal(response.payload.contact.ownerIdentityHash, undefined);
  const audit = harness.db.prepare(`
    SELECT after_json
    FROM recruitment_admin_audit_logs
    WHERE report_id = 'report-contact'
  `).get();
  assert.equal(JSON.parse(audit.after_json).contactAccessed, true);
  assert.equal(audit.after_json.includes('identity-applicant'), false);

  const actionResponse = await runHandlers(harness.routes.get('POST /api/admin/recruitment/contact-exchanges/:id/action'), {
    params: { id: 'exchange-1' },
    body: { action: 'remove', reason: '联系方式违规', reportId: 'report-contact' },
    session: { admin: { id: 7, username: 'moderator' } },
  });
  assert.equal(actionResponse.statusCode, 200);
  assert.equal(harness.db.prepare('SELECT moderation_status FROM recruitment_contact_exchanges WHERE id = ?').get('exchange-1').moderation_status, 'removed');
  harness.db.close();
});

test('治理动作必须携带匹配的举报 ID，不能按任意资源 ID 直接处置', async () => {
  const harness = createHarness();
  const route = harness.routes.get('POST /api/admin/recruitment/messages/:id/action');
  const baseRequest = {
    params: { id: 'message-1' },
    session: { admin: { id: 7, username: 'moderator' } },
  };

  let response = await runHandlers(route, {
    ...baseRequest,
    body: { action: 'remove', reason: '缺少举报来源' },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.payload.code, 'report_required');

  response = await runHandlers(route, {
    ...baseRequest,
    body: { action: 'remove', reason: '错误举报来源', reportId: 'report-other' },
  });
  assert.equal(response.statusCode, 404);
  assert.equal(response.payload.code, 'report_target_not_found');
  assert.equal(harness.db.prepare('SELECT moderation_status FROM recruitment_messages WHERE id = ?').get('message-1').moderation_status, 'visible');
  assert.equal(harness.db.prepare('SELECT COUNT(1) AS count FROM recruitment_admin_audit_logs').get().count, 0);
  harness.db.close();
});

test('招募封禁未给范围时默认只限制招募和密聊，无效范围直接拒绝', async () => {
  const defaultHarness = createHarness();
  let response = await runHandlers(defaultHarness.routes.get('POST /api/admin/recruitment/reports/:id/action'), {
    params: { id: 'report-1' },
    body: { action: 'ban', reason: '使用最小默认范围' },
    session: { admin: { id: 7, username: 'moderator' } },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(defaultHarness.bans.length, 2);
  assert.deepEqual(defaultHarness.bans[0][3].permissions, ['recruit', 'chat']);
  defaultHarness.db.close();

  const invalidHarness = createHarness();
  response = await runHandlers(invalidHarness.routes.get('POST /api/admin/recruitment/reports/:id/action'), {
    params: { id: 'report-1' },
    body: { action: 'ban', reason: '不能扩散到无关权限', permissions: ['post'] },
    session: { admin: { id: 7, username: 'moderator' } },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.payload.code, 'invalid_ban_permissions');
  assert.equal(invalidHarness.bans.length, 0);
  assert.equal(invalidHarness.db.prepare('SELECT status FROM recruitment_reports WHERE id = ?').get('report-1').status, 'pending');
  invalidHarness.db.close();
});

test('无 canonical 的旧身份只写入指纹封禁表', async () => {
  const harness = createHarness({
    resolveStoredIdentityHash: (identityHash) => ({
      type: 'fingerprint',
      identityKey: identityHash,
      canonicalHash: '',
      legacyFingerprintHash: identityHash,
      identityHashes: [identityHash],
    }),
  });
  const response = await runHandlers(harness.routes.get('POST /api/admin/recruitment/reports/:id/action'), {
    params: { id: 'report-1' },
    body: { action: 'ban', reason: '旧匿名身份封禁', permissions: ['recruit', 'chat'] },
    session: { admin: { id: 7, username: 'moderator' } },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(harness.bans.length, 1);
  assert.deepEqual(
    harness.bans[0].slice(0, 3),
    ['banned_fingerprints', 'fingerprint', 'identity-applicant'],
  );
  harness.db.close();
});

test('后台权限中间件缺失时注册失败，不默认放行', () => {
  assert.throws(
    () => registerAdminRecruitmentRoutes(createApp(), {
      requireAdmin: pass,
      requireAdminCsrf: pass,
    }),
    /缺少 requireAdminRead/,
  );
});
