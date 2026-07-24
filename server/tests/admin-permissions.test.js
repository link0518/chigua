
import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

import { registerAdminAuthRoutes } from '../routes/admin/auth-routes.js';
import { registerAdminUsersRoutes } from '../routes/admin/admin-users-routes.js';
import { registerAdminAuditRoutes } from '../routes/admin/audit-routes.js';
import { registerAdminReportsRoutes } from '../routes/admin/reports-routes.js';
import { registerAdminStatsRoutes } from '../routes/admin/stats-routes.js';
import { hasAdminPermission } from '../admin-permissions.js';

test('招募治理权限支持只读与处理等级', () => {
  const reader = { role: 'admin', permissions: { recruitment: 'read' } };
  const manager = { role: 'admin', permissions: { recruitment: 'manage' } };

  assert.equal(hasAdminPermission(reader, 'recruitment', 'read'), true);
  assert.equal(hasAdminPermission(reader, 'recruitment', 'manage'), false);
  assert.equal(hasAdminPermission(manager, 'recruitment', 'manage'), true);
});

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

const runHandlers = async (handlers, req = {}) => {
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

const createAdminDb = () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      permissions_json TEXT,
      disabled INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE admin_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER,
      admin_username TEXT,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      before_json TEXT,
      after_json TEXT,
      reason TEXT,
      ip TEXT,
      session_id TEXT,
      created_at INTEGER NOT NULL
    );
  `);
  return db;
};

const insertUser = (db, {
  username,
  password = 'password123',
  role = 'admin',
  permissions = {},
  disabled = 0,
}) => {
  const now = Date.now();
  const result = db.prepare(`
    INSERT INTO users (username, password_hash, role, permissions_json, disabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(username, bcrypt.hashSync(password, 4), role, JSON.stringify(permissions), disabled, now, now);
  return Number(result.lastInsertRowid);
};

test('disabled admin cannot login and enabled admin returns role and permissions', async () => {
  const db = createAdminDb();
  insertUser(db, { username: 'disabled_admin', disabled: 1 });
  insertUser(db, { username: 'editor', permissions: { posts: 'read' } });

  const app = createApp();
  registerAdminAuthRoutes(app, {
    adminEnabled: true,
    requireAdmin: (_req, _res, next) => next(),
    requireAdminCsrf: (_req, _res, next) => next(),
    db,
    bcrypt,
    crypto,
  });

  const disabledRes = await runHandlers(app.routes.get('POST /api/admin/login'), {
    body: { username: 'disabled_admin', password: 'password123' },
    session: {},
  });
  assert.equal(disabledRes.statusCode, 403);

  const req = { body: { username: 'editor', password: 'password123' }, session: {} };
  const loginRes = await runHandlers(app.routes.get('POST /api/admin/login'), req);
  assert.equal(loginRes.statusCode, 200);
  assert.equal(loginRes.payload.role, 'admin');
  assert.equal(loginRes.payload.permissions.posts, 'read');
  assert.equal(req.session.admin.permissions.posts, 'read');

  db.close();
});

