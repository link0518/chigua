import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ThumbsUp, ThumbsDown, MessageSquare, Share2, UserX } from 'lucide-react';
import type { Post } from '../types';
import { Badge, roughBorderClassSm } from './SketchUI';
import { useFeed } from '../store/FeedContext';
import type { FeedFilter } from '../store/FeedContext';
import ReportModal from './ReportModal';
import MarkdownRenderer from './MarkdownRenderer';
import DeveloperMiniCard from './DeveloperMiniCard';
import FeatureRequestConfirmModal from './FeatureRequestConfirmModal';
import NicknameFrameCard from './NicknameFrameCard';
import PostActionMenu from './PostActionMenu';
import { useFrameRegistryVersion } from './nicknameFrames';
import { postMatchesHiddenFilters } from '../store/hiddenPostTags';
import { buildPostPath, buildPostShareUrl, copyTextToClipboard } from './clipboard';
import FeaturedBadge from './FeaturedBadge';
import {
  usePendingPostInteractionIds,
  usePostInteractionGuard,
} from './usePostInteractionGuard';

type FilterType = FeedFilter;
const DISPLAY_LIMIT = 10;

interface PostItemProps {
  post: Post;
  rank?: number;
  onLike: (postId: string) => void;
  onDislike: (postId: string) => void;
  onFavorite: (postId: string) => void;
  onComment: (postId: string) => void;
  onShare: (postId: string) => void;
  onReport: (postId: string, content: string) => void;
  onRequestFeature: (post: Post) => void;
  onTagClick: (tag: string) => void;
  interactionPending: boolean;
  deferRendering: boolean;
}

