import React, { createContext, useContext } from 'react';
import type { FeedFilter } from './FeedContext';

export interface AppShellSettings {
  turnstileEnabled: boolean;
  cnyThemeEnabled: boolean;
  cnyThemeAutoActive: boolean;
  cnyThemeActive: boolean;
  /** 商城总开关，默认关闭 */
  shopEnabled: boolean;
}

export interface AppShellContextValue {
  settings: AppShellSettings;
  loadSettings: () => Promise<void>;
  prefetchFeedPosts: (filter?: FeedFilter, search?: string) => Promise<void>;
}

const AppShellContext = createContext<AppShellContextValue | undefined>(undefined);

interface AppShellProviderProps {
  value: AppShellContextValue;
  children: React.ReactNode;
}

/** 仅向应用外壳发布其真实依赖，避免全局业务状态更新穿透到整棵页面树。 */
export const AppShellProvider = React.memo<AppShellProviderProps>(({ value, children }) => (
  <AppShellContext.Provider value={value}>{children}</AppShellContext.Provider>
));

AppShellProvider.displayName = 'AppShellProvider';

export const useAppShell = (): AppShellContextValue => {
  const context = useContext(AppShellContext);
  if (!context) {
    throw new Error('useAppShell must be used within an AppShellProvider');
  }
  return context;
};
