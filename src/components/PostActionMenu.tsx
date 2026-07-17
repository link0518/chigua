import React, { useEffect, useRef, useState } from 'react';
import { Bookmark, CheckCircle2, Clock3, Flag, MoreHorizontal, Star, XCircle } from 'lucide-react';

import type { Post } from '../types';

interface PostActionMenuProps {
  post: Pick<Post, 'isFeatured' | 'viewerFeatureRequestStatus'>;
  isFavorited: boolean;
  onFavorite: () => void;
  onReport: () => void;
  onRequestFeature: () => void;
  triggerClassName?: string;
}

const resolveFeatureAction = (post: PostActionMenuProps['post']) => {
  if (post.isFeatured) {
    return { label: '已加精', disabled: true, icon: CheckCircle2 };
  }
  if (post.viewerFeatureRequestStatus === 'pending') {
    return { label: '审核中', disabled: true, icon: Clock3 };
  }
  if (post.viewerFeatureRequestStatus === 'rejected') {
    return { label: '申请未通过', disabled: true, icon: XCircle };
  }
  if (post.viewerFeatureRequestStatus === 'approved') {
    return { label: '精华已取消', disabled: true, icon: XCircle };
  }
  return { label: '申请加精', disabled: false, icon: Star };
};

const PostActionMenu: React.FC<PostActionMenuProps> = ({
  post,
  isFavorited,
  onFavorite,
  onReport,
  onRequestFeature,
  triggerClassName = '',
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const featureAction = resolveFeatureAction(post);
  const FeatureIcon = featureAction.icon;

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`inline-flex min-h-9 items-center gap-1.5 border-l border-dashed border-ink/25 pl-3 pr-1 transition-colors ${triggerClassName}`}
        aria-label="更多帖子操作"
        aria-haspopup="menu"
        aria-expanded={open}
        title="更多操作"
      >
        <MoreHorizontal className="h-5 w-5" />
        <span className="font-hand text-base font-bold">更多</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute bottom-[calc(100%+0.5rem)] right-0 z-30 w-44 overflow-hidden rounded-xl border-2 border-ink bg-white p-1.5 font-sans text-sm shadow-sketch-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onFavorite();
            }}
            className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-pencil transition-colors hover:bg-highlight hover:text-ink"
          >
            <Bookmark className="h-4 w-4" fill={isFavorited ? 'currentColor' : 'none'} />
            {isFavorited ? '取消收藏' : '收藏帖子'}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onReport();
            }}
            className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-pencil transition-colors hover:bg-red-50 hover:text-red-600"
          >
            <Flag className="h-4 w-4" />
            举报帖子
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={featureAction.disabled}
            onClick={() => {
              setOpen(false);
              onRequestFeature();
            }}
            className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-pencil transition-colors hover:bg-highlight disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
          >
            <FeatureIcon className="h-4 w-4" />
            {featureAction.label}
          </button>
        </div>
      )}
    </div>
  );
};

export default PostActionMenu;
