import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import Database from 'better-sqlite3';

import { registerAdminWikiRoutes } from '../routes/admin/wiki-routes.js';
import { registerPublicWikiRoutes } from '../routes/public/wiki-routes.js';

const createRouteApp = () => {
  const routes = [];
  const addRoute = (method, path, handlers) => {
    routes.push({ method, path, handlers });
  };
  return {
    get(path, ...handlers) {
      addRoute('GET', path, handlers);
    },
    post(path, ...handlers) {
      addRoute('POST', path, handlers);
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

const matchRoute = (routePath, requestPath) => {
  const routeParts = routePath.split('/').filter(Boolean);
  const requestParts = requestPath.split('/').filter(Boolean);
  if (routeParts.length !== requestParts.length) {
    return null;
  }
  const params = {};
  for (let index = 0; index < routeParts.length; index += 1) {
    const routePart = routeParts[index];
    const requestPart = requestParts[index];
    if (routePart.startsWith(':')) {
      params[routePart.slice(1)] = decodeURIComponent(requestPart);
      continue;
    }
    if (routePart !== requestPart) {
      return null;
    }
  }
  return params;
};

const invoke = async (app, method, path, req = {}) => {
  const found = app.routes
    .map((route) => ({ route, params: route.method === method ? matchRoute(route.path, path) : null }))
    .find((item) => item.params);
  assert.ok(found, `route not found: ${method} ${path}`);
  const res = createResponse();
  const request = {
    body: {},
    query: {},
    params: found.params,
    session: { admin: { username: 'root' } },
    sessionID: 'session-1',
    headers: {},
    ...req,
  };
  let index = 0;
  const next = async () => {
    const handler = found.route.handlers[index];
    index += 1;
    if (!handler) {
      return;
    }
    if (handler.length >= 3) {
      await handler(request, res, next);
    } else {
      await handler(request, res);
      if (index < found.route.handlers.length) {
        await next();
      }
    }
  };
  await next();
  return res;
};

const createWikiDb = () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE wiki_entries (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      narrative TEXT NOT NULL,
      tags TEXT,
      display_order INTEGER,
      status TEXT NOT NULL DEFAULT 'approved',
      current_revision_id TEXT,
      version_number INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0,
      deleted_at INTEGER
    );

    CREATE TABLE wiki_entry_revisions (
      id TEXT PRIMARY KEY,
      entry_id TEXT,
      action_type TEXT NOT NULL,
      base_revision_id TEXT,
      base_version_number INTEGER NOT NULL DEFAULT 0,
      data_json TEXT NOT NULL,
      edit_summary TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      submitter_fingerprint TEXT,
      submitter_ip TEXT,
      created_at INTEGER NOT NULL,
      review_reason TEXT,
      reviewed_at INTEGER,
      reviewed_by TEXT
    );

    CREATE UNIQUE INDEX idx_wiki_entries_display_order_unique ON wiki_entries(display_order);
  `);
  return db;
};

const createWikiApp = (options = {}) => {
  const db = createWikiDb();
  const app = createRouteApp();
  const auditLogs = [];
  const webhookCalls = [];
  const containsSensitiveWord = options.containsSensitiveWord || (() => false);
  const wecomWebhookService = options.wecomWebhookService || {
    notifyWikiRevision: (payload) => {
      webhookCalls.push(payload);
      return Promise.resolve({ ok: true });
    },
  };
  registerPublicWikiRoutes(app, {
    db,
    requireFingerprint: () => 'fp-1',
    checkBanFor: () => true,
    enforceRateLimit: () => true,
    getClientIp: () => '127.0.0.1',
    verifyTurnstile: async () => ({ ok: true }),
    containsSensitiveWord,
    crypto,
    wecomWebhookService,
  });
  registerAdminWikiRoutes(app, {
    db,
    requireAdmin: (req, res, next) => next(),
    requireAdminCsrf: (req, res, next) => next(),
    logAdminAction: (req, payload) => auditLogs.push(payload),
    crypto,
    containsSensitiveWord,
  });
  return { app, db, auditLogs, webhookCalls };
};

const submitWikiEntry = (app, payload) => invoke(app, 'POST', '/api/wiki/submissions', {
  body: { ...payload, turnstileToken: 'ok' },
});

const submitWikiEdit = (app, slug, payload) => invoke(app, 'POST', `/api/wiki/entries/${encodeURIComponent(slug)}/edits`, {
  body: { ...payload, turnstileToken: 'ok' },
});

const approveRevision = (app, revisionId) => invoke(app, 'POST', `/api/admin/wiki/revisions/${revisionId}/action`, {
  body: { action: 'approve' },
});

test('Wiki list supports updated and number sorting with fallback', async () => {
  const { app, db } = createWikiApp();

  const firstRes = await submitWikiEntry(app, {
    name: 'first-entry',
    narrative: 'first narrative',
    tags: ['alpha'],
  });
  await approveRevision(app, firstRes.payload.id);

  const secondRes = await submitWikiEntry(app, {
    name: 'second-entry',
    narrative: 'second narrative',
    tags: ['beta'],
  });
  await approveRevision(app, secondRes.payload.id);

  db.prepare('UPDATE wiki_entries SET created_at = ?, updated_at = ? WHERE name = ?').run(1000, 4000, 'first-entry');
  db.prepare('UPDATE wiki_entries SET created_at = ?, updated_at = ? WHERE name = ?').run(2000, 5000, 'second-entry');

  const defaultList = await invoke(app, 'GET', '/api/wiki/entries');
  assert.deepEqual(defaultList.payload.items.map((item) => item.name), ['second-entry', 'first-entry']);

  const numberList = await invoke(app, 'GET', '/api/wiki/entries', {
    query: { sort: 'number' },
  });
  assert.deepEqual(numberList.payload.items.map((item) => item.name), ['first-entry', 'second-entry']);
  assert.deepEqual(numberList.payload.items.map((item) => item.displayOrder), [1, 2]);

  const fallbackList = await invoke(app, 'GET', '/api/wiki/entries', {
    query: { sort: 'unexpected' },
  });
  assert.deepEqual(fallbackList.payload.items.map((item) => item.name), ['second-entry', 'first-entry']);
});

test('Wiki list keeps global display order when filtered', async () => {
  const { app } = createWikiApp();

  const firstRes = await submitWikiEntry(app, {
    name: 'filter-one',
    narrative: 'shared tag first',
    tags: ['shared'],
  });
  await approveRevision(app, firstRes.payload.id);

  const secondRes = await submitWikiEntry(app, {
    name: 'filter-two',
    narrative: 'other tag second',
    tags: ['other'],
  });
  await approveRevision(app, secondRes.payload.id);

  const thirdRes = await submitWikiEntry(app, {
    name: 'filter-three',
    narrative: 'shared tag third',
    tags: ['shared'],
  });
  await approveRevision(app, thirdRes.payload.id);

  const filtered = await invoke(app, 'GET', '/api/wiki/entries', {
    query: { sort: 'number', tag: 'shared' },
  });
  assert.deepEqual(filtered.payload.items.map((item) => item.name), ['filter-one', 'filter-three']);
  assert.deepEqual(filtered.payload.items.map((item) => item.displayOrder), [1, 3]);
});

const rejectRevision = (app, revisionId) => invoke(app, 'POST', `/api/admin/wiki/revisions/${revisionId}/action`, {
  body: { action: 'reject', reason: '资料不足' },
});

test('Wiki 新瓜条投稿审核通过后公开，未审核前不可见', async () => {
  const { app, db, auditLogs, webhookCalls } = createWikiApp();
  const createRes = await submitWikiEntry(app, {
    name: '叶英',
    narrative: '心剑一成，万剑臣服。',
    tags: ['藏剑山庄', '庄主'],
  });

  assert.equal(createRes.statusCode, 201);
  const revisionId = createRes.payload.id;
  assert.equal(webhookCalls.length, 1);
  assert.equal(webhookCalls[0].actionType, 'create');
  assert.equal(webhookCalls[0].name, '叶英');

  const beforePublic = await invoke(app, 'GET', '/api/wiki/entries');
  assert.equal(beforePublic.payload.total, 0);

  const pending = db.prepare("SELECT * FROM wiki_entry_revisions WHERE status = 'pending'").all();
  assert.equal(pending.length, 1);

  const approveRes = await approveRevision(app, revisionId);
  assert.equal(approveRes.statusCode, 200);
  assert.equal(approveRes.payload.status, 'approved');

  const afterPublic = await invoke(app, 'GET', '/api/wiki/entries');
  assert.equal(afterPublic.payload.total, 1);
  assert.equal(afterPublic.payload.items[0].name, '叶英');
  assert.deepEqual(afterPublic.payload.items[0].tags, ['藏剑山庄', '庄主']);

  const detail = await invoke(app, 'GET', `/api/wiki/entries/${encodeURIComponent(afterPublic.payload.items[0].slug)}`);
  assert.equal(detail.payload.entry.narrative, '心剑一成，万剑臣服。');
  assert.equal(detail.payload.history.length, 1);
  assert.equal(detail.payload.history[0].status, 'approved');
  assert.equal(detail.payload.history[0].submitterIp, undefined);
  assert.equal(detail.payload.history[0].submitterFingerprint, undefined);
  assert.equal(detail.payload.history[0].reviewedBy, undefined);
  assert.ok(auditLogs.some((item) => item.action === 'wiki_revision_approve'));
});

test('Wiki 新建和编辑待审都会触发 webhook，失败不影响响应', async () => {
  const { app, webhookCalls } = createWikiApp();
  const createRes = await submitWikiEntry(app, {
    name: '公孙大娘',
    narrative: '一舞剑器动四方。',
    tags: ['七秀坊'],
  });
  assert.equal(createRes.statusCode, 201);
  assert.equal(webhookCalls.length, 1);
  assert.equal(webhookCalls[0].actionType, 'create');
  assert.deepEqual(webhookCalls[0].tags, ['七秀坊']);

  await approveRevision(app, createRes.payload.id);
  const list = await invoke(app, 'GET', '/api/wiki/entries');
  const editRes = await submitWikiEdit(app, list.payload.items[0].slug, {
    name: '公孙大娘',
    narrative: '一舞剑器动四方，红裳照水。',
    tags: ['七秀坊', '剑舞'],
    editSummary: '补充剑舞标签',
  });
  assert.equal(editRes.statusCode, 201);
  assert.equal(webhookCalls.length, 2);
  assert.equal(webhookCalls[1].actionType, 'edit');
  assert.equal(webhookCalls[1].editSummary, '补充剑舞标签');

  const failing = createWikiApp({
    wecomWebhookService: {
      notifyWikiRevision: () => Promise.reject(new Error('webhook failed')),
    },
  });
  const failedWebhookRes = await submitWikiEntry(failing.app, {
    name: '东方宇宣',
    narrative: '笔墨可定乾坤。',
    tags: ['万花谷'],
  });
  assert.equal(failedWebhookRes.statusCode, 201);
});

test('Wiki 列表展示编号按创建顺序递增，不受列表倒序影响', async () => {
  const { app } = createWikiApp();

  const firstRes = await submitWikiEntry(app, {
    name: '第一条',
    narrative: '最早创建的瓜条。',
    tags: ['测试'],
  });
  await approveRevision(app, firstRes.payload.id);

  const secondRes = await submitWikiEntry(app, {
    name: '第二条',
    narrative: '后创建的瓜条。',
    tags: ['测试'],
  });
  await approveRevision(app, secondRes.payload.id);

  const list = await invoke(app, 'GET', '/api/wiki/entries');
  assert.equal(list.payload.total, 2);
  const displayOrderByName = Object.fromEntries(list.payload.items.map((item) => [item.name, item.displayOrder]));
  assert.equal(displayOrderByName.第一条, 1);
  assert.equal(displayOrderByName.第二条, 2);
});

test('Wiki 编号使用持久字段，不受 created_at 变更影响', async () => {
  const { app, db } = createWikiApp();

  const firstRes = await submitWikiEntry(app, {
    name: '编号首条',
    narrative: '第一条记录。',
    tags: ['测试'],
  });
  await approveRevision(app, firstRes.payload.id);

  const secondRes = await submitWikiEntry(app, {
    name: '编号二条',
    narrative: '第二条记录。',
    tags: ['测试'],
  });
  await approveRevision(app, secondRes.payload.id);

  db.prepare('UPDATE wiki_entries SET created_at = ? WHERE name = ?').run(1, '编号二条');
  db.prepare('UPDATE wiki_entries SET created_at = ? WHERE name = ?').run(999999999999, '编号首条');

  const numberList = await invoke(app, 'GET', '/api/wiki/entries', {
    query: { sort: 'number' },
  });
  assert.deepEqual(numberList.payload.items.map((item) => item.name), ['编号首条', '编号二条']);
  assert.deepEqual(numberList.payload.items.map((item) => item.displayOrder), [1, 2]);
});

test('Wiki 管理创建在编号冲突后会自动重试', async () => {
  const { app, db } = createWikiApp();
  const originalPrepare = db.prepare.bind(db);
  let shouldFailFirstInsert = true;

  db.prepare = (sql) => {
    const statement = originalPrepare(sql);
    if (!shouldFailFirstInsert || !String(sql).includes('INSERT INTO wiki_entries')) {
      return statement;
    }

    return new Proxy(statement, {
      get(target, prop, receiver) {
        if (prop === 'run') {
          return () => {
            shouldFailFirstInsert = false;
            throw new Error('UNIQUE constraint failed: wiki_entries.display_order');
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  };

  const createRes = await invoke(app, 'POST', '/api/admin/wiki/entries', {
    body: {
      name: '冲突后重试',
      narrative: '管理员创建的条目。',
      tags: ['测试'],
      editSummary: '验证编号冲突重试',
    },
  });

  assert.equal(createRes.statusCode, 201);
  const numberList = await invoke(app, 'GET', '/api/wiki/entries', {
    query: { sort: 'number' },
  });
  assert.deepEqual(numberList.payload.items.map((item) => item.name), ['冲突后重试']);
  assert.deepEqual(numberList.payload.items.map((item) => item.displayOrder), [1]);
});

test('Wiki 审核通过在编号冲突后会自动重试', async () => {
  const { app, db } = createWikiApp();
  const createRes = await submitWikiEntry(app, {
    name: '待审核冲突重试',
    narrative: '等待审核通过的条目。',
    tags: ['测试'],
  });

  const originalPrepare = db.prepare.bind(db);
  let shouldFailFirstInsert = true;

  db.prepare = (sql) => {
    const statement = originalPrepare(sql);
    if (!shouldFailFirstInsert || !String(sql).includes('INSERT INTO wiki_entries')) {
      return statement;
    }

    return new Proxy(statement, {
      get(target, prop, receiver) {
        if (prop === 'run') {
          return () => {
            shouldFailFirstInsert = false;
            throw new Error('UNIQUE constraint failed: wiki_entries.display_order');
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  };

  const approveRes = await approveRevision(app, createRes.payload.id);
  assert.equal(approveRes.statusCode, 200);

  const numberList = await invoke(app, 'GET', '/api/wiki/entries', {
    query: { sort: 'number' },
  });
  assert.deepEqual(numberList.payload.items.map((item) => item.name), ['待审核冲突重试']);
  assert.deepEqual(numberList.payload.items.map((item) => item.displayOrder), [1]);
});

test('Wiki 编辑待审不影响公开内容，拒绝后不进入公开历史', async () => {
  const { app } = createWikiApp();
  const createRes = await submitWikiEntry(app, {
    name: '李忘生',
    narrative: '太极两仪，皆在袖间。',
    tags: ['纯阳宫'],
  });
  await approveRevision(app, createRes.payload.id);
  const list = await invoke(app, 'GET', '/api/wiki/entries');
  const slug = list.payload.items[0].slug;

  const missingReasonRes = await submitWikiEdit(app, slug, {
    name: '李忘生',
    narrative: '这是没有修改原因的新版记录。',
    tags: ['纯阳宫', '掌教'],
  });
  assert.equal(missingReasonRes.statusCode, 400);

  const editRes = await submitWikiEdit(app, slug, {
    name: '李忘生',
    narrative: '这是尚未通过的新版记录。',
    tags: ['纯阳宫', '掌教'],
    editSummary: '补充掌教标签',
  });
  assert.equal(editRes.statusCode, 201);

  const beforeReject = await invoke(app, 'GET', `/api/wiki/entries/${encodeURIComponent(slug)}`);
  assert.equal(beforeReject.payload.entry.narrative, '太极两仪，皆在袖间。');
  assert.equal(beforeReject.payload.history.length, 1);

  await rejectRevision(app, editRes.payload.id);
  const afterReject = await invoke(app, 'GET', `/api/wiki/entries/${encodeURIComponent(slug)}`);
  assert.equal(afterReject.payload.entry.narrative, '太极两仪，皆在袖间。');
  assert.equal(afterReject.payload.history.length, 1);
});

test('Wiki 编辑审核通过后覆盖当前版本并追加公开历史，删除后不可见', async () => {
  const { app } = createWikiApp();
  const createRes = await submitWikiEntry(app, {
    name: '李承恩',
    narrative: '长枪所向，守我大唐。',
    tags: ['天策府'],
  });
  await approveRevision(app, createRes.payload.id);
  const list = await invoke(app, 'GET', '/api/wiki/entries');
  const entry = list.payload.items[0];

  const editRes = await submitWikiEdit(app, entry.slug, {
    name: '李承恩',
    narrative: '长枪所向，守我大唐。他是不倒的铁血军魂。',
    tags: ['天策府', '统领'],
    editSummary: '补充军魂描述',
  });
  await approveRevision(app, editRes.payload.id);

  const detail = await invoke(app, 'GET', `/api/wiki/entries/${encodeURIComponent(entry.slug)}`);
  assert.equal(detail.payload.entry.narrative, '长枪所向，守我大唐。他是不倒的铁血军魂。');
  assert.equal(detail.payload.entry.versionNumber, 2);
  assert.equal(detail.payload.history.length, 2);
  assert.deepEqual(detail.payload.entry.tags, ['天策府', '统领']);

  const deleteRes = await invoke(app, 'POST', `/api/admin/wiki/entries/${entry.id}/action`, {
    body: { action: 'delete', reason: '测试删除' },
  });
  assert.equal(deleteRes.statusCode, 200);

  const publicAfterDelete = await invoke(app, 'GET', '/api/wiki/entries');
  assert.equal(publicAfterDelete.payload.total, 0);
  const detailAfterDelete = await invoke(app, 'GET', `/api/wiki/entries/${encodeURIComponent(entry.slug)}`);
  assert.equal(detailAfterDelete.statusCode, 404);
});

test('Wiki 旧待审编辑不能覆盖已经更新的公开版本', async () => {
  const { app } = createWikiApp();
  const createRes = await submitWikiEntry(app, {
    name: '叶英',
    narrative: '初始记录。',
    tags: ['藏剑山庄'],
  });
  await approveRevision(app, createRes.payload.id);
  const list = await invoke(app, 'GET', '/api/wiki/entries');
  const entry = list.payload.items[0];

  const oldEditRes = await submitWikiEdit(app, entry.slug, {
    name: '叶英',
    narrative: '较旧的编辑。',
    tags: ['藏剑山庄', '庄主'],
    editSummary: '旧版本补充',
  });
  const newEditRes = await submitWikiEdit(app, entry.slug, {
    name: '叶英',
    narrative: '较新的编辑。',
    tags: ['藏剑山庄', '心剑'],
    editSummary: '新版本补充',
  });

  const newApproveRes = await approveRevision(app, newEditRes.payload.id);
  assert.equal(newApproveRes.statusCode, 200);
  const oldApproveRes = await approveRevision(app, oldEditRes.payload.id);
  assert.equal(oldApproveRes.statusCode, 400);

  const detail = await invoke(app, 'GET', `/api/wiki/entries/${encodeURIComponent(entry.slug)}`);
  assert.equal(detail.payload.entry.narrative, '较新的编辑。');
  assert.equal(detail.payload.entry.versionNumber, 2);
  assert.equal(detail.payload.history.length, 2);
});

test('Wiki 投稿、编辑和后台编辑不走敏感词校验', async () => {
  const { app } = createWikiApp({
    containsSensitiveWord: () => true,
  });

  const createRes = await submitWikiEntry(app, {
    name: '敏感词测试瓜条',
    narrative: '这里即使命中违禁词系统，也应该允许进入待审核。',
    tags: ['测试'],
  });
  assert.equal(createRes.statusCode, 201);

  await approveRevision(app, createRes.payload.id);
  const list = await invoke(app, 'GET', '/api/wiki/entries');
  const entry = list.payload.items[0];

  const editRes = await submitWikiEdit(app, entry.slug, {
    name: '敏感词测试瓜条',
    narrative: '前台编辑同样不应该被违禁词系统拦截。',
    tags: ['测试', '编辑'],
    editSummary: '验证前台编辑',
  });
  assert.equal(editRes.statusCode, 201);

  const adminEditRes = await invoke(app, 'POST', `/api/admin/wiki/entries/${entry.id}/edit`, {
    body: {
      name: '敏感词测试瓜条-后台',
      narrative: '后台直接编辑也不应该走违禁词校验。',
      tags: ['测试', '后台'],
      editSummary: '验证后台编辑',
    },
  });
  assert.equal(adminEditRes.statusCode, 200);
  assert.equal(adminEditRes.payload.entry.name, '敏感词测试瓜条-后台');
});

test('Wiki 前台投稿和编辑会保留 Markdown 原文', async () => {
  const { app } = createWikiApp();
  const createMarkdown = '## 标题\n\n- 第一条\n- 第二条\n\n[链接](https://example.com)';
  const createRes = await submitWikiEntry(app, {
    name: 'markdown-front',
    narrative: createMarkdown,
    tags: ['测试'],
  });
  assert.equal(createRes.statusCode, 201);
  await approveRevision(app, createRes.payload.id);

  const list = await invoke(app, 'GET', '/api/wiki/entries');
  const slug = list.payload.items[0].slug;
  const detailAfterCreate = await invoke(app, 'GET', `/api/wiki/entries/${encodeURIComponent(slug)}`);
  assert.equal(detailAfterCreate.payload.entry.narrative, createMarkdown);
  assert.equal(detailAfterCreate.payload.history[0].data.narrative, createMarkdown);

  const editMarkdown = '> 引用段落\n\n**加粗内容** 与 `代码`';
  const editRes = await submitWikiEdit(app, slug, {
    name: 'markdown-front',
    narrative: editMarkdown,
    tags: ['测试', '编辑'],
    editSummary: '补充 Markdown 内容',
  });
  assert.equal(editRes.statusCode, 201);
  await approveRevision(app, editRes.payload.id);

  const detailAfterEdit = await invoke(app, 'GET', `/api/wiki/entries/${encodeURIComponent(slug)}`);
  assert.equal(detailAfterEdit.payload.entry.narrative, editMarkdown);
  assert.equal(detailAfterEdit.payload.history.length, 2);
  assert.equal(detailAfterEdit.payload.history[0].data.narrative, editMarkdown);
  assert.equal(detailAfterEdit.payload.history[1].data.narrative, createMarkdown);
});

test('Wiki 后台新建和编辑会保留 Markdown 原文', async () => {
  const { app } = createWikiApp();
  const adminCreateMarkdown = '## 后台创建\n\n- 条目一\n- 条目二';
  const adminCreateRes = await invoke(app, 'POST', '/api/admin/wiki/entries', {
    body: {
      name: 'markdown-admin',
      narrative: adminCreateMarkdown,
      tags: ['后台'],
      editSummary: '管理员创建 Markdown',
    },
  });
  assert.equal(adminCreateRes.statusCode, 201);
  assert.equal(adminCreateRes.payload.entry.narrative, adminCreateMarkdown);

  const detailAfterCreate = await invoke(
    app,
    'GET',
    `/api/wiki/entries/${encodeURIComponent(adminCreateRes.payload.entry.slug)}`
  );
  assert.equal(detailAfterCreate.payload.entry.narrative, adminCreateMarkdown);
  assert.equal(detailAfterCreate.payload.history[0].data.narrative, adminCreateMarkdown);

  const adminEditMarkdown = '1. 更新条目\n2. 保留列表\n\n`后台代码`';
  const adminEditRes = await invoke(app, 'POST', `/api/admin/wiki/entries/${adminCreateRes.payload.entry.id}/edit`, {
    body: {
      name: 'markdown-admin',
      narrative: adminEditMarkdown,
      tags: ['后台', '编辑'],
      editSummary: '管理员编辑 Markdown',
    },
  });
  assert.equal(adminEditRes.statusCode, 200);
  assert.equal(adminEditRes.payload.entry.narrative, adminEditMarkdown);

  const detailAfterEdit = await invoke(
    app,
    'GET',
    `/api/wiki/entries/${encodeURIComponent(adminEditRes.payload.entry.slug)}`
  );
  assert.equal(detailAfterEdit.payload.entry.narrative, adminEditMarkdown);
  assert.equal(detailAfterEdit.payload.history.length, 2);
  assert.equal(detailAfterEdit.payload.history[0].data.narrative, adminEditMarkdown);
  assert.equal(detailAfterEdit.payload.history[1].data.narrative, adminCreateMarkdown);
});
