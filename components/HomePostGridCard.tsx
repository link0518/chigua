import React from 'react';
import {
  ArrowUpRight,
  Flag,
  Share2,
  Star,
  ThumbsDown,
  ThumbsUp,
  UserX,
} from 'lucide-react';
import type { Post } from '../types';
import DeveloperMiniCard from './DeveloperMiniCard';

const MARKDOWN_IMAGE_RE = /!\[[^\]]*]\([^)]+\)/g;
const MARKDOWN_LINK_RE = /\[([^\]]+)\]\([^)]+\)/g;
const MARKDOWN_DECORATION_RE = /(^|\s)[#>*`~_-]+(?=\s|$)/g;

const buildPreviewText = (content: string) => {
  const normalized = String(content || '')
    .replace(MARKDOWN_IMAGE_RE, ' [图片] ')
    .replace(MARKDOWN_LINK_RE, '$1')
    .replace(MARKDOWN_DECORATION_RE, ' ')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return normalized || '这条帖子暂时没有可预览的正文内容。';
};

const formatCompactCount = (value: number) => {
  if (value >= 10000) {
    return `${(value / 10000).toFixed(1)}w`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}k`;
  }
  return String(value);
};

interface HomePostGridCardProps {
  post: Post;
  isLiked: boolean;
  isDisliked: boolean;
  isFavorited: boolean;
  onOpen: () => void;
  onLike: () => void;
  onDislike: () => void;
  onFavorite: () => void;
  onShare: () => void;
  onReport: () => void;
  onTagClick: (tag: string) => void;
}

const HomePostGridCard: React.FC<HomePostGridCardProps> = ({
  post,
  isLiked,
  isDisliked,
  isFavorited,
  onOpen,
  onLike,
  onDislike,
  onFavorite,
  onShare,
  onReport,
  onTagClick,
}) => {
  const previewText = buildPreviewText(post.content);
  const isDeveloperPost = post.author === 'admin';

  return (
    <article className="group relative h-full">
      <div className="pointer-events-none absolute inset-0 translate-x-1.5 translate-y-2 rounded-[28px] border-2 border-black bg-gray-200 opacity-80 transition-all duration-200 group-hover:translate-y-3" />

      <div className="relative flex h-full flex-col rounded-[28px] border-2 border-black bg-white p-4 shadow-paper transition-transform duration-200 hover:-translate-y-1 sm:p-5">
        <div className="flex h-full flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {isDeveloperPost ? (
                <DeveloperMiniCard timestamp={post.timestamp} size="sm" />
              ) : (
                <div className="inline-flex max-w-full items-center gap-2 rounded-full border-2 border-black bg-[#f4efe2] px-3 py-2 text-pencil shadow-[2px_2px_0_0_rgba(0,0,0,0.12)]">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-black bg-white">
                    <UserX className="h-4 w-4 text-pencil" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-hand text-sm font-bold text-ink">匿名用户</div>
                    <div className="truncate text-[11px] text-gray-500">{post.timestamp}</div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {post.isHot && (
                <span className="inline-flex items-center rounded-sm border border-ink bg-alert px-2 py-0.5 text-xs font-bold shadow-[1px_1px_0_0_rgba(0,0,0,1)]">
                  热门
                </span>
              )}
              <button
                type="button"
                onClick={onFavorite}
                className={`inline-flex h-10 w-10 items-center justify-center rounded-full border-2 border-ink transition-all shadow-sketch active:translate-x-[2px] active:translate-y-[2px] active:shadow-sketch-active ${isFavorited ? 'bg-marker-yellow text-ink hover:bg-marker-yellow/90' : 'bg-white text-ink hover:bg-highlight'}`}
                title={isFavorited ? '取消收藏' : '收藏'}
                aria-label={isFavorited ? '取消收藏' : '收藏'}
              >
                <Star className="h-4 w-4" fill={isFavorited ? 'currentColor' : 'none'} />
              </button>
            </div>
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {(post.tags || []).slice(0, 2).map((tag, index) => (
              <button
                type="button"
                key={tag}
                onClick={() => onTagClick(tag)}
                className={`max-w-full rounded-sm border border-ink px-2 py-0.5 text-left text-xs font-bold shadow-[1px_1px_0_0_rgba(0,0,0,1)] transition-opacity hover:opacity-80 ${index % 2 === 0 ? 'bg-marker-blue' : 'bg-marker-green'}`}
              >
                <span className="break-all">#{tag}</span>
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onOpen}
            className="flex flex-1 flex-col rounded-[20px] border-2 border-dashed border-black/20 bg-[#fcfbf7] p-4 text-left transition-all hover:border-black/35 hover:bg-white"
          >
            <div className="mb-3 flex items-center justify-between gap-2 text-[11px] font-bold tracking-[0.18em] text-pencil/70">
              <span>点击查看详情</span>
              <ArrowUpRight className="h-4 w-4 text-pencil/70 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </div>
            <p className="line-clamp-6 whitespace-pre-line break-all text-sm leading-7 text-ink sm:text-[15px]">
              {previewText}
            </p>
          </button>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-dashed border-black/20 pt-3">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 text-xs font-semibold text-pencil">
              <button
                type="button"
                onClick={onLike}
                className={`inline-flex items-center gap-1.5 transition-colors ${isLiked ? 'text-blue-600' : 'hover:text-ink'}`}
              >
                <ThumbsUp className="h-4 w-4" fill={isLiked ? 'currentColor' : 'none'} />
                <span>{formatCompactCount(post.likes)}</span>
              </button>
              <button
                type="button"
                onClick={onDislike}
                className={`inline-flex items-center gap-1.5 transition-colors ${isDisliked ? 'text-red-600' : 'hover:text-ink'}`}
              >
                <ThumbsDown className="h-4 w-4" fill={isDisliked ? 'currentColor' : 'none'} />
                <span>{formatCompactCount(post.dislikes)}</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onShare}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-ink/20 bg-white text-pencil transition-colors hover:text-ink"
                aria-label="分享帖子"
                title="分享帖子"
              >
                <Share2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={onReport}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-ink/20 bg-white text-gray-400 transition-colors hover:text-red-600"
                aria-label="举报帖子"
                title="举报帖子"
              >
                <Flag className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
};

export default HomePostGridCard;
