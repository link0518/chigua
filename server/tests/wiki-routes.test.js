import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import Database from 'better-sqlite3';

import { registerAdminWikiRoutes } from '../routes/admin/wiki-routes.js';
import { registerPublicWikiRoutes } from '../routes/public/wiki-routes.js';
import {
  buildWikiAttachmentValidationOptions,
  sanitizeWikiPayload,
} from '../wiki-utils.js';

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
      related_post_ids_json TEXT NOT NULL DEFAULT '[]',
      attachments_json TEXT NOT NULL DEFAULT '[]',
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

    CREATE TABLE posts (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0,
      hidden INTEGER NOT NULL DEFAULT 0
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
    getRuntimeConfig: () => options.runtimeConfig || {
      imgbedBaseUrl: 'https://img.example',
      wikiAttachmentAllowedOrigins: ['https://legacy-img.example'],
    },
  });
  registerAdminWikiRoutes(app, {
    db,
    requireAdmin: (req, res, next) => next(),
    requireAdminCsrf: (req, res, next) => next(),
    logAdminAction: (req, payload) => auditLogs.push(payload),
    crypto,
    containsSensitiveWord,
    getRuntimeConfig: () => options.runtimeConfig || {
      imgbedBaseUrl: 'https://img.example',
      wikiAttachmentAllowedOrigins: ['https://legacy-img.example'],
    },
  });
  return { app, db, auditLogs, webhookCalls };
};