test('read permission can list reports and manage permission is required for report action', async () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE reports (
      id TEXT PRIMARY KEY,
      post_id TEXT,
      comment_id TEXT,
      target_type TEXT NOT NULL,
      reason TEXT,
      reason_code TEXT,
      evidence TEXT,
      content_snippet TEXT,
      created_at INTEGER NOT NULL,
      status TEXT NOT NULL,
      risk_level TEXT,
      fingerprint TEXT,
      reporter_ip TEXT
    );
    CREATE TABLE posts (
      id TEXT PRIMARY KEY,
      content TEXT,
      ip TEXT,
      session_id TEXT,
      fingerprint TEXT,
      deleted INTEGER NOT NULL DEFAULT 0,
      hidden INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE comments (
      id TEXT PRIMARY KEY,
      post_id TEXT,
      content TEXT,
      ip TEXT,
      fingerprint TEXT,
      deleted INTEGER NOT NULL DEFAULT 0,
      hidden INTEGER NOT NULL DEFAULT 0
    );
  `);
  db.prepare("INSERT INTO posts (id, content, deleted) VALUES ('post-1', 'content', 0)").run();
  db.prepare(`
    INSERT INTO reports (id, post_id, target_type, reason, content_snippet, created_at, status, risk_level)
    VALUES ('r1', 'post-1', 'post', 'spam', 'spam', 1, 'pending', 'low')
  `).run();

  const app = createApp();
  const blockManage = (_req, res) => res.status(403).json({ error: 'forbidden' });
  registerAdminReportsRoutes(app, {
    db,
    requireAdmin: (_req, _res, next) => next(),
    requireAdminCsrf: (_req, _res, next) => next(),
    requireAdminRead: (_req, _res, next) => next(),
    requireAdminManage: blockManage,
    formatRelativeTime: (value) => String(value || ''),
    logAdminAction: () => {},
    resolveBanOptions: () => ({}),
    upsertBan: () => {},
    BAN_PERMISSIONS: [],
    resolveStoredIdentityHash: () => null,
  });

  const listRes = await runHandlers(app.routes.get('GET /api/reports'), { query: {} });
  assert.equal(listRes.statusCode, 200);
  assert.equal(listRes.payload.items.length, 1);

  const actionRes = await runHandlers(app.routes.get('POST /api/reports/:id/action'), {
    params: { id: 'r1' },
    body: { action: 'ignore' },
    session: { admin: { id: 2, username: 'reader' } },
  });
  assert.equal(actionRes.statusCode, 403);

  db.close();
});

test('audit logs require super admin', async () => {
  const db = createAdminDb();
  db.prepare(`
    INSERT INTO admin_audit_logs (admin_id, admin_username, action, target_type, target_id, created_at)
    VALUES (1, 'root', 'test', 'unit', '1', ?)
  `).run(Date.now());

  const app = createApp();
  registerAdminAuditRoutes(app, {
    db,
    requireAdmin: (_req, _res, next) => next(),
    requireSuperAdmin: (_req, res) => res.status(403).json({ error: 'forbidden' }),
    AUDIT_RETENTION_MS: 30 * 24 * 60 * 60 * 1000,
  });

  const res = await runHandlers(app.routes.get('GET /api/admin/audit-logs'), { query: {} });
  assert.equal(res.statusCode, 403);
  db.close();
});

test('super admin can filter audit logs by category risk target time and reason', async () => {
  const db = createAdminDb();
  const now = Date.now();
  const rows = [
    [1, 'root', 'post_edit', 'post', 'p1', '修正文案', now - 1000],
    [1, 'root', 'ban_ip', 'ip', '1.2.3.4', null, now - 2000],
    [2, 'ops', 'settings_update', 'settings', 'site_settings', '调整限流', now - 3000],
    [2, 'ops', 'wiki_revision_approve', 'wiki_revision', 'w1', '词条通过', now - 60 * 60 * 1000],
    [1, 'root', 'post_delete_request_approve', 'post_delete_request', 'dr1', '用户申请删除', now - 4000],
    [2, 'ops', 'feedback_reply', 'feedback', 'f1', null, now - 5000],
  ];

  const insert = db.prepare(`
    INSERT INTO admin_audit_logs (admin_id, admin_username, action, target_type, target_id, reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  rows.forEach((row) => insert.run(...row));

  const app = createApp();
  registerAdminAuditRoutes(app, {
    db,
    requireAdmin: (_req, _res, next) => next(),
    requireSuperAdmin: (_req, _res, next) => next(),
    AUDIT_RETENTION_MS: 30 * 24 * 60 * 60 * 1000,
  });

  const filteredRes = await runHandlers(app.routes.get('GET /api/admin/audit-logs'), {
    query: {
      category: 'user_safety',
      riskLevel: 'high',
      targetType: 'ip',
      adminUsername: 'root',
      hasReason: 'false',
      from: String(now - 10 * 1000),
      to: String(now),
    },
  });

  assert.equal(filteredRes.statusCode, 200);
  assert.equal(filteredRes.payload.total, 1);
  assert.equal(filteredRes.payload.items[0].action, 'ban_ip');

  const reasonSearchRes = await runHandlers(app.routes.get('GET /api/admin/audit-logs'), {
    query: { search: '调整限流' },
  });

  assert.equal(reasonSearchRes.statusCode, 200);
  assert.equal(reasonSearchRes.payload.total, 1);
  assert.equal(reasonSearchRes.payload.items[0].action, 'settings_update');

  const deleteRequestAuditRes = await runHandlers(app.routes.get('GET /api/admin/audit-logs'), {
    query: {
      category: 'content_review',
      riskLevel: 'high',
      targetType: 'post_delete_request',
      search: '用户申请删除',
    },
  });

  assert.equal(deleteRequestAuditRes.statusCode, 200);
  assert.equal(deleteRequestAuditRes.payload.total, 1);
  assert.equal(deleteRequestAuditRes.payload.items[0].action, 'post_delete_request_approve');
  assert.equal(deleteRequestAuditRes.payload.items[0].category, 'content_review');
  assert.equal(deleteRequestAuditRes.payload.items[0].riskLevel, 'high');

  const feedbackReplyAuditRes = await runHandlers(app.routes.get('GET /api/admin/audit-logs'), {
    query: { category: 'feedback', targetType: 'feedback' },
  });

  assert.equal(feedbackReplyAuditRes.statusCode, 200);
  assert.ok(feedbackReplyAuditRes.payload.items.some((item) => item.action === 'feedback_reply'));
  db.close();
});

test('super admin creates admin user with permissions and audit log', async () => {
  const db = createAdminDb();
  const app = createApp();
  const logs = [];

  registerAdminUsersRoutes(app, {
    db,
    requireAdmin: (_req, _res, next) => next(),
    requireAdminCsrf: (_req, _res, next) => next(),
    requireSuperAdmin: (_req, _res, next) => next(),
    bcrypt,
    logAdminAction: (_req, payload) => {
      logs.push(payload);
      db.prepare(`
        INSERT INTO admin_audit_logs (admin_id, admin_username, action, target_type, target_id, after_json, created_at)
        VALUES (1, 'root', ?, ?, ?, ?, ?)
      `).run(payload.action, payload.targetType, payload.targetId, JSON.stringify(payload.after || null), Date.now());
    },
  });

  const res = await runHandlers(app.routes.get('POST /api/admin/admin-users'), {
    body: {
      username: 'reviewer',
      password: 'password123',
      permissions: { content_review: 'manage', audit: 'manage' },
    },
    session: { admin: { id: 1, username: 'root' } },
  });

  assert.equal(res.statusCode, 201);
  assert.equal(res.payload.item.username, 'reviewer');
  assert.deepEqual(res.payload.item.permissions, { content_review: 'manage' });
  assert.equal(logs.at(-1).action, 'admin_user_create');
  assert.equal(db.prepare('SELECT COUNT(1) AS count FROM admin_audit_logs').get().count, 1);

  db.close();
});

test('normal admin cannot access admin user management', async () => {
  const db = createAdminDb();
  const app = createApp();

  registerAdminUsersRoutes(app, {
    db,
    requireAdmin: (_req, _res, next) => next(),
    requireAdminCsrf: (_req, _res, next) => next(),
    requireSuperAdmin: (_req, res) => res.status(403).json({ error: 'forbidden' }),
    bcrypt,
    logAdminAction: () => {},
  });

  const res = await runHandlers(app.routes.get('GET /api/admin/admin-users'), {
    session: { admin: { id: 2, username: 'normal', role: 'admin' } },
  });
  assert.equal(res.statusCode, 403);

  db.close();
});

test('super admin account cannot be modified through admin user routes', async () => {
  const db = createAdminDb();
  const superId = insertUser(db, { username: 'root', role: 'super_admin' });
  const app = createApp();

  registerAdminUsersRoutes(app, {
    db,
    requireAdmin: (_req, _res, next) => next(),
    requireAdminCsrf: (_req, _res, next) => next(),
    requireSuperAdmin: (_req, _res, next) => next(),
    bcrypt,
    logAdminAction: () => {},
  });

  const permissionsRes = await runHandlers(app.routes.get('POST /api/admin/admin-users/:id/permissions'), {
    params: { id: String(superId) },
    body: { permissions: { posts: 'read' } },
  });
  assert.equal(permissionsRes.statusCode, 400);

  const statusRes = await runHandlers(app.routes.get('POST /api/admin/admin-users/:id/status'), {
    params: { id: String(superId) },
    body: { disabled: true },
  });
  assert.equal(statusRes.statusCode, 400);

  const passwordRes = await runHandlers(app.routes.get('POST /api/admin/admin-users/:id/password'), {
    params: { id: String(superId) },
    body: { password: 'new-password' },
  });
  assert.equal(passwordRes.statusCode, 400);

  const row = db.prepare('SELECT disabled, permissions_json FROM users WHERE id = ?').get(superId);
  assert.equal(row.disabled, 0);
  assert.deepEqual(JSON.parse(row.permissions_json), {});

  db.close();
});

test('admin session refresh returns latest permissions', async () => {
  const db = createAdminDb();
  const userId = insertUser(db, { username: 'reader', permissions: { posts: 'read' } });

  const app = createApp();
  registerAdminAuthRoutes(app, {
    adminEnabled: true,
    requireAdmin: (_req, _res, next) => next(),
    requireAdminCsrf: (_req, _res, next) => next(),
    db,
    bcrypt,
    crypto,
  });

  db.prepare('UPDATE users SET permissions_json = ? WHERE id = ?')
    .run(JSON.stringify({ posts: 'manage', settings: 'read', audit: 'manage' }), userId);

  const req = {
    session: {
      admin: {
        id: userId,
        username: 'reader',
        role: 'admin',
        permissions: { posts: 'read' },
        csrfToken: 'csrf',
      },
    },
  };
  const res = await runHandlers(app.routes.get('GET /api/admin/session'), req);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload.permissions, { posts: 'manage', settings: 'read' });
  assert.deepEqual(req.session.admin.permissions, { posts: 'manage', settings: 'read' });

  db.close();
});

