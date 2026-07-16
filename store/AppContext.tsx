import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { api } from '../api';
import {
  AdminPermissionDefinitions,
  AdminPermissions,
  Comment,
  FeatureRequestSubmissionResult,
  Post,
  Report,
  ReportSubmissionPayload,
  ReportSubmissionResult,
} from '../types';
import {
  normalizeHiddenPostKeyword,
  normalizeHiddenPostKeywordList,
  normalizeHiddenPostTag,
  normalizeHiddenPostTagList,
  postMatchesHiddenFilters,
  readHiddenPostKeywords,
  readHiddenPostTags,
  writeHiddenPostKeywords,
  writeHiddenPostTags,
} from './hiddenPostTags';
import { dispatchAutoHiddenEvent } from './contentVisibility';

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
  totalVisits: number;
  onlineCount: number;
}

interface AdminSession {
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

interface AppSettings {
  turnstileEnabled: boolean;
  cnyThemeEnabled: boolean;
  cnyThemeAutoActive: boolean;
  cnyThemeActive: boolean;
  /** 商城总开关，默认关闭 */
  shopEnabled: boolean;
}

interface AppState {
  homePosts: Post[];
  homeTotal: number;
  feedPosts: Post[];
  feedTotal: number;
  feedLoading: boolean;
  feedRefreshing: boolean;
  feedError: string | null;
  feedRefreshAt: number | null;
  featuredPosts: Post[];
  featuredTotal: number;
  reports: Report[];
  stats: Stats;
  toasts: Toast[];
  likedPosts: Set<string>;
  dislikedPosts: Set<string>;
  favoritedPosts: Set<string>;
  hiddenPostTags: string[];
  hiddenPostKeywords: string[];
  adminSession: AdminSession;
  settings: AppSettings;
}

type AdminReportAction = 'ignore' | 'delete' | 'ban';
type HandleReportOptions = {
  permissions?: string[];
  expiresAt?: number | null;
  deleteComment?: boolean;
};
type HandleReportTargetContext = {
  targetId?: string | null;
  targetType?: Report['targetType'];
};

type FeedFilter = 'week' | 'today' | 'all';

interface FeedSnapshot {
  items: Post[];
  total: number;
  nextOffset: number;
  hasMore: boolean;
  resetRequired?: boolean;
  rankingUpdatedAt?: number;
  rankingExpiresAt?: number;
  rankingExpiresInMs?: number;
}

interface FeedCacheEntry extends FeedSnapshot {
  expiresAt: number;
  contentExpiresAt: number;
}

type FeedPostOverride = Pick<
  Post,
  | 'likes'
  | 'dislikes'
  | 'comments'
  | 'viewerReaction'
  | 'viewerFavorited'
  | 'viewerFeatureRequestStatus'
>;

interface FeedPostOverrideEntry {
  patch: Partial<FeedPostOverride>;
  updatedAt: number;
  expiresAt: number;
}

interface FeedLoadStatus {
  loading: boolean;
  refreshing: boolean;
  error: string | null;
}

const FEED_PAGE_SIZE = 30;
const FEED_DISPLAY_LIMIT = 10;
const FEED_MAX_PAGES_PER_LOAD = 20;
const FEED_MAX_RANKING_RESTARTS = 2;
const FEED_POST_OVERRIDE_TTL_MS = 60 * 1000;
const FEED_CONTENT_TTL_MS = 2 * 60 * 1000;
const FEED_CACHE_MAX_ENTRIES = 12;
const FEED_CACHE_STALE_RETENTION_MS = 60 * 60 * 1000;
const FEED_CACHE_TTL_MS: Record<FeedFilter, number> = {
  today: 15 * 60 * 1000,
  week: 30 * 60 * 1000,
  all: 60 * 60 * 1000,
};

// 缓存放在模块级，开发环境 StrictMode 重挂载时也能复用请求与结果。
const feedCache = new Map<string, FeedCacheEntry>();
const feedPageRequests = new Map<string, Promise<FeedSnapshot>>();
const feedPostOverrides = new Map<string, FeedPostOverrideEntry>();

class FeedLoadCancelledError extends Error {
  constructor() {
    super('热门榜单请求已取消');
    this.name = 'FeedLoadCancelledError';
  }
}

const normalizeFeedSearch = (search: string) => String(search || '').trim();

const normalizeAbsoluteTimestamp = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === 'string' && value.trim()) {
    const numericValue = Number(value);
    if (Number.isFinite(numericValue) && numericValue > 0) {
      return numericValue < 1_000_000_000_000 ? numericValue * 1000 : numericValue;
    }
    const parsedValue = Date.parse(value);
    return Number.isFinite(parsedValue) ? parsedValue : undefined;
  }
  return undefined;
};

const getFeedCacheKey = (filter: FeedFilter, search: string) => (
  `${filter}:${normalizeFeedSearch(search)}`
);

