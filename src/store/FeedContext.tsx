import React, { createContext, useContext } from 'react';
import type { Post } from '../types';

export type FeedFilter = 'week' | 'today' | 'all';

export interface FeedState {
  feedPosts: Post[];
  feedTotal: number;
  feedLoading: boolean;
  feedRefreshing: boolean;
  feedError: string | null;
  feedRefreshAt: number | null;
  hiddenPostTags: string[];
  hiddenPostKeywords: string[];
}

export interface FeedContextValue {
  state: FeedState;
  loadFeedPosts: (filter?: FeedFilter, search?: string) => Promise<void>;
  cancelFeedPostsLoad: () => void;
  likePost: (postId: string) => Promise<void>;
  dislikePost: (postId: string) => Promise<void>;
  toggleFavoritePost: (postId: string) => Promise<boolean>;
  showToast: (
    message: string,
    type?: 'success' | 'error' | 'info' | 'warning'
  ) => void;
}

const FeedContext = createContext<FeedContextValue | undefined>(undefined);

interface FeedProviderProps {
  value: FeedContextValue;
  children: React.ReactNode;
}

/**
 * 隔离热门页与全局 AppContext 的更新。
 * value 未变化时跳过子树协调，避免统计、Toast、后台状态等更新触发热门页重渲染。
 */
export const FeedProvider = React.memo<FeedProviderProps>(({ value, children }) => (
  <FeedContext.Provider value={value}>{children}</FeedContext.Provider>
));

FeedProvider.displayName = 'FeedProvider';

export const useFeed = (): FeedContextValue => {
  const context = useContext(FeedContext);
  if (!context) {
    throw new Error('useFeed must be used within a FeedProvider');
  }
  return context;
};
