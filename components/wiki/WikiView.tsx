import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '../../api';
import { useApp } from '../../store/AppContext';
import type { WikiEntry, WikiRevision } from '../../types';
import Turnstile, { TurnstileHandle } from '../Turnstile';

type WikiListResponse = {
  items?: WikiEntry[];
  total?: number;
  page?: number;
  limit?: number;
  tags?: Array<{ name: string; count: number }>;
};

type WikiDetailResponse = {
  entry?: WikiEntry;
  history?: WikiRevision[];
};

type WikiFormMode = 'create' | 'edit';
type WikiFeedback = { message: string; type: 'success' | 'error' | 'info' };

const PAGE_SIZE = 12;
const WIKI_MOBILE_FEED_QUERY = '(max-width: 767px)';
const WIKI_DETAIL_ENTER_MS = 225;
const WIKI_DETAIL_EXIT_MS = 195;
const WIKI_OVERLAY_MODAL_SELECTOR = '[data-wiki-overlay-modal="true"]';

const useWikiMobileFeed = () => {
  const [enabled, setEnabled] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia(WIKI_MOBILE_FEED_QUERY).matches
  ));

  useEffect(() => {
    const media = window.matchMedia(WIKI_MOBILE_FEED_QUERY);
    const handleChange = () => setEnabled(media.matches);
    handleChange();

    if (media.addEventListener) {
      media.addEventListener('change', handleChange);
      return () => media.removeEventListener('change', handleChange);
    }

    media.addListener(handleChange);
    return () => media.removeListener(handleChange);
  }, []);

  return enabled;
};

const useEscapeToClose = (enabled: boolean, onClose: () => void) => {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }

      event.preventDefault();
      onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, onClose]);
};

const normalizeTag = (value: string) => value
  .trim()
  .replace(/^#+/, '')
  .replace(/\s+/g, ' ');

const parseTagInput = (value: string) => {
  const seen = new Set<string>();
  const result: string[] = [];
  String(value || '')
    .split(/[\r\n,，、;；|]+/g)
    .map(normalizeTag)
    .filter(Boolean)
    .forEach((tag) => {
      const key = tag.toLowerCase();
      if (seen.has(key) || tag.length > 16 || result.length >= 6) {
        return;
      }
      seen.add(key);
      result.push(tag);
    });
  return result;
};

const formatDateTime = (value?: number | null) => {
  if (!value) {
    return '';
  }
  return new Date(value).toLocaleString('zh-CN');
};

const getRevisionVersion = (revision: WikiRevision) => (
  revision.versionNumber || revision.baseVersionNumber + 1
);

const getRevisionSummary = (revision: WikiRevision) => (
  revision.editSummary || (revision.actionType === 'create' ? '创建公开瓜条' : '提交瓜条编辑')
);

const getWikiEntryUrl = (entry: WikiEntry) => (
  `${window.location.origin}/wiki/${encodeURIComponent(entry.slug)}`
);

const copyTextToClipboard = async (text: string) => {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);
  if (!copied) {
    throw new Error('复制失败');
  }
};

const sanitizeImageFileName = (value: string) => {
  const cleaned = value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 40);
  return cleaned || '瓜条';
};

const drawRoundedRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) => {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
};

const wrapCanvasText = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number) => {
  const lines: string[] = [];
  String(text || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .forEach((paragraph) => {
      const source = paragraph.trim();
      if (!source) {
        lines.push('');
        return;
      }

      let current = '';
      Array.from(source).forEach((char) => {
        const next = current + char;
        if (current && ctx.measureText(next).width > maxWidth) {
          lines.push(current);
          current = char.trim() ? char : '';
        } else {
          current = next;
        }
      });
      if (current) {
        lines.push(current);
      }
    });
  return lines.length ? lines : [''];
};

const drawWrappedText = (
  ctx: CanvasRenderingContext2D,
  lines: string[],
  x: number,
  y: number,
  lineHeight: number,
) => {
  let cursorY = y;
  lines.forEach((line) => {
    if (line) {
      ctx.fillText(line, x, cursorY);
    }
    cursorY += lineHeight;
  });
  return cursorY;
};

const canvasToBlob = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => {
  canvas.toBlob((blob) => {
    if (blob) {
      resolve(blob);
    } else {
      reject(new Error('图片生成失败'));
    }
  }, 'image/png');
});

const saveWikiEntryCardImage = async (entry: WikiEntry, shareUrl: string) => {
  if ('fonts' in document) {
    await document.fonts.ready;
  }

  const width = 1080;
  const padding = 88;
  const contentWidth = width - padding * 2;
  const titleFont = '700 64px "Noto Sans SC", "Microsoft YaHei", sans-serif';
  const tagFont = '500 28px "Noto Sans SC", "Microsoft YaHei", sans-serif';
  const bodyFont = '300 36px "Noto Sans SC", "Microsoft YaHei", sans-serif';
  const labelFont = '700 24px "Noto Sans SC", "Microsoft YaHei", sans-serif';
  const footerFont = '400 24px "Noto Sans SC", "Microsoft YaHei", sans-serif';

  const measureCanvas = document.createElement('canvas');
  const measureCtx = measureCanvas.getContext('2d');
  if (!measureCtx) {
    throw new Error('图片生成失败');
  }

  measureCtx.font = titleFont;
  const titleLines = wrapCanvasText(measureCtx, entry.name, contentWidth);
  measureCtx.font = tagFont;
  const tagText = entry.tags.length ? entry.tags.map((tag) => `#${tag}`).join('  ') : '暂无标签';
  const tagLines = wrapCanvasText(measureCtx, tagText, contentWidth);
  measureCtx.font = bodyFont;
  const narrativeLines = wrapCanvasText(measureCtx, entry.narrative, contentWidth);
  measureCtx.font = footerFont;
  const urlLines = wrapCanvasText(measureCtx, shareUrl, contentWidth);

  const titleLineHeight = 82;
  const tagLineHeight = 40;
  const bodyLineHeight = 58;
  const footerLineHeight = 34;
  const height = Math.max(
    820,
    padding * 2
    + 44
    + 28
    + titleLines.length * titleLineHeight
    + 30
    + tagLines.length * tagLineHeight
    + 64
    + narrativeLines.length * bodyLineHeight
    + 78
    + footerLineHeight
    + urlLines.length * footerLineHeight,
  );

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('图片生成失败');
  }

  ctx.fillStyle = '#fcfdfc';
  ctx.fillRect(0, 0, width, height);
  drawRoundedRect(ctx, 36, 36, width - 72, height - 72, 34);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = 'rgba(47, 51, 52, 0.08)';
  ctx.lineWidth = 2;
  ctx.stroke();

  let cursorY = padding;
  ctx.fillStyle = '#546354';
  ctx.font = labelFont;
  ctx.fillText('瓜条档案', padding, cursorY);
  ctx.fillStyle = 'rgba(47, 51, 52, 0.25)';
  ctx.fillRect(padding, cursorY + 22, 120, 2);
  cursorY += 86;

  ctx.fillStyle = '#2f3334';
  ctx.font = titleFont;
  cursorY = drawWrappedText(ctx, titleLines, padding, cursorY, titleLineHeight);
  cursorY += 18;

  ctx.fillStyle = 'rgba(47, 51, 52, 0.62)';
  ctx.font = tagFont;
  cursorY = drawWrappedText(ctx, tagLines, padding, cursorY, tagLineHeight);
  cursorY += 58;

  ctx.fillStyle = 'rgba(47, 51, 52, 0.80)';
  ctx.font = bodyFont;
  cursorY = drawWrappedText(ctx, narrativeLines, padding, cursorY, bodyLineHeight);
  cursorY += 64;

  ctx.strokeStyle = 'rgba(47, 51, 52, 0.08)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(padding, cursorY - 24);
  ctx.lineTo(width - padding, cursorY - 24);
  ctx.stroke();

  ctx.fillStyle = 'rgba(47, 51, 52, 0.48)';
  ctx.font = footerFont;
  ctx.fillText(`第 ${entry.versionNumber} 版 · 生成于 ${formatDateTime(Date.now())}`, padding, cursorY);
  cursorY += footerLineHeight;
  cursorY = drawWrappedText(ctx, urlLines, padding, cursorY, footerLineHeight);

  const blob = await canvasToBlob(canvas);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${sanitizeImageFileName(entry.name)}-第${entry.versionNumber}版.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const decodeSlugSegment = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const getSlugFromPath = (pathname: string) => {
  const normalized = String(pathname || '').replace(/\/+$/, '');
  const match = normalized.match(/^\/wiki\/([^/]+)$/);
  return match ? decodeSlugSegment(match[1]) : '';
};

