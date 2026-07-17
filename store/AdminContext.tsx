import React, { createContext, useContext } from 'react';
import type {
  AdminPermissionDefinitions,
  AdminPermissions,
  Report,
} from '../types';

export interface AdminStats {
  todayReports: number;
  bannedUsers: number;
  weeklyVisits: number[];
  weeklyPosts: number[];
  totalPosts: number;
  totalVisits: number;
  onlineCount: number;
}

export interface AdminSession {
  loggedIn: boolean;
  id?: number;
  username?: string;
  role?: 'admin' | 'super_admin';
  isSuperAdmin?: boolean;
  permissions?: AdminPermissions;
  permissionDefinitions?: AdminPermissionDefinitions | null;
  checked: boolean;
  csrfToken?: string | null;
  disabled?: boolean;
}

export type AdminReportAction = 'ignore' | 'delete' | 'ban';

export interface HandleReportOptions {
  permissions?: string[];
  expiresAt?: number | null;
  deleteComment?: boolean;
}

export interface HandleReportTargetContext {
  targetId?: string | null;
  targetType?: Report['targetType'];
}

export interface AdminContextValue {
  adminSession: AdminSession;
  reports: Report[];
  stats: AdminStats;
  handleReport: (
    reportId: string,
    action: AdminReportAction,
    reason?: string,
    options?: HandleReportOptions,
    targetContext?: HandleReportTargetContext
  ) => Promise<void>;
  getPendingReports: () => Report[];
  loadReports: () => Promise<void>;
  loadStats: () => Promise<void>;
  loadAdminSession: () => Promise<void>;
  loginAdmin: (username: string, password: string) => Promise<void>;
  logoutAdmin: () => Promise<void>;
}

const AdminContext = createContext<AdminContextValue | undefined>(undefined);

interface AdminProviderProps {
  value: AdminContextValue;
  children: React.ReactNode;
}

/** 后台会话、报表与管理命令仅向后台路由发布。 */
export const AdminProvider = React.memo<AdminProviderProps>(({ value, children }) => (
  <AdminContext.Provider value={value}>{children}</AdminContext.Provider>
));

AdminProvider.displayName = 'AdminProvider';

export const useAdmin = (): AdminContextValue => {
  const context = useContext(AdminContext);
  if (!context) {
    throw new Error('useAdmin must be used within an AdminProvider');
  }
  return context;
};
