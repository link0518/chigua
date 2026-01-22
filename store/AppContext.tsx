import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { api } from '../api';
import { Comment, Post, Report } from '../types';

export interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
}

interface Stats {
  todayReports: number;
  bannedUsers: number;
  weeklyVisits: number[];
  weeklyPosts: number[];
  totalPosts: number;
}

interface AdminSession {
  loggedIn: boolean;
  username?: string;
  checked: boolean;
}

interface AppState {
  homePosts: Post[];
  feedPosts: Post[];
  feedTotal: number;
  reports: Report[];
  stats: Stats;
  toasts: Toast[];
  likedPosts: Set<string>;
  dislikedPosts: Set<string>;
  adminSession: AdminSession;
}

interface AppContextType {
  state: AppState;
  addPost: (post: Omit<Post, 'id' | 'likes' | 'comments' | 'createdAt'>) => Promise<void>;
  addComment: (postId: string, content: string) => Promise<Comment>;
  likePost: (postId: string) => Promise<void>;
  dislikePost: (postId: string) => Promise<void>;
  deletePost: (postId: string) => void;
  reportPost: (postId: string, reason: string) => Promise<void>;
  handleReport: (reportId: string, action: 'ignore' | 'delete' | 'ban', reason?: string) => Promise<void>;
  showToast: (message: string, type?: Toast['type']) => void;
  removeToast: (id: string) => void;
  isLiked: (postId: string) => boolean;
  isDisliked: (postId: string) => boolean;
  getHomePosts: () => Post[];
  getFeedPosts: (filter?: 'week' | 'today' | 'all') => Post[];
  getPendingReports: () => Report[];
  loadHomePosts: (limit?: number) => Promise<void>;
  loadFeedPosts: (filter?: 'week' | 'today' | 'all', search?: string) => Promise<void>;
  loadReports: () => Promise<void>;
  loadStats: () => Promise<void>;
  viewPost: (postId: string) => Promise<void>;
  loadAdminSession: () => Promise<void>;
  loginAdmin: (username: string, password: string) => Promise<void>;
  logoutAdmin: () => Promise<void>;
  upsertHomePost: (post: Post, options?: { prepend?: boolean }) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const initialStats: Stats = {
  todayReports: 0,
  bannedUsers: 0,
  weeklyVisits: [0, 0, 0, 0, 0, 0, 0],
  weeklyPosts: [0, 0, 0, 0, 0, 0, 0],
  totalPosts: 0,
};

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<AppState>({
    homePosts: [],
    feedPosts: [],
    feedTotal: 0,
    reports: [],
    stats: initialStats,
    toasts: [],
    likedPosts: new Set(),
    dislikedPosts: new Set(),
    adminSession: { loggedIn: false, checked: false },
  });

