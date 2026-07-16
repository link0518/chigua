import React, { useEffect, useMemo, useState } from 'react';
import { Star } from 'lucide-react';

import { useApp } from '../store/AppContext';
import { postMatchesHiddenFilters } from '../store/hiddenPostTags';
import type { Post } from '../types';
import FeatureRequestConfirmModal from './FeatureRequestConfirmModal';
import HomePostGridCard from './HomePostGridCard';
import ReportModal from './ReportModal';
import { buildPostPath, buildPostShareUrl, copyTextToClipboard } from './clipboard';

const PAGE_SIZE = 20;

const FeaturedView: React.FC = () => {
  const {
    state,
    loadFeaturedPosts,
    likePost,
    dislikePost,
    toggleFavoritePost,
    isLiked,
    isDisliked,
    isFavorited,
    showToast,
  } = useApp();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reportModal, setReportModal] = useState<{ postId: string; content: string } | null>(null);
  const [featureRequestPost, setFeatureRequestPost] = useState<Post | null>(null);

  useEffect(() => {
    setLoading(true);
    loadFeaturedPosts({ limit: PAGE_SIZE, offset: 0 })
      .catch((error) => {
        showToast(error instanceof Error ? error.message : '精华帖子加载失败', 'error');
      })
      .finally(() => setLoading(false));
  }, [loadFeaturedPosts, showToast]);

  const posts = useMemo(
    () => state.featuredPosts.filter((post) => (
      !postMatchesHiddenFilters(post, state.hiddenPostTags, state.hiddenPostKeywords)
    )),
    [state.featuredPosts, state.hiddenPostKeywords, state.hiddenPostTags]
  );
  const hasMore = state.featuredPosts.length < state.featuredTotal;

  const handleLoadMore = async () => {
    if (loadingMore || !hasMore) {
      return;
    }
    setLoadingMore(true);
    try {
      await loadFeaturedPosts({
        limit: PAGE_SIZE,
        offset: state.featuredPosts.length,
        append: true,
      });
    } catch (error) {
      showToast(error instanceof Error ? error.message : '加载更多精华帖子失败', 'error');
    } finally {
      setLoadingMore(false);
    }
  };

  const handleLike = async (postId: string) => {
    try {
      await likePost(postId);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '点赞失败，请稍后重试', 'error');
    }
  };

  const handleDislike = async (postId: string) => {
    try {
      await dislikePost(postId);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '操作失败，请稍后重试', 'error');
    }
  };

  const handleFavorite = async (postId: string) => {
    try {
      const favorited = await toggleFavoritePost(postId);
      showToast(favorited ? '已收藏' : '已取消收藏', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '收藏失败，请稍后重试', 'error');
    }
  };

  const handleShare = async (postId: string) => {
    try {
      await copyTextToClipboard(buildPostShareUrl(postId));
      showToast('分享链接已复制', 'success');
    } catch {
      showToast('复制失败，请手动复制链接', 'error');
    }
  };

  const openTagSearch = (tag: string) => {
    const params = new URLSearchParams();
    params.set('tag', tag);
    const targetPath = `/search?${params.toString()}`;
    window.history.pushState({}, '', targetPath);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col px-4 pb-20 pt-8">
      <header className="mb-8 text-center">
        <div className="mb-3 inline-flex size-14 items-center justify-center rounded-full border-2 border-ink bg-marker-yellow shadow-sketch">
          <Star className="h-7 w-7" />
        </div>
        <h2 className="font-display text-4xl text-ink">精华</h2>
        <p className="mt-2 font-hand text-lg text-pencil">挑过的好瓜，都在这儿</p>
        {!loading && <p className="mt-2 text-xs text-pencil">当前共 {state.featuredTotal} 条精华</p>}
      </header>

      {loading ? (
        <div className="rounded-2xl border-2 border-dashed border-ink/20 bg-white p-12 text-center text-pencil">
          正在翻找精华瓜……
        </div>
      ) : posts.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-ink/20 bg-white p-12 text-center">
          <Star className="mx-auto mb-4 h-16 w-16" />
          <h3 className="font-display text-2xl text-ink">这里还空着</h3>
          <p className="mt-2 font-hand text-lg text-pencil">碰到值得留下的，去帖子菜单里推荐一下。</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:gap-5">
          {posts.map((post) => (
            <HomePostGridCard
              key={post.id}
              post={post}
              isLiked={isLiked(post.id)}
              isDisliked={isDisliked(post.id)}
              isFavorited={isFavorited(post.id)}
              onOpen={() => window.open(buildPostPath(post.id), '_blank', 'noopener,noreferrer')}
              onLike={() => handleLike(post.id)}
              onDislike={() => handleDislike(post.id)}
              onFavorite={() => handleFavorite(post.id)}
              onShare={() => handleShare(post.id)}
              onReport={() => setReportModal({ postId: post.id, content: post.content })}
              onRequestFeature={() => setFeatureRequestPost(post)}
              onTagClick={openTagSearch}
            />
          ))}
        </div>
      )}

      {hasMore && (
        <div className="mt-8 flex justify-center">
          <button
            type="button"
            disabled={loadingMore}
            onClick={handleLoadMore}
            className="rounded-full border-2 border-ink bg-white px-8 py-3 font-hand text-lg font-bold shadow-sketch transition-all hover:-translate-y-0.5 hover:bg-highlight disabled:cursor-wait disabled:opacity-60"
          >
            {loadingMore ? '加载中...' : '加载更多精华'}
          </button>
        </div>
      )}

      <ReportModal
        isOpen={Boolean(reportModal)}
        onClose={() => setReportModal(null)}
        postId={reportModal?.postId || ''}
        contentPreview={(reportModal?.content || '').substring(0, 80)}
      />
      <FeatureRequestConfirmModal
        post={featureRequestPost}
        onClose={() => setFeatureRequestPost(null)}
      />
    </div>
  );
};

export default FeaturedView;