const WikiIcon: React.FC<{ name: string; className?: string }> = ({ name, className = '' }) => (
  <span className={`material-symbols-outlined ${className}`} aria-hidden="true">{name}</span>
);

const useWikiFeedback = () => {
  const [feedback, setFeedback] = useState<WikiFeedback | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);

  const showFeedback = useCallback((message: string, type: WikiFeedback['type'] = 'success') => {
    if (feedbackTimerRef.current) {
      window.clearTimeout(feedbackTimerRef.current);
    }
    setFeedback({ message, type });
    feedbackTimerRef.current = window.setTimeout(() => {
      setFeedback(null);
      feedbackTimerRef.current = null;
    }, 2400);
  }, []);

  useEffect(() => () => {
    if (feedbackTimerRef.current) {
      window.clearTimeout(feedbackTimerRef.current);
    }
  }, []);

  return { feedback, showFeedback };
};

const WikiFloatingFeedback: React.FC<{ feedback: WikiFeedback | null }> = ({ feedback }) => {
  if (!feedback) {
    return null;
  }

  const feedbackClass = feedback.type === 'error'
    ? 'border-[#a73b21]/20 bg-[#fff7f6] text-[#6e1400]'
    : 'border-[#546354]/20 bg-[#f3f7f1] text-[#344335]';
  const iconName = feedback.type === 'error' ? 'error' : 'check_circle';

  return (
    <div className={`pointer-events-none fixed left-1/2 top-1/2 z-[120] flex w-[min(88vw,360px)] -translate-x-1/2 -translate-y-1/2 items-center justify-center gap-2 rounded-xl border px-5 py-4 text-center font-body text-sm shadow-[0px_18px_60px_rgba(47,51,52,0.18)] backdrop-blur-md ${feedbackClass}`}>
      <WikiIcon name={iconName} className="text-[18px]" />
      <span>{feedback.message}</span>
    </div>
  );
};

const WikiShell: React.FC<{
  children: React.ReactNode;
  tags: Array<{ name: string; count: number }>;
  activeTag: string;
  onTagChange: (tag: string) => void;
  onOpenSubmit: () => void;
  onNavigateHome: () => void;
  onQueryChange: (query: string) => void;
  query: string;
}> = ({ children, tags, activeTag, onTagChange, onOpenSubmit, onNavigateHome, query, onQueryChange }) => (
  <div className="wiki-page wiki-page-shell flex w-full min-w-0 overflow-hidden bg-[#fcfdfc] text-[#2f3334]">
    {/* 左侧目录 */}
    <aside className="hidden w-72 shrink-0 flex-col border-r border-black/5 bg-[#fcfdfc] lg:flex">
      <div className="flex items-center gap-4 border-b border-black/5 px-8 pt-10 pb-8">
        <button type="button" onClick={onNavigateHome} className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#2f3334] text-white transition-all shadow-sm hover:bg-[#546354] hover:shadow-md hover:-translate-y-0.5">
          <WikiIcon name="auto_stories" />
        </button>
        <div>
          <h1 className="font-headline text-xl font-bold tracking-tight">JX3瓜条</h1>
          <p className="font-label text-[10px] tracking-widest text-[#2f3334]/40">角色档案库</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="mb-8">
          <div className="relative group">
            <WikiIcon name="search" className="absolute left-4 top-1/2 -translate-y-1/2 text-[18px] text-[#2f3334]/30 transition-colors group-hover:text-[#546354]/60" />
            <input
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="快速检索..."
              className="w-full rounded-xl border border-black/[0.03] bg-black/[0.02] py-3 pl-11 pr-4 font-body text-sm outline-none transition-all placeholder:text-[#2f3334]/30 focus:border-[#546354]/20 focus:bg-white focus:ring-4 focus:ring-[#546354]/[0.03]"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="mb-4 px-2 font-label text-[10px] font-bold tracking-widest text-[#2f3334]/40">档案标签分类</div>
          <button
            type="button"
            onClick={() => onTagChange('')}
            className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left font-body text-sm transition-all ${!activeTag ? 'bg-[#546354] text-white shadow-md' : 'text-[#2f3334]/70 hover:bg-black/[0.03]'}`}
          >
            <span className={!activeTag ? 'font-medium tracking-wide' : ''}>全部瓜条</span>
          </button>
          {tags.map((tag) => (
            <button
              key={tag.name}
              type="button"
              onClick={() => onTagChange(tag.name)}
              className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left font-body text-sm transition-all ${activeTag === tag.name ? 'bg-[#546354] text-white shadow-md' : 'text-[#2f3334]/70 hover:bg-black/[0.03]'}`}
            >
              <span className={activeTag === tag.name ? 'font-medium tracking-wide' : ''}>{tag.name}</span>
              <span className={`font-label text-[10px] ${activeTag === tag.name ? 'text-white/60 font-bold' : 'text-[#2f3334]/30'}`}>{tag.count}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-black/5 bg-[#f9faf9] p-6 backdrop-blur-md">
        <button
          type="button"
          onClick={onOpenSubmit}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#2f3334] py-3.5 font-label text-xs font-bold tracking-widest text-white shadow-sm transition-all hover:bg-[#546354] hover:shadow-md hover:-translate-y-0.5"
        >
          <WikiIcon name="edit_document" className="text-[16px]" />
          新建瓜条
        </button>
      </div>
    </aside>

    {/* 主内容与详情层 */}
    <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-white/50 pattern-grid-lg">
      {/* 移动端顶部导航 */}
      <nav className="flex shrink-0 items-center justify-between border-b border-black/5 bg-white/80 px-5 py-3 backdrop-blur-xl lg:hidden">
        <button type="button" onClick={onNavigateHome} className="font-headline text-lg font-bold">JX3瓜条</button>
        <button type="button" onClick={onOpenSubmit} className="text-[#2f3334]/60"><WikiIcon name="edit_note" /></button>
      </nav>
      <div className="shrink-0 border-b border-black/5 bg-white/75 px-4 py-3 backdrop-blur-xl lg:hidden">
        <div className="relative group">
          <WikiIcon name="search" className="absolute left-4 top-1/2 -translate-y-1/2 text-[18px] text-[#2f3334]/35 transition-colors group-focus-within:text-[#546354]" />
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="搜索瓜条名字或记录..."
            className="h-11 w-full rounded-xl border border-black/[0.04] bg-white/80 py-2.5 pl-11 pr-11 font-body text-sm text-[#2f3334] outline-none shadow-sm transition-all placeholder:text-[#2f3334]/35 focus:border-[#546354]/25 focus:bg-white focus:ring-4 focus:ring-[#546354]/[0.04]"
          />
          {query && (
            <button
              type="button"
              onClick={() => onQueryChange('')}
              className="absolute right-3 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-[#2f3334]/40 transition-colors hover:bg-black/[0.04] hover:text-[#2f3334]"
              aria-label="清空搜索"
            >
              <WikiIcon name="close" className="text-[16px]" />
            </button>
          )}
        </div>
      </div>
      {children}
    </div>
  </div>
);

