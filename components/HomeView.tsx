import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  LayoutGrid,
  MessageCircle,
  Rows3,
  Share2,
  ThumbsDown,
  ThumbsUp,
  UserX,
  Zap,
} from 'lucide-react';
import { api } from '../api';
import { useAppActions } from '../store/AppActionsContext';
import { useAppShell } from '../store/AppShellContext';
import { useContent } from '../store/ContentContext';
import { useUserPreferences } from '../store/UserPreferencesContext';
import type { Post } from '../types';
import CommentModal from './CommentModal';
import DeveloperMiniCard from './DeveloperMiniCard';
import FeatureRequestConfirmModal from './FeatureRequestConfirmModal';
import { requestOverlayHistoryBack, requestOverlayHistoryNavigation } from './overlayHistory';
import HomePostGridCard from './HomePostGridCard';
import NicknameFrameCard from './NicknameFrameCard';
import { useFrameRegistryVersion } from './nicknameFrames';
import MarkdownRenderer from './MarkdownRenderer';
import Modal from './Modal';
import ReportModal from './ReportModal';
import PostActionMenu from './PostActionMenu';
import { SketchButton } from './SketchUI';
import Turnstile, { TurnstileHandle } from './Turnstile';
import useMediaQuery from './useMediaQuery';
import { usePostInteractionGuard } from './usePostInteractionGuard';
import { postMatchesHiddenFilters } from '../store/hiddenPostTags';
import { buildPostPath, buildPostShareUrl, copyTextToClipboard } from './clipboard';
import FeaturedBadge from './FeaturedBadge';

type HomeViewMode = 'focus' | 'grid';

type HomeHistoryState = {
  homeOverlay?: 'comments' | 'comment-composer';
  homeCommentPostId?: string;
  homeSecondaryOverlay?: 'comment-report' | 'comment-meme' | 'markdown-image' | 'post-report' | 'post-delete-request';
  homeSecondaryOverlayId?: string;
  homeSecondaryOverlayIndex?: number;
};

type HomeReportModalState = {
  isOpen: boolean;
  postId: string;
  content: string;
  viewerIsAuthor: boolean;
  viewerDeleteRequestStatus?: Post['viewerDeleteRequestStatus'];
};

const HOME_FOCUS_PAGE_SIZE = 10;
const HOME_GRID_PAGE_SIZE = 20;
const HOME_ROUTE_MAX_PREFETCH_PAGES = 5;
const HOME_ROUTE_PREFETCH_LIMIT = HOME_GRID_PAGE_SIZE * HOME_ROUTE_MAX_PREFETCH_PAGES;
const HOME_VIEW_MODE_STORAGE_KEY = 'home:viewMode:v1';

const readHomeHistoryState = (): HomeHistoryState => (
  window.history.state && typeof window.history.state === 'object'
    ? window.history.state as HomeHistoryState
    : {}
);

const createEmptyReportModalState = (): HomeReportModalState => ({
  isOpen: false,
  postId: '',
  content: '',
  viewerIsAuthor: false,
  viewerDeleteRequestStatus: null,
});

const readStoredHomeViewMode = (): HomeViewMode => {
  try {
    return window.localStorage.getItem(HOME_VIEW_MODE_STORAGE_KEY) === 'grid' ? 'grid' : 'focus';
  } catch {
    return 'focus';
  }
};

const parseHomeLocation = () => {
  const sharedPathMatch = window.location.pathname.match(/^\/post\/([^/]+)\/?$/);
  const searchParams = new URLSearchParams(window.location.search);
  const rawHomeIndex = searchParams.get('homeIndex');
  const parsedHomeIndex = rawHomeIndex === null || rawHomeIndex.trim() === '' ? NaN : Number(rawHomeIndex);
  const normalizedHomeIndex = Number.isFinite(parsedHomeIndex) && parsedHomeIndex >= 0
    ? Math.floor(parsedHomeIndex)
    : null;
  const homeIndex = normalizedHomeIndex !== null && normalizedHomeIndex < HOME_ROUTE_PREFETCH_LIMIT
    ? normalizedHomeIndex
    : null;
  return {
    postId: sharedPathMatch ? decodeURIComponent(sharedPathMatch[1]) : '',
    commentId: searchParams.get('comment'),
    homeIndex,
  };
};

