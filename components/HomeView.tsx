import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Flag,
  MessageCircle,
  Share2,
  Star,
  ThumbsDown,
  ThumbsUp,
  UserX,
  Zap,
} from 'lucide-react';
import { api } from '../api';
import { useApp } from '../store/AppContext';
import type { Post } from '../types';
import CommentModal from './CommentModal';
import DeveloperMiniCard from './DeveloperMiniCard';
import HomePostGridCard from './HomePostGridCard';
import MarkdownRenderer from './MarkdownRenderer';
import Modal from './Modal';
import ReportModal from './ReportModal';
import { SketchButton } from './SketchUI';
import Turnstile, { TurnstileHandle } from './Turnstile';
import { postMatchesHiddenTags } from '../store/hiddenPostTags';

type HomeViewMode = 'focus' | 'grid';

const HOME_FOCUS_PAGE_SIZE = 10;
const HOME_GRID_PAGE_SIZE = 20;
const HOME_VIEW_MODE_STORAGE_KEY = 'home:viewMode:v1';

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
  return {
    postId: sharedPathMatch ? decodeURIComponent(sharedPathMatch[1]) : '',
    commentId: searchParams.get('comment'),
  };
};

const buildPostPath = (postId: string, commentId?: string | null) => {
  const params = new URLSearchParams();
  if (commentId) {
    params.set('comment', commentId);
  }
  const qs = params.toString();
  const basePath = `/post/${encodeURIComponent(postId)}`;
  return qs ? `${basePath}?${qs}` : basePath;
};