  const showToast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const newToast: Toast = {
      id: `toast-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      message,
      type,
    };
    setState((prev) => ({
      ...prev,
      toasts: [...prev.toasts, newToast],
    }));
  }, []);

  const removeToast = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      toasts: prev.toasts.filter((toast) => toast.id !== id),
    }));
  }, []);

  const syncReactions = useCallback((posts: Post[]) => {
    setState((prev) => {
      const likedPosts = new Set(prev.likedPosts);
      const dislikedPosts = new Set(prev.dislikedPosts);

      posts.forEach((post) => {
        likedPosts.delete(post.id);
        dislikedPosts.delete(post.id);
        if (post.viewerReaction === 'like') {
          likedPosts.add(post.id);
        } else if (post.viewerReaction === 'dislike') {
          dislikedPosts.add(post.id);
        }
      });

      return {
        ...prev,
        likedPosts,
        dislikedPosts,
      };
    });
  }, []);

  const loadHomePosts = useCallback(async (limit?: number) => {
    const data = await api.getHomePosts(limit);
    const items: Post[] = data.items || [];
    setState((prev) => ({
      ...prev,
      homePosts: items,
    }));
    syncReactions(items);
  }, [syncReactions]);

  const loadFeedPosts = useCallback(async (filter: 'week' | 'today' | 'all' = 'week', search = '') => {
    const data = await api.getFeedPosts(filter, search);
    const items: Post[] = data.items || [];
    setState((prev) => ({
      ...prev,
      feedPosts: items,
      feedTotal: data.total ?? items.length,
    }));
    syncReactions(items);
  }, [syncReactions]);

  const loadReports = useCallback(async () => {
    const data = await api.getReports();
    setState((prev) => ({
      ...prev,
      reports: data.items || [],
    }));
  }, []);

  const loadStats = useCallback(async () => {
    const data = await api.getStats();
    setState((prev) => ({
      ...prev,
      stats: {
        todayReports: data.todayReports ?? prev.stats.todayReports,
        bannedUsers: data.bannedUsers ?? prev.stats.bannedUsers,
        weeklyVisits: data.weeklyVisits ?? prev.stats.weeklyVisits,
        weeklyPosts: data.weeklyPosts ?? prev.stats.weeklyPosts,
        totalPosts: data.totalPosts ?? prev.stats.totalPosts,
      },
    }));
  }, []);

  const loadAdminSession = useCallback(async () => {
    const data = await api.getAdminSession();
    setState((prev) => ({
      ...prev,
      adminSession: {
        loggedIn: Boolean(data.loggedIn),
        username: data.username,
        checked: true,
      },
    }));
  }, []);

  const loginAdmin = useCallback(async (username: string, password: string) => {
    const data = await api.adminLogin(username, password);
    setState((prev) => ({
      ...prev,
      adminSession: {
        loggedIn: Boolean(data.loggedIn),
        username: data.username,
        checked: true,
      },
    }));
  }, []);

  const logoutAdmin = useCallback(async () => {
    await api.adminLogout();
    setState((prev) => ({
      ...prev,
      adminSession: {
        loggedIn: false,
        checked: true,
      },
    }));
  }, []);

  const addPost = useCallback(async (post: Omit<Post, 'id' | 'likes' | 'comments' | 'createdAt'>) => {
    const data = await api.createPost(post.content, post.tags || []);
    const newPost: Post = data.post;
    setState((prev) => ({
      ...prev,
      homePosts: [newPost, ...prev.homePosts],
      feedPosts: [newPost, ...prev.feedPosts],
      feedTotal: prev.feedTotal + 1,
    }));
  }, []);

  const addComment = useCallback(async (postId: string, content: string) => {
    const data = await api.addComment(postId, content);
    const comment: Comment = data.comment;
    setState((prev) => {
      const updateList = (list: Post[]) =>
        list.map((post) =>
          post.id === postId
            ? { ...post, comments: post.comments + 1 }
            : post
        );
      return {
        ...prev,
        homePosts: updateList(prev.homePosts),
        feedPosts: updateList(prev.feedPosts),
      };
    });
    return comment;
  }, []);

  const likePost = useCallback(async (postId: string) => {
    const data = await api.likePost(postId);
    setState((prev) => {
      const likedPosts = new Set(prev.likedPosts);
      const dislikedPosts = new Set(prev.dislikedPosts);

      likedPosts.delete(postId);
      dislikedPosts.delete(postId);
      if (data.reaction === 'like') {
        likedPosts.add(postId);
      }
      if (data.reaction === 'dislike') {
        dislikedPosts.add(postId);
      }

      const updateList = (list: Post[]) =>
        list.map((post) =>
          post.id === postId
            ? { ...post, likes: data.likes ?? post.likes, viewerReaction: data.reaction }
            : post
        );

      return {
        ...prev,
        likedPosts,
        dislikedPosts,
        homePosts: updateList(prev.homePosts),
        feedPosts: updateList(prev.feedPosts),
      };
    });
  }, []);

  const dislikePost = useCallback(async (postId: string) => {
    const data = await api.dislikePost(postId);
    setState((prev) => {
      const likedPosts = new Set(prev.likedPosts);
      const dislikedPosts = new Set(prev.dislikedPosts);

      likedPosts.delete(postId);
      dislikedPosts.delete(postId);
      if (data.reaction === 'like') {
        likedPosts.add(postId);
      }
      if (data.reaction === 'dislike') {
        dislikedPosts.add(postId);
      }

      const updateList = (list: Post[]) =>
        list.map((post) =>
          post.id === postId
            ? { ...post, likes: data.likes ?? post.likes, viewerReaction: data.reaction }
            : post
        );

      return {
        ...prev,
        likedPosts,
        dislikedPosts,
        homePosts: updateList(prev.homePosts),
        feedPosts: updateList(prev.feedPosts),
      };
    });
  }, []);

  const deletePost = useCallback((postId: string) => {
    setState((prev) => ({
      ...prev,
      homePosts: prev.homePosts.filter((post) => post.id !== postId),
      feedPosts: prev.feedPosts.filter((post) => post.id !== postId),
      feedTotal: Math.max(prev.feedTotal - 1, 0),
      likedPosts: (() => {
        const next = new Set(prev.likedPosts);
        next.delete(postId);
        return next;
      })(),
      dislikedPosts: (() => {
        const next = new Set(prev.dislikedPosts);
        next.delete(postId);
        return next;
      })(),
    }));
  }, []);

  const reportPost = useCallback(async (postId: string, reason: string) => {
    await api.reportPost(postId, reason);
  }, []);

  const handleReport = useCallback(async (reportId: string, action: 'ignore' | 'delete' | 'ban', reason = '') => {
    const report = state.reports.find((item) => item.id === reportId);
    await api.handleReport(reportId, action, reason);
    if (action !== 'ignore' && report?.targetId) {
      deletePost(report.targetId);
    }
    await loadReports();
    await loadStats();
  }, [deletePost, loadReports, loadStats, state.reports]);

  const viewPost = useCallback(async (postId: string) => {
    await api.viewPost(postId);
  }, []);

  const upsertHomePost = useCallback((post: Post, options?: { prepend?: boolean }) => {
    setState((prev) => {
      const exists = prev.homePosts.some((item) => item.id === post.id);
      if (options?.prepend) {
        return {
          ...prev,
          homePosts: [post, ...prev.homePosts.filter((item) => item.id !== post.id)],
        };
      }
      return {
        ...prev,
        homePosts: exists
          ? prev.homePosts.map((item) => (item.id === post.id ? post : item))
          : [...prev.homePosts, post],
      };
    });
    syncReactions([post]);
  }, [syncReactions]);

  const isLiked = useCallback((postId: string) => state.likedPosts.has(postId), [state.likedPosts]);
  const isDisliked = useCallback((postId: string) => state.dislikedPosts.has(postId), [state.dislikedPosts]);

  const getHomePosts = useCallback(() => state.homePosts, [state.homePosts]);
  const getFeedPosts = useCallback(() => state.feedPosts, [state.feedPosts]);
  const getPendingReports = useCallback(() => state.reports.filter((report) => report.status === 'pending'), [state.reports]);

  const value = useMemo<AppContextType>(
    () => ({
      state,
      addPost,
      addComment,
      likePost,
      dislikePost,
      deletePost,
      reportPost,
      handleReport,
      showToast,
      removeToast,
      isLiked,
      isDisliked,
      getHomePosts,
      getFeedPosts,
      getPendingReports,
      loadHomePosts,
      loadFeedPosts,
      loadReports,
      loadStats,
      viewPost,
      loadAdminSession,
      loginAdmin,
      logoutAdmin,
      upsertHomePost,
    }),
    [
      state,
      addPost,
      addComment,
      likePost,
      dislikePost,
      deletePost,
      reportPost,
      handleReport,
      showToast,
      removeToast,
      isLiked,
      isDisliked,
      getHomePosts,
      getFeedPosts,
      getPendingReports,
      loadHomePosts,
      loadFeedPosts,
      loadReports,
      loadStats,
      viewPost,
      loadAdminSession,
      loginAdmin,
      logoutAdmin,
      upsertHomePost,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export const useApp = (): AppContextType => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};

