import type {
  AdminPermissionLevel,
  AdminPermissionModuleKey,
  AdminPermissions,
} from '@/types';

export const ADMIN_PERMISSION_LEVEL_READ: AdminPermissionLevel = 'read';
export const ADMIN_PERMISSION_LEVEL_MANAGE: AdminPermissionLevel = 'manage';

const LEVEL_RANK: Record<AdminPermissionLevel | 'none', number> = {
  none: 0,
  read: 1,
  manage: 2,
};

export const ADMIN_PERMISSION_MODULE_LABELS: Record<AdminPermissionModuleKey, string> = {
  content_review: '内容审核',
  posts: '帖子管理',
  wiki: 'Wiki 管理',
  feedback: '留言管理',
  recruitment: '招募治理',
  user_safety: '用户处置',
  publish: '发布中心',
  settings: '系统设置',
};

export const hasPermission = (
  session: { isSuperAdmin?: boolean; permissions?: AdminPermissions } | null | undefined,
  moduleKey: AdminPermissionModuleKey,
  level: AdminPermissionLevel = ADMIN_PERMISSION_LEVEL_READ
) => {
  if (session?.isSuperAdmin) {
    return true;
  }
  const actual = session?.permissions?.[moduleKey] || 'none';
  return (LEVEL_RANK[actual] || 0) >= LEVEL_RANK[level];
};
