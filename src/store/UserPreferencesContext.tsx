import React, { createContext, useContext } from 'react';

export interface UserPreferencesContextValue {
  likedPosts: Set<string>;
  dislikedPosts: Set<string>;
  favoritedPosts: Set<string>;
  hiddenPostTags: string[];
  hiddenPostKeywords: string[];
  toggleHiddenPostTag: (tag: string) => void;
  toggleHiddenPostKeyword: (keyword: string) => void;
  clearHiddenPostTags: () => void;
  clearHiddenPostKeywords: () => void;
  isLiked: (postId: string) => boolean;
  isDisliked: (postId: string) => boolean;
  isFavorited: (postId: string) => boolean;
}

const UserPreferencesContext = createContext<UserPreferencesContextValue | undefined>(undefined);

interface UserPreferencesProviderProps {
  value: UserPreferencesContextValue;
  children: React.ReactNode;
}

/** 用户反应与本地屏蔽偏好独立发布，只在相关集合变化时通知消费者。 */
export const UserPreferencesProvider = React.memo<UserPreferencesProviderProps>(({ value, children }) => (
  <UserPreferencesContext.Provider value={value}>{children}</UserPreferencesContext.Provider>
));

UserPreferencesProvider.displayName = 'UserPreferencesProvider';

export const useUserPreferences = (): UserPreferencesContextValue => {
  const context = useContext(UserPreferencesContext);
  if (!context) {
    throw new Error('useUserPreferences must be used within a UserPreferencesProvider');
  }
  return context;
};