const HomeView: React.FC = () => {
  // frames 异步加载完成后需重渲染，才能显示帖子 authorFrameId
  useFrameRegistryVersion();
  const { homePosts, homeTotal, loadHomePosts } = useContent();
  const {
    hiddenPostTags,
    hiddenPostKeywords,
    isLiked,
    isDisliked,
    isFavorited,
  } = useUserPreferences();
  const {
    likePost,
    dislikePost,
    toggleFavoritePost,
    showToast,
    viewPost,
    upsertHomePost,
    removeHomePostsFromMemory,
  } = useAppActions();
  const { settings } = useAppShell();
  const isMobileLayout = useMediaQuery('(max-width: 767px)');
  const runPostInteraction = usePostInteractionGuard();

  const [currentIndex, setCurrentIndex] = useState(0);
  const [preferredViewMode, setPreferredViewMode] = useState<HomeViewMode>(() => readStoredHomeViewMode());
  const [routeState, setRouteState] = useState(parseHomeLocation);
  const [animate, setAnimate] = useState(false);
  const [switchingPost, setSwitchingPost] = useState(false);
  const [commentModalOpen, setCommentModalOpen] = useState(false);
  const [commentPostId, setCommentPostId] = useState<string | null>(null);
  const [focusCommentId, setFocusCommentId] = useState<string | null>(null);
  const [reportModal, setReportModal] = useState<HomeReportModalState>(() => createEmptyReportModalState());
  const [featureRequestPost, setFeatureRequestPost] = useState<Post | null>(null);
  const [deleteRequestModal, setDeleteRequestModal] = useState<{ isOpen: boolean; postId: string; content: string; reason: string }>({
    isOpen: false,
    postId: '',
    content: '',
    reason: '',
  });
  const [deleteRequestSubmitting, setDeleteRequestSubmitting] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackContent, setFeedbackContent] = useState('');
  const [feedbackEmail, setFeedbackEmail] = useState('');
  const [feedbackWechat, setFeedbackWechat] = useState('');
  const [feedbackQq, setFeedbackQq] = useState('');
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const feedbackTurnstileRef = useRef<TurnstileHandle | null>(null);
  const focusArticleRef = useRef<HTMLElement | null>(null);
  const postSwitchTimerRef = useRef<number | null>(null);
  const transientRoutePostIdsRef = useRef<Set<string>>(new Set());
  const [mascotClicks, setMascotClicks] = useState(0);
  const [mascotPop, setMascotPop] = useState(false);
  const [mascotBurstKey, setMascotBurstKey] = useState(0);
  const [showMascot, setShowMascot] = useState(false);
  const [showGridBackToTop, setShowGridBackToTop] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [pendingAdvance, setPendingAdvance] = useState(false);
  const [pendingGridPrefill, setPendingGridPrefill] = useState(false);
  const [routePrefetchFailureKey, setRoutePrefetchFailureKey] = useState('');
  const prevPostCountRef = useRef(0);
  const handledRouteCommentKeyRef = useRef('');
  const markHomePostsAsServerLoaded = useCallback((items: Post[]) => {
    items.forEach((post) => {
      transientRoutePostIdsRef.current.delete(post.id);
    });
  }, []);
  const routePostId = routeState.postId;
  const routeCommentId = routeState.commentId;
  const routeHomeIndex = routeState.homeIndex;
  const routeCommentKey = routePostId && routeCommentId ? `${routePostId}:${routeCommentId}` : '';
  const allPosts = homePosts;
  const homeIndexById = useMemo(
    () => new Map(allPosts.map((post, index) => [post.id, index] as const)),
    [allPosts]
  );
  const routeHomeIndexById = useMemo(() => {
    const indexById = new Map<string, number>();
    let serverIndex = 0;
    allPosts.forEach((post) => {
      if (transientRoutePostIdsRef.current.has(post.id)) {
        return;
      }
      indexById.set(post.id, serverIndex);
      serverIndex += 1;
    });
    return indexById;
  }, [allPosts]);
  const posts = useMemo(
    () => (
      routePostId
        ? allPosts
        : allPosts.filter((post) => !postMatchesHiddenFilters(post, hiddenPostTags, hiddenPostKeywords))
    ),
    [allPosts, hiddenPostKeywords, hiddenPostTags, routePostId]
  );
  // 直达详情按 ID 临时注入的帖子不属于已加载分页，不能占用服务端 offset。
  const loadedPostCount = allPosts.reduce((count, post) => (
    transientRoutePostIdsRef.current.has(post.id) ? count : count + 1
  ), 0);
  const hasHiddenPostFilter = hiddenPostTags.length > 0 || hiddenPostKeywords.length > 0;
  const hiddenOnlyEmptyState = !routePostId && loadedPostCount > 0 && posts.length === 0 && hasHiddenPostFilter;
  const boundedIndex = posts.length ? Math.min(currentIndex, posts.length - 1) : 0;
  const routePostIndex = routePostId ? homeIndexById.get(routePostId) : undefined;
  const currentPost = routePostId
    ? routePostIndex === undefined ? undefined : allPosts[routePostIndex]
    : posts[boundedIndex];
  const routePostResolving = Boolean(routePostId && !currentPost);
  const commentTargetPost = useMemo(
    () => (commentPostId ? posts.find((post) => post.id === commentPostId) || null : currentPost || null),
    [commentPostId, currentPost, posts]
  );
  const effectiveViewMode: HomeViewMode = routePostId ? 'focus' : preferredViewMode;
  const shouldShowBanner = window.location.hostname === '933211.xyz';
  const isLatestPost = boundedIndex === 0;
  const turnstileEnabled = settings.turnstileEnabled;
  const initialLoadLimitRef = useRef(
    routePostId
      ? Math.min(
        HOME_ROUTE_PREFETCH_LIMIT,
        Math.max(HOME_FOCUS_PAGE_SIZE, (routeHomeIndex ?? 0) + HOME_FOCUS_PAGE_SIZE)
      )
      : preferredViewMode === 'focus'
        ? HOME_FOCUS_PAGE_SIZE
        : HOME_GRID_PAGE_SIZE
  );

  const syncRouteState = useCallback(() => {
    const nextRouteState = parseHomeLocation();
    const historyState = readHomeHistoryState();
    const overlay = historyState.homeOverlay;
    const overlayPostId = nextRouteState.postId || historyState.homeCommentPostId || '';
    const secondaryPost = historyState.homeSecondaryOverlayId
      ? allPosts.find((post) => post.id === historyState.homeSecondaryOverlayId) || null
      : null;
    setRouteState(nextRouteState);
    if (historyState.homeSecondaryOverlay === 'post-report' && secondaryPost) {
      setReportModal({
        isOpen: true,
        postId: secondaryPost.id,
        content: secondaryPost.content,
        viewerIsAuthor: Boolean(secondaryPost.viewerIsAuthor),
        viewerDeleteRequestStatus: secondaryPost.viewerDeleteRequestStatus ?? null,
      });
    } else if (historyState.homeSecondaryOverlay !== 'post-report') {
      setReportModal(createEmptyReportModalState());
    }
    if (historyState.homeSecondaryOverlay === 'post-delete-request' && secondaryPost) {
      setDeleteRequestModal((current) => (
        current.isOpen && current.postId === secondaryPost.id
          ? current
          : { isOpen: true, postId: secondaryPost.id, content: secondaryPost.content, reason: '' }
      ));
    } else if (historyState.homeSecondaryOverlay !== 'post-delete-request') {
      setDeleteRequestModal({ isOpen: false, postId: '', content: '', reason: '' });
    }
    if (overlayPostId && (overlay === 'comments' || overlay === 'comment-composer')) {
      setCommentPostId(overlayPostId);
      setFocusCommentId(nextRouteState.commentId || null);
      setCommentModalOpen(true);
      return;
    }
    if (!nextRouteState.commentId) {
      setCommentModalOpen(false);
      setCommentPostId(null);
      setFocusCommentId(null);
    }
  }, [allPosts]);

  const persistViewMode = useCallback((mode: HomeViewMode) => {
    setPreferredViewMode(mode);
    try {
      window.localStorage.setItem(HOME_VIEW_MODE_STORAGE_KEY, mode);
    } catch {
      // 忽略本地存储失败。
    }
  }, []);

  const updateHistoryPath = useCallback((path: string, replace = false, statePatch?: HomeHistoryState) => {
    if (window.location.pathname + window.location.search === path) {
      return;
    }
    const nextState = {
      ...readHomeHistoryState(),
      ...(statePatch || {}),
    };
    if (replace) {
      window.history.replaceState(nextState, '', path);
      return;
    }
    window.history.pushState(nextState, '', path);
  }, []);

  const navigateToHomeRoot = useCallback((replace = false) => {
    updateHistoryPath('/', replace);
    setRouteState({ postId: '', commentId: null, homeIndex: null });
  }, [updateHistoryPath]);

  const openPostInFocus = useCallback((postId: string, options?: {
    commentId?: string | null;
    homeIndex?: number | null;
    replace?: boolean;
    historyState?: HomeHistoryState;
  }) => {
    updateHistoryPath(
      buildPostPath(postId, options?.commentId || null, { homeIndex: options?.homeIndex ?? null }),
      Boolean(options?.replace),
      options?.historyState
    );
    setRouteState({ postId, commentId: options?.commentId || null, homeIndex: options?.homeIndex ?? null });
    const targetIndex = posts.findIndex((item) => item.id === postId);
    if (targetIndex >= 0) {
      setCurrentIndex(targetIndex);
    }
  }, [posts, updateHistoryPath]);

  const openPostInNewTab = useCallback((postId: string, commentId?: string | null, homeIndex?: number | null) => {
    const targetUrl = `${window.location.origin}${buildPostPath(postId, commentId, { homeIndex: homeIndex ?? null })}`;
    const newWindow = window.open(targetUrl, '_blank', 'noopener,noreferrer');
    if (newWindow) {
      newWindow.opener = null;
    }
  }, []);

  const openTagSearch = useCallback((tag: string) => {
    const normalized = String(tag || '').trim();
    if (!normalized) {
      return;
    }
    const params = new URLSearchParams();
    params.set('tag', normalized);
    const targetPath = `/search?${params.toString()}`;
    if (window.location.pathname + window.location.search !== targetPath) {
      window.history.pushState({}, '', targetPath);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  }, []);

  const handleBackToTop = useCallback(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({
      top: 0,
      behavior: reduceMotion ? 'auto' : 'smooth',
    });
  }, []);

  const copyShareLink = useCallback(async (postId: string) => {
    try {
      await copyTextToClipboard(buildPostShareUrl(postId));
      showToast('分享链接已复制', 'success');
    } catch {
      showToast('复制失败，请手动复制链接', 'error');
    }
  }, [showToast]);

  const handleLike = useCallback(async (postId: string) => {
    const wasLiked = isLiked(postId);
    try {
      const result = await runPostInteraction(postId, () => likePost(postId));
      if (result.executed && !wasLiked) {
        showToast('已点赞', 'success');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '点赞失败，请稍后重试';
      showToast(message, 'error');
    }
  }, [isLiked, likePost, runPostInteraction, showToast]);

  const handleDislike = useCallback(async (postId: string) => {
    const wasDisliked = isDisliked(postId);
    try {
      const result = await runPostInteraction(postId, () => dislikePost(postId));
      if (result.executed && !wasDisliked) {
        showToast('已点踩', 'info');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '操作失败，请稍后重试';
      showToast(message, 'error');
    }
  }, [dislikePost, isDisliked, runPostInteraction, showToast]);

  const handleFavorite = useCallback(async (postId: string) => {
    try {
      const result = await runPostInteraction(postId, () => toggleFavoritePost(postId));
      if (result.executed) {
        showToast(result.value ? '已收藏' : '已取消收藏', 'success');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '操作失败';
      showToast(message, 'error');
    }
  }, [runPostInteraction, showToast, toggleFavoritePost]);

  const openCommentModal = useCallback((
    postId: string,
    commentId?: string | null,
    options?: { pushHistory?: boolean }
  ) => {
    if (effectiveViewMode === 'grid') {
      return;
    }
    setCommentPostId(postId);
    setFocusCommentId(commentId || null);
    setCommentModalOpen(true);
    if (
      options?.pushHistory === false
      || document.documentElement.clientWidth > 767
      || readHomeHistoryState().homeOverlay
    ) {
      return;
    }
    window.history.pushState({
      ...readHomeHistoryState(),
      homeOverlay: 'comments',
      homeCommentPostId: postId,
    }, '', window.location.pathname + window.location.search);
  }, [effectiveViewMode]);

  const openRouteComment = useCallback((postId: string, commentId: string, homeIndex: number | null) => {
    const currentState = readHomeHistoryState();
    if (document.documentElement.clientWidth <= 767 && !currentState.homeOverlay) {
      const baseState = { ...currentState };
      delete baseState.homeOverlay;
      delete baseState.homeCommentPostId;
      delete baseState.homeSecondaryOverlay;
      delete baseState.homeSecondaryOverlayId;
      const basePath = buildPostPath(postId, null, { homeIndex });
      const commentPath = buildPostPath(postId, commentId, { homeIndex });

      // 将深链当前记录改造成单帖基座，再压入评论层；Back 会先收起评论，而不是直接离开帖子。
      window.history.replaceState(baseState, '', basePath);
      window.history.pushState({
        ...baseState,
        homeOverlay: 'comments',
        homeCommentPostId: postId,
      }, '', commentPath);
      setRouteState({ postId, commentId, homeIndex });
    }
    openCommentModal(postId, commentId, { pushHistory: false });
  }, [openCommentModal]);

  const finalizeCommentModalClose = useCallback(() => {
    setCommentModalOpen(false);
    setCommentPostId(null);
    setFocusCommentId(null);
  }, []);

  const cleanCommentRoute = useCallback(() => {
    const nextHistoryState = { ...readHomeHistoryState() };
    delete nextHistoryState.homeOverlay;
    delete nextHistoryState.homeCommentPostId;
    delete nextHistoryState.homeSecondaryOverlay;
    delete nextHistoryState.homeSecondaryOverlayId;
    delete nextHistoryState.homeSecondaryOverlayIndex;
    const nextPath = routePostId
      ? buildPostPath(routePostId, null, { homeIndex: routeHomeIndex })
      : window.location.pathname + window.location.search;
    window.history.replaceState(nextHistoryState, '', nextPath);
    if (routePostId && routeCommentId) {
      setRouteState({ postId: routePostId, commentId: null, homeIndex: routeHomeIndex });
    }
  }, [routeCommentId, routeHomeIndex, routePostId]);

  const closeCommentModal = useCallback(() => {
    const overlay = readHomeHistoryState().homeOverlay;
    if (overlay === 'comments' || overlay === 'comment-composer') {
      requestOverlayHistoryBack();
      return;
    }
    cleanCommentRoute();
    finalizeCommentModalClose();
  }, [cleanCommentRoute, finalizeCommentModalClose]);

  const forceCloseCommentModal = useCallback(() => {
    const historyState = readHomeHistoryState();
    const mainDepth = historyState.homeOverlay === 'comment-composer'
      ? 2
      : historyState.homeOverlay === 'comments'
        ? 1
        : 0;
    const secondaryDepth = historyState.homeSecondaryOverlay ? 1 : 0;
    const overlayDepth = mainDepth + secondaryDepth;
    if (overlayDepth > 0) {
      requestOverlayHistoryNavigation(-overlayDepth);
      return true;
    }
    cleanCommentRoute();
    finalizeCommentModalClose();
    return false;
  }, [cleanCommentRoute, finalizeCommentModalClose]);

  const closeFeedbackModal = useCallback(() => {
    setFeedbackOpen(false);
    setFeedbackSubmitting(false);
    setFeedbackContent('');
    setFeedbackEmail('');
    setFeedbackWechat('');
    setFeedbackQq('');
  }, []);

  const closeDeleteRequestModal = useCallback(() => {
    if (deleteRequestSubmitting) {
      return;
    }
    const currentState = readHomeHistoryState();
    if (currentState.homeSecondaryOverlay === 'post-delete-request') {
      requestOverlayHistoryBack();
      return;
    }
    setDeleteRequestModal({ isOpen: false, postId: '', content: '', reason: '' });
  }, [deleteRequestSubmitting]);

  useEffect(() => {
    if (!isMobileLayout) {
      return;
    }
    const currentState = readHomeHistoryState();
    if (deleteRequestModal.isOpen && deleteRequestModal.postId) {
      if (currentState.homeSecondaryOverlay === 'post-delete-request') {
        return;
      }
      const nextState: HomeHistoryState = {
        ...currentState,
        homeSecondaryOverlay: 'post-delete-request',
        homeSecondaryOverlayId: deleteRequestModal.postId,
      };
      if (currentState.homeSecondaryOverlay === 'post-report') {
        window.history.replaceState(nextState, '', window.location.pathname + window.location.search);
      } else {
        window.history.pushState(nextState, '', window.location.pathname + window.location.search);
      }
      return;
    }
    if (reportModal.isOpen && reportModal.postId && currentState.homeSecondaryOverlay !== 'post-report') {
      window.history.pushState({
        ...currentState,
        homeSecondaryOverlay: 'post-report',
        homeSecondaryOverlayId: reportModal.postId,
      }, '', window.location.pathname + window.location.search);
    }
  }, [
    deleteRequestModal.isOpen,
    deleteRequestModal.postId,
    isMobileLayout,
    reportModal.isOpen,
    reportModal.postId,
  ]);

  const isCommentModalActiveForPost = useCallback((postId: string) => (
    commentModalOpen && commentPostId === postId
  ), [commentModalOpen, commentPostId]);

  const toggleCommentModal = useCallback((postId: string, commentId?: string | null) => {
    const nextFocusCommentId = commentId || null;
    if (
      commentModalOpen
      && commentPostId === postId
      && (!nextFocusCommentId || focusCommentId === nextFocusCommentId)
    ) {
      closeCommentModal();
      return;
    }
    openCommentModal(postId, nextFocusCommentId);
  }, [closeCommentModal, commentModalOpen, commentPostId, focusCommentId, openCommentModal]);

  const loadMorePosts = useCallback(async (limit?: number): Promise<boolean> => {
    if (loading || loadingMore || !hasMore) {
      return false;
    }
    const batchSize = limit ?? (effectiveViewMode === 'grid' ? HOME_GRID_PAGE_SIZE : HOME_FOCUS_PAGE_SIZE);
    const knownPostIds = new Set(allPosts.map((post) => post.id));
    setLoadingMore(true);
    try {
      const result = await loadHomePosts({ limit: batchSize, offset: loadedPostCount, append: true });
      if (!result.applied) {
        setPendingAdvance(false);
        return false;
      }
      // 按 ID 临时注入的帖子若已出现在自然分页中，应恢复为服务端分页项，避免 offset 长期少算一位。
      markHomePostsAsServerLoaded(result.items);
      const addedPostCount = result.items.reduce((count, post) => (
        knownPostIds.has(post.id) ? count : count + 1
      ), 0);
      if (addedPostCount === 0) {
        // 防止总数与分页结果短暂不一致时，在同一 offset 上持续补页。
        setHasMore(false);
        setPendingAdvance(false);
        return false;
      }
      return true;
    } catch {
      setPendingAdvance(false);
      showToast('加载更多失败，请稍后重试', 'error');
      return false;
    } finally {
      setLoadingMore(false);
    }
  }, [allPosts, effectiveViewMode, hasMore, loadHomePosts, loadedPostCount, loading, loadingMore, markHomePostsAsServerLoaded, showToast]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const result = await loadHomePosts(initialLoadLimitRef.current);
        if (result.applied) {
          markHomePostsAsServerLoaded(result.items);
        }
      } catch {
        // 空态自行处理。
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [loadHomePosts, markHomePostsAsServerLoaded]);

  useEffect(() => {
    syncRouteState();
    window.addEventListener('popstate', syncRouteState);
    return () => {
      window.removeEventListener('popstate', syncRouteState);
    };
  }, [syncRouteState]);

  useEffect(() => {
    if (
      transientRoutePostIdsRef.current.size === 0
      || (routePostId && transientRoutePostIdsRef.current.has(routePostId))
    ) {
      return;
    }
    const transientPostIds = [...transientRoutePostIdsRef.current];
    transientRoutePostIdsRef.current.clear();
    removeHomePostsFromMemory(transientPostIds);
  }, [removeHomePostsFromMemory, routePostId]);

  useEffect(() => () => {
    if (transientRoutePostIdsRef.current.size === 0) {
      return;
    }
    const transientPostIds = [...transientRoutePostIdsRef.current];
    transientRoutePostIdsRef.current.clear();
    removeHomePostsFromMemory(transientPostIds);
  }, [removeHomePostsFromMemory]);

  useEffect(() => {
    const handleNavigate = (event: Event) => {
      const detail = (event as CustomEvent<{ postId: string; commentId?: string | null }>).detail;
      if (!detail?.postId) {
        return;
      }
      if (detail.commentId) {
        handledRouteCommentKeyRef.current = '';
      }
      setRouteState({ postId: detail.postId, commentId: detail.commentId || null, homeIndex: null });
    };
    window.addEventListener('notification:navigate', handleNavigate as EventListener);
    return () => {
      window.removeEventListener('notification:navigate', handleNavigate as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!routeCommentKey) {
      handledRouteCommentKeyRef.current = '';
    }
  }, [routeCommentKey]);

  useEffect(() => {
    setRoutePrefetchFailureKey('');
  }, [routeHomeIndex, routePostId]);

  useEffect(() => {
    if (!commentModalOpen || !commentPostId) {
      return;
    }
    if (!posts.some((post) => post.id === commentPostId)) {
      forceCloseCommentModal();
    }
  }, [commentModalOpen, commentPostId, forceCloseCommentModal, posts]);

  useEffect(() => {
    if (!posts.length) {
      return;
    }
    if (currentIndex !== boundedIndex) {
      setCurrentIndex(boundedIndex);
    }
  }, [boundedIndex, currentIndex, posts.length]);

  useEffect(() => {
    if (!routePostId) {
      return;
    }
    const shouldAutoOpenRouteComment = Boolean(routeCommentKey) && handledRouteCommentKeyRef.current !== routeCommentKey;
    const existingIndex = homeIndexById.get(routePostId) ?? -1;
    if (existingIndex >= 0) {
      const targetIndex = (
        routeHomeIndex !== null
        && allPosts[routeHomeIndex]?.id === routePostId
      )
        ? routeHomeIndex
        : existingIndex;
      if (currentIndex !== targetIndex) {
        setCurrentIndex(targetIndex);
      }
      if (shouldAutoOpenRouteComment && routeCommentId) {
        handledRouteCommentKeyRef.current = routeCommentKey;
        openRouteComment(routePostId, routeCommentId, routeHomeIndex);
      }
      return;
    }

    if (routeHomeIndex !== null && routeHomeIndex >= allPosts.length && hasMore) {
      if (loading || loadingMore) {
        return;
      }
      const routePrefetchKey = `${routePostId}:${routeHomeIndex}`;
      const targetCount = Math.min(
        HOME_ROUTE_PREFETCH_LIMIT,
        routeHomeIndex + HOME_FOCUS_PAGE_SIZE
      );
      const remainingCount = targetCount - allPosts.length;
      if (remainingCount > 0 && routePrefetchFailureKey !== routePrefetchKey) {
        void loadMorePosts(remainingCount).then((loaded) => {
          if (!loaded) {
            // 自动补页失败后直接按帖子 ID 降级，避免同一路由持续重试和重复 Toast。
            setRoutePrefetchFailureKey(routePrefetchKey);
          }
        });
        return;
      }
    }

    // 首页首批请求完成后再按 ID 加载，避免两个覆盖式写入互相移除目标帖子。
    if (loading || loadingMore) {
      return;
    }

    let cancelled = false;
    api.getPostById(routePostId)
      .then((data) => {
        if (cancelled) {
          return;
        }
        transientRoutePostIdsRef.current.add(data.post.id);
        upsertHomePost(data.post, { prepend: true });
        setCurrentIndex(0);
        if (shouldAutoOpenRouteComment && routeCommentId) {
          handledRouteCommentKeyRef.current = routeCommentKey;
          openRouteComment(routePostId, routeCommentId, routeHomeIndex);
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        const message = error instanceof Error ? error.message : '分享的帖子不存在或已删除';
        showToast(message, 'warning');
        navigateToHomeRoot(true);
      });

    return () => {
      cancelled = true;
    };
  }, [
    allPosts,
    currentIndex,
    hasMore,
    homeIndexById,
    loadMorePosts,
    loading,
    loadingMore,
    navigateToHomeRoot,
    openRouteComment,
    routeCommentId,
    routeCommentKey,
    routeHomeIndex,
    routePostId,
    routePrefetchFailureKey,
    showToast,
    upsertHomePost,
  ]);

  useEffect(() => {
    if (effectiveViewMode !== 'focus' || !currentPost?.id) {
      return;
    }
    viewPost(currentPost.id).catch(() => { });
  }, [currentPost?.id, effectiveViewMode, viewPost]);

  useEffect(() => {
    if (effectiveViewMode !== 'grid') {
      setShowGridBackToTop(false);
      return;
    }

    let frameId = 0;
    const syncBackToTopVisibility = () => {
      frameId = 0;
      setShowGridBackToTop(window.scrollY > 480);
    };
    const handleScroll = () => {
      if (frameId) {
        return;
      }
      frameId = window.requestAnimationFrame(syncBackToTopVisibility);
    };

    syncBackToTopVisibility();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      window.removeEventListener('scroll', handleScroll);
    };
  }, [effectiveViewMode]);

  useEffect(() => {
    const timer = window.setTimeout(() => setShowMascot(true), 1000);
    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const handleRefresh = () => {
      forceCloseCommentModal();
      if (loading) {
        return;
      }
      const latestRouteState = parseHomeLocation();
      const refreshViewMode: HomeViewMode = latestRouteState.postId ? 'focus' : preferredViewMode;
      setRouteState(latestRouteState);
      setLoading(true);
      const refreshLimit = refreshViewMode === 'grid' ? HOME_GRID_PAGE_SIZE : HOME_FOCUS_PAGE_SIZE;
      loadHomePosts(refreshLimit)
        .then((result) => {
          if (result.applied) {
            markHomePostsAsServerLoaded(result.items);
          }
          if (!latestRouteState.postId) {
            setCurrentIndex(0);
          }
        })
        .catch(() => { })
        .finally(() => {
          setLoading(false);
        });
    };
    window.addEventListener('home:refresh', handleRefresh as EventListener);
    return () => {
      window.removeEventListener('home:refresh', handleRefresh as EventListener);
    };
  }, [forceCloseCommentModal, loadHomePosts, loading, markHomePostsAsServerLoaded, preferredViewMode]);

  useEffect(() => {
    if (homeTotal > 0) {
      setHasMore(loadedPostCount < homeTotal);
      return;
    }
    setHasMore(false);
  }, [homeTotal, loadedPostCount]);

  useEffect(() => {
    if (effectiveViewMode !== 'focus' || loadingMore || !hasMore || posts.length === 0) {
      return;
    }
    if (currentIndex >= posts.length - 3) {
      loadMorePosts();
    }
  }, [currentIndex, effectiveViewMode, hasMore, loadMorePosts, loadingMore, posts.length]);

  useEffect(() => {
    if (!pendingGridPrefill || effectiveViewMode !== 'grid' || loading || loadingMore) {
      return;
    }
    const targetCount = Math.min(homeTotal || HOME_GRID_PAGE_SIZE, HOME_GRID_PAGE_SIZE);
    setPendingGridPrefill(false);
    if (posts.length < targetCount && hasMore) {
      loadMorePosts(targetCount - posts.length);
    }
  }, [effectiveViewMode, hasMore, homeTotal, loadMorePosts, loading, loadingMore, pendingGridPrefill, posts.length]);

  const handleModeSwitch = (mode: HomeViewMode) => {
    persistViewMode(mode);
    if (mode !== 'grid') {
      setPendingGridPrefill(false);
      return;
    }
    if (forceCloseCommentModal()) {
      return;
    }
    if (routePostId) {
      navigateToHomeRoot(true);
    }
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'auto' });
    });
    const targetCount = Math.min(homeTotal || HOME_GRID_PAGE_SIZE, HOME_GRID_PAGE_SIZE);
    if (posts.length >= targetCount || !hasMore) {
      setPendingGridPrefill(false);
      return;
    }
    if (loading) {
      setPendingGridPrefill(true);
      return;
    }
    setPendingGridPrefill(false);
    loadMorePosts(targetCount - posts.length);
  };

  const scrollFocusPostToTop = useCallback(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        focusArticleRef.current?.scrollIntoView({
          block: 'start',
          behavior: reduceMotion ? 'auto' : 'smooth',
        });
      });
    });
  }, []);

  const switchToPostIndex = useCallback((nextIndex: number) => {
    if (switchingPost || !posts[nextIndex]) {
      return;
    }
    if (forceCloseCommentModal()) {
      return;
    }
    const targetPost = posts[nextIndex];
    setSwitchingPost(true);
    setAnimate(true);
    if (postSwitchTimerRef.current !== null) {
      window.clearTimeout(postSwitchTimerRef.current);
    }
    postSwitchTimerRef.current = window.setTimeout(() => {
      const nextHistoryState = { ...readHomeHistoryState() };
      delete nextHistoryState.homeOverlay;
      delete nextHistoryState.homeCommentPostId;
      delete nextHistoryState.homeSecondaryOverlay;
      delete nextHistoryState.homeSecondaryOverlayId;
      delete nextHistoryState.homeSecondaryOverlayIndex;
      setCurrentIndex(nextIndex);
      if (routePostId) {
        openPostInFocus(targetPost.id, {
          homeIndex: routeHomeIndexById.get(targetPost.id) ?? null,
          replace: true,
          historyState: nextHistoryState,
        });
      }
      setAnimate(false);
      setSwitchingPost(false);
      postSwitchTimerRef.current = null;
      scrollFocusPostToTop();
    }, 180);
  }, [
    boundedIndex,
    forceCloseCommentModal,
    openPostInFocus,
    posts,
    routeHomeIndexById,
    routePostId,
    scrollFocusPostToTop,
    switchingPost,
  ]);

  const handleNext = () => {
    if (!currentPost || switchingPost || pendingAdvance) {
      return;
    }
    if (boundedIndex >= posts.length - 1) {
      if (hasMore) {
        setPendingAdvance(true);
        loadMorePosts(HOME_FOCUS_PAGE_SIZE);
      } else {
        showToast('这已经是最后一条了', 'info');
      }
      return;
    }
    switchToPostIndex(Math.min(boundedIndex + 1, posts.length - 1));
  };

  const handlePrev = () => {
    if (!currentPost || switchingPost || pendingAdvance) {
      return;
    }
    if (boundedIndex <= 0) {
      return;
    }
    switchToPostIndex(Math.max(boundedIndex - 1, 0));
  };

  useEffect(() => {
    const prevCount = prevPostCountRef.current;
    if (pendingAdvance && posts.length > prevCount) {
      const nextIndex = Math.min(currentIndex + 1, posts.length - 1);
      setPendingAdvance(false);
      switchToPostIndex(nextIndex);
    } else if (!hasMore && pendingAdvance) {
      setPendingAdvance(false);
    }
    prevPostCountRef.current = posts.length;
  }, [currentIndex, hasMore, pendingAdvance, posts.length, switchToPostIndex]);

  useEffect(() => () => {
    if (postSwitchTimerRef.current !== null) {
      window.clearTimeout(postSwitchTimerRef.current);
    }
  }, []);

  const handleMascotClick = () => {
    setMascotPop(true);
    setMascotBurstKey((prev) => prev + 1);
    window.setTimeout(() => {
      setMascotPop(false);
    }, 320);
    setMascotClicks((prev) => {
      const next = prev + 1;
      if (next >= 5) {
        setFeedbackOpen(true);
        return 0;
      }
      return next;
    });
  };

  const handleFeedbackSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const content = feedbackContent.trim();
    const email = feedbackEmail.trim();
    const wechat = feedbackWechat.trim();
    const qq = feedbackQq.trim();

    if (!content) {
      showToast('留言内容不能为空', 'warning');
      return;
    }

    setFeedbackSubmitting(true);
    try {
      let turnstileToken = '';
      if (turnstileEnabled) {
        if (!feedbackTurnstileRef.current) {
          throw new Error('安全验证加载中，请稍后再试');
        }
        turnstileToken = await feedbackTurnstileRef.current.execute();
      }
      await api.createFeedback(content, email, wechat, qq, turnstileToken);
      showToast('留言已发送', 'success');
      closeFeedbackModal();
    } catch (error) {
      const message = error instanceof Error ? error.message : '留言失败，请稍后重试';
      showToast(message, 'error');
      setFeedbackSubmitting(false);
    }
  };

  const openReportModal = (post: Post) => {
    setReportModal({
      isOpen: true,
      postId: post.id,
      content: post.content,
      viewerIsAuthor: Boolean(post.viewerIsAuthor),
      viewerDeleteRequestStatus: post.viewerDeleteRequestStatus ?? null,
    });
    if (document.documentElement.clientWidth <= 767) {
      const currentState = readHomeHistoryState();
      if (currentState.homeSecondaryOverlay !== 'post-report') {
        window.history.pushState({
          ...currentState,
          homeSecondaryOverlay: 'post-report',
          homeSecondaryOverlayId: post.id,
        }, '', window.location.pathname + window.location.search);
      }
    }
  };

  const closeReportModal = () => {
    const currentState = readHomeHistoryState();
    if (currentState.homeSecondaryOverlay === 'post-report') {
      requestOverlayHistoryBack();
      return;
    }
    setReportModal(createEmptyReportModalState());
  };

  const openDeleteRequestModal = (post: Pick<Post, 'id' | 'content'>) => {
    setDeleteRequestModal({
      isOpen: true,
      postId: post.id,
      content: post.content,
      reason: '',
    });
    const currentState = readHomeHistoryState();
    if (currentState.homeSecondaryOverlay === 'post-report') {
      const nextState: HomeHistoryState = {
        ...currentState,
        homeSecondaryOverlay: 'post-delete-request',
        homeSecondaryOverlayId: post.id,
      };
      window.history.replaceState(nextState, '', window.location.pathname + window.location.search);
    } else if (
      document.documentElement.clientWidth <= 767
      && currentState.homeSecondaryOverlay !== 'post-delete-request'
    ) {
      const nextState: HomeHistoryState = {
        ...currentState,
        homeSecondaryOverlay: 'post-delete-request',
        homeSecondaryOverlayId: post.id,
      };
      window.history.pushState(nextState, '', window.location.pathname + window.location.search);
    }
  };

  const handleDeleteRequestSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const reason = deleteRequestModal.reason.trim();
    if (!reason) {
      showToast('请填写删除原因', 'warning');
      return;
    }
    setDeleteRequestSubmitting(true);
    try {
      await api.createPostDeleteRequest(deleteRequestModal.postId, reason);
      const targetPost = posts.find((post) => post.id === deleteRequestModal.postId);
      if (targetPost) {
        upsertHomePost({
          ...targetPost,
          viewerIsAuthor: true,
          viewerDeleteRequestStatus: 'pending',
        });
      }
      showToast('删除申请已提交，等待管理员审核', 'success');
      setDeleteRequestModal({ isOpen: false, postId: '', content: '', reason: '' });
      if (
        readHomeHistoryState().homeSecondaryOverlay === 'post-delete-request'
      ) {
        requestOverlayHistoryBack();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '删除申请提交失败';
      showToast(message, 'error');
    } finally {
      setDeleteRequestSubmitting(false);
    }
  };

  const handleRequestPostDeletionFromReport = () => {
    const { postId, content } = reportModal;
    setReportModal(createEmptyReportModalState());
    openDeleteRequestModal({ id: postId, content });
  };

  const bannerContent = (
    <div className="relative overflow-hidden rounded-lg border-2 border-ink bg-[linear-gradient(90deg,rgba(255,245,157,0.75),rgba(129,212,250,0.35),rgba(255,245,157,0.75))] shadow-sketch doodle-border !rounded-lg">
      <div className="absolute -right-10 -top-6 h-44 w-44 rotate-12 rounded-full border border-ink/10 bg-marker-green/20" />
      <div className="absolute -bottom-10 -left-8 h-48 w-48 -rotate-6 rounded-full border border-ink/10 bg-highlight/40" />
      <div className="relative flex items-start gap-3 px-4 py-3">
        <Zap className="mt-0.5 h-[22px] w-[22px] text-ink" />
        <div className="min-w-0 flex-1">
          <div className="font-hand text-base font-bold leading-snug text-ink">
            本站支持双域名，推荐用 <span className="font-mono">https://jx3gua.com/</span> 访问更快
          </div>
          <div className="mt-1 text-xs font-sans text-pencil">
            如果当前访问较慢，可换域名打开，不影响内容和功能。
          </div>
        </div>
        <a
          href="https://jx3gua.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1 rounded-full border-2 border-ink bg-white px-3 py-1.5 font-hand text-sm font-bold text-ink shadow-sketch transition-all hover:bg-highlight"
        >
          去更快域名
          <ArrowUpRight className="h-[18px] w-[18px]" />
        </a>
      </div>
    </div>
  );

  const renderModeHeader = () => (
    <div className="mx-auto mb-5 flex w-full max-w-6xl justify-center sm:justify-end">
      <div className="relative inline-flex items-stretch border-2 border-ink bg-white p-1 shadow-sketch doodle-border !rounded-lg">
        <span className="pointer-events-auto absolute -top-3 left-3 cursor-default select-none rotate-[-2deg] border border-ink bg-alert px-2 py-0.5 font-hand text-[11px] font-bold leading-none text-ink">
          浏览方式
        </span>
        <button
          type="button"
          onClick={() => handleModeSwitch('focus')}
          aria-pressed={effectiveViewMode === 'focus'}
          className={`inline-flex min-w-[88px] items-center justify-center gap-2 border-r border-dashed border-ink/30 px-3 pb-2 pt-2.5 font-hand text-sm font-bold transition-colors sm:min-w-[96px] sm:px-4 ${effectiveViewMode === 'focus'
            ? 'bg-highlight text-ink'
            : 'bg-white text-pencil hover:bg-marker-blue/30 hover:text-ink'}`}
        >
          <Rows3 className="h-[18px] w-[18px]" strokeWidth={2.25} />
          单帖
        </button>
        <button
          type="button"
          onClick={() => handleModeSwitch('grid')}
          aria-pressed={effectiveViewMode === 'grid'}
          className={`inline-flex min-w-[88px] items-center justify-center gap-2 px-3 pb-2 pt-2.5 font-hand text-sm font-bold transition-colors sm:min-w-[96px] sm:px-4 ${effectiveViewMode === 'grid'
            ? 'bg-highlight text-ink'
            : 'bg-white text-pencil hover:bg-marker-blue/30 hover:text-ink'}`}
        >
          <LayoutGrid className="h-[18px] w-[18px]" strokeWidth={2.25} />
          列表
        </button>
      </div>
    </div>
  );

  const renderLoadingSkeleton = () => {
    const skeletonCard = (compact = false) => (
      <div className="home-post-skeleton relative" aria-hidden="true">
        <div className={`pastel-post-shadow absolute inset-0 border-2 border-black ${compact ? 'translate-x-1.5 translate-y-2 rounded-[28px] opacity-80' : 'translate-x-2 translate-y-3 rounded-lg doodle-border !rounded-lg'}`} />
        <div className={`relative overflow-hidden border-2 border-ink bg-white shadow-paper ${compact ? 'min-h-[316px] rounded-[28px] p-4 sm:p-5' : 'rounded-lg p-8 doodle-border !rounded-lg'}`}>
          <div className="home-post-skeleton__shine" />
          <div className="relative flex items-center gap-3">
            <span className="home-post-skeleton__block size-10 shrink-0 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <span className="home-post-skeleton__block h-4 w-24 rounded-sm" />
              <span className="home-post-skeleton__block h-3 w-32 rounded-sm opacity-70" />
            </div>
            <span className="home-post-skeleton__block h-7 w-14 rounded-sm" />
          </div>
          <div className={`relative flex flex-col gap-3 ${compact ? 'mt-6' : 'mt-8'}`}>
            <span className="home-post-skeleton__block h-4 w-full rounded-sm" />
            <span className="home-post-skeleton__block h-4 w-[88%] rounded-sm" />
            <span className="home-post-skeleton__block h-4 w-[62%] rounded-sm" />
          </div>
          <div className={`relative flex items-center justify-between border-t-2 border-dashed border-ink/20 ${compact ? 'mt-6 pt-4' : 'mt-8 pt-5'}`}>
            <div className="flex gap-4">
              <span className="home-post-skeleton__block size-6 rounded-full" />
              <span className="home-post-skeleton__block size-6 rounded-full" />
              <span className="home-post-skeleton__block size-6 rounded-full" />
            </div>
            <span className="home-post-skeleton__block h-4 w-20 rounded-sm" />
          </div>
        </div>
      </div>
    );

    if (effectiveViewMode === 'grid') {
      return (
        <div role="status" aria-live="polite" aria-label="正在加载帖子">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:gap-5">
            {[0, 1, 2, 3].map((item) => (
              <React.Fragment key={item}>{skeletonCard(true)}</React.Fragment>
            ))}
          </div>
          <div className="mt-6 flex justify-center">
            <div className="flex h-[52px] items-center justify-center gap-3 px-6 text-pencil">
              <span className="home-post-skeleton__dot" aria-hidden="true" />
              <span className="font-hand text-base font-bold tracking-wide">正在翻瓜，马上就好</span>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="contents" role="status" aria-live="polite" aria-label="正在加载帖子">
        <article className="relative my-auto w-full">
          {skeletonCard()}
        </article>
        <div className="mx-auto mt-10 mb-4 flex min-h-[66px] w-full max-w-md items-center justify-center gap-3 text-pencil md:max-w-none">
          <span className="home-post-skeleton__dot" aria-hidden="true" />
          <span className="font-hand text-base font-bold tracking-wide sm:text-lg">正在翻瓜，马上就好</span>
        </div>
      </div>
    );
  };

  const renderFocusMode = () => {
    if (!currentPost) {
      return null;
    }
    const isRumor = currentPost.rumorStatus === 'suspected';

    return (
      <>
        <article
          ref={focusArticleRef}
          aria-busy={switchingPost || pendingAdvance}
          className={`group relative my-auto w-full scroll-mt-20 transition-all duration-200 motion-reduce:transition-none ${animate ? 'pointer-events-none translate-x-10 select-none opacity-0' : 'translate-x-0 opacity-100'} ${pendingAdvance ? 'pointer-events-none select-none' : ''}`}
        >
          <div className="pastel-post-shadow absolute inset-0 translate-x-2 translate-y-3 rounded-lg opacity-100 transition-opacity doodle-border !rounded-lg" />
          <div className="tape-mask" />
          <div className={`pastel-post-card relative flex flex-col overflow-hidden rounded-lg border-2 p-8 shadow-paper transition-transform duration-200 hover:-translate-y-1 doodle-border !rounded-lg ${isRumor ? 'border-red-300' : 'border-black'}`}>
            <div className="relative z-[1] mb-2 flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                {currentPost.author === 'admin' ? (
                  <DeveloperMiniCard timestamp={currentPost.timestamp} size="md" />
                ) : (currentPost.authorFrameId || currentPost.authorNameStyleId) ? (
                  <NicknameFrameCard
                    frameId={currentPost.authorFrameId}
                    nameStyleId={currentPost.authorNameStyleId}
                    username="匿名用户"
                    timestamp={currentPost.timestamp}
                    size="md"
                  />
                ) : (
                  <>
                    <div className="flex size-10 items-center justify-center rounded-full border-2 border-black bg-paper-shadow shadow-sm">
                      <UserX className="h-5 w-5 text-pencil" />
                    </div>
                    <div className="flex flex-col">
                      <span className="font-hand text-xl font-bold text-pencil">匿名用户</span>
                      <span className="font-mono text-xs text-pencil/70">{currentPost.timestamp}</span>
                    </div>
                  </>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {currentPost.isHot && (
                  <span className="inline-flex items-center rounded-sm border border-ink bg-alert px-2 py-0.5 text-xs font-bold shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
                    热门
                  </span>
                )}
                {currentPost.isFeatured && (
                  <FeaturedBadge />
                )}
              </div>
            </div>

            {currentPost.tags?.length ? (
              <div className="relative z-[1] mb-2 mt-[10px] flex min-w-0 flex-wrap items-center gap-2">
                {currentPost.tags.slice(0, 2).map((tag, index) => (
                  <button
                    type="button"
                    key={tag}
                    onClick={() => openTagSearch(tag)}
                    className={`max-w-full rounded-sm border border-ink px-2 py-0.5 text-left text-xs font-bold shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] ${index % 2 === 0 ? 'bg-marker-blue' : 'bg-marker-green'} hover:opacity-80`}
                  >
                    <span className="break-all">#{tag}</span>
                  </button>
                ))}
              </div>
            ) : null}

            {isRumor && (
              <div className="relative z-[1] mb-4 flex w-full max-w-full items-start gap-2 rounded-2xl border-2 border-dashed border-ink/25 bg-[#f7efc7] px-4 py-2 text-sm text-pencil shadow-[2px_2px_0_rgba(0,0,0,0.08)] sm:inline-flex sm:w-auto sm:items-center sm:rounded-full">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#c27b2b] sm:mt-0" />
                <span className="min-w-0 flex-1 break-words leading-5 text-pencil sm:flex-none sm:whitespace-nowrap sm:leading-normal">
                  审核提示：该帖
                  <span className="mx-1 rounded-sm bg-marker-yellow/70 px-1.5 py-0.5 font-bold text-ink">
                    疑似谣言
                  </span>
                  ，请谨慎辨别。
                </span>
              </div>
            )}

            <div className="relative z-[1] text-lg leading-relaxed text-black">
              <MarkdownRenderer
                content={currentPost.content}
                enableImageViewer
                historyOverlayKey={`post:${currentPost.id}`}
              />
            </div>

            <div className="relative z-[1] mt-6 flex items-center justify-between border-t-2 border-dashed border-black pt-4">
              <div className="flex items-center gap-6 pr-2">
                <button
                  type="button"
                  onClick={() => handleLike(currentPost.id)}
                  className={`flex items-center gap-1.5 transition-colors ${isLiked(currentPost.id) ? 'text-leaf-dark' : 'hover:text-ink'}`}
                >
                  <ThumbsUp className="h-[22px] w-[22px]" fill={isLiked(currentPost.id) ? 'currentColor' : 'none'} />
                  <span className="font-hand text-base font-bold">{currentPost.likes}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDislike(currentPost.id)}
                  className={`flex items-center gap-1.5 transition-colors ${isDisliked(currentPost.id) ? 'text-melon-deep' : 'hover:text-ink'}`}
                >
                  <ThumbsDown className="h-[22px] w-[22px]" fill={isDisliked(currentPost.id) ? 'currentColor' : 'none'} />
                  <span className="font-hand text-base font-bold">{currentPost.dislikes}</span>
                </button>
              </div>
              <div className="flex items-center gap-8 pl-2">
                <button
                  type="button"
                  onClick={() => toggleCommentModal(currentPost.id)}
                  className={`flex items-center gap-1.5 transition-colors ${isCommentModalActiveForPost(currentPost.id) ? 'text-leaf-dark' : 'hover:text-leaf-dark'}`}
                >
                  <MessageCircle className="h-[22px] w-[22px]" />
                  <span className="font-hand text-base font-bold">{currentPost.comments}</span>
                </button>
                <button
                  type="button"
                  onClick={() => copyShareLink(currentPost.id)}
                  className="flex items-center gap-1.5 transition-colors hover:text-leaf-dark"
                >
                  <Share2 className="h-[22px] w-[22px]" />
                  <span className="font-hand text-base font-bold">分享</span>
                </button>
                <PostActionMenu
                  post={currentPost}
                  isFavorited={isFavorited(currentPost.id)}
                  onFavorite={() => handleFavorite(currentPost.id)}
                  onReport={() => openReportModal(currentPost)}
                  onRequestFeature={() => setFeatureRequestPost(currentPost)}
                  triggerClassName="text-ink hover:text-leaf-dark"
                />
              </div>
            </div>
          </div>
        </article>

        <div className="mx-auto mt-10 mb-4 flex w-full max-w-md items-center gap-3 md:max-w-none md:justify-center md:gap-4">
          <button
            type="button"
            onClick={handlePrev}
            className="group relative flex items-center justify-center gap-2 rounded-full border-[3px] border-black bg-white px-4 py-3 shadow-sketch-lg transition-all duration-200 hover:-translate-y-1 hover:bg-highlight hover:shadow-sketch-hover active:translate-y-[4px] active:shadow-sketch-active md:gap-3 md:px-10 md:py-4"
          >
            <ArrowLeft className="h-[24px] w-[24px] transition-transform group-hover:rotate-12 md:h-[30px] md:w-[30px]" />
            <span className="hidden font-hand text-base font-bold tracking-widest md:inline md:text-2xl">上一个瓜</span>
          </button>
          <button
            type="button"
            onClick={handleNext}
            className="group relative flex flex-1 items-center justify-center gap-3 rounded-full border-[3px] border-black bg-white px-6 py-4 shadow-sketch-lg transition-all duration-200 hover:-translate-y-1 hover:bg-highlight hover:shadow-sketch-hover active:translate-y-[4px] active:shadow-sketch-active md:flex-none md:px-10 md:py-4"
          >
            <span className="font-hand text-2xl font-bold tracking-widest">下一个瓜</span>
            <ArrowRight className="h-[30px] w-[30px] transition-transform group-hover:rotate-12" />
          </button>
        </div>

      </>
    );
  };

  const renderGridMode = () => (
    <>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:gap-5">
        {posts.map((post) => {
          const homeIndex = routeHomeIndexById.get(post.id) ?? -1;
          return (
          <HomePostGridCard
            key={post.id}
            post={post}
            isLiked={isLiked(post.id)}
            isDisliked={isDisliked(post.id)}
            isFavorited={isFavorited(post.id)}
            onOpen={() => openPostInNewTab(post.id, null, homeIndex >= 0 ? homeIndex : null)}
            onLike={() => handleLike(post.id)}
            onDislike={() => handleDislike(post.id)}
            onFavorite={() => handleFavorite(post.id)}
            onShare={() => copyShareLink(post.id)}
            onReport={() => openReportModal(post)}
            onRequestFeature={() => setFeatureRequestPost(post)}
            onTagClick={openTagSearch}
          />
          );
        })}
      </div>

      {hasMore && (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            disabled={loadingMore}
            onClick={() => loadMorePosts(HOME_GRID_PAGE_SIZE)}
            className="inline-flex items-center justify-center rounded-full border-2 border-ink bg-white px-6 py-3 font-hand text-lg font-bold text-ink shadow-sketch transition-all hover:bg-highlight disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loadingMore ? '加载中...' : '继续加载更多帖子'}
          </button>
        </div>
      )}
    </>
  );

  if ((loading && posts.length === 0) || routePostResolving) {
    return (
      <div className={`relative mx-auto flex min-h-[80vh] w-full max-w-6xl flex-grow flex-col overflow-x-hidden px-4 py-6 ${effectiveViewMode === 'grid' ? 'pb-20' : 'pb-8'}`}>
        {shouldShowBanner && effectiveViewMode === 'grid' && (
          <div className="mb-4 w-full">
            {bannerContent}
          </div>
        )}
        {shouldShowBanner && effectiveViewMode !== 'grid' && (
          <div className="mx-auto mb-4 w-full max-w-3xl">
            {bannerContent}
          </div>
        )}
        {renderModeHeader()}
        <div className={effectiveViewMode === 'grid' ? 'w-full' : 'mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center'}>
          {renderLoadingSkeleton()}
        </div>
      </div>
    );
  }

  if (hiddenOnlyEmptyState) {
    return (
      <div className="mx-auto flex min-h-[80vh] w-full max-w-6xl flex-grow flex-col px-4 py-8">
        {renderModeHeader()}
        <div className="flex min-h-[55vh] flex-col items-center justify-center text-center">
          <span className="mb-4 block text-6xl">??</span>
          <h2 className="font-display text-3xl text-ink">当前批次都被屏蔽了</h2>
          <p className="mt-2 font-hand text-xl text-pencil">
            {hasMore ? '可以继续加载看看后面的帖子' : '目前没有未被屏蔽的帖子'}
          </p>
          {hasMore && (
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => loadMorePosts(effectiveViewMode === 'grid' ? HOME_GRID_PAGE_SIZE : HOME_FOCUS_PAGE_SIZE)}
                className="mt-6 inline-flex items-center justify-center rounded-full border-2 border-ink bg-white px-6 py-3 font-hand text-lg font-bold text-ink shadow-sketch transition-all hover:bg-highlight disabled:cursor-not-allowed disabled:opacity-60"
              >
              {loadingMore ? '加载中...' : '继续加载更多帖子'}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!currentPost && posts.length === 0) {
    return (
      <div className="mx-auto flex min-h-[80vh] w-full max-w-6xl flex-grow flex-col px-4 py-8">
        {renderModeHeader()}
        <div className="flex min-h-[55vh] flex-col items-center justify-center text-center">
          <span className="mb-4 block text-6xl">📰</span>
          <h2 className="font-display text-3xl text-ink">暂时还没有帖子</h2>
          <p className="mt-2 font-hand text-xl text-pencil">去投一条，成为第一位发帖的人</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative mx-auto flex min-h-[80vh] w-full max-w-6xl flex-grow flex-col overflow-x-hidden px-4 py-6 ${effectiveViewMode === 'grid' ? 'pb-20' : 'pb-8'}`}>
      {showMascot && (
        <>
          <div
            className="mascot-anchor"
            style={{
              position: 'fixed',
              right: 'calc(1rem + env(safe-area-inset-right))',
              bottom: 'calc(1rem + env(safe-area-inset-bottom))',
              zIndex: 10,
              transform: 'translateZ(0)',
            }}
          >
            <img
              src="/chxb.png"
              width={80}
              height={80}
              loading="lazy"
              decoding="async"
              fetchPriority="low"
              alt=""
              aria-label="吉祥物"
              title="吉祥物"
              className={`mascot-float h-20 w-20 cursor-pointer select-none object-contain drop-shadow-md md:h-28 md:w-28 ${mascotPop ? 'mascot-pop' : ''}`}
              onClick={handleMascotClick}
            />
          </div>
          {mascotBurstKey > 0 && (
            <div key={mascotBurstKey} className="mascot-burst">
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
          )}
        </>
      )}

      {shouldShowBanner && effectiveViewMode === 'grid' && (
        <div className="mb-4 w-full">
          {bannerContent}
        </div>
      )}
      {shouldShowBanner && effectiveViewMode !== 'grid' && isLatestPost && (
        <div className="mx-auto mb-4 w-full max-w-3xl">
          {bannerContent}
        </div>
      )}

      {renderModeHeader()}
      <div className={effectiveViewMode === 'grid' ? 'w-full' : 'mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center'}>
        {effectiveViewMode === 'grid' ? renderGridMode() : renderFocusMode()}
      </div>

      {effectiveViewMode === 'grid' && showGridBackToTop && (
        <button
          type="button"
          onClick={handleBackToTop}
          className="fixed right-[calc(6.75rem+env(safe-area-inset-right))] bottom-[calc(1.5rem+env(safe-area-inset-bottom))] z-20 inline-flex items-center gap-2 rounded-full border-[3px] border-ink bg-marker-yellow px-4 py-3 font-hand text-base font-bold text-ink shadow-sketch-lg transition-all hover:-translate-y-1 hover:bg-highlight hover:shadow-sketch-hover active:translate-x-[2px] active:translate-y-[2px] active:shadow-sketch-active sm:right-[calc(8.75rem+env(safe-area-inset-right))]"
          aria-label="回到顶部"
          title="回到顶部"
        >
          <ArrowUp className="h-5 w-5" />
          <span className="hidden sm:inline">回到顶部</span>
        </button>
      )}

      <ReportModal
        isOpen={reportModal.isOpen}
        onClose={closeReportModal}
        postId={reportModal.postId}
        contentPreview={reportModal.content.substring(0, 80)}
        canRequestPostDeletion={reportModal.viewerIsAuthor && reportModal.viewerDeleteRequestStatus !== 'pending'}
        onRequestPostDeletion={handleRequestPostDeletionFromReport}
      />

      <FeatureRequestConfirmModal
        post={featureRequestPost}
        onClose={() => setFeatureRequestPost(null)}
      />

      <Modal isOpen={deleteRequestModal.isOpen} onClose={closeDeleteRequestModal} title="申请删除帖子">
        <form className="flex flex-col gap-4" onSubmit={handleDeleteRequestSubmit}>
          <div className="rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 p-3">
            <p className="line-clamp-3 text-sm text-pencil">"{deleteRequestModal.content}"</p>
          </div>
          <div>
            <label className="text-xs font-sans text-pencil">删除原因（必填）</label>
            <textarea
              value={deleteRequestModal.reason}
              onChange={(event) => setDeleteRequestModal((prev) => ({ ...prev, reason: event.target.value }))}
              className="mt-2 h-28 w-full resize-none rounded-lg border-2 border-gray-200 p-3 text-sm font-sans outline-none focus:border-ink"
              placeholder="请说明为什么要删除这条帖子"
              maxLength={1000}
            />
          </div>
          <p className="text-xs font-sans text-pencil">提交后帖子会继续公开展示，管理员审核通过后才会删除。</p>
          <div className="flex gap-3">
            <SketchButton type="button" variant="secondary" className="flex-1" onClick={closeDeleteRequestModal} disabled={deleteRequestSubmitting}>
              取消
            </SketchButton>
            <SketchButton type="submit" variant="danger" className="flex-1" disabled={deleteRequestSubmitting}>
              {deleteRequestSubmitting ? '提交中...' : '提交申请'}
            </SketchButton>
          </div>
        </form>
      </Modal>

      {commentModalOpen && commentTargetPost && (
        <div className="mx-auto w-full max-w-3xl">
          <CommentModal
            isOpen={commentModalOpen}
            onClose={closeCommentModal}
            postId={commentTargetPost.id}
            contentPreview={commentTargetPost.content}
            focusCommentId={focusCommentId}
          />
        </div>
      )}

      <Modal isOpen={feedbackOpen} onClose={closeFeedbackModal} title="给开发者留言">
        <form className="flex flex-col gap-4" onSubmit={handleFeedbackSubmit}>
          <div>
            <label className="text-xs font-sans text-pencil">留言内容（必填）</label>
            <textarea
              value={feedbackContent}
              onChange={(event) => setFeedbackContent(event.target.value)}
              className="mt-2 h-28 w-full resize-none rounded-lg border-2 border-gray-200 p-3 text-sm font-sans outline-none focus:border-ink"
              placeholder="说点什么吧..."
              maxLength={2100}
            />
          </div>
          <div>
            <label className="text-xs font-sans text-pencil">邮箱（选填）</label>
            <input
              type="email"
              value={feedbackEmail}
              onChange={(event) => setFeedbackEmail(event.target.value)}
              className="mt-2 h-10 w-full rounded-lg border-2 border-gray-200 px-3 text-sm font-sans outline-none focus:border-ink"
              placeholder="name@example.com"
            />
            <p className="mt-2 text-xs font-sans text-pencil">如果期待开发者回复，请填写可联系的邮箱信息。</p>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="text-xs font-sans text-pencil">微信（可选）</label>
              <input
                type="text"
                value={feedbackWechat}
                onChange={(event) => setFeedbackWechat(event.target.value)}
                className="mt-2 h-10 w-full rounded-lg border-2 border-gray-200 px-3 text-sm font-sans outline-none focus:border-ink"
                placeholder="微信号"
              />
            </div>
            <div>
              <label className="text-xs font-sans text-pencil">QQ（可选）</label>
              <input
                type="text"
                value={feedbackQq}
                onChange={(event) => setFeedbackQq(event.target.value)}
                className="mt-2 h-10 w-full rounded-lg border-2 border-gray-200 px-3 text-sm font-sans outline-none focus:border-ink"
                placeholder="QQ 号"
              />
            </div>
          </div>
          <p className="text-xs font-sans text-pencil">为避免滥用，每小时仅可留言一次。</p>
          <div className="flex gap-3">
            <SketchButton type="button" variant="secondary" className="flex-1" onClick={closeFeedbackModal}>
              取消
            </SketchButton>
            <SketchButton type="submit" variant="primary" className="flex-1" disabled={feedbackSubmitting}>
              {feedbackSubmitting ? '发送中...' : '发送留言'}
            </SketchButton>
          </div>
        </form>

        <Turnstile ref={feedbackTurnstileRef} action="feedback" enabled={feedbackOpen && turnstileEnabled} />
      </Modal>
    </div>
  );
};

export default HomeView;
