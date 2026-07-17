import React, { createContext, useContext } from 'react';
import type { Post } from '../types';

export interface HomePostsLoadResult {
  items: Post[];
  total: number;
  applied: boolean;
}

export interface ContentContextValue {
  homePosts: Post[];
  homeTotal: number;
  featuredPosts: Post[];
  featuredTotal: number;
  loadHomePosts: (
    options?: number | { limit?: number; offset?: number; append?: boolean }
  ) => Promise<HomePostsLoadResult>;
  loadFeaturedPosts: (
    options?: { limit?: number; offset?: number; append?: boolean }
  ) => Promise<void>;
}

const ContentContext = createContext<ContentContextValue | undefined>(undefined);

interface ContentProviderProps {
  value: ContentContextValue;
  children: React.ReactNode;
}

/** 隔离首页与精华列表，避免 Toast、后台和偏好设置更新触发内容页刷新。 */
export const ContentProvider = React.memo<ContentProviderProps>(({ value, children }) => (
  <ContentContext.Provider value={value}>{children}</ContentContext.Provider>
));

ContentProvider.displayName = 'ContentProvider';

export const useContent = (): ContentContextValue => {
  const context = useContext(ContentContext);
  if (!context) {
    throw new Error('useContent must be used within a ContentProvider');
  }
  return context;
};
