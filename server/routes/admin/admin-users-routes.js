import {
  ADMIN_ROLE_ADMIN,
  ADMIN_ROLE_SUPER,
  buildAdminPermissionDefinitions,
  isSuperAdminRole,
  mapAdminUserRow,
  normalizeAdminPermissions,
  serializeAdminPermissions,
} from '../../admin-permissions.js';

const MIN_PASSWORD_LENGTH = 8;
const MAX_USERNAME_LENGTH = 40;

const normalizeUsername = (value) => String(value || '').trim();

const validateUsername = (username) => {
  if (!username) {
    return '账号不能为空';
  }
  if (username.length > MAX_USERNAME_LENGTH) {
    return `账号不能超过 ${MAX_USERNAME_LENGTH} 个字符`;
  }
  if (!/^[A-Za-z0-9_@.-]+$/.test(username)) {
    return '账号只能包含字母、数字、下划线、点、短横线或 @';
  }
  return '';
};

const validatePassword = (password) => {
  if (!password) {
    return '密码不能为空';
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `密码至少需要 ${MIN_PASSWORD_LENGTH} 个字符`;
  }
  if (password.length > 128) {
    return '密码不能超过 128 个字符';
  }
  return '';
};

const getAdminUserById = (db, id) => {
  const userId = Number(id || 0);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return null;
  }
  return db
    .prepare('SELECT id, username, role, permissions_json, disabled, created_at, updated_at FROM users WHERE id = ?')
    .get(userId);
};

export const registerAdminUsersRoutes = (app, deps) => {
  const {
    db,
    requireAdmin,
    requireAdminCsrf,
    requireSuperAdmin,
    bcrypt,
    logAdminAction,
  } = deps;

  app.get('/api/admin/admin-users/permission-definitions', requireAdmin, requireSuperAdmin, (_req, res) => {
    return res.json(buildAdminPermissionDefinitions());
  });

  app.get('/api/admin/admin-users', requireAdmin, requireSuperAdmin, (_req, res) => {
    const rows = db
      .prepare(
        `
        SELECT id, username, role, permissions_json, disabled, created_at, updated_at
        FROM users
        ORDER BY role = ? DESC, disabled ASC, created_at ASC
        `
      )
      .all(ADMIN_ROLE_SUPER);

    return res.json({
      items: rows.map(mapAdminUserRow),
      permissionDefinitions: buildAdminPermissionDefinitions(),
    });
  });

  app.post('/api/admin/admin-users', requireAdmin, requireAdminCsrf, requireSuperAdmin, (req, res) => {
    const username = normalizeUsername(req.body?.username);
    const password = String(req.body?.password || '');
    const permissions = normalizeAdminPermissions(req.body?.permissions);

    const usernameError = validateUsername(username);
    if (usernameError) {
      return res.status(400).json({ error: usernameError });
    }
    const passwordError = validatePassword(password);
    if (passwordError) {
      return res.status(400).json({ error: passwordError });
    }

    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
      return res.status(409).json({ error: '账号已存在' });
    }

    const now = Date.now();
    const passwordHash = bcrypt.hashSync(password, 10);
    const result = db.prepare(
      `
      INSERT INTO users (username, password_hash, role, permissions_json, disabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, ?, ?)
      `
    ).run(username, passwordHash, ADMIN_ROLE_ADMIN, serializeAdminPermissions(permissions), now, now);

    const row = getAdminUserById(db, result.lastInsertRowid);
    const item = mapAdminUserRow(row);

    logAdminAction(req, {
      action: 'admin_user_create',
      targetType: 'admin_user',
      targetId: String(item.id),
      before: null,
      after: {
        username: item.username,
        role: item.role,
        disabled: item.disabled,
        permissions: item.permissions,
      },
    });

    return res.status(201).json({ item });
  });

  app.post('/api/admin/admin-users/:id/permissions', requireAdmin, requireAdminCsrf, requireSuperAdmin, (req, res) => {
    const row = getAdminUserById(db, req.params.id);
    if (!row) {
      return res.status(404).json({ error: '管理员账号不存在' });
    }
    const user = mapAdminUserRow(row);
    if (user.isSuperAdmin) {
      return res.status(400).json({ error: '超级管理员权限不可修改' });
    }

    const permissions = normalizeAdminPermissions(req.body?.permissions);
    const now = Date.now();
    db.prepare('UPDATE users SET permissions_json = ?, updated_at = ? WHERE id = ?')
      .run(serializeAdminPermissions(permissions), now, user.id);

    const nextUser = mapAdminUserRow(getAdminUserById(db, user.id));
    logAdminAction(req, {
      action: 'admin_user_permissions_update',
      targetType: 'admin_user',
      targetId: String(user.id),
      before: { permissions: user.permissions },
      after: { permissions: nextUser.permissions },
    });

    return res.json({ item: nextUser });
  });

  app.post('/api/admin/admin-users/:id/status', requireAdmin, requireAdminCsrf, requireSuperAdmin, (req, res) => {
    const row = getAdminUserById(db, req.params.id);
    if (!row) {
      return res.status(404).json({ error: '管理员账号不存在' });
    }
    const user = mapAdminUserRow(row);
    if (user.isSuperAdmin) {
      return res.status(400).json({ error: '超级管理员不可禁用' });
    }

    const disabled = Boolean(req.body?.disabled);
    const now = Date.now();
    db.prepare('UPDATE users SET disabled = ?, updated_at = ? WHERE id = ?')
      .run(disabled ? 1 : 0, now, user.id);

    const nextUser = mapAdminUserRow(getAdminUserById(db, user.id));
    logAdminAction(req, {
      action: disabled ? 'admin_user_disable' : 'admin_user_enable',
      targetType: 'admin_user',
      targetId: String(user.id),
      before: { disabled: user.disabled },
      after: { disabled: nextUser.disabled },
    });

    return res.json({ item: nextUser });
  });

  app.post('/api/admin/admin-users/:id/password', requireAdmin, requireAdminCsrf, requireSuperAdmin, (req, res) => {
    const row = getAdminUserById(db, req.params.id);
    if (!row) {
      return res.status(404).json({ error: '管理员账号不存在' });
    }
    const user = mapAdminUserRow(row);
    if (isSuperAdminRole(user.role)) {
      return res.status(400).json({ error: '超级管理员密码请通过环境变量维护' });
    }

    const password = String(req.body?.password || '');
    const passwordError = validatePassword(password);
    if (passwordError) {
      return res.status(400).json({ error: passwordError });
    }

    const now = Date.now();
    const passwordHash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
      .run(passwordHash, now, user.id);

    logAdminAction(req, {
      action: 'admin_user_password_reset',
      targetType: 'admin_user',
      targetId: String(user.id),
      before: null,
      after: { passwordReset: true },
    });

    return res.json({ ok: true });
  });
};