const PostItem: React.FC<PostItemProps> = React.memo(({
  post,
  rank,
  onLike,
  onDislike,
  onFavorite,
  onComment,
  onShare,
  onReport,
  onRequestFeature,
  onTagClick,
  interactionPending,
  deferRendering,
}) => {
  useFrameRegistryVersion();
  const isDeveloperPost = post.author === 'admin';
  const isLiked = post.viewerReaction === 'like';
  const isDisliked = post.viewerReaction === 'dislike';
  const isFavorited = Boolean(post.viewerFavorited);
  return (
    <div className={`relative group ${rank ? 'mb-10' : 'mb-6'} z-0`}>
      {/* Rank Badge */}
      {rank && rank <= 3 && (
        <div className="absolute left-2 sm:-left-3 md:-left-6 -top-4 z-10 transition-transform group-hover:scale-110 duration-200">
           <div className={`w-12 h-12 md:w-14 md:h-14 flex items-center justify-center font-display text-2xl md:text-3xl text-ink border-2 border-ink rounded-full shadow-md ${rank === 1 ? 'bg-alert rotate-[-12deg]' : rank === 2 ? 'bg-white rotate-6' : 'bg-highlight rotate-[-3deg]'}`}>
             {rank}
           </div>
        </div>
      )}

      <div className={`bg-white border-2 border-ink p-6 transition-all hover:-translate-y-1 duration-200 ${deferRendering ? 'feed-post-render-deferred ' : ''}${rank && rank <= 3 ? 'shadow-sketch-lg hover:shadow-sketch-hover ' + roughBorderClassSm : 'shadow-sketch hover:shadow-sketch border-ink rounded-lg'}`}>

        {/* Header Tags */}
        <div className="flex gap-2 mb-3 flex-wrap">
          {post.isHot && <Badge color="bg-highlight">🔥 热门</Badge>}
          {post.isFeatured && (
            <span className="sm:hidden">
              <FeaturedBadge />
            </span>
          )}
          {post.tags?.slice(0, 2).map(tag => (
             <button
              type="button"
              key={tag}
              className="inline-flex min-w-0 max-w-full text-left"
              onClick={() => onTagClick(tag)}
            >
              <Badge allowWrap className="max-w-full text-left">#{tag}</Badge>
            </button>
          ))}
        </div>

        {/* Content - Markdown Rendered */}
        <div className="font-sans text-lg text-ink leading-relaxed mb-4">
          <MarkdownRenderer content={post.content} enableImageViewer />
        </div>

        {/* Anonymous Info */}
        <div className="flex items-center gap-2 mb-4 text-sm text-pencil">
          {isDeveloperPost ? (
            <DeveloperMiniCard size="sm" timestamp={post.timestamp} />
          ) : (post.authorFrameId || post.authorNameStyleId) ? (
            <NicknameFrameCard
              frameId={post.authorFrameId}
              nameStyleId={post.authorNameStyleId}
              username="匿名用户"
              timestamp={post.timestamp}
              size="sm"
            />
          ) : (
            <>
              <UserX className="w-4 h-4" />
              <span className="font-hand font-bold">匿名用户</span>
              <span>•</span>
              <span>{post.timestamp}</span>
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between gap-3 pt-4 border-t-2 border-dashed border-gray-100">
          <div className="flex min-w-0 items-center gap-3 text-pencil font-hand font-bold sm:gap-6">
            <button
              type="button"
              onClick={() => onLike(post.id)}
              disabled={interactionPending}
              aria-busy={interactionPending}
              className={`flex shrink-0 items-center gap-1 transition-colors group/btn disabled:cursor-wait disabled:opacity-50 ${isLiked ? 'text-blue-600' : 'hover:text-ink'}`}
            >
              <ThumbsUp className={`w-5 h-5 group-hover/btn:scale-110 transition-transform ${isLiked ? 'fill-current' : ''}`} />
              <span>{post.likes > 1000 ? (post.likes / 1000).toFixed(1) + 'k' : post.likes}</span>
            </button>
            <button
              type="button"
              onClick={() => onDislike(post.id)}
              disabled={interactionPending}
              aria-busy={interactionPending}
              className={`flex shrink-0 items-center gap-1 transition-colors disabled:cursor-wait disabled:opacity-50 ${isDisliked ? 'text-red-600' : 'hover:text-ink'}`}
            >
              <ThumbsDown className={`w-5 h-5 mt-1 ${isDisliked ? 'fill-current' : ''}`} />
              <span>{post.dislikes > 1000 ? (post.dislikes / 1000).toFixed(1) + 'k' : post.dislikes}</span>
            </button>
            {post.isFeatured && (
              <span className="hidden sm:inline-flex">
                <FeaturedBadge />
              </span>
            )}
            <button
              onClick={() => onComment(post.id)}
              className="flex shrink-0 items-center gap-1 hover:text-ink transition-colors ml-auto"
            >
              <MessageSquare className="w-5 h-5" />
              <span>{post.comments}</span>
            </button>
            <button
              onClick={() => onShare(post.id)}
              className="flex shrink-0 items-center gap-1 hover:text-ink transition-colors"
            >
              <Share2 className="w-5 h-5" />
              <span className="hidden sm:inline">分享</span>
            </button>
          </div>
          <fieldset
            disabled={interactionPending}
            aria-busy={interactionPending}
            className="m-0 min-w-0 shrink-0 border-0 p-0 disabled:cursor-wait disabled:opacity-50"
          >
            <PostActionMenu
              post={post}
              isFavorited={isFavorited}
              onFavorite={() => onFavorite(post.id)}
              onReport={() => onReport(post.id, post.content)}
              onRequestFeature={() => onRequestFeature(post)}
              triggerClassName="text-pencil hover:text-ink"
            />
          </fieldset>
        </div>

      </div>
    </div>
  );
});

PostItem.displayName = 'PostItem';

const FeedView: React.FC = () => {
  const {
    state,
    loadFeedPosts,
    cancelFeedPostsLoad,
    likePost,
    dislikePost,
    toggleFavoritePost,
    showToast,
  } = useFeed();
  const [filter, setFilter] = useState<FilterType>('today');
  const [reportModal, setReportModal] = useState<{ isOpen: boolean; postId: string; content: string }>({
    isOpen: false,
    postId: '',
    content: '',
  });
  const [featureRequestPost, setFeatureRequestPost] = useState<Post | null>(null);
  const lastResumeCheckAtRef = useRef(0);
  const runPostInteraction = usePostInteractionGuard();
  const interactionPendingPostIds = usePendingPostInteractionIds();

  const refreshFeed = useCallback(() => {
    loadFeedPosts(filter).catch(() => {
      // 错误由 AppContext 统一写入 feedError，避免重复弹出 toast。
    });
  }, [filter, loadFeedPosts]);

  useEffect(() => {
    refreshFeed();
    return cancelFeedPostsLoad;
  }, [cancelFeedPostsLoad, refreshFeed]);

  useEffect(() => {
    if (
      !state.feedRefreshAt
      || state.feedLoading
      || state.feedRefreshing
      || state.feedError
      || document.visibilityState !== 'visible'
    ) {
      return undefined;
    }

    const delay = Math.max(state.feedRefreshAt - Date.now(), 0);
    const timer = window.setTimeout(() => {
      if (document.visibilityState === 'visible') {
        refreshFeed();
      }
    }, Math.min(delay, 2_147_000_000));
    return () => window.clearTimeout(timer);
  }, [refreshFeed, state.feedError, state.feedLoading, state.feedRefreshAt, state.feedRefreshing]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (
        document.visibilityState !== 'visible'
        || state.feedLoading
        || state.feedRefreshing
      ) {
        return;
      }
      const now = Date.now();
      // visibilitychange 与 focus 经常连续触发，短时间内只检查一次缓存状态。
      if (now - lastResumeCheckAtRef.current < 500) {
        return;
      }
      lastResumeCheckAtRef.current = now;
      refreshFeed();
    };

    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [refreshFeed, state.feedLoading, state.feedRefreshing]);

  const posts = useMemo(() => (
    state.feedPosts.filter((post) => (
      !postMatchesHiddenFilters(post, state.hiddenPostTags, state.hiddenPostKeywords)
    ))
  ), [state.feedPosts, state.hiddenPostKeywords, state.hiddenPostTags]);

  const displayedPosts = useMemo(() => posts.slice(0, DISPLAY_LIMIT), [posts]);

  const handleLike = useCallback(async (postId: string) => {
    try {
      await runPostInteraction(postId, () => likePost(postId));
    } catch (error) {
      const message = error instanceof Error ? error.message : '点赞失败，请稍后重试';
      showToast(message, 'error');
    }
  }, [likePost, runPostInteraction, showToast]);

  const handleDislike = useCallback(async (postId: string) => {
    try {
      await runPostInteraction(postId, () => dislikePost(postId));
    } catch (error) {
      const message = error instanceof Error ? error.message : '操作失败，请稍后重试';
      showToast(message, 'error');
    }
  }, [dislikePost, runPostInteraction, showToast]);

  const handleFavorite = useCallback(async (postId: string) => {
    try {
      const result = await runPostInteraction(postId, () => toggleFavoritePost(postId));
      if (result.executed) {
        showToast(result.value ? '已收藏' : '已取消收藏', 'success');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '收藏失败，请稍后重试';
      showToast(message, 'error');
    }
  }, [runPostInteraction, showToast, toggleFavoritePost]);

  const handleReport = useCallback((postId: string, content: string) => {
    setReportModal({ isOpen: true, postId, content });
  }, []);

  const handleShare = useCallback(async (postId: string) => {
    try {
      await copyTextToClipboard(buildPostShareUrl(postId));
      showToast('分享链接已复制', 'success');
    } catch {
      showToast('复制失败，请手动复制链接', 'error');
    }
  }, [showToast]);

  const handleComment = useCallback((postId: string) => {
    const targetPath = buildPostPath(postId);
    if (window.location.pathname + window.location.search !== targetPath) {
      window.history.pushState({}, '', targetPath);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  }, []);

  const handleTagClick = useCallback((tag: string) => {
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

  const handleRequestFeature = useCallback((post: Post) => {
    setFeatureRequestPost(post);
  }, []);

  const closeReportModal = useCallback(() => {
    setReportModal({ isOpen: false, postId: '', content: '' });
  }, []);

  const closeFeatureRequestModal = useCallback(() => {
    setFeatureRequestPost(null);
  }, []);

  return (
    <div className="max-w-2xl mx-auto px-4 pb-20 pt-6">
      <div className="text-center mb-10 relative">
        <h2 className="font-display text-4xl inline-block relative z-10">
          热门内容
          <div className="absolute -bottom-2 left-0 w-full h-3 bg-alert/50 -z-10 -rotate-1 skew-x-12"></div>
        </h2>

        {/* Filter Tabs */}
        <div className="flex justify-center gap-6 mt-6 font-hand text-xl font-bold text-pencil">
          <button
            onClick={() => { setFilter('today'); }}
            className={`transition-all ${filter === 'today' ? 'text-ink underline decoration-wavy decoration-alert underline-offset-4' : 'hover:text-ink'}`}
          >
            今日
          </button>
          <button
            onClick={() => { setFilter('week'); }}
            className={`transition-all ${filter === 'week' ? 'text-ink underline decoration-wavy decoration-alert underline-offset-4' : 'hover:text-ink'}`}
          >
            近7天
          </button>
          <button
            onClick={() => { setFilter('all'); }}
            className={`transition-all ${filter === 'all' ? 'text-ink underline decoration-wavy decoration-alert underline-offset-4' : 'hover:text-ink'}`}
          >
            历史
          </button>
        </div>

        {/* Post Count */}
        <div className="mt-4 text-sm text-pencil" aria-live="polite">
          {state.feedLoading && displayedPosts.length === 0 ? (
            '正在加载热门内容…'
          ) : (
            <>
              共 {state.feedTotal} 条内容，仅展示前 {DISPLAY_LIMIT} 条
              {state.feedRefreshing && ' · 正在刷新榜单…'}
            </>
          )}
        </div>
      </div>

      {/* Posts List */}
      <div className="flex flex-col">
        {state.feedError && displayedPosts.length > 0 && (
          <div
            className="mb-6 rounded-lg border-2 border-alert bg-alert/10 px-4 py-3 text-ink"
            role="alert"
          >
            <p className="font-hand font-bold">热门内容刷新失败：{state.feedError}</p>
            <button
              type="button"
              className="mt-2 font-hand font-bold underline decoration-wavy underline-offset-4 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={state.feedLoading || state.feedRefreshing}
              onClick={refreshFeed}
            >
              重新加载
            </button>
          </div>
        )}
        {state.feedLoading && displayedPosts.length === 0 ? (
          <div className="text-center py-16 text-pencil">
            <span className="text-5xl mb-4 block" aria-hidden="true">🍉</span>
            <p className="font-hand text-lg">正在加载热门内容，请稍候…</p>
          </div>
        ) : state.feedError && displayedPosts.length === 0 ? (
          <div className="text-center py-16" role="alert">
            <span className="text-6xl mb-4 block" aria-hidden="true">🍉</span>
            <h3 className="font-display text-2xl text-ink mb-2">热门内容加载失败</h3>
            <p className="font-hand text-lg text-pencil mb-4">{state.feedError}</p>
            <button
              type="button"
              className="rounded-lg border-2 border-ink bg-highlight px-5 py-2 font-hand font-bold shadow-sketch transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={state.feedLoading || state.feedRefreshing}
              onClick={refreshFeed}
            >
              重新加载
            </button>
          </div>
        ) : displayedPosts.length === 0 ? (
          <div className="text-center py-16">
            <span className="text-6xl mb-4 block">🍉</span>
            <h3 className="font-display text-2xl text-ink mb-2">暂无内容</h3>
            <p className="font-hand text-lg text-pencil">快去投稿第一个瓜吧！</p>
          </div>
        ) : (
          displayedPosts.map((post, index) => (
            <PostItem
              key={post.id}
              post={post}
              rank={index + 1}
              onLike={handleLike}
              onDislike={handleDislike}
              onFavorite={handleFavorite}
              onComment={handleComment}
              onShare={handleShare}
              onReport={handleReport}
              onRequestFeature={handleRequestFeature}
              onTagClick={handleTagClick}
              interactionPending={interactionPendingPostIds.has(post.id)}
              deferRendering={index >= 2}
            />
          ))
        )}
      </div>

      {/* End of List */}
      {posts.length > 0 && (
        <div className="text-center mt-8 py-4">
          <span className="font-hand text-pencil">~ 已展示前 {DISPLAY_LIMIT} 条 ~</span>
        </div>
      )}

      {/* Report Modal */}
      <ReportModal
        isOpen={reportModal.isOpen}
        onClose={closeReportModal}
        postId={reportModal.postId}
        contentPreview={reportModal.content.substring(0, 80)}
      />

      <FeatureRequestConfirmModal
        post={featureRequestPost}
        onClose={closeFeatureRequestModal}
      />

    </div>
  );
};

export default React.memo(FeedView);