test('admin stats only exposes data for readable modules', async () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE stats_daily (
      date TEXT PRIMARY KEY,
      visits INTEGER NOT NULL DEFAULT 0,
      posts INTEGER NOT NULL DEFAULT 0,
      reports INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE posts (id TEXT PRIMARY KEY, deleted INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE banned_ips (id INTEGER PRIMARY KEY AUTOINCREMENT, expires_at INTEGER);
    CREATE TABLE banned_fingerprints (id INTEGER PRIMARY KEY AUTOINCREMENT, expires_at INTEGER);
    CREATE TABLE banned_identities (id INTEGER PRIMARY KEY AUTOINCREMENT, expires_at INTEGER);
  `);
  db.prepare('INSERT INTO stats_daily (date, visits, posts, reports) VALUES (?, ?, ?, ?)').run('2026-06-15', 10, 2, 1);
  db.prepare('INSERT INTO stats_daily (date, visits, posts, reports) VALUES (?, ?, ?, ?)').run('2026-06-17', 20, 3, 4);
  db.prepare('INSERT INTO posts (id, deleted) VALUES (?, ?), (?, ?), (?, ?)').run('p1', 0, 'p2', 0, 'p3', 1);
  db.prepare('INSERT INTO banned_ips (expires_at) VALUES (NULL)').run();
  db.prepare('INSERT INTO banned_fingerprints (expires_at) VALUES (NULL)').run();
  db.prepare('INSERT INTO banned_identities (expires_at) VALUES (NULL)').run();

  const app = createApp();
  registerAdminStatsRoutes(app, {
    db,
    requireAdmin: (_req, _res, next) => next(),
    refreshAdminSession: (req) => req.session?.admin || null,
    hasAdminPermission,
    formatDateKey: (date = new Date('2026-06-17T00:00:00.000Z')) => date.toISOString().slice(0, 10),
    startOfWeek: () => Date.parse('2026-06-15T00:00:00.000Z'),
    getOnlineCount: () => 7,
  });

  const res = await runHandlers(app.routes.get('GET /api/admin/stats'), {
    session: {
      admin: {
        id: 2,
        username: 'post_reader',
        role: 'admin',
        permissions: { posts: 'read' },
      },
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.totalPosts, 2);
  assert.deepEqual(res.payload.weeklyPosts.slice(0, 3), [2, 0, 3]);
  assert.equal(res.payload.todayReports, 0);
  assert.equal(res.payload.bannedUsers, 0);
  assert.equal(res.payload.totalVisits, 0);
  assert.equal(res.payload.onlineCount, 0);
  assert.deepEqual(res.payload.weeklyVisits, [0, 0, 0, 0, 0, 0, 0]);

  db.close();
});