const WikiGallery: React.FC<{
  items: WikiEntry[];
  total: number;
  page: number;
  loading: boolean;
  loadingMore: boolean;
  mobileFeed: boolean;
  hasMore: boolean;
  onPageChange: (value: number) => void;
  onLoadMore: () => void;
  onOpenEntry: (slug: string) => void;
}> = ({ items, total, page, loading, loadingMore, mobileFeed, hasMore, onPageChange, onLoadMore, onOpenEntry }) => {
  const listRef = useRef<HTMLElement | null>(null);
  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const itemOffset = mobileFeed ? 0 : (page - 1) * PAGE_SIZE;

  const handleScroll = useCallback((event: React.UIEvent<HTMLElement>) => {
    if (!mobileFeed || loading || loadingMore || !hasMore) {
      return;
    }

    const target = event.currentTarget;
    const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    if (distanceToBottom < 360) {
      onLoadMore();
    }
  }, [hasMore, loading, loadingMore, mobileFeed, onLoadMore]);

  useEffect(() => {
    if (!mobileFeed || loading || loadingMore || !hasMore) {
      return;
    }

    const listNode = listRef.current;
    if (listNode && listNode.scrollHeight <= listNode.clientHeight + 120) {
      onLoadMore();
    }
  }, [hasMore, items.length, loading, loadingMore, mobileFeed, onLoadMore]);

  const getEntryDisplayNumber = (entry: WikiEntry, index: number) => {
    if (typeof entry.displayOrder === 'number' && entry.displayOrder > 0) {
      return entry.displayOrder;
    }
    return Math.max(total - itemOffset - index, 1);
  };

  return (
    <main ref={listRef} onScroll={handleScroll} className="flex-1 overflow-y-auto w-full">
      <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col px-4 py-6 pb-24 sm:px-6 md:px-12 md:py-16 md:pb-16">
        <div className="flex-1">
          <header className="mb-8 md:mb-12">
            <h2 className="font-headline text-3xl font-extrabold text-[#2f3334] md:text-5xl tracking-tight">阅览矩阵</h2>
            <p className="mt-3 font-label text-xs font-bold tracking-[0.2em] text-[#2f3334]/40">瓜条目录</p>
          </header>

          {loading ? (
            <div className="flex items-center justify-center py-32 font-label text-xs tracking-widest text-[#2f3334]/40">
              档案数据读取中...
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-2xl border border-black/5 bg-white/50 p-10 text-center font-body text-[#2f3334]/50 shadow-sm backdrop-blur-sm md:p-24">
              暂无匹配瓜条。
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((entry, index) => (
                <article
                  key={entry.id}
                  onClick={() => onOpenEntry(entry.slug)}
                  className="group relative flex h-[320px] cursor-pointer flex-col overflow-hidden rounded-2xl border border-black/5 bg-white p-6 shadow-sm transition-all duration-500 ease-out hover:-translate-y-1.5 hover:border-[#546354]/40 hover:shadow-xl hover:shadow-[#546354]/5 md:h-[340px] md:p-7"
                >
                  <div className="mb-5 flex items-center justify-between">
                    <span className="font-label text-[10px] font-bold tracking-widest text-[#2f3334]/30 group-hover:text-[#546354]/70 transition-colors">
                      编号 {String(getEntryDisplayNumber(entry, index)).padStart(3, '0')}
                    </span>
                    <div className="h-2 w-2 rounded-full bg-[#f3f4f4] group-hover:bg-[#546354]/50 transition-colors" />
                  </div>

                  <h3 className="mb-4 line-clamp-2 min-h-[4.25rem] font-headline text-2xl font-bold leading-snug text-[#2f3334] transition-colors group-hover:text-[#546354]">
                    {entry.name}
                  </h3>

                  <p className="mb-6 flex-1 line-clamp-5 font-body text-sm leading-relaxed text-[#2f3334]/70 opacity-90">
                    {entry.narrative || '暂无叙述详情...'}
                  </p>

                  <div className="mt-auto flex flex-wrap gap-1.5">
                    {entry.tags.slice(0, 4).map((tag) => (
                      <span key={tag} className="rounded bg-[#f9faf9] px-2.5 py-1 font-label text-[10px] tracking-wide text-[#2f3334]/60 border border-black/[0.03]">
                        #{tag}
                      </span>
                    ))}
                    {entry.tags.length > 4 && (
                      <span className="rounded bg-[#f9faf9] px-2.5 py-1 font-label text-[10px] tracking-wide text-[#2f3334]/60 border border-black/[0.03]">
                        +{entry.tags.length - 4}
                      </span>
                    )}
                  </div>

                  <div className="absolute left-0 bottom-0 h-[3px] w-full origin-left scale-x-0 bg-[#546354] opacity-0 transition-all duration-500 ease-out group-hover:scale-x-100 group-hover:opacity-100" />
                </article>
              ))}
            </div>
          )}
        </div>

        {mobileFeed && items.length > 0 && (
          <div className="mt-8 flex justify-center pb-2 font-label text-xs tracking-widest text-[#2f3334]/40 md:hidden">
            {loadingMore ? '继续加载中...' : hasMore ? '继续向下滑动加载' : '已经到底了'}
          </div>
        )}

        <footer className="mt-16 hidden items-center justify-between gap-6 border-t border-black/5 pt-10 font-label text-xs tracking-widest text-[#2f3334]/40 md:flex">
          <span>第 {String(page).padStart(2, '0')} 页 / 共 {String(totalPages).padStart(2, '0')} 页</span>
          <div className="flex items-center gap-8">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
              className="hover:text-[#2f3334] disabled:opacity-30 transition-colors"
            >
              上一页
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
              className="hover:text-[#2f3334] disabled:opacity-30 transition-colors"
            >
              下一页
            </button>
          </div>
        </footer>
      </div>
    </main>
  );
};