const HomeView: React.FC = () => {
  const {
    state,
    getHomePosts,
    likePost,
    dislikePost,
    isLiked,
    isDisliked,
    isFavorited,
    toggleFavoritePost,
    showToast,
    loadHomePosts,
    viewPost,
    upsertHomePost,
  } = useApp();

  const [currentIndex, setCurrentIndex] = useState(0);
  const [preferredViewMode, setPreferredViewMode] = useState<HomeViewMode>(() => readStoredHomeViewMode());
  const [routeState, setRouteState] = useState(parseHomeLocation);
  const [animate, setAnimate] = useState(false);
  const [commentModalOpen, setCommentModalOpen] = useState(false);
  const [commentPostId, setCommentPostId] = useState<string | null>(null);
  const [focusCommentId, setFocusCommentId] = useState<string | null>(null);
  const [reportModal, setReportModal] = useState<{ isOpen: boolean; postId: string; content: string }>({
    isOpen: false,
    postId: '',
    content: '',
  });
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackContent, setFeedbackContent] = useState('');
  const [feedbackEmail, setFeedbackEmail] = useState('');
  const [feedbackWechat, setFeedbackWechat] = useState('');
  const [feedbackQq, setFeedbackQq] = useState('');
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const feedbackTurnstileRef = useRef<TurnstileHandle | null>(null);
  const [mascotClicks, setMascotClicks] = useState(0);
  const [mascotPop, setMascotPop] = useState(false);
  const [mascotBurstKey, setMascotBurstKey] = useState(0);
  const [showMascot, setShowMascot] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [pendingAdvance, setPendingAdvance] = useState(false);
  const [pendingGridPrefill, setPendingGridPrefill] = useState(false);
  const prevPostCountRef = useRef(0);
  const handledRouteCommentKeyRef = useRef('');
  const routePostId = routeState.postId;
  const routeCommentId = routeState.commentId;
  const routeCommentKey = routePostId && routeCommentId ? `${routePostId}:${routeCommentId}` : '';
  const allPosts = getHomePosts();
  const hiddenPostTags = state.hiddenPostTags;
  const posts = useMemo(
    () => (
      routePostId
        ? allPosts
        : allPosts.filter((post) => !postMatchesHiddenTags(post.tags, hiddenPostTags))
    ),
    [allPosts, hiddenPostTags, routePostId]
  );
  const loadedPostCount = allPosts.length;
  const hasHiddenTagFilter = hiddenPostTags.length > 0;
  const hiddenOnlyEmptyState = !routePostId && loadedPostCount > 0 && posts.length === 0 && hasHiddenTagFilter;
  const boundedIndex = posts.length ? Math.min(currentIndex, posts.length - 1) : 0;
  const currentPost = posts[boundedIndex];
  const commentTargetPost = useMemo(
    () => (commentPostId ? posts.find((post) => post.id === commentPostId) || null : currentPost || null),
    [commentPostId, currentPost, posts]
  );
  const effectiveViewMode: HomeViewMode = routePostId ? 'focus' : preferredViewMode;
  const containerWidthClass = effectiveViewMode === 'grid' ? 'max-w-6xl' : 'max-w-3xl';
  const shouldShowBanner = window.location.hostname === '933211.xyz';
  const isLatestPost = boundedIndex === 0;
  const turnstileEnabled = state.settings.turnstileEnabled;
  const initialLoadLimitRef = useRef(
    routePostId || preferredViewMode === 'focus' ? HOME_FOCUS_PAGE_SIZE : HOME_GRID_PAGE_SIZE
  );

  const syncRouteState = useCallback(() => {
    setRouteState(parseHomeLocation());
  }, []);

  const persistViewMode = useCallback((mode: HomeViewMode) => {
    setPreferredViewMode(mode);
    try {
      window.localStorage.setItem(HOME_VIEW_MODE_STORAGE_KEY, mode);
    } catch {
      // 忽略本地存储失败。
    }
  }, []);

  const updateHistoryPath = useCallback((path: string, replace = false) => {
    if (window.location.pathname + window.location.search === path) {
      return;
    }
    if (replace) {
      window.history.replaceState({}, '', path);
      return;
    }
    window.history.pushState({}, '', path);
  }, []);

  const navigateToHomeRoot = useCallback((replace = false) => {
    updateHistoryPath('/', replace);
    setRouteState({ postId: '', commentId: null });
  }, [updateHistoryPath]);

  const openPostInFocus = useCallback((postId: string, options?: { commentId?: string | null; replace?: boolean }) => {
    updateHistoryPath(buildPostPath(postId, options?.commentId || null), Boolean(options?.replace));
    setRouteState({ postId, commentId: options?.commentId || null });
    const targetIndex = posts.findIndex((item) => item.id === postId);
    if (targetIndex >= 0) {
      setCurrentIndex(targetIndex);
    }
  }, [posts, updateHistoryPath]);

  const openPostInNewTab = useCallback((postId: string, commentId?: string | null) => {
    const targetUrl = `${window.location.origin}${buildPostPath(postId, commentId)}`;
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

  const copyShareLink = useCallback(async (postId: string) => {
    const shareUrl = `${window.location.origin}/post/${encodeURIComponent(postId)}`;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(shareUrl);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = shareUrl;
        textarea.setAttribute('readonly', 'true');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      showToast('分享链接已复制', 'success');
    } catch {
      showToast('复制失败，请手动复制链接', 'error');
    }
  }, [showToast]);

  const handleLike = useCallback(async (postId: string) => {
    const wasLiked = isLiked(postId);
    try {
      await likePost(postId);
      if (!wasLiked) {
        showToast('已点赞', 'success');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '点赞失败，请稍后重试';
      showToast(message, 'error');
    }
  }, [isLiked, likePost, showToast]);

  const handleDislike = useCallback(async (postId: string) => {
    const wasDisliked = isDisliked(postId);
    try {
      await dislikePost(postId);
      if (!wasDisliked) {
        showToast('已点踩', 'info');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '操作失败，请稍后重试';
      showToast(message, 'error');
    }
  }, [dislikePost, isDisliked, showToast]);

  const handleFavorite = useCallback(async (postId: string) => {
    try {
      const favorited = await toggleFavoritePost(postId);
      showToast(favorited ? '已收藏' : '已取消收藏', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '操作失败';
      showToast(message, 'error');
    }
  }, [showToast, toggleFavoritePost]);

  const openCommentModal = useCallback((postId: string, commentId?: string | null) => {
    if (effectiveViewMode === 'grid') {
      return;
    }
    setCommentPostId(postId);
    setFocusCommentId(commentId || null);
    setCommentModalOpen(true);
  }, [effectiveViewMode]);

  const closeCommentModal = useCallback(() => {
    setCommentModalOpen(false);
    setCommentPostId(null);
    setFocusCommentId(null);
  }, []);

  const closeFeedbackModal = useCallback(() => {
    setFeedbackOpen(false);
    setFeedbackSubmitting(false);
    setFeedbackContent('');
    setFeedbackEmail('');
    setFeedbackWechat('');
    setFeedbackQq('');
  }, []);

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

  const loadMorePosts = useCallback(async (limit?: number) => {
    if (loading || loadingMore || !hasMore) {
      return;
    }
    const batchSize = limit ?? (effectiveViewMode === 'grid' ? HOME_GRID_PAGE_SIZE : HOME_FOCUS_PAGE_SIZE);
    setLoadingMore(true);
    try {
      await loadHomePosts({ limit: batchSize, offset: loadedPostCount, append: true });
    } catch {
      showToast('加载更多失败，请稍后重试', 'error');
    } finally {
      setLoadingMore(false);
    }
  }, [effectiveViewMode, hasMore, loadHomePosts, loadedPostCount, loading, loadingMore, showToast]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        await loadHomePosts(initialLoadLimitRef.current);
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
  }, [loadHomePosts]);

  useEffect(() => {
    syncRouteState();
    window.addEventListener('popstate', syncRouteState);
    return () => {
      window.removeEventListener('popstate', syncRouteState);
    };
  }, [syncRouteState]);

  useEffect(() => {
    const handleNavigate = (event: Event) => {
      const detail = (event as CustomEvent<{ postId: string; commentId?: string | null }>).detail;
      if (!detail?.postId) {
        return;
      }
      if (detail.commentId) {
        handledRouteCommentKeyRef.current = '';
      }
      setRouteState({ postId: detail.postId, commentId: detail.commentId || null });
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
    if (!commentModalOpen || !commentPostId) {
      return;
    }
    if (!posts.some((post) => post.id === commentPostId)) {
      closeCommentModal();
    }
  }, [closeCommentModal, commentModalOpen, commentPostId, posts]);

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
    const existingIndex = allPosts.findIndex((post) => post.id === routePostId);
    if (existingIndex >= 0) {
      if (currentIndex !== existingIndex) {
        setCurrentIndex(existingIndex);
      }
      if (shouldAutoOpenRouteComment && routeCommentId) {
        handledRouteCommentKeyRef.current = routeCommentKey;
        openCommentModal(routePostId, routeCommentId);
      }
      return;
    }

    let cancelled = false;
    api.getPostById(routePostId)
      .then((data) => {
        if (cancelled) {
          return;
        }
        upsertHomePost(data.post, { prepend: true });
        setCurrentIndex(0);
        if (shouldAutoOpenRouteComment && routeCommentId) {
          handledRouteCommentKeyRef.current = routeCommentKey;
          openCommentModal(routePostId, routeCommentId);
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
  }, [allPosts, currentIndex, navigateToHomeRoot, openCommentModal, routeCommentId, routeCommentKey, routePostId, showToast, upsertHomePost]);

  useEffect(() => {
    if (effectiveViewMode !== 'focus' || !currentPost?.id) {
      return;
    }
    viewPost(currentPost.id).catch(() => { });
  }, [currentPost?.id, effectiveViewMode, viewPost]);

  useEffect(() => {
    const timer = window.setTimeout(() => setShowMascot(true), 1000);
    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const handleRefresh = () => {
      closeCommentModal();
      if (loading) {
        return;
      }
      setLoading(true);
      const refreshLimit = effectiveViewMode === 'grid' ? HOME_GRID_PAGE_SIZE : HOME_FOCUS_PAGE_SIZE;
      loadHomePosts(refreshLimit)
        .then(() => {
          if (!routePostId) {
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
  }, [closeCommentModal, effectiveViewMode, loadHomePosts, loading, routePostId]);

  useEffect(() => {
    if (state.homeTotal > 0) {
      setHasMore(loadedPostCount < state.homeTotal);
      return;
    }
    setHasMore(false);
  }, [loadedPostCount, state.homeTotal]);

  useEffect(() => {
    const prevCount = prevPostCountRef.current;
    if (pendingAdvance && posts.length > prevCount) {
      const nextIndex = Math.min(currentIndex + 1, posts.length - 1);
      setCurrentIndex(nextIndex);
      if (routePostId && posts[nextIndex]) {
        openPostInFocus(posts[nextIndex].id);
      }
      setPendingAdvance(false);
    }
    if (!hasMore && pendingAdvance) {
      setPendingAdvance(false);
    }
    prevPostCountRef.current = posts.length;
  }, [currentIndex, hasMore, openPostInFocus, pendingAdvance, posts, routePostId]);

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
    const targetCount = Math.min(state.homeTotal || HOME_GRID_PAGE_SIZE, HOME_GRID_PAGE_SIZE);
    setPendingGridPrefill(false);
    if (posts.length < targetCount && hasMore) {
      loadMorePosts(targetCount - posts.length);
    }
  }, [effectiveViewMode, hasMore, loadMorePosts, loading, loadingMore, pendingGridPrefill, posts.length, state.homeTotal]);

  const handleModeSwitch = (mode: HomeViewMode) => {
    persistViewMode(mode);
    if (mode !== 'grid') {
      setPendingGridPrefill(false);
      return;
    }
    closeCommentModal();
    if (routePostId) {
      navigateToHomeRoot(true);
    }
    const targetCount = Math.min(state.homeTotal || HOME_GRID_PAGE_SIZE, HOME_GRID_PAGE_SIZE);
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

  const handleNext = () => {
    if (!currentPost) {
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
    setAnimate(true);
    closeCommentModal();
    window.setTimeout(() => {
      const nextIndex = Math.min(boundedIndex + 1, posts.length - 1);
      const targetPost = posts[nextIndex];
      setCurrentIndex(nextIndex);
      if (routePostId && targetPost) {
        openPostInFocus(targetPost.id);
      }
      setAnimate(false);
    }, 200);
  };

  const handlePrev = () => {
    if (!currentPost) {
      return;
    }
    if (boundedIndex <= 0) {
      showToast('已经是最新一条', 'info');
      return;
    }
    setAnimate(true);
    closeCommentModal();
    window.setTimeout(() => {
      const nextIndex = Math.max(boundedIndex - 1, 0);
      const targetPost = posts[nextIndex];
      setCurrentIndex(nextIndex);
      if (routePostId && targetPost) {
        openPostInFocus(targetPost.id);
      }
      setAnimate(false);
    }, 200);
  };

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

  const bannerContent = (
    <div className="relative overflow-hidden rounded-lg border-2 border-ink bg-[linear-gradient(90deg,rgba(255,245,157,0.75),rgba(129,212,250,0.35),rgba(255,245,157,0.75))] shadow-sketch doodle-border !rounded-lg">
      <div className="absolute -right-10 -top-6 h-44 w-44 rotate-12 rounded-full border border-ink/20 bg-white/25" />
      <div className="absolute -bottom-10 -left-8 h-48 w-48 -rotate-6 rounded-full border border-ink/20 bg-white/20" />
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
    <div className="mb-4 flex justify-end">
      <div className="inline-flex items-center gap-1 rounded-full border-2 border-ink bg-white/90 p-1.5 shadow-sketch backdrop-blur-sm">
        <button
          type="button"
          onClick={() => handleModeSwitch('focus')}
          className={`rounded-full px-4 py-2 text-sm font-bold transition-all ${effectiveViewMode === 'focus'
            ? 'bg-ink text-white shadow-[0_6px_14px_-10px_rgba(15,23,42,0.9)]'
            : 'bg-transparent text-slate-600 hover:bg-highlight hover:text-ink'}`}
        >
          单帖
        </button>
        <button
          type="button"
          onClick={() => handleModeSwitch('grid')}
          className={`rounded-full px-4 py-2 text-sm font-bold transition-all ${effectiveViewMode === 'grid'
            ? 'bg-ink text-white shadow-[0_6px_14px_-10px_rgba(15,23,42,0.9)]'
            : 'bg-transparent text-slate-600 hover:bg-highlight hover:text-ink'}`}
        >
          列表
        </button>
      </div>
    </div>
  );

  const renderFocusMode = () => {
    if (!currentPost) {
      return null;
    }

    return (
      <>
        <article className={`group relative my-auto w-full transition-all duration-200 ${animate ? 'translate-x-10 opacity-0' : 'translate-x-0 opacity-100'}`}>
          <div className="absolute inset-0 translate-x-2 translate-y-3 rounded-lg bg-gray-200 opacity-100 transition-opacity doodle-border !rounded-lg" />
          <div className="tape-mask" />
          <div className="relative flex flex-col rounded-lg border-2 border-black bg-white p-8 shadow-paper transition-transform duration-200 hover:-translate-y-1 doodle-border !rounded-lg">
            <div className="mb-2 flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                {currentPost.author === 'admin' ? (
                  <DeveloperMiniCard timestamp={currentPost.timestamp} size="md" />
                ) : (
                  <>
                    <div className="flex size-10 items-center justify-center rounded-full border-2 border-black bg-gray-200 shadow-sm">
                      <UserX className="h-5 w-5 text-pencil" />
                    </div>
                    <div className="flex flex-col">
                      <span className="font-hand text-xl font-bold text-pencil">匿名用户</span>
                      <span className="font-mono text-xs text-gray-400">{currentPost.timestamp}</span>
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
                <button
                  type="button"
                  onClick={() => handleFavorite(currentPost.id)}
                  className={`flex shrink-0 items-center justify-center rounded-full border-2 border-ink px-2.5 py-2 shadow-sketch transition-all active:translate-x-[2px] active:translate-y-[2px] active:shadow-sketch-active ${isFavorited(currentPost.id) ? 'bg-marker-yellow hover:bg-marker-yellow/90' : 'bg-white hover:bg-highlight'}`}
                >
                  <Star className="h-5 w-5" fill={isFavorited(currentPost.id) ? 'currentColor' : 'none'} />
                </button>
              </div>
            </div>

            {currentPost.tags?.length ? (
              <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
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

            <div className="text-lg leading-relaxed text-black">
              <MarkdownRenderer content={currentPost.content} />
            </div>

            <div className="mt-4 flex items-center justify-between border-t-2 border-dashed border-black pt-4">
              <div className="flex items-center gap-6 pr-2">
                <button
                  type="button"
                  onClick={() => handleLike(currentPost.id)}
                  className={`flex items-center gap-1.5 transition-colors ${isLiked(currentPost.id) ? 'text-blue-600' : 'hover:text-ink'}`}
                >
                  <ThumbsUp className="h-[22px] w-[22px]" fill={isLiked(currentPost.id) ? 'currentColor' : 'none'} />
                  <span className="font-hand text-base font-bold">{currentPost.likes}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDislike(currentPost.id)}
                  className={`flex items-center gap-1.5 transition-colors ${isDisliked(currentPost.id) ? 'text-red-600' : 'hover:text-ink'}`}
                >
                  <ThumbsDown className="h-[22px] w-[22px]" fill={isDisliked(currentPost.id) ? 'currentColor' : 'none'} />
                  <span className="font-hand text-base font-bold">{currentPost.dislikes}</span>
                </button>
              </div>
              <div className="flex items-center gap-8 pl-2">
                <button
                  type="button"
                  onClick={() => toggleCommentModal(currentPost.id)}
                  className={`flex items-center gap-1.5 transition-colors ${isCommentModalActiveForPost(currentPost.id) ? 'text-blue-600' : 'hover:text-blue-600'}`}
                >
                  <MessageCircle className="h-[22px] w-[22px]" />
                  <span className="font-hand text-base font-bold">{currentPost.comments}</span>
                </button>
                <button
                  type="button"
                  onClick={() => copyShareLink(currentPost.id)}
                  className="flex items-center gap-1.5 transition-colors hover:text-blue-600"
                >
                  <Share2 className="h-[22px] w-[22px]" />
                  <span className="font-hand text-base font-bold">分享</span>
                </button>
                <button
                  type="button"
                  onClick={() => setReportModal({ isOpen: true, postId: currentPost.id, content: currentPost.content })}
                  className="flex items-center gap-1 border-l-2 border-dotted border-gray-200 pl-2 text-gray-400 transition-colors hover:text-red-600"
                >
                  <Flag className="h-5 w-5" />
                  <span className="font-hand pt-0.5 text-sm font-bold">举报</span>
                </button>
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
        {posts.map((post) => (
          <HomePostGridCard
            key={post.id}
            post={post}
            isLiked={isLiked(post.id)}
            isDisliked={isDisliked(post.id)}
            isFavorited={isFavorited(post.id)}
            onOpen={() => openPostInNewTab(post.id)}
            onLike={() => handleLike(post.id)}
            onDislike={() => handleDislike(post.id)}
            onFavorite={() => handleFavorite(post.id)}
            onShare={() => copyShareLink(post.id)}
            onReport={() => setReportModal({ isOpen: true, postId: post.id, content: post.content })}
            onTagClick={openTagSearch}
          />
        ))}
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

  if (loading && posts.length === 0) {
    return (
      <div className={`mx-auto flex min-h-[80vh] w-full ${containerWidthClass} flex-grow flex-col px-4 py-8`}>
        {renderModeHeader()}
        <div className="flex min-h-[55vh] flex-col items-center justify-center text-center">
          <span className="mb-4 block text-6xl">🗂️</span>
          <h2 className="font-display text-3xl text-ink">正在加载帖子...</h2>
          <p className="mt-2 font-hand text-xl text-pencil">马上就能开始浏览</p>
        </div>
      </div>
    );
  }

  if (hiddenOnlyEmptyState) {
    return (
      <div className={`mx-auto flex min-h-[80vh] w-full ${containerWidthClass} flex-grow flex-col px-4 py-8`}>
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
      <div className={`mx-auto flex min-h-[80vh] w-full ${containerWidthClass} flex-grow flex-col px-4 py-8`}>
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
    <div className={`relative mx-auto flex min-h-[80vh] w-full ${containerWidthClass} flex-grow flex-col overflow-x-hidden px-4 py-6 ${effectiveViewMode === 'grid' ? 'pb-20' : 'justify-center pb-8'}`}>
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
        <div className="mb-4 w-full">
          {bannerContent}
        </div>
      )}

      {renderModeHeader()}
      {effectiveViewMode === 'grid' ? renderGridMode() : renderFocusMode()}

      <ReportModal
        isOpen={reportModal.isOpen}
        onClose={() => setReportModal({ isOpen: false, postId: '', content: '' })}
        postId={reportModal.postId}
        contentPreview={reportModal.content.substring(0, 80)}
      />

      {commentModalOpen && commentTargetPost && (
        <CommentModal
          isOpen={commentModalOpen}
          onClose={closeCommentModal}
          postId={commentTargetPost.id}
          contentPreview={commentTargetPost.content}
          focusCommentId={focusCommentId}
        />
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