const pruneFeedCache = (now = Date.now(), protectedKey?: string) => {
  feedCache.forEach((entry, key) => {
    if (
      entry.expiresAt <= now - FEED_CACHE_STALE_RETENTION_MS
      && entry.contentExpiresAt <= now - FEED_CACHE_STALE_RETENTION_MS
    ) {
      feedCache.delete(key);
    }
  });

  for (const key of feedCache.keys()) {
    if (feedCache.size <= FEED_CACHE_MAX_ENTRIES) {
      break;
    }
    if (key !== protectedKey) {
      feedCache.delete(key);
    }
  }
};

const setFeedCacheEntry = (key: string, entry: FeedCacheEntry) => {
  // 重新插入以维持近似 LRU 顺序，优先淘汰长期未访问的搜索缓存。
  feedCache.delete(key);
  feedCache.set(key, entry);
  pruneFeedCache(Date.now(), key);
};

const pruneFeedPostOverrides = (now = Date.now()) => {
  feedPostOverrides.forEach((entry, postId) => {
    if (entry.expiresAt <= now) {
      feedPostOverrides.delete(postId);
    }
  });
};

const mergeUniqueFeedPosts = (existing: Post[], incoming: Post[]) => {
  const merged = [...existing];
  const existingIds = new Set(merged.map((post) => post.id));
  incoming.forEach((post) => {
    if (!existingIds.has(post.id)) {
      existingIds.add(post.id);
      merged.push(post);
    }
  });
  return merged;
};

const reconcileFeedPost = (post: Post, requestedAt: number): Post => {
  const override = feedPostOverrides.get(post.id);
  if (!override) {
    return post;
  }
  if (override.expiresAt <= Date.now()) {
    feedPostOverrides.delete(post.id);
    return post;
  }
  // 仅保护写操作之前已经发出的旧请求；写操作之后的新请求以服务端为准。
  return override.updatedAt > requestedAt ? { ...post, ...override.patch } : post;
};

const countVisibleFeedPosts = (
  posts: Post[],
  hiddenTags: string[],
  hiddenKeywords: string[]
) => posts.reduce((count, post) => (
  count >= FEED_DISPLAY_LIMIT || postMatchesHiddenFilters(post, hiddenTags, hiddenKeywords)
    ? count
    : count + 1
), 0);

const requestFeedPage = (
  filter: FeedFilter,
  search: string,
  offset: number,
  rankingUpdatedAt?: number
): Promise<FeedSnapshot> => {
  const requestKey = `${getFeedCacheKey(filter, search)}:${offset}:${rankingUpdatedAt || 0}`;
  const existingRequest = feedPageRequests.get(requestKey);
  if (existingRequest) {
    return existingRequest;
  }

  const requestedAt = Date.now();
  const request = api.getFeedPosts(
    filter,
    search,
    FEED_PAGE_SIZE,
    offset,
    rankingUpdatedAt
  )
    .then((data) => {
      const resetRequired = Boolean(data?.resetRequired);
      const items: Post[] = Array.isArray(data?.items)
        ? data.items.map((post: Post) => reconcileFeedPost(post, requestedAt))
        : [];
      const totalValue = Number(data?.total);
      const total = Number.isFinite(totalValue) && totalValue >= 0 ? totalValue : items.length;
      const fallbackNextOffset = offset + items.length;
      const nextOffsetValue = Number(data?.nextOffset);
      const nextOffset = resetRequired
        ? 0
        : Number.isFinite(nextOffsetValue) && nextOffsetValue >= fallbackNextOffset
          ? nextOffsetValue
          : fallbackNextOffset;
      const declaredHasMore = typeof data?.hasMore === 'boolean'
        ? data.hasMore
        : nextOffset < total;

      return {
        items,
        total,
        nextOffset,
        // 游标不前进时强制终止，避免异常响应造成死循环。
        hasMore: declaredHasMore && nextOffset > offset,
        resetRequired,
        rankingUpdatedAt: normalizeAbsoluteTimestamp(data?.rankingUpdatedAt),
        rankingExpiresAt: normalizeAbsoluteTimestamp(data?.rankingExpiresAt),
        rankingExpiresInMs: Number.isFinite(Number(data?.rankingExpiresInMs))
          ? Math.max(0, Number(data.rankingExpiresInMs))
          : undefined,
      };
    });

  const trackedRequest = request.then(
    (result) => {
      feedPageRequests.delete(requestKey);
      return result;
    },
    (error) => {
      feedPageRequests.delete(requestKey);
      throw error;
    }
  );
  feedPageRequests.set(requestKey, trackedRequest);
  return trackedRequest;
};

const patchFeedPostCache = (postId: string, patch: Partial<FeedPostOverride>) => {
  const now = Date.now();
  pruneFeedPostOverrides(now);
  feedPostOverrides.set(postId, {
    patch: {
      ...feedPostOverrides.get(postId)?.patch,
      ...patch,
    },
    updatedAt: now,
    expiresAt: now + FEED_POST_OVERRIDE_TTL_MS,
  });
  feedCache.forEach((entry, key) => {
    if (!entry.items.some((post) => post.id === postId)) {
      return;
    }
    feedCache.set(key, {
      ...entry,
      items: entry.items.map((post) => (
        post.id === postId ? { ...post, ...patch } : post
      )),
    });
  });
};

