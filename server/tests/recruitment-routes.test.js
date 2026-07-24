import assert from 'node:assert/strict';
import test from 'node:test';

import { registerPublicRecruitmentRoutes } from '../routes/public/recruitment-routes.js';

const createApp = () => {
  const routes = new Map();
  return {
    get(path, handler) {
      routes.set(`GET ${path}`, handler);
    },
    post(path, handler) {
      routes.set(`POST ${path}`, handler);
    },
    routes,
  };
};

const createResponse = () => {
  let statusCode = 200;
  let payload;
  const headers = new Map();
  return {
    status(code) {
      statusCode = code;
      return this;
    },
    json(value) {
      payload = value;
      return this;
    },
    set(name, value) {
      headers.set(String(name).toLowerCase(), String(value));
      return this;
    },
    vary(name) {
      const key = 'vary';
      const values = new Set(
        String(headers.get(key) || '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      );
      values.add(String(name));
      headers.set(key, Array.from(values).join(', '));
      return this;
    },
    getHeader(name) {
      return headers.get(String(name).toLowerCase());
    },
    get statusCode() {
      return statusCode;
    },
    get payload() {
      return payload;
    },
  };
};

const createServiceStub = (overrides = {}) => ({
  getCatalog: () => ({ items: [], optionCount: 0, sourceRecordCount: 0 }),
  listPosts: () => ({ items: [], total: 0, page: 1, limit: 20 }),
  getPost: () => ({ id: 'post-1' }),
  createPost: () => ({ id: 'post-1' }),
  closePost: () => ({ id: 'post-1' }),
  applyToPost: () => ({ created: true, thread: { id: 'thread-1' } }),
  listThreads: () => ({ items: [], total: 0, page: 1, limit: 20 }),
  getThread: () => ({ id: 'thread-1' }),
  closeThread: () => ({ id: 'thread-1', status: 'closed' }),
  getExistingMessageForSender: () => null,
  sendMessage: () => ({ created: true, message: { id: 'message-1' } }),
  listMessages: () => ({ items: [], hasMore: false }),
  markThreadRead: () => ({ threadId: 'thread-1', lastReadSeq: 0 }),
  listContactExchanges: () => [],
  putContactExchange: () => ({ items: [] }),
  consentToContactExchange: () => ({ items: [] }),
  listNotifications: () => ({ items: [] }),
  markNotificationsRead: () => ({ updated: 0 }),
  submitReport: () => ({ id: 'report-1' }),
  ...overrides,
});

const register = ({ identityContext, service, privateFeaturesEnabled = true, sessionSecretConfigured = true, onRate, onBan, onTurnstile } = {}) => {
  const app = createApp();
  registerPublicRecruitmentRoutes(app, {
    repository: {},
    service: service || createServiceStub(),
    getRequestIdentityContext: () => identityContext || { canonicalHash: 'canonical-1' },
    checkBanFor: (_req, _res, permission, _message, requestIdentityContext) => {
      onBan?.(permission, requestIdentityContext);
      return true;
    },
    enforceRateLimit: (_req, _res, action) => {
      onRate?.(action);
      return true;
    },
    verifyTurnstile: async (_token, _req, action) => {
      onTurnstile?.(action);
      return { ok: true };
    },
    privateFeaturesEnabled,
    sessionSecretConfigured,
  });
  return app.routes;
};

test('未配置稳定 SESSION_SECRET 时仅允许公共目录和 feed，私有读写明确返回 503', async () => {
  const routes = register({ privateFeaturesEnabled: false, sessionSecretConfigured: false });
  const catalogRes = createResponse();
  await routes.get('GET /api/recruitment/catalog')({}, catalogRes);
  assert.equal(catalogRes.statusCode, 200);

  const publishRes = createResponse();
  await routes.get('POST /api/recruitment/posts')({ body: {} }, publishRes);
  assert.equal(publishRes.statusCode, 503);
  const threadRes = createResponse();
  await routes.get('GET /api/recruitment/threads')({}, threadRes);
  assert.equal(threadRes.statusCode, 503);
});

test('legacy fingerprint 没有 canonicalHash 时不能访问 mine 或写入招募', async () => {
  const rates = [];
  const routes = register({
    identityContext: { canonicalHash: '', legacyFingerprintHash: 'legacy-only' },
    onRate: (action) => rates.push(action),
  });
  const mineRes = createResponse();
  await routes.get('GET /api/recruitment/posts')({ query: { mine: '1' } }, mineRes);
  assert.equal(mineRes.statusCode, 400);
  const publishRes = createResponse();
  await routes.get('POST /api/recruitment/posts')({ body: {} }, publishRes);
  assert.equal(publishRes.statusCode, 400);
  assert.deepEqual(rates, []);
});

test('密聊列表路由向服务层传递状态与分页筛选', async () => {
  let listInput = null;
  const routes = register({
    service: createServiceStub({
      listThreads: (input) => {
        listInput = input;
        return { items: [], total: 0, page: 2, limit: 10, unreadCount: 0 };
      },
    }),
  });
  const response = createResponse();

  await routes.get('GET /api/recruitment/threads')({
    query: { status: 'closed', page: '2', limit: '10' },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(listInput, {
    identityHash: 'canonical-1',
    status: 'closed',
    page: '2',
    limit: '10',
  });
});

test('私密招募响应禁止缓存并传递消息治理游标', async () => {
  let received;
  const routes = register({
    service: createServiceStub({
      listMessages: (payload) => {
        received = payload;
        return { items: [], moderationItems: [], moderationCursor: 7, hasMore: false };
      },
    }),
  });
  const res = createResponse();
  await routes.get('GET /api/recruitment/threads/:threadId/messages')({
    params: { threadId: 'thread-1' },
    query: {
      afterSeq: '3',
      afterModerationSeq: '6',
      includeContactExchanges: '1',
      limit: '20',
    },
  }, res);

  assert.equal(received.afterModerationSeq, '6');
  assert.equal(received.includeContactExchanges, true);
  assert.equal(res.getHeader('cache-control'), 'private, no-store, max-age=0');
  assert.match(res.getHeader('vary'), /Cookie/);
  assert.match(res.getHeader('vary'), /X-Client-Fingerprint/);
});

test('包含当前身份会话 ID 的公开招募响应同样禁止共享缓存', async () => {
  const routes = register();
  const listRes = createResponse();
  const detailRes = createResponse();

  await routes.get('GET /api/recruitment/posts')({ query: {} }, listRes);
  await routes.get('GET /api/recruitment/posts/:postId')({
    params: { postId: 'post-1' },
  }, detailRes);

  for (const response of [listRes, detailRes]) {
    assert.equal(response.getHeader('cache-control'), 'private, no-store, max-age=0');
    assert.match(response.getHeader('vary'), /Cookie/);
    assert.match(response.getHeader('vary'), /X-Client-Fingerprint/);
  }
});

test('消息发送调用 chat ban/rate hook，但不会调用 Turnstile', async () => {
  const rates = [];
  const bans = [];
  const turnstiles = [];
  const routes = register({ onRate: (action) => rates.push(action), onBan: (permission) => bans.push(permission), onTurnstile: (action) => turnstiles.push(action) });
  const response = createResponse();
  await routes.get('POST /api/recruitment/threads/:threadId/messages')({
    params: { threadId: 'thread-1' },
    body: { clientMsgId: 'client-1', content: '纯文本消息' },
  }, response);
  assert.equal(response.statusCode, 201);
  assert.deepEqual(rates, ['recruitment_message']);
  assert.deepEqual(bans, ['chat']);
  assert.deepEqual(turnstiles, []);
});

test('会话成员可关闭密聊且关闭动作幂等走独立写入入口', async () => {
  const rates = [];
  let closeInput = null;
  const routes = register({
    onRate: (action) => rates.push(action),
    service: createServiceStub({
      closeThread: (input) => {
        closeInput = input;
        return { id: input.threadId, status: 'closed' };
      },
    }),
  });
  const response = createResponse();

  await routes.get('POST /api/recruitment/threads/:threadId/close')({
    params: { threadId: 'thread-close-1' },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(closeInput, {
    threadId: 'thread-close-1',
    identityHash: 'canonical-1',
  });
  assert.equal(response.payload.thread.status, 'closed');
  assert.deepEqual(rates, ['recruitment_close']);
});

test('联系方式发起与同意均受 chat 封禁权限约束', async () => {
  const rates = [];
  const bans = [];
  const routes = register({
    onRate: (action) => rates.push(action),
    onBan: (permission) => bans.push(permission),
  });

  const createResponseValue = createResponse();
  await routes.get('POST /api/recruitment/threads/:threadId/contact-exchanges')({
    params: { threadId: 'thread-1' },
    body: { contact: { type: 'other', value: 'game-id' } },
  }, createResponseValue);

  const consentResponse = createResponse();
  await routes.get('POST /api/recruitment/contact-exchanges/:exchangeId/consent')({
    params: { exchangeId: 'exchange-1' },
    body: { contact: { type: 'other', value: 'game-id-2' } },
  }, consentResponse);

  assert.equal(createResponseValue.statusCode, 201);
  assert.equal(consentResponse.statusCode, 200);
  assert.deepEqual(bans, ['chat', 'chat']);
  assert.deepEqual(rates, ['recruitment_contact', 'recruitment_contact']);
});

test('招募风控传入完整身份上下文，保留关联的 legacy 指纹封禁检查', async () => {
  const identityContext = {
    canonicalHash: 'canonical-1',
    legacyFingerprintHash: 'legacy-1',
    lookupHashes: ['canonical-1', 'legacy-1'],
  };
  const banContexts = [];
  const routes = register({
    identityContext,
    onBan: (_permission, context) => banContexts.push(context),
  });
  const response = createResponse();

  await routes.get('POST /api/recruitment/threads/:threadId/messages')({
    params: { threadId: 'thread-1' },
    body: { clientMsgId: 'client-legacy-ban', content: '风控上下文测试' },
  }, response);

  assert.equal(response.statusCode, 201);
  assert.equal(banContexts.length, 1);
  assert.equal(banContexts[0], identityContext);
  assert.equal(banContexts[0].legacyFingerprintHash, 'legacy-1');
});
