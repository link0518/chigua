import React, { useEffect, useState } from 'react';
import { ArrowUpRight, MessageCircle, Share2, Star, ThumbsUp } from 'lucide-react';
import { api } from '../api';
import { Post } from '../types';
import { useApp } from '../store/AppContext';
import MarkdownRenderer from './MarkdownRenderer';

const FavoritesView: React.FC = () => {
  const { showToast, isFavorited, toggleFavoritePost } = useApp();
  const [items, setItems] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);
  const pageSize = 10;

  const load = async (offset: number, append: boolean) => {
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    try {
      const data = await api.getFavorites(pageSize, offset);
      const nextItems: Post[] = data?.items || [];
      const total = Number(data?.total || 0);
      setItems((prev) => {
        if (!append) {
          return nextItems;
        }
        const existingIds = new Set(prev.map((item) => item.id));
        const deduped = nextItems.filter((item) => !existingIds.has(item.id));
        return [...prev, ...deduped];
      });
      const nextOffset = offset + nextItems.length;
      setOffset(nextOffset);
      setHasMore(nextOffset < total);
    } catch (error) {
      const message = error instanceof Error ? error.message : '收藏加载失败';
      showToast(message, 'error');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    setOffset(0);
    load(0, false);
  }, []);

  const openPost = (postId: string) => {
    const targetPath = `/post/${encodeURIComponent(postId)}`;
    if (window.location.pathname + window.location.search !== targetPath) {
      window.history.pushState({}, '', targetPath);
    }
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  const copyShareLink = async (postId: string) => {
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
  };

  const handleFavorite = async (postId: string) => {
    try {
      const favorited = await toggleFavoritePost(postId);
      setItems((prev) => (favorited ? prev : prev.filter((item) => item.id !== postId)));
      showToast(favorited ? '已收藏' : '已取消收藏', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '收藏失败，请稍后重试';
      showToast(message, 'error');
    }
  };

  if (loading) {
    return (
      <div className="flex-grow w-full max-w-2xl mx-auto px-4 py-10 flex flex-col justify-center items-center min-h-70vh-safe">
        <div className="text-center">
          <span className="text-6xl mb-4 block">⭐</span>
          <h2 className="font-display text-3xl text-ink mb-2">正在加载收藏...</h2>
          <p className="font-hand text-xl text-pencil">马上就好</p>
        </div>
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="flex-grow w-full max-w-2xl mx-auto px-4 py-10 flex flex-col justify-center items-center min-h-70vh-safe">
        <div className="text-center">
          <span className="text-6xl mb-4 block">⭐</span>
          <h2 className="font-display text-3xl text-ink mb-2">还没有收藏</h2>
          <p className="font-hand text-xl text-pencil">去“最新”里收藏几个帖子吧</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-grow w-full max-w-2xl mx-auto px-4 pt-6 pb-20 flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-3xl text-ink tracking-widest flex items-center gap-2">
          <Star className="w-7 h-7" />
          我的收藏
        </h2>
        <span className="text-xs text-pencil font-sans">按收藏时间倒序</span>
      </div>

      {items.map((post) => (
        <article key={post.id} className="relative w-full">
          <div className="relative flex flex-col gap-4 rounded-lg border-2 border-black bg-white p-6 doodle-border !rounded-lg shadow-paper">
            <div className="flex items-start justify-between gap-3">
              <div className="text-xs text-gray-400 font-mono flex items-center gap-1">
                {post.timestamp}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleFavorite(post.id)}
                  className={`flex items-center justify-center rounded-full px-3 py-2 border-2 border-ink transition-all shadow-sketch active:shadow-sketch-active active:translate-x-[2px] active:translate-y-[2px] ${isFavorited(post.id) ? 'bg-marker-yellow hover:bg-marker-yellow/90' : 'bg-white hover:bg-highlight'}`}
                  title={isFavorited(post.id) ? '取消收藏' : '收藏'}
                  aria-label={isFavorited(post.id) ? '取消收藏' : '收藏'}
                >
                  <Star className="w-5 h-5" fill={isFavorited(post.id) ? 'currentColor' : 'none'} />
                </button>
                <button
                  type="button"
                  onClick={() => openPost(post.id)}
                  className="flex items-center justify-center rounded-full px-3 py-2 border-2 border-ink bg-white hover:bg-highlight transition-all shadow-sketch active:shadow-sketch-active active:translate-x-[2px] active:translate-y-[2px]"
                  title="打开帖子"
                  aria-label="打开帖子"
                >
                  <ArrowUpRight className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="text-black text-base leading-relaxed font-sans">
              <MarkdownRenderer content={post.content} />
            </div>

            <div className="flex items-center justify-between pt-3 border-t-2 border-black border-dashed">
              <div className="flex items-center gap-4 text-pencil">
                <span className="flex items-center gap-1.5">
                  <ThumbsUp className="w-4 h-4" />
                  <span className="font-hand font-bold text-base">{post.likes}</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <MessageCircle className="w-4 h-4" />
                  <span className="font-hand font-bold text-base">{post.comments}</span>
                </span>
              </div>
              <button
                type="button"
                onClick={() => copyShareLink(post.id)}
                className="flex items-center gap-1.5 group/btn transition-colors hover:text-blue-600"
              >
                <Share2 className="w-4 h-4" />
                <span className="font-hand font-bold text-base">分享</span>
              </button>
            </div>
          </div>
        </article>
      ))}

      {hasMore && (
        <button
          type="button"
          disabled={loadingMore}
          onClick={() => load(offset, true)}
          className="w-full mt-2 flex items-center justify-center rounded-full px-4 py-3 border-2 border-ink bg-white hover:bg-highlight transition-all shadow-sketch disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <span className="font-hand font-bold text-lg">{loadingMore ? '加载中...' : '加载更多'}</span>
        </button>
      )}
    </div>
  );
};

export default FavoritesView;
