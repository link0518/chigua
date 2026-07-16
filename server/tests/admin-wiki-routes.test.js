import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { registerAdminWikiRoutes } from '../routes/admin/wiki-routes.js';

const createDb = () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE posts (
      id TEXT PRIMARY KEY,
      content TEXT,
      deleted INTEGER NOT NULL DEFAULT 0,
      hidden INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE wiki_entries (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      narrative TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
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
      status TEXT NOT NULL,
      submitter_fingerprint TEXT,
      submitter_ip TEXT,
      created_at INTEGER NOT NULL,
      reviewed_at INTEGER,
      reviewed_by TEXT,
      review_reason TEXT
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
  const next = async () => {
    index += 1;
    const handler = handlers[index];
    if (!handler) {
      return;
    }
    if (handler.length >= 3) {
      return handler(req, res, next);
    }
    return handler(req, res);
  };
  await next();
  return res;
};

const createHarness = () => {
  const db = createDb();
  const app = createApp();
  const auditLogs = [];

  registerAdminWikiRoutes(app, {
    db,
    requireAdmin: (_req, _res, next) => next(),
    requireAdminCsrf: (_req, _res, next) => next(),
    requireAdminRead: (_req, _res, next) => next(),
    requireAdminManage: (_req, _res, next) => next(),
    logAdminAction: (_req, payload) => auditLogs.push(payload),
    crypto: { randomUUID: () => 'generated-id' },
  });

  return { db, routes: app.routes, auditLogs };
};

const seedRevision = (db, status = 'pending') => {
  db.prepare(`
    INSERT INTO wiki_entry_revisions (
      id,
      entry_id,
      action_type,
      base_revision_id,
      base_version_number,
      data_json,
      edit_summary,
      status,
      submitter_fingerprint,
      submitter_ip,
      created_at
    ) VALUES (?, NULL, 'create', NULL, 0, ?, ?, ?, NULL, NULL, ?)
  `).run(
    'revision-1',
    JSON.stringify({
      name: '原名字',
      narrative: '原内容',
      tags: ['旧标签'],
      relatedPostIds: [],
      attachments: [],
    }),
    '原投稿说明',
    status,
    1000
  );
};

const seedLegacyEditRevision = (db) => {
  const attachments = [{
    title: '原附件',
    imageUrls: ['https://img.zsix.de/images/original.png'],
  }];
  db.prepare('INSERT INTO posts (id, content, deleted, hidden) VALUES (?, ?, 0, 0)')
    .run('post-related', '关联帖子');
  db.prepare(`
    INSERT INTO wiki_entries (
      id,
      slug,
      name,
      narrative,
      tags,
      related_post_ids_json,
      attachments_json,
      display_order,
      status,
      current_revision_id,
      version_number,
      created_at,
      updated_at,
      deleted
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'approved', ?, 1, ?, ?, 0)
  `).run(
    'entry-1',
    'legacy-entry',
    '公开瓜条',
    '公开内容',
    JSON.stringify(['公开']),
    JSON.stringify(['post-related']),
    JSON.stringify(attachments),
    'approved-revision',
    100,
    100
  );
  db.prepare(`
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
    ) VALUES (?, ?, 'edit', ?, 1, ?, ?, 'pending', ?)
  `).run(
    'legacy-edit-revision',
    'entry-1',
    'approved-revision',
    JSON.stringify({
      name: '公开瓜条',
      narrative: '旧客户端修改的内容',
      tags: ['公开', '旧客户端'],
    }),
    '旧客户端编辑',
    200
  );
  return attachments;
};

test('管理员可以编辑待审核瓜条稿件且保留审核状态与投稿说明', async () => {
  const { db, routes, auditLogs } = createHarness();
  seedRevision(db);

  const res = await runHandlers(routes.get('POST /api/admin/wiki/revisions/:id/edit'), {
    params: { id: 'revision-1' },
    body: {
      name: '修订后的名字',
      narrative: '修订后的内容',
      tags: ['新标签'],
      relatedPostIds: [],
      attachments: [],
    },
    session: { admin: { username: 'reviewer' } },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.revision.data.name, '修订后的名字');
  assert.equal(res.payload.revision.status, 'pending');

  const row = db.prepare('SELECT data_json, edit_summary, status FROM wiki_entry_revisions WHERE id = ?')
    .get('revision-1');
  assert.equal(JSON.parse(row.data_json).narrative, '修订后的内容');
  assert.equal(row.edit_summary, '原投稿说明');
  assert.equal(row.status, 'pending');
  assert.equal(auditLogs[0]?.action, 'wiki_revision_edit');

  db.close();
});

test('管理员不能修改已处理的瓜条审核记录', async () => {
  const { db, routes } = createHarness();
  seedRevision(db, 'approved');

  const res = await runHandlers(routes.get('POST /api/admin/wiki/revisions/:id/edit'), {
    params: { id: 'revision-1' },
    body: {
      name: '不应保存',
      narrative: '不应保存',
      tags: [],
      relatedPostIds: [],
      attachments: [],
    },
    session: { admin: { username: 'reviewer' } },
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.error, '只能编辑待审核稿件');

  db.close();
});

test('管理员可以移除投稿后失效的关联帖子并保存待审核稿件', async () => {
  const { db, routes } = createHarness();
  db.prepare('INSERT INTO posts (id, content, deleted, hidden) VALUES (?, ?, 0, 0)')
    .run('post-invalidated', '稍后被隐藏的帖子');
  db.prepare(`
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
    ) VALUES (?, NULL, 'create', NULL, 0, ?, ?, 'pending', ?)
  `).run(
    'invalid-related-revision',
    JSON.stringify({
      name: '待修复稿件',
      narrative: '原稿件内容',
      tags: [],
      relatedPostIds: ['post-invalidated'],
      attachments: [],
    }),
    '原投稿说明',
    1000
  );
  db.prepare('UPDATE posts SET hidden = 1 WHERE id = ?').run('post-invalidated');

  const res = await runHandlers(routes.get('POST /api/admin/wiki/revisions/:id/edit'), {
    params: { id: 'invalid-related-revision' },
    body: {
      name: '待修复稿件',
      narrative: '管理员已移除失效关联',
      tags: [],
      relatedPostIds: [],
      attachments: [],
    },
    session: { admin: { username: 'reviewer' } },
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload.revision.data.relatedPostIds, []);

  db.close();
});

test('旧格式待审核编辑稿在后台列表中继承当前瓜条的关联帖子和附件', async () => {
  const { db, routes } = createHarness();
  const attachments = seedLegacyEditRevision(db);

  const listRes = await runHandlers(routes.get('GET /api/admin/wiki/revisions'), {
    query: {
      status: 'pending',
      actionType: 'edit',
      page: '1',
      limit: '12',
    },
  });

  assert.equal(listRes.statusCode, 200);
  assert.deepEqual(listRes.payload.items[0].data.relatedPostIds, ['post-related']);
  assert.deepEqual(listRes.payload.items[0].data.attachments, attachments);

  const editRes = await runHandlers(routes.get('POST /api/admin/wiki/revisions/:id/edit'), {
    params: { id: 'legacy-edit-revision' },
    body: {
      ...listRes.payload.items[0].data,
      narrative: '管理员只修改正文',
    },
    session: { admin: { username: 'reviewer' } },
  });

  assert.equal(editRes.statusCode, 200);
  const savedData = JSON.parse(
    db.prepare('SELECT data_json FROM wiki_entry_revisions WHERE id = ?').get('legacy-edit-revision').data_json
  );
  assert.deepEqual(savedData.relatedPostIds, ['post-related']);
  assert.deepEqual(savedData.attachments, attachments);

  db.close();
});