const incrementFeedPostCommentCache = (postId: string) => {
  let latestComments: number | undefined;
  feedCache.forEach((entry, key) => {
    if (!entry.items.some((post) => post.id === postId)) {
      return;
    }
    const items = entry.items.map((post) => {
      if (post.id !== postId) {
        return post;
      }
      const comments = post.comments + 1;
      latestComments = Math.max(latestComments ?? 0, comments);
      return { ...post, comments };
    });
    feedCache.set(key, { ...entry, items });
  });
  if (latestComments !== undefined) {
    const now = Date.now();
    pruneFeedPostOverrides(now);
    feedPostOverrides.set(postId, {
      patch: {
        ...feedPostOverrides.get(postId)?.patch,
        comments: latestComments,
      },
      updatedAt: now,
      expiresAt: now + FEED_POST_OVERRIDE_TTL_MS,
    });
  }
};

const removeFeedPostFromCache = (postId: string) => {
  feedPostOverrides.delete(postId);
  feedCache.forEach((entry, key) => {
    if (!entry.items.some((post) => post.id === postId)) {
      return;
    }
    feedCache.set(key, {
      ...entry,
      items: entry.items.filter((post) => post.id !== postId),
      total: Math.max(entry.total - 1, 0),
    });
  });
};

const getFeedCacheEntry = (filter: FeedFilter, search: string) => {
  pruneFeedCache();
  const key = getFeedCacheKey(filter, search);
  const entry = feedCache.get(key);
  if (!entry) {
    return null;
  }
  feedCache.delete(key);
  feedCache.set(key, entry);
  return entry;
};

const resolveFeedCacheExpiresAt = (
  snapshot: Pick<FeedSnapshot, 'rankingExpiresAt' | 'rankingExpiresInMs'>,
  filter: FeedFilter,
  now = Date.now()
) => {
  if (snapshot.rankingExpiresInMs !== undefined) {
    return now + snapshot.rankingExpiresInMs;
  }
  return snapshot.rankingExpiresAt ?? now + FEED_CACHE_TTL_MS[filter];
};

const getFeedErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return '热门内容加载失败，请稍后重试';
};

// 排行快照沿用服务端长缓存；完整帖子最多缓存 2 分钟，过期后从首批重新 hydrate。
const fillFeedCache = async (
  filter: FeedFilter,
  search: string,
  hiddenTags: string[],
  hiddenKeywords: string[],
  options: {
    shouldContinue?: () => boolean;
  } = {}
): Promise<FeedCacheEntry> => {
  const normalizedSearch = normalizeFeedSearch(search);
  const cacheKey = getFeedCacheKey(filter, normalizedSearch);
  const cached = getFeedCacheEntry(filter, normalizedSearch);
  const now = Date.now();
  const rankingIsFresh = Boolean(cached && cached.expiresAt > now);
  const contentIsFresh = Boolean(cached && cached.contentExpiresAt > now);
  const shouldContinue = options.shouldContinue || (() => true);
  const canAppendCached = Boolean(cached && rankingIsFresh && contentIsFresh);

  if (
    cached
    && canAppendCached
    && (
      countVisibleFeedPosts(cached.items, hiddenTags, hiddenKeywords) >= FEED_DISPLAY_LIMIT
      || !cached.hasMore
    )
  ) {
    return cached;
  }

  let snapshot: FeedSnapshot = canAppendCached && cached
    ? cached
    : { items: [], total: 0, nextOffset: 0, hasMore: true };
  let expiresAt = canAppendCached && cached
    ? cached.expiresAt
    : now + FEED_CACHE_TTL_MS[filter];
  let contentExpiresAt = canAppendCached && cached
    ? cached.contentExpiresAt
    : now + FEED_CONTENT_TTL_MS;
  let offset = snapshot.nextOffset;
  let pageCount = 0;
  let rankingRestartCount = 0;

  while (
    snapshot.hasMore
    && pageCount < FEED_MAX_PAGES_PER_LOAD
    && countVisibleFeedPosts(snapshot.items, hiddenTags, hiddenKeywords) < FEED_DISPLAY_LIMIT
  ) {
    if (!shouldContinue()) {
      throw new FeedLoadCancelledError();
    }
    const page = await requestFeedPage(
      filter,
      normalizedSearch,
      offset,
      offset > 0 ? snapshot.rankingUpdatedAt : undefined
    );
    // 页面切换后最多只等待当前请求结束，不再继续补后续分页，也不污染共享缓存。
    if (!shouldContinue()) {
      throw new FeedLoadCancelledError();
    }
    const rankingChanged = offset > 0 && (
      page.resetRequired
      || (
        snapshot.rankingUpdatedAt !== undefined
        && page.rankingUpdatedAt !== undefined
        && snapshot.rankingUpdatedAt !== page.rankingUpdatedAt
      )
    );
    if (rankingChanged) {
      rankingRestartCount += 1;
      if (rankingRestartCount > FEED_MAX_RANKING_RESTARTS) {
        throw new Error('热门榜单更新频繁，请稍后重试');
      }
      snapshot = { items: [], total: 0, nextOffset: 0, hasMore: true };
      offset = 0;
      expiresAt = Date.now() + FEED_CACHE_TTL_MS[filter];
      pageCount += 1;
      continue;
    }
    snapshot = {
      items: mergeUniqueFeedPosts(snapshot.items, page.items),
      total: page.total,
      nextOffset: page.nextOffset,
      hasMore: page.hasMore,
      rankingUpdatedAt: page.rankingUpdatedAt,
      rankingExpiresAt: page.rankingExpiresAt,
      rankingExpiresInMs: page.rankingExpiresInMs,
    };
    // 优先使用服务端给出的剩余有效时间，避免客户端时钟偏差和两层 TTL 叠加。
    expiresAt = resolveFeedCacheExpiresAt(page, filter);
    pageCount += 1;

    if (page.nextOffset <= offset) {
      snapshot = { ...snapshot, hasMore: false };
      break;
    }
    offset = page.nextOffset;
  }

  if (!shouldContinue()) {
    throw new FeedLoadCancelledError();
  }

  if (!canAppendCached) {
    contentExpiresAt = Date.now() + FEED_CONTENT_TTL_MS;
  }
  const entry = { ...snapshot, expiresAt, contentExpiresAt };
  setFeedCacheEntry(cacheKey, entry);
  if (
    snapshot.hasMore
    && pageCount >= FEED_MAX_PAGES_PER_LOAD
    && countVisibleFeedPosts(snapshot.items, hiddenTags, hiddenKeywords) < FEED_DISPLAY_LIMIT
  ) {
    throw new Error('热门榜单分页达到加载上限，结果可能不完整，请重试');
  }
  return entry;
};