const WikiRevisionHistory: React.FC<{
  history: WikiRevision[];
  onOpenRevision: (revision: WikiRevision) => void;
}> = ({ history, onOpenRevision }) => (
  <section className="space-y-8 border-t border-black/5 pt-12">
    <div className="flex items-center gap-4 border-b border-black/5 pb-4">
      <span className="font-label text-xs font-bold tracking-widest text-[#2f3334]/50">编辑历史</span>
    </div>
    {history.length === 0 ? (
      <div className="font-body text-sm text-[#2f3334]/40">
        暂无公开编辑记录。
      </div>
    ) : (
      <div className="space-y-6">
        {history.map((revision) => (
          <button
            key={revision.id}
            type="button"
            onClick={() => onOpenRevision(revision)}
            className="group relative block w-full border-l-2 border-[#f3f4f4] pl-6 text-left transition-colors hover:border-[#546354]/30 focus:outline-none focus-visible:border-[#546354] focus-visible:ring-2 focus-visible:ring-[#546354]/20"
          >
            <div className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full bg-[#f3f4f4] group-hover:bg-[#546354]/50 transition-colors" />
            <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="font-label text-xs font-bold text-[#2f3334]">
                  第 {getRevisionVersion(revision)} 版
                </span>
                <span className="font-body text-xs text-[#2f3334]/40">
                  {formatDateTime(revision.reviewedAt || revision.createdAt)}
                </span>
              </div>
              <span className="rounded-full bg-[#f3f4f4] px-2 py-1 font-label text-[10px] text-[#2f3334]/60">
                {revision.actionType === 'create' ? '创建' : '编辑'}
              </span>
            </div>
            <p className="font-body text-sm leading-relaxed text-[#2f3334]/70">
              {getRevisionSummary(revision)}
            </p>
            <span className="mt-2 inline-flex items-center gap-1 font-label text-[10px] font-bold tracking-widest text-[#546354]/70 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              查看历史瓜条 <WikiIcon name="open_in_new" className="text-[13px]" />
            </span>
          </button>
        ))}
      </div>
    )}
  </section>
);

const WikiRevisionDetailModal: React.FC<{
  revision: WikiRevision | null;
  onClose: () => void;
}> = ({ revision, onClose }) => {
  useEscapeToClose(Boolean(revision), onClose);

  if (!revision) {
    return null;
  }

  const tags = Array.isArray(revision.data.tags) ? revision.data.tags : [];
  const narrative = revision.data.narrative || '';

  return (
    <div data-wiki-overlay-modal="true" className="fixed inset-0 z-[90] flex items-center justify-center p-4 md:p-6">
      <button type="button" aria-label="关闭历史瓜条" className="fixed inset-0 bg-[#2f3334]/10 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex max-h-[calc(100vh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-black/5 bg-white shadow-[0px_24px_80px_rgba(47,51,52,0.18)] md:max-h-[86vh]">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-black/5 bg-[#fcfdfc] px-5 py-5 md:gap-6 md:px-8 md:py-6">
          <div className="space-y-2">
            <span className="font-label text-[10px] font-bold tracking-widest text-[#546354]">历史瓜条</span>
            <h2 className="font-headline text-xl font-bold tracking-tight text-[#2f3334] md:text-2xl">
              第 {getRevisionVersion(revision)} 版 · {revision.actionType === 'create' ? '创建' : '编辑'}
            </h2>
            <p className="font-body text-xs text-[#2f3334]/45">
              {formatDateTime(revision.reviewedAt || revision.createdAt)}
            </p>
          </div>
          <button type="button" onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-black/[0.03] text-[#2f3334]/60 transition-all hover:bg-[#2f3334] hover:text-white">
            <WikiIcon name="close" className="text-[18px]" />
          </button>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto px-5 py-6 md:px-8 md:py-8">
          <div className="mb-8 rounded-xl border border-black/5 bg-[#f9faf9] p-5">
            <div className="mb-2 font-label text-[10px] font-bold tracking-widest text-[#2f3334]/40">修改原因</div>
            <p className="font-body text-sm leading-relaxed text-[#2f3334]/70">
              {getRevisionSummary(revision)}
            </p>
          </div>

          <div className="space-y-6 border-b border-black/5 pb-8">
            <h3 className="font-headline text-3xl font-extrabold leading-tight tracking-tight text-[#2f3334] md:text-4xl">
              {revision.data.name}
            </h3>
            <div className="flex flex-wrap gap-2">
              {tags.length === 0 ? (
                <span className="rounded-md bg-[#f9faf9] px-2.5 py-1 font-label text-[10px] text-[#2f3334]/45 border border-black/5">暂无标签</span>
              ) : tags.map((tag) => (
                <span key={tag} className="rounded-md bg-[#f9faf9] px-2.5 py-1 font-label text-[10px] text-[#2f3334]/70 border border-black/5">#{tag}</span>
              ))}
            </div>
          </div>

          <div className="pt-8 font-body text-base leading-loose text-[#2f3334]/80">
            {narrative.split('\n').map((paragraph, index) => (
              <p key={index} className="mb-5">{paragraph || '　'}</p>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
};

const WikiEntryDetail: React.FC<{
  entry: WikiEntry | null;
  history: WikiRevision[];
  loading: boolean;
  error: string;
  onBack: () => void;
  onEdit: (entry: WikiEntry) => void;
}> = ({ entry, history, loading, error, onBack, onEdit }) => {
  const [selectedRevision, setSelectedRevision] = useState<WikiRevision | null>(null);
  const { feedback, showFeedback } = useWikiFeedback();

  const handleShare = useCallback(async () => {
    if (!entry) {
      return;
    }

    const shareUrl = getWikiEntryUrl(entry);
    try {
      if (navigator.share) {
        try {
          await navigator.share({
            title: `${entry.name} - 瓜条档案`,
            text: `查看瓜条：${entry.name}`,
            url: shareUrl,
          });
          showFeedback('分享面板已打开');
          return;
        } catch (shareError) {
          if (shareError instanceof DOMException && shareError.name === 'AbortError') {
            return;
          }
        }
      }
      await copyTextToClipboard(shareUrl);
      showFeedback('链接已复制');
    } catch {
      showFeedback('分享失败，请手动复制链接', 'error');
    }
  }, [entry, showFeedback]);

  const handleSaveImage = useCallback(async () => {
    if (!entry) {
      return;
    }

    try {
      await saveWikiEntryCardImage(entry, getWikiEntryUrl(entry));
      showFeedback('瓜条图片已保存');
    } catch {
      showFeedback('保存失败，请稍后重试', 'error');
    }
  }, [entry, showFeedback]);

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-white/50 backdrop-blur-3xl pt-24 font-label text-xs tracking-widest text-[#2f3334]/40">
        正在读取档案...
      </div>
    );
  }

  if (error || !entry) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-6 p-8 bg-white/95 backdrop-blur-3xl">
        <WikiIcon name="drafts" className="text-4xl text-[#2f3334]/20" />
        <h1 className="font-headline text-2xl font-bold text-[#2f3334]">未找到瓜条</h1>
        <p className="font-body text-sm text-[#2f3334]/60">{error || '该瓜条不存在或尚未公开。'}</p>
        <button type="button" onClick={onBack} className="mt-4 rounded-xl bg-[#2f3334] px-6 py-2.5 font-label text-xs font-bold tracking-wide text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-[#546354]">
          返回矩阵
        </button>
      </div>
    );
  }

  const decorativeChar = entry.name.trim().slice(-1) || '档';

  return (
    <div className="relative z-10 flex h-full w-full flex-col overflow-y-auto bg-[#fcfdfc] sm:bg-white/95 sm:backdrop-blur-3xl lg:flex-row lg:overflow-hidden">
      <WikiFloatingFeedback feedback={feedback} />

      {/* 移动端顶部栏 */}
      <div className="sticky top-0 z-20 flex w-full items-center justify-between border-b border-black/5 bg-white/90 px-6 py-4 backdrop-blur-md lg:hidden">
        <button onClick={onBack} className="text-[#2f3334]/60 p-2"><WikiIcon name="close" /></button>
        <span className="font-label text-[10px] font-bold tracking-widest text-[#2f3334]">第 {entry.versionNumber} 版</span>
      </div>

      {/* 正文区域 */}
      <article className="relative z-0 flex-none px-5 py-8 pb-36 md:px-16 md:pb-40 lg:flex-1 lg:overflow-y-auto lg:py-20 lg:pb-32">
        <div className="pointer-events-none absolute -top-8 right-0 select-none opacity-[0.02]">
          <span className="font-serif text-[16rem] leading-none md:text-[22rem]">{decorativeChar}</span>
        </div>

        <div className="relative z-10 mx-auto max-w-2xl space-y-10 md:space-y-12">
          <div className="space-y-5 border-b border-black/5 pb-8 md:space-y-6 md:pb-10">
            <span className="inline-block rounded border border-[#546354]/20 bg-[#546354]/5 px-2.5 py-1 font-label text-[9px] font-bold tracking-widest text-[#546354]">公开档案</span>
            <h1 className="font-headline text-4xl font-extrabold leading-tight tracking-tight text-[#2f3334] md:text-5xl lg:text-6xl">{entry.name}</h1>
            <div className="flex flex-wrap gap-2 pt-2">
              {entry.tags.map(tag => (
                <span key={tag} className="rounded-md bg-[#f9faf9] px-2.5 py-1 font-label text-[10px] text-[#2f3334]/70 border border-black/5 shadow-sm">#{tag}</span>
              ))}
            </div>
          </div>

          <div className="prose prose-neutral max-w-none text-base text-[#2f3334]/80 prose-p:mb-6 prose-p:font-body prose-p:font-light prose-p:leading-loose md:prose-lg md:prose-p:mb-8">
            {entry.narrative.split('\n').map((paragraph, i) => (
              <p key={i}>{paragraph}</p>
            ))}
          </div>
        </div>

        <div className="pointer-events-none hidden fixed bottom-5 left-5 z-[70] flex justify-start md:bottom-8 md:left-8 lg:left-[308px] xl:left-[416px]">
          <button
            type="button"
            aria-label="¼ìË÷¹ÏÌõ"
            title="¼ìË÷¹ÏÌõ"
            onClick={() => {}}
            className="pointer-events-auto group flex h-12 min-w-12 items-center justify-center gap-2 rounded-xl border border-black/5 bg-white/95 px-3 font-label text-xs font-bold tracking-widest text-[#2f3334]/75 shadow-[0px_10px_30px_rgba(47,51,52,0.10)] backdrop-blur-md transition-all hover:-translate-y-0.5 hover:border-[#546354]/50 hover:bg-[#f9faf9] hover:text-[#546354] hover:shadow-xl md:h-14 md:min-w-14 md:px-4"
          >
            <WikiIcon name="search" className="text-[22px]" />
            <span className="hidden sm:inline">¼ìË÷</span>
          </button>
        </div>

        <div className="pointer-events-none fixed bottom-5 right-5 z-[70] flex justify-end gap-3 md:bottom-8 md:right-8 md:gap-4 lg:right-[344px] xl:right-[432px]">
          <button
            type="button"
            aria-label="分享瓜条"
            title="分享瓜条"
            onClick={handleShare}
            className="pointer-events-auto group flex h-12 min-w-12 items-center justify-center gap-2 rounded-xl border border-black/5 bg-white/95 px-3 font-label text-xs font-bold tracking-widest text-[#2f3334]/75 shadow-[0px_10px_30px_rgba(47,51,52,0.10)] backdrop-blur-md transition-all hover:-translate-y-0.5 hover:border-[#546354]/50 hover:bg-[#f9faf9] hover:text-[#546354] hover:shadow-xl md:h-14 md:min-w-14 md:px-4"
          >
            <WikiIcon name="ios_share" className="text-[22px]" />
            <span className="hidden sm:inline">分享</span>
          </button>
          <button
            type="button"
            aria-label="保存瓜条图片"
            title="保存瓜条图片"
            onClick={handleSaveImage}
            className="pointer-events-auto group flex h-12 min-w-12 items-center justify-center gap-2 rounded-xl border border-black/5 bg-[#2f3334] px-3 font-label text-xs font-bold tracking-widest text-white shadow-[0px_10px_30px_rgba(47,51,52,0.16)] backdrop-blur-md transition-all hover:-translate-y-0.5 hover:bg-[#546354] hover:shadow-xl md:h-14 md:min-w-14 md:px-4"
          >
            <WikiIcon name="download" className="text-[22px]" />
            <span className="hidden sm:inline">保存</span>
          </button>
        </div>
      </article>

      {/* 右侧版本信息 */}
      <aside className="z-10 w-full shrink-0 border-t border-black/5 bg-[#fcfdfc] p-5 pb-28 shadow-[-20px_0_40px_rgba(0,0,0,0.02)] md:p-8 md:pb-32 lg:w-[320px] lg:overflow-y-auto lg:border-l lg:border-t-0 lg:pb-12 xl:w-[400px] xl:p-12 xl:pb-16">
        <div className="mb-16 hidden justify-end gap-3 lg:flex">
          <button onClick={() => onEdit(entry)} className="group flex h-11 w-11 items-center justify-center rounded-xl border border-black/5 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:border-[#546354]/50 hover:bg-[#f9faf9] hover:shadow-md">
            <WikiIcon name="edit" className="text-[18px] text-[#2f3334] group-hover:text-[#546354]" />
          </button>
          <button onClick={onBack} className="group flex h-11 w-11 items-center justify-center rounded-xl border border-transparent bg-black/[0.03] shadow-sm transition-all hover:-translate-y-0.5 hover:bg-[#2f3334] hover:shadow-md">
            <WikiIcon name="close" className="text-[18px] text-[#2f3334] group-hover:text-white" />
          </button>
        </div>
        <div className="mb-10 lg:hidden border-b border-black/5 pb-8">
          <div className="grid grid-cols-1 gap-3">
            <button onClick={() => onEdit(entry)} className="flex items-center justify-center gap-1.5 rounded-xl bg-[#2f3334] py-3 font-label text-[10px] font-bold tracking-widest text-white shadow-sm hover:bg-[#546354] hover:-translate-y-0.5 transition-all">
              <WikiIcon name="edit" className="text-[15px]" /> 编辑
            </button>
          </div>
        </div>

        <div className="mb-12 rounded-2xl border border-black/5 bg-white p-6 shadow-sm">
          <WikiIcon name="verified_user" className="mb-3 text-[24px] text-[#546354]" />
          <div className="font-label text-[10px] font-bold tracking-widest text-[#2f3334]/40">审核状态</div>
          <div className="mt-1 font-body text-sm font-medium text-[#2f3334]/80">档案委员会已通过</div>
          <div className="mt-4 flex items-center justify-between border-t border-black/5 pt-4">
            <span className="font-label text-[10px] tracking-widest text-[#2f3334]/40">版本</span>
            <span className="font-mono text-sm font-bold text-[#2f3334]">第 {entry.versionNumber} 版</span>
          </div>
        </div>

        <WikiRevisionHistory history={history} onOpenRevision={setSelectedRevision} />
      </aside>

      <WikiRevisionDetailModal revision={selectedRevision} onClose={() => setSelectedRevision(null)} />
    </div>
  );
};

const WikiEntryFormModal: React.FC<{
  mode: WikiFormMode;
  open: boolean;
  entry?: WikiEntry | null;
  turnstileEnabled: boolean;
  onClose: () => void;
  onSubmitted: (message: string) => void;
}> = ({ mode, open, entry, turnstileEnabled, onClose, onSubmitted }) => {
  const [name, setName] = useState('');
  const [narrative, setNarrative] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [editSummary, setEditSummary] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const turnstileRef = useRef<TurnstileHandle | null>(null);
  const { feedback, showFeedback } = useWikiFeedback();

  useEscapeToClose(open, onClose);

  useEffect(() => {
    if (!open) {
      return;
    }
    setName(entry?.name || '');
    setNarrative(entry?.narrative || '');
    setTagInput((entry?.tags || []).join('，'));
    setEditSummary('');
    setMessage('');
    setSubmitting(false);
  }, [entry, open]);

  if (!open) {
    return null;
  }

  const parsedTags = parseTagInput(tagInput);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const tags = parseTagInput(tagInput);
    const trimmedName = name.trim();
    const trimmedNarrative = narrative.trim();
    const trimmedEditSummary = editSummary.trim();
    if (!trimmedName || !trimmedNarrative) {
      setMessage('请填写名字和记录叙述。');
      return;
    }
    if (mode === 'edit' && !trimmedEditSummary) {
      setMessage('');
      showFeedback('请填写修改原因', 'error');
      return;
    }
    setSubmitting(true);
    setMessage('');
    try {
      const turnstileToken = turnstileEnabled
        ? await turnstileRef.current?.execute()
        : '';
      const payload = {
        name: trimmedName,
        narrative: trimmedNarrative,
        tags,
        editSummary: mode === 'edit' ? trimmedEditSummary : '',
        turnstileToken: turnstileToken || '',
      };
      if (mode === 'edit' && entry) {
        await api.createWikiEdit(entry.slug, payload);
      } else {
        await api.createWikiSubmission(payload);
      }
      const successMessage = mode === 'edit'
        ? '修改已提交，等待审核'
        : '瓜条已提交，等待审核';
      setMessage(successMessage);
      onSubmitted(successMessage);
      window.setTimeout(onClose, 900);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '提交失败，请稍后再试。');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div data-wiki-overlay-modal="true" className="fixed inset-0 z-[80] flex items-center justify-center p-4 md:p-6">
      <WikiFloatingFeedback feedback={feedback} />
      <button type="button" aria-label="关闭弹窗" className="fixed inset-0 bg-on-surface/5 backdrop-blur-sm" onClick={onClose} />
      <form
        onSubmit={handleSubmit}
        className="relative z-10 flex max-h-[calc(100vh-2rem)] w-full max-w-xl flex-col overflow-hidden rounded-xl bg-surface-container-lowest shadow-[0px_4px_20px_rgba(47,51,52,0.06)] md:max-h-[calc(100vh-3rem)]"
      >
        <header className="flex shrink-0 items-center justify-between bg-surface-container-lowest/80 px-5 py-5 backdrop-blur-md md:px-8 md:py-6">
          <div className="space-y-1">
            <h1 className="font-headline text-xl font-bold text-on-surface">{mode === 'edit' ? '编辑瓜条' : '提交瓜条'}</h1>
            <p className="font-body text-xs text-on-surface-variant opacity-60">提交后进入后台审核</p>
          </div>
          <button type="button" onClick={onClose} className="text-on-surface-variant transition-colors duration-300 hover:text-primary">
            <WikiIcon name="close" />
          </button>
        </header>

        <main className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5 md:space-y-6 md:p-8">
          <label className="block">
            <span className="mb-2 block font-label text-[10px] font-semibold uppercase text-on-surface-variant">名字</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="输入姓名..."
              className="w-full border-0 border-b border-outline-variant/30 bg-transparent px-0 py-3 font-body text-base outline-none ring-0 transition-all duration-300 placeholder:text-on-surface-variant/30 focus:border-primary"
            />
          </label>
          <label className="block">
            <span className="mb-2 block font-label text-[10px] font-semibold text-on-surface-variant">标签</span>
            <input
              value={tagInput}
              onChange={(event) => setTagInput(event.target.value)}
              placeholder="输入tags"
              className="w-full border-0 border-b border-outline-variant/30 bg-transparent px-0 py-3 font-body text-base outline-none ring-0 transition-all duration-300 placeholder:text-on-surface-variant/30 focus:border-primary"
            />
            <span className="mt-2 block font-body text-xs leading-relaxed text-on-surface-variant/60">
              可输入多个标签，用逗号、顿号、分号、竖线或换行分隔，最多保留 6 个。
            </span>
          </label>
          {parsedTags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {parsedTags.map((tag) => (
                <span key={tag} className="rounded-md border border-primary/10 bg-primary-container/40 px-2.5 py-1 font-label text-[10px] text-on-primary-container">
                  #{tag}
                </span>
              ))}
            </div>
          )}
          <label className="block">
            <span className="mb-2 block font-label text-[10px] font-semibold uppercase text-on-surface-variant">记录叙述</span>
            <textarea
              value={narrative}
              onChange={(event) => setNarrative(event.target.value)}
              placeholder="客观中立的描述该词条..."
              rows={7}
              className="w-full resize-none rounded-lg border-0 bg-surface-container-high/20 px-4 py-4 font-body text-base leading-relaxed outline-none ring-0 transition-all duration-300 placeholder:text-on-surface-variant/30 focus:ring-1 focus:ring-primary"
            />
          </label>
          {mode === 'edit' && (
            <label className="block">
              <span className="mb-2 block font-label text-[10px] font-semibold text-on-surface-variant">修改原因</span>
              <textarea
                value={editSummary}
                onChange={(event) => setEditSummary(event.target.value)}
                placeholder="请说明本次修改的依据、补充内容或修正原因..."
                rows={3}
                className="w-full resize-none rounded-lg border-0 bg-surface-container-high/20 px-4 py-4 font-body text-sm leading-relaxed outline-none ring-0 transition-all duration-300 placeholder:text-on-surface-variant/30 focus:ring-1 focus:ring-primary"
              />
            </label>
          )}

          <div className="flex items-start gap-4 rounded-lg bg-surface-container-low p-4">
            <WikiIcon name="info" className="text-lg text-primary" />
            <p className="font-body text-xs leading-relaxed text-on-surface-variant">
              所有提交与编辑都会进入档案委员会审核。公开页面只展示审核通过的版本。
            </p>
          </div>
          {message && (
            <p className="rounded-lg bg-surface-container-low px-4 py-3 font-body text-sm text-on-surface-variant">
              {message}
            </p>
          )}
        </main>

        <footer className="flex shrink-0 items-center justify-end gap-4 bg-surface-container-low/30 px-5 py-5 md:gap-6 md:px-8 md:py-6">
          <button type="button" onClick={onClose} className="font-label text-sm text-on-surface-variant transition-colors duration-300 hover:text-on-surface">
            取消
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="flex items-center gap-2 rounded-[0.125rem] bg-primary px-8 py-3 font-headline text-sm font-semibold text-on-primary shadow-sm transition-all duration-300 hover:bg-primary-dim disabled:opacity-60"
          >
            <span>{submitting ? '提交中...' : mode === 'edit' ? '提交编辑' : '提交瓜条'}</span>
            {!submitting && <WikiIcon name="send" className="text-sm" />}
          </button>
        </footer>
        <Turnstile ref={turnstileRef} action="wiki" enabled={turnstileEnabled} />
      </form>
    </div>
  );
};

const WikiNeutralNoticeModal: React.FC<{
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}> = ({ open, onCancel, onConfirm }) => {
  useEscapeToClose(open, onCancel);

  if (!open) {
    return null;
  }

  return (
    <div data-wiki-overlay-modal="true" className="fixed inset-0 z-[80] flex items-center justify-center p-4 md:p-6">
      <button type="button" aria-label="关闭提示" className="fixed inset-0 bg-on-surface/5 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative z-10 max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto rounded-xl bg-surface-container-lowest p-6 shadow-[0px_4px_20px_rgba(47,51,52,0.06)] md:p-8">
        <div className="mb-6 flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-container text-primary">
            <WikiIcon name="balance" />
          </div>
          <div className="space-y-2">
            <h2 className="font-headline text-xl font-bold text-on-surface">瓜条撰写提示</h2>
            <p className="font-body text-sm leading-relaxed text-on-surface-variant">
              请秉承中立原则撰写瓜条，不带个人感情，不使用攻击、吹捧或臆测式表达。请尽量以客观、清晰、可审核的方式叙述角色信息。
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-4">
          <button type="button" onClick={onCancel} className="font-label text-sm text-on-surface-variant transition-colors hover:text-on-surface">
            取消
          </button>
          <button type="button" onClick={onConfirm} className="rounded-[0.125rem] bg-primary px-6 py-3 font-headline text-sm font-semibold text-on-primary shadow-sm transition-colors hover:bg-primary-dim">
            我已了解，继续提交
          </button>
        </div>
      </div>
    </div>
  );
};

const WikiView: React.FC = () => {
  const { state } = useApp();
  const [path, setPath] = useState(window.location.pathname);
  const [entries, setEntries] = useState<WikiEntry[]>([]);
  const [tags, setTags] = useState<Array<{ name: string; count: number }>>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [activeTag, setActiveTag] = useState('');
  const [listLoading, setListLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailEntry, setDetailEntry] = useState<WikiEntry | null>(null);
  const [history, setHistory] = useState<WikiRevision[]>([]);
  const [formMode, setFormMode] = useState<WikiFormMode>('create');
  const [formEntry, setFormEntry] = useState<WikiEntry | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [neutralNoticeOpen, setNeutralNoticeOpen] = useState(false);
  const { feedback, showFeedback } = useWikiFeedback();
  const isMobileFeed = useWikiMobileFeed();
  const listRequestRef = useRef(0);
  const detailAnimationFrameRef = useRef<number | null>(null);
  const detailCloseTimerRef = useRef<number | null>(null);
  const slug = useMemo(() => getSlugFromPath(path), [path]);
  const isDetail = Boolean(slug);
  const [detailMounted, setDetailMounted] = useState(isDetail);
  const [detailVisible, setDetailVisible] = useState(isDetail);
  const detailActive = isDetail || detailMounted;

  useEffect(() => {
    const handlePopState = () => setPath(window.location.pathname);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    return () => {
      if (detailAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(detailAnimationFrameRef.current);
      }
      if (detailCloseTimerRef.current !== null) {
        window.clearTimeout(detailCloseTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (detailAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(detailAnimationFrameRef.current);
      detailAnimationFrameRef.current = null;
    }
    if (detailCloseTimerRef.current !== null) {
      window.clearTimeout(detailCloseTimerRef.current);
      detailCloseTimerRef.current = null;
    }

    if (isDetail) {
      setDetailMounted(true);
      detailAnimationFrameRef.current = window.requestAnimationFrame(() => {
        setDetailVisible(true);
        detailAnimationFrameRef.current = null;
      });
      return;
    }

    setDetailVisible(false);
    if (!detailMounted) {
      return;
    }

    detailCloseTimerRef.current = window.setTimeout(() => {
      setDetailMounted(false);
      detailCloseTimerRef.current = null;
    }, WIKI_DETAIL_EXIT_MS);
  }, [detailMounted, isDetail]);

  useEffect(() => {
    setPage(1);
  }, [isMobileFeed]);

  const navigateTo = useCallback((targetPath: string) => {
    if (window.location.pathname !== targetPath) {
      window.history.pushState({}, '', targetPath);
    }
    setPath(targetPath);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (!detailActive) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (document.querySelector(WIKI_OVERLAY_MODAL_SELECTOR)) {
          return;
        }

        event.preventDefault();
        navigateTo('/wiki');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [detailActive, navigateTo]);

  const loadEntries = useCallback(async () => {
    const requestId = listRequestRef.current + 1;
    listRequestRef.current = requestId;
    const shouldAppend = isMobileFeed && page > 1;

    setListLoading(true);
    try {
      const data: WikiListResponse = await api.getWikiEntries({
        q: query,
        tag: activeTag,
        page,
        limit: PAGE_SIZE,
      });
      if (requestId !== listRequestRef.current) {
        return;
      }

      const nextItems = Array.isArray(data?.items) ? data.items : [];
      setEntries((prev) => {
        if (!shouldAppend) {
          return nextItems;
        }

        const existingIds = new Set(prev.map((item) => item.id));
        const mergedItems = nextItems.filter((item) => !existingIds.has(item.id));
        return [...prev, ...mergedItems];
      });
      setTags(Array.isArray(data?.tags) ? data.tags : []);
      setTotal(Number(data?.total || 0));
    } catch {
      if (requestId !== listRequestRef.current) {
        return;
      }

      if (!shouldAppend) {
        setEntries([]);
        setTags([]);
        setTotal(0);
      }
    } finally {
      if (requestId === listRequestRef.current) {
        setListLoading(false);
      }
    }
  }, [activeTag, isMobileFeed, page, query]);

  const loadDetail = useCallback(async () => {
    if (!slug) {
      return;
    }
    setDetailLoading(true);
    setDetailError('');
    try {
      const data: WikiDetailResponse = await api.getWikiEntry(slug);
      setDetailEntry(data.entry || null);
      setHistory(Array.isArray(data.history) ? data.history : []);
    } catch (error) {
      setDetailEntry(null);
      setHistory([]);
      setDetailError(error instanceof Error ? error.message : '瓜条不存在或尚未公开。');
    } finally {
      setDetailLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    if (!isDetail) {
      loadEntries();
    }
  }, [isDetail, loadEntries]);

  useEffect(() => {
    if (isDetail) {
      loadDetail();
    }
  }, [isDetail, loadDetail]);

  const openCreate = () => {
    setNeutralNoticeOpen(true);
  };

  const confirmCreate = () => {
    setNeutralNoticeOpen(false);
    setFormMode('create');
    setFormEntry(null);
    setFormOpen(true);
  };

  const openEdit = (entry: WikiEntry) => {
    setFormMode('edit');
    setFormEntry(entry);
    setFormOpen(true);
  };

  const handleSubmitted = (message: string) => {
    showFeedback(message);
    if (isDetail) {
      loadDetail();
    } else {
      loadEntries();
    }
  };

  const handleSearchCurrentEntry = useCallback(() => {
    const keyword = String(detailEntry?.name || '').trim();
    if (!keyword) {
      return;
    }

    const params = new URLSearchParams();
    params.set('q', keyword);
    const targetUrl = `${window.location.origin}/search?${params.toString()}`;
    const newWindow = window.open(targetUrl, '_blank', 'noopener,noreferrer');
    if (newWindow) {
      newWindow.opener = null;
    }
  }, [detailEntry]);

  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const hasMoreEntries = isMobileFeed && !isDetail && page < totalPages && entries.length < total;
  const loadingMore = isMobileFeed && page > 1 && listLoading;

  const loadMoreEntries = useCallback(() => {
    if (!hasMoreEntries || listLoading) {
      return;
    }

    setPage((prev) => Math.min(prev + 1, totalPages));
  }, [hasMoreEntries, listLoading, totalPages]);

  return (
    <WikiShell
      tags={tags}
      activeTag={activeTag}
      onTagChange={(val) => { setActiveTag(val); setPage(1); }}
      onOpenSubmit={openCreate}
      onNavigateHome={() => navigateTo('/wiki')}
      query={query}
      onQueryChange={(val) => { setQuery(val); setPage(1); }}
    >
      <WikiFloatingFeedback feedback={feedback} />

      {/* 详情以覆盖层展示，画廊常驻底层。 */}
      <WikiGallery
        items={entries}
        total={total}
        page={page}
        loading={listLoading && (!isMobileFeed || page === 1 || entries.length === 0)}
        loadingMore={loadingMore}
        mobileFeed={isMobileFeed}
        hasMore={hasMoreEntries}
        onPageChange={setPage}
        onLoadMore={loadMoreEntries}
        onOpenEntry={(entrySlug) => navigateTo(`/wiki/${encodeURIComponent(entrySlug)}`)}
      />

      {/* 详情覆盖层 */}
      <div
        className={`fixed inset-0 right-0 z-[60] w-full transition-opacity motion-reduce:transition-none lg:left-72 lg:w-auto xl:left-96 2xl:left-auto 2xl:w-[1300px] ${detailActive ? 'pointer-events-auto' : 'pointer-events-none'} ${detailVisible ? 'opacity-100' : 'opacity-0'}`}
        style={{
          transitionDuration: `${detailVisible ? WIKI_DETAIL_ENTER_MS : WIKI_DETAIL_EXIT_MS}ms`,
          transitionTimingFunction: detailVisible ? 'cubic-bezier(0.0, 0, 0.2, 1)' : 'cubic-bezier(0.4, 0, 1, 1)',
        }}
      >
        <div
          className={`absolute inset-y-0 right-0 overflow-hidden bg-[#fcfdfc] transition-[width,box-shadow,border-color] motion-reduce:transition-none lg:border-l ${detailVisible ? 'w-full border-black/5 shadow-[-30px_0_40px_rgba(47,51,52,0.08)]' : 'w-0 border-transparent shadow-none'}`}
          style={{
            transitionDuration: `${detailVisible ? WIKI_DETAIL_ENTER_MS : WIKI_DETAIL_EXIT_MS}ms`,
            transitionTimingFunction: detailVisible ? 'cubic-bezier(0.0, 0, 0.2, 1)' : 'cubic-bezier(0.4, 0, 1, 1)',
          }}
        >
          <div
            className={`absolute inset-y-0 right-0 w-full min-w-0 transition-opacity motion-reduce:transition-none ${detailVisible ? 'opacity-100 delay-[90ms] duration-150 ease-linear' : 'opacity-0 delay-0 duration-100 ease-linear'}`}
          >
            {detailActive && (
              <WikiEntryDetail
                entry={detailEntry}
                history={history}
                loading={detailLoading}
                error={detailError}
                onBack={() => navigateTo('/wiki')}
                onEdit={openEdit}
              />
            )}
          </div>
        </div>
        {detailEntry && !detailLoading && !detailError && (
          <div className="pointer-events-none absolute inset-x-0 bottom-5 z-[70] md:bottom-8">
            <div className="flex">
              <div className="min-w-0 flex-1 px-5 md:px-16">
                <div className="mx-auto flex max-w-2xl justify-start">
                  <button
                    type="button"
                    aria-label="检索瓜条"
                    title="检索瓜条"
                    onClick={handleSearchCurrentEntry}
                    className="pointer-events-auto group flex h-12 min-w-12 items-center justify-center gap-2 rounded-xl border border-black/5 bg-white/95 px-3 font-label text-xs font-bold tracking-widest text-[#2f3334]/75 shadow-[0px_10px_30px_rgba(47,51,52,0.10)] backdrop-blur-md transition-all hover:-translate-y-0.5 hover:border-[#546354]/50 hover:bg-[#f9faf9] hover:text-[#546354] hover:shadow-xl md:h-14 md:min-w-14 md:px-4"
                  >
                    <WikiIcon name="search" className="text-[22px]" />
                    <span className="hidden sm:inline">检索</span>
                  </button>
                </div>
              </div>
              <div className="hidden shrink-0 lg:block lg:w-[320px] xl:w-[400px]" />
            </div>
          </div>
        )}
      </div>

      {/* 移动端点击遮罩返回画廊 */}
      <div
        className={`fixed inset-0 z-[55] bg-black/10 backdrop-blur-sm transition-opacity motion-reduce:transition-none lg:hidden ${detailActive ? 'pointer-events-auto' : 'pointer-events-none'} ${detailVisible ? 'opacity-100' : 'opacity-0'}`}
        style={{
          transitionDuration: `${detailVisible ? WIKI_DETAIL_ENTER_MS : WIKI_DETAIL_EXIT_MS}ms`,
          transitionTimingFunction: detailVisible ? 'cubic-bezier(0.0, 0, 0.2, 1)' : 'cubic-bezier(0.4, 0, 1, 1)',
        }}
        onClick={() => navigateTo('/wiki')}
      />

      <WikiEntryFormModal
        mode={formMode}
        open={formOpen}
        entry={formEntry}
        turnstileEnabled={state.settings.turnstileEnabled}
        onClose={() => setFormOpen(false)}
        onSubmitted={handleSubmitted}
      />
      <WikiNeutralNoticeModal
        open={neutralNoticeOpen}
        onCancel={() => setNeutralNoticeOpen(false)}
        onConfirm={confirmCreate}
      />
    </WikiShell>
  );
};

export default WikiView;
