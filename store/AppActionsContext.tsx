import React, { createContext, useContext } from 'react';
import type {
  Comment,
  FeatureRequestSubmissionResult,
  Post,
  ReportSubmissionPayload,
  ReportSubmissionResult,
} from '../types';

export interface AppActionsContextValue {
  addPost: (
    post: Omit<Post, 'id' | 'likes' | 'dislikes' | 'comments' | 'createdAt'>,
    turnstileToken: string
  ) => Promise<Post>;
  addComment: (
    postId: string,
    content: string,
    turnstileToken: string,
    parentId?: string | null,
    replyToId?: string | null
  ) => Promise<Comment>;
  likePost: (postId: string) => Promise<void>;
  dislikePost: (postId: string) => Promise<void>;
  toggleFavoritePost: (postId: string) => Promise<boolean>;
  deletePost: (postId: string) => void;
  reportPost: (
    postId: string,
    payload: ReportSubmissionPayload
  ) => Promise<ReportSubmissionResult>;
  reportComment: (
    commentId: string,
    payload: ReportSubmissionPayload
  ) => Promise<ReportSubmissionResult>;
  requestPostFeature: (postId: string) => Promise<FeatureRequestSubmissionResult>;
  showToast: (
    message: string,
    type?: 'success' | 'error' | 'info' | 'warning'
  ) => void;
  viewPost: (postId: string) => Promise<void>;
  upsertHomePost: (post: Post, options?: { prepend?: boolean }) => void;
  removeHomePostsFromMemory: (postIds: string[]) => void;
}

const AppActionsContext = createContext<AppActionsContextValue | undefined>(undefined);

interface AppActionsProviderProps {
  value: AppActionsContextValue;
  children: React.ReactNode;
}

/** 仅发布稳定业务命令，避免动作型组件订阅任意状态变化。 */
export const AppActionsProvider = React.memo<AppActionsProviderProps>(({ value, children }) => (
  <AppActionsContext.Provider value={value}>{children}</AppActionsContext.Provider>
));

AppActionsProvider.displayName = 'AppActionsProvider';

export const useAppActions = (): AppActionsContextValue => {
  const context = useContext(AppActionsContext);
  if (!context) {
    throw new Error('useAppActions must be used within an AppActionsProvider');
  }
  return context;
};