const getSyncedReactionSets = (state: AppState, posts: Post[]) => {
  const likedPosts = new Set(state.likedPosts);
  const dislikedPosts = new Set(state.dislikedPosts);
  const favoritedPosts = new Set(state.favoritedPosts);

  posts.forEach((post) => {
    likedPosts.delete(post.id);
    dislikedPosts.delete(post.id);
    favoritedPosts.delete(post.id);
    if (post.viewerReaction === 'like') {
      likedPosts.add(post.id);
    } else if (post.viewerReaction === 'dislike') {
      dislikedPosts.add(post.id);
    }
    if (post.viewerFavorited) {
      favoritedPosts.add(post.id);
    }
  });

  return { likedPosts, dislikedPosts, favoritedPosts };
};

interface AppContextType {
  state: AppState;
  addPost: (post: Omit<Post, 'id' | 'likes' | 'dislikes' | 'comments' | 'createdAt'>, turnstileToken: string) => Promise<Post>;
  addComment: (postId: string, content: string, turnstileToken: string, parentId?: string | null, replyToId?: string | null) => Promise<Comment>;
  likePost: (postId: string) => Promise<void>;
  dislikePost: (postId: string) => Promise<void>;
  toggleFavoritePost: (postId: string) => Promise<boolean>;
  deletePost: (postId: string) => void;
  reportPost: (postId: string, payload: ReportSubmissionPayload) => Promise<ReportSubmissionResult>;
  reportComment: (commentId: string, payload: ReportSubmissionPayload) => Promise<ReportSubmissionResult>;
  requestPostFeature: (postId: string) => Promise<FeatureRequestSubmissionResult>;
  handleReport: (
    reportId: string,
    action: AdminReportAction,
    reason?: string,
    options?: HandleReportOptions,
    targetContext?: HandleReportTargetContext
  ) => Promise<void>;
  showToast: (message: string, type?: Toast['type']) => void;
  removeToast: (id: string) => void;
  toggleHiddenPostTag: (tag: string) => void;
  toggleHiddenPostKeyword: (keyword: string) => void;
  clearHiddenPostTags: () => void;
  clearHiddenPostKeywords: () => void;
  isLiked: (postId: string) => boolean;
  isDisliked: (postId: string) => boolean;
  isFavorited: (postId: string) => boolean;
  getHomePosts: () => Post[];
  getFeedPosts: (filter?: FeedFilter) => Post[];
  getPendingReports: () => Report[];
  loadHomePosts: (options?: number | { limit?: number; offset?: number; append?: boolean }) => Promise<void>;
  loadFeedPosts: (filter?: FeedFilter, search?: string) => Promise<void>;
  cancelFeedPostsLoad: () => void;
  prefetchFeedPosts: (filter?: FeedFilter, search?: string) => Promise<void>;
  loadFeaturedPosts: (options?: { limit?: number; offset?: number; append?: boolean }) => Promise<void>;
  loadReports: () => Promise<void>;
  loadStats: () => Promise<void>;
  loadSettings: () => Promise<void>;
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
  totalVisits: 0,
  onlineCount: 0,
};

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<AppState>({
    homePosts: [],
    homeTotal: 0,
    feedPosts: [],
    feedTotal: 0,
    feedLoading: false,
    feedRefreshing: false,
    feedError: null,
    feedRefreshAt: null,
    featuredPosts: [],
    featuredTotal: 0,
    reports: [],
    stats: initialStats,
    toasts: [],
    likedPosts: new Set(),
    dislikedPosts: new Set(),
    favoritedPosts: new Set(),
    hiddenPostTags: readHiddenPostTags(),
    hiddenPostKeywords: readHiddenPostKeywords(),
    adminSession: { loggedIn: false, checked: false, disabled: false, csrfToken: null },
    settings: {
      turnstileEnabled: true,
      cnyThemeEnabled: false,
      cnyThemeAutoActive: false,
      cnyThemeActive: false,
      shopEnabled: false,
    },
  });
  const feedRequestIdRef = React.useRef(0);

  React.useEffect(() => {
    writeHiddenPostTags(state.hiddenPostTags);
  }, [state.hiddenPostTags]);

  React.useEffect(() => {
    writeHiddenPostKeywords(state.hiddenPostKeywords);
  }, [state.hiddenPostKeywords]);

  const commitFeedSnapshot = useCallback((
    requestId: number,
    snapshot: FeedSnapshot,
    status: FeedLoadStatus
  ) => {
    const items = snapshot.items;
    const cacheSnapshot = snapshot as Partial<FeedCacheEntry>;
    const refreshCandidates = [cacheSnapshot.expiresAt, cacheSnapshot.contentExpiresAt]
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    setState((prev) => {
      if (requestId !== feedRequestIdRef.current) {
        return prev;
      }
      return {
        ...prev,
        ...getSyncedReactionSets(prev, items),
        feedPosts: items,
        feedTotal: snapshot.total,
        feedLoading: status.loading,
        feedRefreshing: status.refreshing,
        feedError: status.error,
        feedRefreshAt: refreshCandidates.length > 0 ? Math.min(...refreshCandidates) : null,
      };
    });
  }, []);

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

  const toggleHiddenPostTag = useCallback((tag: string) => {
    const normalized = normalizeHiddenPostTag(tag);
    if (!normalized) {
      return;
    }

    setState((prev) => {
      const nextTags = prev.hiddenPostTags.some((item) => item.toLowerCase() === normalized.toLowerCase())
        ? prev.hiddenPostTags.filter((item) => item.toLowerCase() !== normalized.toLowerCase())
        : [...prev.hiddenPostTags, normalized];

      return {
        ...prev,
        hiddenPostTags: normalizeHiddenPostTagList(nextTags),
      };
    });
  }, []);

  const clearHiddenPostTags = useCallback(() => {
    setState((prev) => ({
      ...prev,
      hiddenPostTags: [],
    }));
  }, []);

  const toggleHiddenPostKeyword = useCallback((keyword: string) => {
    const normalized = normalizeHiddenPostKeyword(keyword);
    if (!normalized) {
      return;
    }

    setState((prev) => {
      const nextKeywords = prev.hiddenPostKeywords.some((item) => item.toLowerCase() === normalized.toLowerCase())
        ? prev.hiddenPostKeywords.filter((item) => item.toLowerCase() !== normalized.toLowerCase())
        : [...prev.hiddenPostKeywords, normalized];

      return {
        ...prev,
        hiddenPostKeywords: normalizeHiddenPostKeywordList(nextKeywords),
      };
    });
  }, []);

  const clearHiddenPostKeywords = useCallback(() => {
    setState((prev) => ({
      ...prev,
      hiddenPostKeywords: [],
    }));
  }, []);

  const syncReactions = useCallback((posts: Post[]) => {
    setState((prev) => ({
      ...prev,
      ...getSyncedReactionSets(prev, posts),
    }));
  }, []);

  const loadHomePosts = useCallback(async (options?: number | { limit?: number; offset?: number; append?: boolean }) => {
    const resolved = typeof options === 'number' ? { limit: options } : options || {};
    const limit = resolved.limit;
    const offset = resolved.offset ?? 0;
    const append = Boolean(resolved.append);
    const data = await api.getHomePosts(limit, offset);
    const items: Post[] = data.items || [];
    setState((prev) => {
      const existingIds = new Set(prev.homePosts.map((post) => post.id));
      const merged = append
        ? [...prev.homePosts, ...items.filter((post) => !existingIds.has(post.id))]
        : items;
      return {
        ...prev,
        homePosts: merged,
        homeTotal: data.total ?? (append ? prev.homeTotal : items.length),
      };
    });
    syncReactions(items);
  }, [syncReactions]);

  const loadFeedPosts = useCallback(async (
    filter: FeedFilter = 'week',
    search = ''
  ) => {
    const normalizedSearch = normalizeFeedSearch(search);
    const requestId = feedRequestIdRef.current + 1;
    feedRequestIdRef.current = requestId;

    const cached = getFeedCacheEntry(filter, normalizedSearch);
    const now = Date.now();
    const rankingIsFresh = Boolean(cached && cached.expiresAt > now);
    const contentIsFresh = Boolean(cached && cached.contentExpiresAt > now);
    const needsMoreCachedPosts = Boolean(
      cached
      && cached.hasMore
      && countVisibleFeedPosts(
        cached.items,
        state.hiddenPostTags,
        state.hiddenPostKeywords
      ) < FEED_DISPLAY_LIMIT
    );
    const needsRequest = Boolean(
      !cached
      || !rankingIsFresh
      || !contentIsFresh
      || needsMoreCachedPosts
    );

    if (cached) {
      commitFeedSnapshot(requestId, cached, {
        loading: needsRequest && cached.items.length === 0,
        refreshing: needsRequest && cached.items.length > 0,
        error: null,
      });
    } else {
      commitFeedSnapshot(
        requestId,
        { items: [], total: 0, nextOffset: 0, hasMore: true },
        { loading: true, refreshing: false, error: null }
      );
    }

    if (!needsRequest) {
      return;
    }

    try {
      const snapshot = await fillFeedCache(
        filter,
        normalizedSearch,
        state.hiddenPostTags,
        state.hiddenPostKeywords,
        {
          shouldContinue: () => requestId === feedRequestIdRef.current,
        }
      );
      commitFeedSnapshot(requestId, snapshot, {
        loading: false,
        refreshing: false,
        error: null,
      });
    } catch (error) {
      // 旧筛选请求失效后只停止后续补页，不应覆盖当前筛选的状态或错误提示。
      if (requestId !== feedRequestIdRef.current || error instanceof FeedLoadCancelledError) {
        return;
      }
      const fallback = getFeedCacheEntry(filter, normalizedSearch)
        || cached
        || { items: [], total: 0, nextOffset: 0, hasMore: false };
      commitFeedSnapshot(requestId, fallback, {
        loading: false,
        refreshing: false,
        error: getFeedErrorMessage(error),
      });
      throw error;
    }
  }, [commitFeedSnapshot, state.hiddenPostKeywords, state.hiddenPostTags]);

  const cancelFeedPostsLoad = useCallback(() => {
    // 组件卸载或切换筛选时使当前代次失效；已发出的单页请求结束后不会继续补页。
    feedRequestIdRef.current += 1;
  }, []);

  const prefetchFeedPosts = useCallback(async (filter: FeedFilter = 'today', search = '') => {
    const normalizedSearch = normalizeFeedSearch(search);
    const cached = getFeedCacheEntry(filter, normalizedSearch);
    const now = Date.now();
    if (cached && cached.expiresAt > now && cached.contentExpiresAt > now) {
      return;
    }

    // 导航意图只预取首批，真正进入热门页后再按本地隐藏规则补足 10 条。
    const page = await requestFeedPage(filter, normalizedSearch, 0);
    setFeedCacheEntry(getFeedCacheKey(filter, normalizedSearch), {
      ...page,
      expiresAt: resolveFeedCacheExpiresAt(page, filter),
      contentExpiresAt: Date.now() + FEED_CONTENT_TTL_MS,
    });
  }, []);

  const loadFeaturedPosts = useCallback(async (options: { limit?: number; offset?: number; append?: boolean } = {}) => {
    const limit = options.limit ?? 20;
    const offset = options.offset ?? 0;
    const append = Boolean(options.append);
    const data = await api.getFeaturedPosts(limit, offset);
    const items: Post[] = data.items || [];
    setState((prev) => {
      const existingIds = new Set(prev.featuredPosts.map((post) => post.id));
      return {
        ...prev,
        featuredPosts: append
          ? [...prev.featuredPosts, ...items.filter((post) => !existingIds.has(post.id))]
          : items,
        featuredTotal: data.total ?? (append ? prev.featuredTotal : items.length),
      };
    });
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
        totalVisits: data.totalVisits ?? prev.stats.totalVisits,
        onlineCount: data.onlineCount ?? prev.stats.onlineCount,
      },
    }));
  }, []);

  const loadSettings = useCallback(async () => {
    const data = await api.getPublicSettings();
    setState((prev) => ({
      ...prev,
      settings: {
        turnstileEnabled: typeof data?.turnstileEnabled === 'boolean'
          ? data.turnstileEnabled
          : prev.settings.turnstileEnabled,
        cnyThemeEnabled: typeof data?.cnyThemeEnabled === 'boolean'
          ? data.cnyThemeEnabled
          : prev.settings.cnyThemeEnabled,
        cnyThemeAutoActive: typeof data?.cnyThemeAutoActive === 'boolean'
          ? data.cnyThemeAutoActive
          : prev.settings.cnyThemeAutoActive,
        cnyThemeActive: typeof data?.cnyThemeActive === 'boolean'
          ? data.cnyThemeActive
          : (
            (typeof data?.cnyThemeEnabled === 'boolean' ? data.cnyThemeEnabled : prev.settings.cnyThemeEnabled)
            && (typeof data?.cnyThemeAutoActive === 'boolean' ? data.cnyThemeAutoActive : prev.settings.cnyThemeAutoActive)
          ),
        shopEnabled: typeof data?.shopEnabled === 'boolean'
          ? data.shopEnabled
          : prev.settings.shopEnabled,
      },
    }));
  }, []);

  const loadAdminSession = useCallback(async () => {
    const data = await api.getAdminSession();
    api.setCsrfToken(data?.csrfToken || '');
    setState((prev) => ({
      ...prev,
      adminSession: {
        loggedIn: Boolean(data.loggedIn),
        id: data.id,
        username: data.username,
        role: data.role,
        isSuperAdmin: Boolean(data.isSuperAdmin),
        permissions: data.permissions || {},
        permissionDefinitions: data.permissionDefinitions || null,
        checked: true,
        csrfToken: data?.csrfToken || null,
        disabled: Boolean(data?.disabled),
      },
    }));
  }, []);

  const loginAdmin = useCallback(async (username: string, password: string) => {
    const data = await api.adminLogin(username, password);
    api.setCsrfToken(data?.csrfToken || '');
    setState((prev) => ({
      ...prev,
      adminSession: {
        loggedIn: Boolean(data.loggedIn),
        id: data.id,
        username: data.username,
        role: data.role,
        isSuperAdmin: Boolean(data.isSuperAdmin),
        permissions: data.permissions || {},
        permissionDefinitions: data.permissionDefinitions || null,
        checked: true,
        csrfToken: data?.csrfToken || null,
        disabled: false,
      },
    }));
  }, []);

  const logoutAdmin = useCallback(async () => {
    await api.adminLogout();
    api.setCsrfToken('');
    setState((prev) => ({
      ...prev,
      adminSession: {
        loggedIn: false,
        checked: true,
        csrfToken: null,
        disabled: prev.adminSession.disabled,
      },
    }));
  }, []);

  const addPost = useCallback(async (post: Omit<Post, 'id' | 'likes' | 'dislikes' | 'comments' | 'createdAt'>, turnstileToken: string) => {
    const data = await api.createPost(post.content, post.tags || [], turnstileToken);
    const newPost: Post = data.post;
    setState((prev) => ({
      ...prev,
      homePosts: [newPost, ...prev.homePosts],
      homeTotal: prev.homeTotal + 1,
    }));
    return newPost;
  }, []);

  const addComment = useCallback(async (postId: string, content: string, turnstileToken: string, parentId?: string | null, replyToId?: string | null) => {
    const data = await api.addComment(postId, content, turnstileToken, parentId, replyToId);
    const comment: Comment = data.comment;
    incrementFeedPostCommentCache(postId);
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
        featuredPosts: updateList(prev.featuredPosts),
      };
    });
    return comment;
  }, []);

  const likePost = useCallback(async (postId: string) => {
    const data = await api.likePost(postId);
    patchFeedPostCache(postId, {
      ...(typeof data.likes === 'number' ? { likes: data.likes } : {}),
      ...(typeof data.dislikes === 'number' ? { dislikes: data.dislikes } : {}),
      viewerReaction: data.reaction === 'like' || data.reaction === 'dislike'
        ? data.reaction
        : null,
    });
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
            ? {
              ...post,
              likes: data.likes ?? post.likes,
              dislikes: data.dislikes ?? post.dislikes,
              viewerReaction: data.reaction,
            }
            : post
        );

      return {
        ...prev,
        likedPosts,
        dislikedPosts,
        homePosts: updateList(prev.homePosts),
        feedPosts: updateList(prev.feedPosts),
        featuredPosts: updateList(prev.featuredPosts),
      };
    });
  }, []);

  const dislikePost = useCallback(async (postId: string) => {
    const data = await api.dislikePost(postId);
    patchFeedPostCache(postId, {
      ...(typeof data.likes === 'number' ? { likes: data.likes } : {}),
      ...(typeof data.dislikes === 'number' ? { dislikes: data.dislikes } : {}),
      viewerReaction: data.reaction === 'like' || data.reaction === 'dislike'
        ? data.reaction
        : null,
    });
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
            ? {
              ...post,
              likes: data.likes ?? post.likes,
              dislikes: data.dislikes ?? post.dislikes,
              viewerReaction: data.reaction,
            }
            : post
        );

      return {
        ...prev,
        likedPosts,
        dislikedPosts,
        homePosts: updateList(prev.homePosts),
        feedPosts: updateList(prev.feedPosts),
        featuredPosts: updateList(prev.featuredPosts),
      };
    });
  }, []);

  const toggleFavoritePost = useCallback(async (postId: string) => {
    const data = await api.toggleFavoritePost(postId);
    const favorited = Boolean(data?.favorited);
    patchFeedPostCache(postId, { viewerFavorited: favorited });
    setState((prev) => {
      const favoritedPosts = new Set(prev.favoritedPosts);
      if (favorited) {
        favoritedPosts.add(postId);
      } else {
        favoritedPosts.delete(postId);
      }

      const updateList = (list: Post[]) =>
        list.map((post) =>
          post.id === postId
            ? { ...post, viewerFavorited: favorited }
            : post
        );

      return {
        ...prev,
        favoritedPosts,
        homePosts: updateList(prev.homePosts),
        feedPosts: updateList(prev.feedPosts),
        featuredPosts: updateList(prev.featuredPosts),
      };
    });
    return favorited;
  }, []);

  const deletePost = useCallback((postId: string) => {
    removeFeedPostFromCache(postId);
    setState((prev) => ({
      ...prev,
      homePosts: prev.homePosts.filter((post) => post.id !== postId),
      homeTotal: Math.max(prev.homeTotal - 1, 0),
      feedPosts: prev.feedPosts.filter((post) => post.id !== postId),
      feedTotal: Math.max(prev.feedTotal - 1, 0),
      featuredPosts: prev.featuredPosts.filter((post) => post.id !== postId),
      featuredTotal: Math.max(
        prev.featuredTotal - (prev.featuredPosts.some((post) => post.id === postId) ? 1 : 0),
        0
      ),
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
      favoritedPosts: (() => {
        const next = new Set(prev.favoritedPosts);
        next.delete(postId);
        return next;
      })(),
    }));
  }, []);

  const reportPost = useCallback(async (postId: string, payload: ReportSubmissionPayload) => {
    const data: ReportSubmissionResult = await api.reportPost(postId, payload);
    if (data?.autoHidden && data?.targetType === 'post' && data?.targetId) {
      deletePost(data.targetId);
    }
    dispatchAutoHiddenEvent(data);
    return data;
  }, [deletePost]);

  const reportComment = useCallback(async (commentId: string, payload: ReportSubmissionPayload) => {
    const data: ReportSubmissionResult = await api.reportComment(commentId, payload);
    dispatchAutoHiddenEvent(data);
    return data;
  }, []);

  const requestPostFeature = useCallback(async (postId: string) => {
    const data = await api.requestPostFeature(postId);
    const request: FeatureRequestSubmissionResult = data.request;
    patchFeedPostCache(postId, { viewerFeatureRequestStatus: 'pending' });
    setState((prev) => {
      const updateList = (list: Post[]) => list.map((post) => (
        post.id === postId
          ? { ...post, viewerFeatureRequestStatus: 'pending' }
          : post
      ));
      return {
        ...prev,
        homePosts: updateList(prev.homePosts),
        feedPosts: updateList(prev.feedPosts),
        featuredPosts: updateList(prev.featuredPosts),
      };
    });
    return request;
  }, []);


  const handleReport = useCallback(async (
    reportId: string,
    action: AdminReportAction,
    reason = '',
    options?: HandleReportOptions,
    targetContext?: HandleReportTargetContext
  ) => {
    const report = state.reports.find((item) => item.id === reportId);
    const resolvedTargetId = targetContext?.targetId ?? report?.targetId;
    const resolvedTargetType = targetContext?.targetType ?? report?.targetType ?? 'post';
    await api.handleReport(reportId, action, reason, options || {});
    if ((action === 'delete' || action === 'ban') && resolvedTargetId && resolvedTargetType === 'post') {
      deletePost(resolvedTargetId);
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
  const isFavorited = useCallback((postId: string) => state.favoritedPosts.has(postId), [state.favoritedPosts]);

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
      toggleFavoritePost,
      deletePost,
      reportPost,
      reportComment,
      requestPostFeature,
      handleReport,
      showToast,
      removeToast,
      toggleHiddenPostTag,
      toggleHiddenPostKeyword,
      clearHiddenPostTags,
      clearHiddenPostKeywords,
      isLiked,
      isDisliked,
      isFavorited,
      getHomePosts,
      getFeedPosts,
      getPendingReports,
      loadHomePosts,
      loadFeedPosts,
      cancelFeedPostsLoad,
      prefetchFeedPosts,
      loadFeaturedPosts,
      loadReports,
      loadStats,
      loadSettings,
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
      toggleFavoritePost,
      deletePost,
      reportPost,
      reportComment,
      requestPostFeature,
      handleReport,
      showToast,
      removeToast,
      toggleHiddenPostTag,
      toggleHiddenPostKeyword,
      clearHiddenPostTags,
      clearHiddenPostKeywords,
      isLiked,
      isDisliked,
      isFavorited,
      getHomePosts,
      getFeedPosts,
      getPendingReports,
      loadHomePosts,
      loadFeedPosts,
      cancelFeedPostsLoad,
      prefetchFeedPosts,
      loadFeaturedPosts,
      loadReports,
      loadStats,
      loadSettings,
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