const insertPost = (db, id, content = `帖子 ${id}`) => {
  db.prepare(
    'INSERT INTO posts (id, content, deleted, hidden) VALUES (?, ?, 0, 0)'
  ).run(id, content);
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

const changeRevisionStatusAfterPendingRead = (db, nextStatus) => {
  const originalPrepare = db.prepare.bind(db);
  let injected = false;
  db.prepare = (sql) => {
    const statement = originalPrepare(sql);
    if (injected || !String(sql).includes('SELECT wiki_entry_revisions.*')) {
      return statement;
    }
    return new Proxy(statement, {
      get(target, prop, receiver) {
        if (prop === 'get') {
          return (...args) => {
            const row = target.get(...args);
            if (row && !injected) {
              injected = true;
              originalPrepare('UPDATE wiki_entry_revisions SET status = ? WHERE id = ?')
                .run(nextStatus, args[0]);
            }
            return row;
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  };
  return () => {
    db.prepare = originalPrepare;
  };
};

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

test('Wiki 重复通过同一创建修订不会生成第二条瓜条', async () => {
  const { app, db, auditLogs } = createWikiApp();
  const createRes = await submitWikiEntry(app, {
    name: '重复审核保护',
    narrative: '同一修订只能通过一次。',
    tags: ['测试'],
  });

  const firstApprove = await approveRevision(app, createRes.payload.id);
  const secondApprove = await approveRevision(app, createRes.payload.id);

  assert.equal(firstApprove.statusCode, 200);
  assert.equal(secondApprove.statusCode, 400);
  assert.equal(secondApprove.payload.error, '该记录已处理');
  assert.equal(db.prepare('SELECT COUNT(1) AS count FROM wiki_entries').get().count, 1);
  assert.equal(
    auditLogs.filter((item) => item.action === 'wiki_revision_approve').length,
    1
  );
});

test('Wiki 通过在读取后被其他请求抢先拒绝时不会覆盖状态或创建瓜条', async () => {
  const { app, db, auditLogs } = createWikiApp();
  const createRes = await submitWikiEntry(app, {
    name: '通过竞争保护',
    narrative: '读取后被另一请求先拒绝。',
    tags: ['测试'],
  });
  const restorePrepare = changeRevisionStatusAfterPendingRead(db, 'rejected');

  let approveRes;
  try {
    approveRes = await approveRevision(app, createRes.payload.id);
  } finally {
    restorePrepare();
  }

  assert.equal(approveRes.statusCode, 400);
  assert.equal(approveRes.payload.error, '该记录已处理');
  assert.equal(db.prepare('SELECT COUNT(1) AS count FROM wiki_entries').get().count, 0);
  assert.equal(
    db.prepare('SELECT status FROM wiki_entry_revisions WHERE id = ?').get(createRes.payload.id).status,
    'rejected'
  );
  assert.equal(
    auditLogs.filter((item) => item.action === 'wiki_revision_approve').length,
    0
  );
});

test('Wiki 拒绝在读取后被其他请求抢先通过时不会覆盖最终状态', async () => {
  const { app, db, auditLogs } = createWikiApp();
  const createRes = await submitWikiEntry(app, {
    name: '拒绝竞争保护',
    narrative: '读取后被另一请求先通过。',
    tags: ['测试'],
  });
  const restorePrepare = changeRevisionStatusAfterPendingRead(db, 'approved');

  let rejectRes;
  try {
    rejectRes = await invoke(app, 'POST', `/api/admin/wiki/revisions/${createRes.payload.id}/action`, {
      body: { action: 'reject', reason: '竞争测试' },
    });
  } finally {
    restorePrepare();
  }

  assert.equal(rejectRes.statusCode, 400);
  assert.equal(rejectRes.payload.error, '该记录已处理');
  assert.equal(
    db.prepare('SELECT status FROM wiki_entry_revisions WHERE id = ?').get(createRes.payload.id).status,
    'approved'
  );
  assert.equal(
    auditLogs.filter((item) => item.action === 'wiki_revision_reject').length,
    0
  );
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

test('Wiki 多关联帖子和附件会进入完整修订快照并在详情返回当前帖子状态', async () => {
  const { app, db } = createWikiApp();
  insertPost(db, 'post-a', '第一条相关帖子正文');
  insertPost(db, 'post-b', '第二条相关帖子正文');
  const attachments = [
    {
      title: '聊天记录',
      imageUrls: [
        'https://img.example/images/chat-1.png',
        'https://img.example/images/chat-2.png',
      ],
    },
    {
      title: '旧图床证据',
      imageUrls: ['https://legacy-img.example/archive/proof.webp'],
    },
  ];

  const createRes = await submitWikiEntry(app, {
    name: '完整资料瓜条',
    narrative: '包含多个相关帖子和多组附件。',
    tags: ['资料'],
    relatedPostIds: ['post-b', 'post-a'],
    attachments,
  });
  assert.equal(createRes.statusCode, 201);

  const pendingRow = db.prepare('SELECT data_json FROM wiki_entry_revisions WHERE id = ?')
    .get(createRes.payload.id);
  assert.deepEqual(JSON.parse(pendingRow.data_json), {
    name: '完整资料瓜条',
    narrative: '包含多个相关帖子和多组附件。',
    tags: ['资料'],
    relatedPostIds: ['post-b', 'post-a'],
    attachments,
  });

  const pendingList = await invoke(app, 'GET', '/api/admin/wiki/revisions', {
    query: { status: 'pending' },
  });
  assert.deepEqual(
    pendingList.payload.items[0].relatedPosts.map((post) => [post.id, post.available]),
    [['post-b', true], ['post-a', true]]
  );

  await approveRevision(app, createRes.payload.id);
  const publicList = await invoke(app, 'GET', '/api/wiki/entries');
  assert.equal(Object.prototype.hasOwnProperty.call(publicList.payload.items[0], 'attachments'), false);
  assert.deepEqual(publicList.payload.items[0].relatedPostIds, ['post-b', 'post-a']);

  const detail = await invoke(
    app,
    'GET',
    `/api/wiki/entries/${encodeURIComponent(publicList.payload.items[0].slug)}`
  );
  assert.deepEqual(detail.payload.entry.attachments, attachments);
  assert.deepEqual(
    detail.payload.entry.relatedPosts.map((post) => [post.id, post.available, post.excerpt]),
    [
      ['post-b', true, '第二条相关帖子正文'],
      ['post-a', true, '第一条相关帖子正文'],
    ]
  );
  assert.deepEqual(detail.payload.history[0].data.relatedPostIds, ['post-b', 'post-a']);
  assert.deepEqual(detail.payload.history[0].data.attachments, attachments);

  db.prepare('UPDATE posts SET hidden = 1 WHERE id = ?').run('post-b');
  const hiddenDetail = await invoke(
    app,
    'GET',
    `/api/wiki/entries/${encodeURIComponent(publicList.payload.items[0].slug)}`
  );
  assert.deepEqual(hiddenDetail.payload.entry.relatedPosts[0], {
    id: 'post-b',
    available: false,
  });
  assert.equal(hiddenDetail.payload.entry.relatedPosts[1].available, true);

  const adminEntries = await invoke(app, 'GET', '/api/admin/wiki/entries');
  assert.deepEqual(adminEntries.payload.items[0].attachments, attachments);
  assert.equal(adminEntries.payload.items[0].relatedPosts[0].available, false);
});

test('Wiki 服务端严格拒绝超限附件、重复图片和非白名单图床地址', async () => {
  const { app } = createWikiApp();
  const basePayload = {
    name: '附件边界测试',
    narrative: '验证服务端附件约束。',
    tags: ['测试'],
  };
  const cases = [
    {
      relatedPostIds: ['1', '2', '3', '4', '5', '6'],
      expected: /相关帖子最多 5 个/,
    },
    {
      attachments: Array.from({ length: 6 }, (_, index) => ({
        title: `附件${index + 1}`,
        imageUrls: [`https://img.example/images/${index + 1}.png`],
      })),
      expected: /附件最多 5 组/,
    },
    {
      attachments: [{
        title: '单组过多',
        imageUrls: [1, 2, 3, 4].map((index) => `https://img.example/images/group-${index}.png`),
      }],
      expected: /需包含 1-3 张图片/,
    },
    {
      attachments: [
        { title: '一', imageUrls: [1, 2, 3].map((i) => `https://img.example/a-${i}.png`) },
        { title: '二', imageUrls: [1, 2, 3].map((i) => `https://img.example/b-${i}.png`) },
        { title: '三', imageUrls: [1, 2, 3].map((i) => `https://img.example/c-${i}.png`) },
        { title: '四', imageUrls: [1, 2].map((i) => `https://img.example/d-${i}.png`) },
      ],
      expected: /总数不能超过 10 张/,
    },
    {
      attachments: [{
        title: '',
        imageUrls: ['https://img.example/images/empty-title.png'],
      }],
      expected: /附件标题需为 1-60 个字符/,
    },
    {
      attachments: [{
        title: '重复图片',
        imageUrls: [
          'https://img.example/images/repeated.png',
          'https://img.example/images/repeated.png',
        ],
      }],
      expected: /不能重复使用相同的附件图片/,
    },
    {
      attachments: [{
        title: '外部图床',
        imageUrls: ['https://outside.example/images/proof.png'],
      }],
      expected: /不在允许的图床范围内/,
    },
    {
      attachments: [{
        title: '非法协议',
        imageUrls: ['data:image/png;base64,AAAA'],
      }],
      expected: /无效图片地址/,
    },
  ];

  for (const [index, item] of cases.entries()) {
    const res = await submitWikiEntry(app, {
      ...basePayload,
      name: `${basePayload.name}-${index + 1}`,
      ...item,
    });
    assert.equal(res.statusCode, 400);
    assert.match(res.payload.error, item.expected);
  }
});

test('Wiki 编辑缺少新字段时继承，显式空数组会清空，管理员编辑也写入完整快照', async () => {
  const { app, db } = createWikiApp();
  insertPost(db, 'post-inherit', '需要继承的帖子');
  const attachments = [{
    title: '原始附件',
    imageUrls: ['https://img.example/images/original.png'],
  }];
  const createRes = await submitWikiEntry(app, {
    name: '继承测试',
    narrative: '初始正文。',
    tags: ['测试'],
    relatedPostIds: ['post-inherit'],
    attachments,
  });
  await approveRevision(app, createRes.payload.id);
  const initialList = await invoke(app, 'GET', '/api/wiki/entries');
  const initialEntry = initialList.payload.items[0];

  const editRes = await submitWikiEdit(app, initialEntry.slug, {
    name: '继承测试',
    narrative: '前台编辑正文。',
    tags: ['测试'],
    editSummary: '只修改正文',
  });
  const editSnapshot = JSON.parse(
    db.prepare('SELECT data_json FROM wiki_entry_revisions WHERE id = ?').get(editRes.payload.id).data_json
  );
  assert.deepEqual(editSnapshot.relatedPostIds, ['post-inherit']);
  assert.deepEqual(editSnapshot.attachments, attachments);
  await approveRevision(app, editRes.payload.id);

  const adminEditRes = await invoke(app, 'POST', `/api/admin/wiki/entries/${initialEntry.id}/edit`, {
    body: {
      name: '继承测试',
      narrative: '管理员继续只修改正文。',
      tags: ['测试', '后台'],
      editSummary: '后台补充正文',
    },
  });
  assert.equal(adminEditRes.statusCode, 200);
  assert.deepEqual(adminEditRes.payload.entry.relatedPostIds, ['post-inherit']);
  assert.deepEqual(adminEditRes.payload.entry.attachments, attachments);
  const adminSnapshot = JSON.parse(
    db.prepare('SELECT data_json FROM wiki_entry_revisions WHERE id = ?')
      .get(adminEditRes.payload.entry.currentRevisionId).data_json
  );
  assert.deepEqual(adminSnapshot.relatedPostIds, ['post-inherit']);
  assert.deepEqual(adminSnapshot.attachments, attachments);

  const clearRes = await submitWikiEdit(app, adminEditRes.payload.entry.slug, {
    name: '继承测试',
    narrative: '清空相关资料。',
    tags: ['测试'],
    relatedPostIds: [],
    attachments: [],
    editSummary: '清空相关资料',
  });
  assert.equal(clearRes.statusCode, 201);
  await approveRevision(app, clearRes.payload.id);
  const detail = await invoke(
    app,
    'GET',
    `/api/wiki/entries/${encodeURIComponent(adminEditRes.payload.entry.slug)}`
  );
  assert.deepEqual(detail.payload.entry.relatedPostIds, []);
  assert.deepEqual(detail.payload.entry.relatedPosts, []);
  assert.deepEqual(detail.payload.entry.attachments, []);
});

test('Wiki 关联帖子在提交及审核时都必须保持公开，审核失败不会产生半成品', async () => {
  const { app, db } = createWikiApp();
  const missingPostRes = await submitWikiEntry(app, {
    name: '不存在帖子',
    narrative: '不应进入待审。',
    tags: ['测试'],
    relatedPostIds: ['missing-post'],
  });
  assert.equal(missingPostRes.statusCode, 400);
  assert.match(missingPostRes.payload.error, /不存在或已不可用/);

  insertPost(db, 'post-review', '审核期间可能失效的帖子');
  const createRes = await submitWikiEntry(app, {
    name: '审核二次校验',
    narrative: '提交时帖子公开。',
    tags: ['测试'],
    relatedPostIds: ['post-review'],
  });
  assert.equal(createRes.statusCode, 201);
  db.prepare('UPDATE posts SET hidden = 1 WHERE id = ?').run('post-review');

  const failedApprove = await approveRevision(app, createRes.payload.id);
  assert.equal(failedApprove.statusCode, 400);
  assert.match(failedApprove.payload.error, /不存在或已不可用/);
  assert.equal(db.prepare('SELECT COUNT(1) AS count FROM wiki_entries').get().count, 0);
  assert.equal(
    db.prepare('SELECT status FROM wiki_entry_revisions WHERE id = ?').get(createRes.payload.id).status,
    'pending'
  );

  db.prepare('UPDATE posts SET hidden = 0 WHERE id = ?').run('post-review');
  const successfulApprove = await approveRevision(app, createRes.payload.id);
  assert.equal(successfulApprove.statusCode, 200);
});

test('Wiki 审核旧格式编辑时会继承当前相关帖子和附件而不是静默清空', async () => {
  const { app, db } = createWikiApp();
  insertPost(db, 'post-legacy-revision', '旧修订需要继承的帖子');
  const attachments = [{
    title: '保留附件',
    imageUrls: ['https://img.example/images/keep.png'],
  }];
  const createRes = await submitWikiEntry(app, {
    name: '旧修订兼容',
    narrative: '当前公开正文。',
    tags: ['测试'],
    relatedPostIds: ['post-legacy-revision'],
    attachments,
  });
  await approveRevision(app, createRes.payload.id);
  const entry = db.prepare('SELECT * FROM wiki_entries').get();
  db.prepare(
    `
    INSERT INTO wiki_entry_revisions (
      id,
      entry_id,
      action_type,
      base_revision_id,
      base_version_number,
      data_json,
      edit_summary,
      status,
      created_at
    ) VALUES (?, ?, 'edit', ?, ?, ?, ?, 'pending', ?)
    `
  ).run(
    'legacy-edit-revision',
    entry.id,
    entry.current_revision_id,
    entry.version_number,
    JSON.stringify({
      name: '旧修订兼容',
      narrative: '旧客户端提交的新正文。',
      tags: ['测试', '旧客户端'],
    }),
    '旧客户端编辑',
    Date.now()
  );

  const approveRes = await approveRevision(app, 'legacy-edit-revision');
  assert.equal(approveRes.statusCode, 200);
  const detail = await invoke(app, 'GET', `/api/wiki/entries/${encodeURIComponent(entry.slug)}`);
  assert.deepEqual(detail.payload.entry.relatedPostIds, ['post-legacy-revision']);
  assert.deepEqual(detail.payload.entry.attachments, attachments);
  assert.deepEqual(detail.payload.history[0].data.relatedPostIds, ['post-legacy-revision']);
  assert.deepEqual(detail.payload.history[0].data.attachments, attachments);
});

test('Wiki 管理员创建含相关帖子和附件时生成完整 approved revision', async () => {
  const { app, db } = createWikiApp();
  insertPost(db, 'post-admin-create', '管理员关联帖子');
  const attachments = [{
    title: '管理员附件',
    imageUrls: ['https://img.example/images/admin.png'],
  }];
  const createRes = await invoke(app, 'POST', '/api/admin/wiki/entries', {
    body: {
      name: '管理员完整创建',
      narrative: '管理员直接创建。',
      tags: ['后台'],
      relatedPostIds: ['post-admin-create'],
      attachments,
      editSummary: '管理员创建完整资料',
    },
  });
  assert.equal(createRes.statusCode, 201);
  assert.deepEqual(createRes.payload.entry.relatedPostIds, ['post-admin-create']);
  assert.deepEqual(createRes.payload.entry.attachments, attachments);
  assert.equal(createRes.payload.entry.relatedPosts[0].available, true);

  const revision = db.prepare('SELECT * FROM wiki_entry_revisions').get();
  assert.equal(revision.status, 'approved');
  assert.deepEqual(JSON.parse(revision.data_json), {
    name: '管理员完整创建',
    narrative: '管理员直接创建。',
    tags: ['后台'],
    relatedPostIds: ['post-admin-create'],
    attachments,
  });
});

test('Wiki 新写入附件始终拒绝外部 HTTP 地址', () => {
  const payload = sanitizeWikiPayload({
    name: 'HTTPS 校验',
    narrative: '外部附件必须使用 HTTPS。',
    tags: ['测试'],
    attachments: [{
      title: 'HTTP 图片',
      imageUrls: ['http://img.example/images/insecure.png'],
    }],
  }, buildWikiAttachmentValidationOptions({
    imgbedBaseUrl: 'http://img.example',
  }));
  assert.equal(payload.ok, false);
  assert.equal(payload.error, '附件图片必须使用 HTTPS 地址（本地回环地址除外）');
});

test('Wiki 本地回环 HTTP 图床可用于开发环境', () => {
  const loopbackOrigins = [
    'http://localhost:8080',
    'http://assets.localhost:8080',
    'http://127.23.45.67:8080',
    'http://[::1]:8080',
  ];
  for (const origin of loopbackOrigins) {
    const payload = sanitizeWikiPayload({
      name: '本地图床校验',
      narrative: '本地开发允许回环 HTTP 图床。',
      tags: ['测试'],
      attachments: [{
        title: '本地图片',
        imageUrls: [`${origin}/images/local.png`],
      }],
    }, buildWikiAttachmentValidationOptions({
      imgbedBaseUrl: origin,
    }));
    assert.equal(payload.ok, true, `${origin} 应允许回环 HTTP 附件`);
  }
});

test('Wiki 两个默认可信 HTTPS 图床无需额外配置即可使用', () => {
  const payload = sanitizeWikiPayload({
    name: '默认图床校验',
    narrative: '默认可信图床应直接通过。',
    tags: ['测试'],
    attachments: [
      {
        title: '默认图床一',
        imageUrls: ['https://img.zsix.de/images/default-a.png'],
      },
      {
        title: '默认图床二',
        imageUrls: ['https://ibed.933211.xyz/images/default-b.png'],
      },
    ],
  }, buildWikiAttachmentValidationOptions());
  assert.equal(payload.ok, true);
});
