export const ADMIN_ROLE_ADMIN = 'admin';
export const ADMIN_ROLE_SUPER = 'super_admin';

export const ADMIN_PERMISSION_LEVEL_READ = 'read';
export const ADMIN_PERMISSION_LEVEL_MANAGE = 'manage';

export const ADMIN_PERMISSION_MODULES = [
  {
    key: 'content_review',
    label: '内容审核',
    description: '举报、隐藏内容、谣言审核',
  },
  {
    key: 'posts',
    label: '帖子管理',
    description: '帖子列表、评论查看、编辑、删除、恢复',
  },
  {
    key: 'wiki',
    label: 'Wiki 管理',
    description: 'Wiki 审核、条目创建、编辑、删除与恢复',
  },
  {
    key: 'feedback',
    label: '留言管理',
    description: '留言查看、标记、删除与封禁',
  },
  {
    key: 'user_safety',
    label: '用户处置',
    description: '封禁、解封与封禁权限调整',
  },
  {
    key: 'publish',
    label: '发布中心',
    description: '后台发帖、站点公告、更新公告',
  },
  {
    key: 'settings',
    label: '系统设置',
    description: '限流、主题、敏感词、Webhook 等设置',
  },
];

export const ADMIN_PERMISSION_LEVELS = [
  {
    key: ADMIN_PERMISSION_LEVEL_READ,
    label: '只读',
    description: '可查看对应模块内容，不可执行处理动作',
  },
  {
    key: ADMIN_PERMISSION_LEVEL_MANAGE,
    label: '处理',
    description: '可查看并执行对应模块的处理动作',
  },
];

const MODULE_KEYS = new Set(ADMIN_PERMISSION_MODULES.map((item) => item.key));
const LEVEL_RANK = {
  none: 0,
  [ADMIN_PERMISSION_LEVEL_READ]: 1,
  [ADMIN_PERMISSION_LEVEL_MANAGE]: 2,
};

export const normalizeAdminRole = (role) => (
  String(role || '').trim() === ADMIN_ROLE_SUPER ? ADMIN_ROLE_SUPER : ADMIN_ROLE_ADMIN
);

const normalizePermissionLevel = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (['manage', 'write', '处理'].includes(normalized)) {
    return ADMIN_PERMISSION_LEVEL_MANAGE;
  }
  if (['read', 'readonly', '只读'].includes(normalized)) {
    return ADMIN_PERMISSION_LEVEL_READ;
  }
  return '';
};

const parsePermissionInput = (input) => {
  if (!input) {
    return {};
  }
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return input && typeof input === 'object' && !Array.isArray(input) ? input : {};
};

export const normalizeAdminPermissions = (input) => {
  const source = parsePermissionInput(input);
  const result = {};

  Object.entries(source).forEach(([rawKey, rawValue]) => {
    const key = String(rawKey || '').trim();
    if (!MODULE_KEYS.has(key)) {
      return;
    }

    let level = '';
    if (typeof rawValue === 'boolean') {
      level = rawValue ? ADMIN_PERMISSION_LEVEL_MANAGE : '';
    } else if (rawValue && typeof rawValue === 'object') {
      level = rawValue.manage || rawValue.write
        ? ADMIN_PERMISSION_LEVEL_MANAGE
        : rawValue.read
          ? ADMIN_PERMISSION_LEVEL_READ
          : '';
    } else {
      level = normalizePermissionLevel(rawValue);
    }

    if (level) {
      result[key] = level;
    }
  });

  return result;
};

export const serializeAdminPermissions = (input) => JSON.stringify(normalizeAdminPermissions(input));

export const isSuperAdminRole = (role) => normalizeAdminRole(role) === ADMIN_ROLE_SUPER;

export const isSuperAdmin = (admin) => isSuperAdminRole(admin?.role);

export const hasAdminPermission = (admin, moduleKey, requiredLevel = ADMIN_PERMISSION_LEVEL_READ) => {
  if (isSuperAdmin(admin)) {
    return true;
  }

  const key = String(moduleKey || '').trim();
  if (!MODULE_KEYS.has(key)) {
    return false;
  }

  const permissions = normalizeAdminPermissions(admin?.permissions || admin?.permissions_json);
  const actualRank = LEVEL_RANK[permissions[key] || 'none'] || 0;
  const requiredRank = LEVEL_RANK[normalizePermissionLevel(requiredLevel) || ADMIN_PERMISSION_LEVEL_READ] || 1;
  return actualRank >= requiredRank;
};

export const buildAdminPermissionDefinitions = () => ({
  modules: ADMIN_PERMISSION_MODULES,
  levels: ADMIN_PERMISSION_LEVELS,
});

export const mapAdminUserRow = (row) => {
  if (!row) {
    return null;
  }
  const role = normalizeAdminRole(row.role);
  return {
    id: row.id,
    username: row.username,
    role,
    isSuperAdmin: isSuperAdminRole(role),
    disabled: row.disabled === 1,
    permissions: normalizeAdminPermissions(row.permissions_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at || null,
  };
};

export const buildAdminSessionPayload = (user, extra = {}) => ({
  loggedIn: true,
  id: user.id,
  username: user.username,
  role: user.role,
  isSuperAdmin: Boolean(user.isSuperAdmin),
  permissions: user.permissions || {},
  permissionDefinitions: buildAdminPermissionDefinitions(),
  ...extra,
});
