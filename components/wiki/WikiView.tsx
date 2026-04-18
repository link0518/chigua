import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '../../api';
import { useApp } from '../../store/AppContext';
import type { WikiEntry, WikiEntrySort, WikiRevision } from '../../types';
import WikiMarkdownComposer from '../WikiMarkdownComposer';
import MarkdownRenderer from '../MarkdownRenderer';
import Turnstile, { TurnstileHandle } from '../Turnstile';
import { getWikiMarkdownExcerpt } from './wikiMarkdownPlainText';

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
type WikiFeedback = {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
  duration: number;
};
type WikiListState = {
  query: string;
  tag: string;
  sortBy: WikiEntrySort;
  page: number;
};

const PAGE_SIZE = 12;
const WIKI_NARRATIVE_MAX_LENGTH = 8000;
const WIKI_MOBILE_FEED_QUERY = '(max-width: 767px)';
const WIKI_DETAIL_ENTER_MS = 225;
const WIKI_DETAIL_EXIT_MS = 195;
const WIKI_OVERLAY_MODAL_SELECTOR = '[data-wiki-overlay-modal="true"]';
const waitForNextPaint = () => new Promise<void>((resolve) => {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => resolve());
  });
});
const WIKI_SORT_OPTIONS: Array<{ value: WikiEntrySort; label: string }> = [
  { value: 'updated', label: '更新时间' },
  { value: 'number', label: '编号' },
];

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
      if (event.key !== 'Escape' || event.defaultPrevented) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
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

const canvasToBlob = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => {
  canvas.toBlob((blob) => {
    if (blob) {
      resolve(blob);
    } else {
      reject(new Error('图片生成失败'));
    }
  }, 'image/png');
});

const blobToDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onloadend = () => {
    if (typeof reader.result === 'string') {
      resolve(reader.result);
      return;
    }
    reject(new Error('图片生成失败'));
  };
  reader.onerror = () => reject(new Error('图片生成失败'));
  reader.readAsDataURL(blob);
});

const waitForImage = (image: HTMLImageElement) => new Promise<void>((resolve, reject) => {
  image.loading = 'eager';
  image.decoding = 'sync';

  if (image.complete) {
    if (image.naturalWidth > 0) {
      resolve();
    } else {
      reject(new Error('存在图片加载失败，无法导出'));
    }
    return;
  }

  let cleanedUp = false;
  const timer = window.setTimeout(() => {
    cleanup();
    reject(new Error('图片加载超时，无法导出'));
  }, 15000);

  const cleanup = () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    window.clearTimeout(timer);
    image.removeEventListener('load', handleLoad);
    image.removeEventListener('error', handleError);
  };

  const handleLoad = () => {
    cleanup();
    resolve();
  };

  const handleError = () => {
    cleanup();
    reject(new Error('存在图片加载失败，无法导出'));
  };

  image.addEventListener('load', handleLoad);
  image.addEventListener('error', handleError);
});

const waitForNodeImages = async (node: HTMLElement) => {
  const images = Array.from(node.querySelectorAll('img'));
  await Promise.all(images.map((image) => waitForImage(image)));
};

const inlineComputedStyles = (source: Element, target: Element) => {
  const computed = window.getComputedStyle(source);
  const styleText = Array.from(computed)
    .map((property) => `${property}: ${computed.getPropertyValue(property)};`)
    .join(' ');
  target.setAttribute('style', styleText);
};

const cloneNodeWithInlineStyles = <T extends HTMLElement>(node: T) => {
  const clone = node.cloneNode(true) as T;
  const sourceElements = [node, ...Array.from(node.querySelectorAll('*'))];
  const clonedElements = [clone, ...Array.from(clone.querySelectorAll('*'))];

  sourceElements.forEach((sourceElement, index) => {
    const targetElement = clonedElements[index];
    if (!targetElement) {
      return;
    }
    inlineComputedStyles(sourceElement, targetElement);
  });

  return clone;
};

const embedCloneImages = async (sourceNode: HTMLElement, clonedNode: HTMLElement) => {
  const sourceImages = Array.from(sourceNode.querySelectorAll('img'));
  const clonedImages = Array.from(clonedNode.querySelectorAll('img'));

  await Promise.all(sourceImages.map(async (image, index) => {
    const target = clonedImages[index];
    if (!target) {
      return;
    }

    const imageUrl = image.currentSrc || image.src;
    if (!imageUrl) {
      throw new Error('存在无法识别的图片资源，无法导出');
    }

    let response: Response;
    try {
      response = await fetch(imageUrl);
    } catch {
      throw new Error('存在无法导出的外链图片，请稍后重试或更换图片来源');
    }

    if (!response.ok) {
      throw new Error('存在无法导出的图片资源，请稍后重试');
    }

    const blob = await response.blob();
    const dataUrl = await blobToDataUrl(blob);
    target.removeAttribute('srcset');
    target.setAttribute('src', dataUrl);
  }));
};

const loadImageElement = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image();
  image.decoding = 'sync';
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('图片生成失败'));
  image.src = src;
});

const saveWikiEntryCardImage = async (entry: WikiEntry, node: HTMLElement) => {
  if ('fonts' in document) {
    await document.fonts.ready;
  }

  await waitForNodeImages(node);
  const clonedNode = cloneNodeWithInlineStyles(node);
  await embedCloneImages(node, clonedNode);

  const width = Math.ceil(node.scrollWidth);
  const height = Math.ceil(node.scrollHeight);
  if (!width || !height) {
    throw new Error('导出区域为空，无法保存图片');
  }

  const exportWrapper = document.createElement('div');
  exportWrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  exportWrapper.setAttribute('style', [
    `width: ${width}px`,
    `height: ${height}px`,
    'overflow: hidden',
    'background: #fcfdfc',
  ].join('; '));
  exportWrapper.appendChild(clonedNode);

  const serializedNode = new XMLSerializer().serializeToString(exportWrapper);
  const svgMarkup = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <foreignObject x="0" y="0" width="100%" height="100%">${serializedNode}</foreignObject>
    </svg>
  `;
  const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;
  const image = await loadImageElement(svgUrl);

  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('图片生成失败');
  }
  ctx.scale(scale, scale);
  ctx.fillStyle = '#fcfdfc';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);

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

const normalizeWikiSort = (value?: string | null): WikiEntrySort => (
  value === 'number' ? 'number' : 'updated'
);

const parseWikiPage = (value?: string | null) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
};

const getWikiListStateFromHref = (href: string): WikiListState => {
  const url = new URL(href, window.location.origin);
  return {
    query: String(url.searchParams.get('q') || '').trim(),
    tag: String(url.searchParams.get('tag') || '').trim(),
    sortBy: normalizeWikiSort(url.searchParams.get('sort')),
    page: parseWikiPage(url.searchParams.get('page')),
  };
};

const createWikiListUrl = ({ query, tag, sortBy, page }: WikiListState) => {
  const params = new URLSearchParams();
  if (query) {
    params.set('q', query);
  }
  if (tag) {
    params.set('tag', tag);
  }
  if (sortBy !== 'updated') {
    params.set('sort', sortBy);
  }
  if (page > 1) {
    params.set('page', String(page));
  }
  const queryString = params.toString();
  return queryString ? `/wiki?${queryString}` : '/wiki';
};

const WikiIcon: React.FC<{ name: string; className?: string }> = ({ name, className = '' }) => (
  <span className={`material-symbols-outlined ${className}`} aria-hidden="true">{name}</span>
);

const useWikiFeedback = () => {
  const [feedback, setFeedback] = useState<WikiFeedback | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);
  const feedbackSeedRef = useRef(0);

  const showFeedback = useCallback((message: string, type: WikiFeedback['type'] = 'success') => {
    if (feedbackTimerRef.current) {
      window.clearTimeout(feedbackTimerRef.current);
    }
    const duration = type === 'error' ? 4200 : type === 'info' ? 3200 : 2600;
    feedbackSeedRef.current += 1;
    setFeedback({
      id: feedbackSeedRef.current,
      message,
      type,
      duration,
    });
    feedbackTimerRef.current = window.setTimeout(() => {
      setFeedback(null);
      feedbackTimerRef.current = null;
    }, duration);
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

  const feedbackMeta = feedback.type === 'error'
    ? {
      eyebrow: '需要处理',
      title: '这次操作没有完成',
      iconName: 'error',
      shellClassName: 'border-[#b86149]/22 bg-[linear-gradient(180deg,rgba(255,250,248,0.97),rgba(255,244,239,0.95))] text-[#6e1400]',
      iconClassName: 'border-[#b86149]/18 bg-[#fff1eb] text-[#a73b21]',
      progressClassName: 'bg-[#b86149]/55',
    }
    : feedback.type === 'info'
      ? {
        eyebrow: '系统提示',
        title: '请留意当前状态',
        iconName: 'info',
        shellClassName: 'border-[#546354]/18 bg-[linear-gradient(180deg,rgba(248,250,247,0.97),rgba(242,246,239,0.95))] text-[#314132]',
        iconClassName: 'border-[#546354]/12 bg-[#edf3ea] text-[#546354]',
        progressClassName: 'bg-[#546354]/45',
      }
      : {
        eyebrow: '档案回执',
        title: '操作已经记录',
        iconName: 'check_circle',
        shellClassName: 'border-[#6a8168]/18 bg-[linear-gradient(180deg,rgba(251,253,250,0.98),rgba(242,247,240,0.95))] text-[#344335]',
        iconClassName: 'border-[#6a8168]/12 bg-[#eef5ea] text-[#546354]',
        progressClassName: 'bg-[#6a8168]/52',
      };
  const feedbackStyle = { '--wiki-feedback-duration': `${feedback.duration}ms` } as React.CSSProperties;

  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-[120] flex justify-center md:inset-x-auto md:right-6 md:top-6 md:bottom-auto">
      <div
        key={feedback.id}
        role={feedback.type === 'error' ? 'alert' : 'status'}
        aria-live={feedback.type === 'error' ? 'assertive' : 'polite'}
        aria-atomic="true"
        style={feedbackStyle}
        className={`wiki-feedback-enter relative w-full max-w-[24rem] overflow-hidden rounded-[22px] border px-4 py-4 shadow-[0px_20px_60px_rgba(47,51,52,0.16)] backdrop-blur-xl md:w-[24rem] ${feedbackMeta.shellClassName}`}
      >
        <div className="absolute inset-x-0 top-0 h-px bg-white/75" />
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border shadow-sm ${feedbackMeta.iconClassName}`}>
            <WikiIcon name={feedbackMeta.iconName} className="text-[20px]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-label text-[10px] font-bold tracking-[0.2em] text-[#2f3334]/48">
              {feedbackMeta.eyebrow}
            </p>
            <h3 className="mt-1 font-headline text-[18px] font-bold leading-none text-[#2f3334]">
              {feedbackMeta.title}
            </h3>
            <p className="mt-2 font-body text-sm leading-6 text-[#2f3334]/68">
              {feedback.message}
            </p>
          </div>
        </div>
        <div className="mt-4 h-[3px] overflow-hidden rounded-full bg-black/5">
          <div className={`wiki-feedback-progress h-full rounded-full ${feedbackMeta.progressClassName}`} />
        </div>
      </div>
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
    <aside className="hidden w-72 shrink-0 flex-col border-r border-black/5 bg-[#fcfdfc] lg:flex">
      <div className="flex items-center gap-4 border-b border-black/5 px-8 pb-8 pt-10">
        <button type="button" onClick={onNavigateHome} className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#2f3334] text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-[#546354] hover:shadow-md">
          <WikiIcon name="auto_stories" />
        </button>
        <div>
          <h1 className="font-headline text-xl font-bold tracking-tight">JX3瓜条</h1>
          <p className="font-label text-[11px] tracking-[0.16em] text-[#2f3334]/42">角色档案库</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="mb-8">
          <div className="relative group">
            <WikiIcon name="search" className="absolute left-4 top-1/2 -translate-y-1/2 text-[18px] text-[#2f3334]/30 transition-colors group-hover:text-[#546354]/60" />
            <input
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="快速检索档案..."
              className="w-full rounded-xl border border-black/[0.03] bg-black/[0.02] py-3 pl-11 pr-11 font-body text-sm outline-none transition-all placeholder:text-[#2f3334]/30 focus:border-[#546354]/20 focus:bg-white focus:ring-4 focus:ring-[#546354]/[0.03]"
            />
            {query && (
              <button
                type="button"
                onClick={() => onQueryChange('')}
                className="absolute right-3 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-[#2f3334]/38 transition-colors hover:bg-black/[0.04] hover:text-[#2f3334]"
                aria-label="清空搜索"
              >
                <WikiIcon name="close" className="text-[16px]" />
              </button>
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="mb-4 px-2 font-label text-[11px] font-bold tracking-[0.16em] text-[#2f3334]/42">档案标签分类</div>
          <button
            type="button"
            onClick={() => onTagChange('')}
            className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left font-body text-sm transition-all ${!activeTag ? 'bg-[#546354] text-white shadow-md' : 'text-[#2f3334]/70 hover:bg-black/[0.03]'}`}
          >
            <span className={!activeTag ? 'font-medium tracking-[0.04em]' : ''}>全部瓜条</span>
          </button>
          {tags.map((tag) => (
            <button
              key={tag.name}
              type="button"
              onClick={() => onTagChange(tag.name)}
              className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left font-body text-sm transition-all ${activeTag === tag.name ? 'bg-[#546354] text-white shadow-md' : 'text-[#2f3334]/70 hover:bg-black/[0.03]'}`}
            >
              <span className={activeTag === tag.name ? 'font-medium tracking-[0.04em]' : ''}>{tag.name}</span>
              <span className={`font-label text-[11px] ${activeTag === tag.name ? 'font-bold text-white/60' : 'text-[#2f3334]/30'}`}>{tag.count}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-black/5 bg-[#f9faf9] p-6 backdrop-blur-md">
        <button
          type="button"
          onClick={onOpenSubmit}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#2f3334] py-3.5 font-label text-xs font-bold tracking-[0.14em] text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-[#546354] hover:shadow-md"
        >
          <WikiIcon name="edit_document" className="text-[16px]" />
          新建瓜条
        </button>
      </div>
    </aside>

    <div className="pattern-grid-lg relative flex min-w-0 flex-1 flex-col overflow-hidden bg-white/50">
      <nav className="flex shrink-0 items-center justify-between border-b border-black/5 bg-white/80 px-5 py-3 backdrop-blur-xl lg:hidden">
        <button type="button" onClick={onNavigateHome} className="font-headline text-lg font-bold tracking-tight">JX3瓜条</button>
        <button
          type="button"
          onClick={onOpenSubmit}
          className="flex h-10 w-10 items-center justify-center rounded-xl text-[#2f3334]/60 transition-colors hover:bg-black/[0.04] hover:text-[#2f3334]"
          aria-label="新建瓜条"
        >
          <WikiIcon name="edit_note" />
        </button>
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
        {tags.length > 0 && (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => onTagChange('')}
              className={`shrink-0 rounded-full border px-3 py-1.5 font-label text-[11px] font-semibold transition-all ${!activeTag ? 'border-[#546354] bg-[#546354] text-white shadow-sm' : 'border-black/5 bg-white/90 text-[#2f3334]/68'}`}
            >
              全部
            </button>
            {tags.map((tag) => (
              <button
                key={tag.name}
                type="button"
                onClick={() => onTagChange(tag.name)}
                className={`shrink-0 rounded-full border px-3 py-1.5 font-label text-[11px] font-semibold transition-all ${activeTag === tag.name ? 'border-[#546354] bg-[#546354] text-white shadow-sm' : 'border-black/5 bg-white/90 text-[#2f3334]/68'}`}
              >
                #{tag.name}
              </button>
            ))}
          </div>
        )}
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
  sortBy: WikiEntrySort;
  query: string;
  activeTag: string;
  onPageChange: (value: number) => void;
  onSortChange: (value: WikiEntrySort) => void;
  onClearFilters: () => void;
  onLoadMore: () => void;
  onOpenEntry: (slug: string) => void;
}> = ({
  items,
  total,
  page,
  loading,
  loadingMore,
  mobileFeed,
  hasMore,
  sortBy,
  query,
  activeTag,
  onPageChange,
  onSortChange,
  onClearFilters,
  onLoadMore,
  onOpenEntry,
}) => {
  const listRef = useRef<HTMLElement | null>(null);
  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const itemOffset = mobileFeed ? 0 : (page - 1) * PAGE_SIZE;
  const latestUpdatedAt = items.reduce((max, item) => Math.max(max, Number(item.updatedAt || 0)), 0);
  const hasListFilters = Boolean(query || activeTag || sortBy !== 'updated' || page > 1);
  const footerHint = totalPages <= 1
    ? '已展示全部公开瓜条'
    : page >= totalPages
      ? '已浏览到末页'
      : page <= 1
        ? '向后翻页浏览'
        : '继续翻页浏览';
  const mobileFooterHint = loadingMore
    ? '继续加载中'
    : hasMore
      ? '继续下滑浏览'
      : '已浏览到末页';
  const footerActionClassName = 'group inline-flex h-8 items-center gap-1 rounded-full px-2 font-label text-[11px] font-semibold tracking-[0.11em] text-[#2f3334]/44 transition-all duration-300 hover:text-[#546354] disabled:pointer-events-none disabled:text-[#2f3334]/20';

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
      <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col px-4 py-6 pb-16 sm:px-6 md:px-12 md:py-16 md:pb-12">
        <div className="flex-1">
          <header className="mb-8 md:mb-12">
            <div className="space-y-4">
              <div>
                <h2 className="font-headline text-3xl font-extrabold tracking-tight text-[#2f3334] md:text-5xl">阅览矩阵</h2>
                <p className="mt-3 font-label text-[11px] font-bold tracking-[0.16em] text-[#2f3334]/42">公开瓜条目录</p>
              </div>

              <div className="rounded-[28px] border border-black/5 bg-white/78 p-4 shadow-[0px_20px_50px_rgba(47,51,52,0.05)] backdrop-blur-xl md:p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-[#546354]/15 bg-[#546354]/6 px-3 py-1.5 font-label text-[11px] font-semibold text-[#546354]">
                    共 {total} 条公开档案
                  </span>
                  <span className="rounded-full border border-black/5 bg-[#f8faf8] px-3 py-1.5 font-label text-[11px] text-[#2f3334]/62">
                    第 {String(page).padStart(2, '0')} / {String(totalPages).padStart(2, '0')} 页
                  </span>
                  {latestUpdatedAt > 0 && (
                    <span className="rounded-full border border-black/5 bg-[#f8faf8] px-3 py-1.5 font-body text-[12px] text-[#2f3334]/58">
                      最近更新 {formatDateTime(latestUpdatedAt)}
                    </span>
                  )}
                  {activeTag && (
                    <span className="rounded-full border border-black/5 bg-[#f8faf8] px-3 py-1.5 font-label text-[11px] text-[#2f3334]/62">
                      标签 #{activeTag}
                    </span>
                  )}
                  {query && (
                    <span className="rounded-full border border-black/5 bg-[#f8faf8] px-3 py-1.5 font-body text-[12px] text-[#2f3334]/58">
                      搜索 “{query}”
                    </span>
                  )}
                </div>

                <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="flex flex-wrap items-center gap-2 self-start rounded-full border border-black/5 bg-white/80 p-1 shadow-sm">
                    <span className="px-2 font-label text-[11px] font-bold tracking-[0.14em] text-[#2f3334]/38">排序</span>
                    {WIKI_SORT_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => onSortChange(option.value)}
                        aria-pressed={sortBy === option.value}
                        className={`rounded-full px-3 py-1.5 font-label text-[11px] font-bold transition-all ${sortBy === option.value ? 'bg-[#2f3334] text-white shadow-sm' : 'text-[#2f3334]/58 hover:bg-black/[0.04] hover:text-[#2f3334]'}`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>

                  {hasListFilters && (
                    <button
                      type="button"
                      onClick={onClearFilters}
                      className="inline-flex items-center gap-2 self-start rounded-full border border-black/5 bg-white/90 px-4 py-2 font-label text-[11px] font-semibold text-[#2f3334]/68 transition-all hover:-translate-y-0.5 hover:border-[#546354]/30 hover:text-[#546354]"
                    >
                      <WikiIcon name="filter_alt_off" className="text-[16px]" />
                      清空筛选
                    </button>
                  )}
                </div>
              </div>
            </div>
          </header>

          {loading ? (
            <div className="flex items-center justify-center py-32 font-label text-xs tracking-[0.16em] text-[#2f3334]/40">
              档案数据读取中...
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-3xl border border-black/5 bg-white/60 p-10 text-center shadow-sm backdrop-blur-sm md:p-24">
              <div className="mx-auto max-w-md">
                <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f3f4f4] text-[#546354]">
                  <WikiIcon name="search_off" className="text-[22px]" />
                </div>
                <h3 className="font-headline text-2xl font-bold tracking-tight text-[#2f3334]">没有找到对应瓜条</h3>
                <p className="mt-3 font-body text-sm leading-relaxed text-[#2f3334]/56">
                  试试换个关键词，或者清空当前筛选条件重新浏览。
                </p>
                {hasListFilters && (
                  <button
                    type="button"
                    onClick={onClearFilters}
                    className="mt-5 inline-flex items-center gap-2 rounded-full border border-black/5 bg-white px-4 py-2 font-label text-[11px] font-semibold text-[#2f3334]/68 transition-all hover:-translate-y-0.5 hover:border-[#546354]/30 hover:text-[#546354]"
                  >
                    <WikiIcon name="replay" className="text-[16px]" />
                    清空筛选
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((entry, index) => (
                <article key={entry.id} className="min-h-[332px] md:min-h-[352px]">
                  <button
                    type="button"
                    onClick={() => onOpenEntry(entry.slug)}
                    className="group relative flex h-full w-full flex-col overflow-hidden rounded-[28px] border border-black/5 bg-white p-6 text-left shadow-[0px_20px_50px_rgba(47,51,52,0.05)] transition-all duration-500 ease-out hover:-translate-y-1.5 hover:border-[#546354]/40 hover:shadow-[0px_28px_80px_rgba(84,99,84,0.12)] focus:outline-none focus-visible:-translate-y-1.5 focus-visible:border-[#546354]/50 focus-visible:ring-2 focus-visible:ring-[#546354]/18 md:p-7"
                  >
                    <div className="mb-5 flex items-center gap-3">
                      <span className="font-label text-[11px] font-bold tracking-[0.14em] text-[#2f3334]/34 transition-colors group-hover:text-[#546354]/74">
                        编号 {String(getEntryDisplayNumber(entry, index)).padStart(3, '0')}
                      </span>
                    </div>

                    <h3 className="mb-4 line-clamp-2 min-h-[4.25rem] font-headline text-[28px] font-bold leading-snug text-[#2f3334] transition-colors group-hover:text-[#546354]">
                      {entry.name}
                    </h3>

                    <p className="mb-6 flex-1 line-clamp-5 font-body text-sm leading-relaxed text-[#2f3334]/70">
                      {getWikiMarkdownExcerpt(entry.narrative, 120) || '暂无叙述详情...'}
                    </p>

                    <div className="mt-auto flex flex-wrap gap-2">
                      {entry.tags.slice(0, 4).map((tag) => (
                        <span key={tag} className="rounded-full border border-black/[0.04] bg-[#f9faf9] px-2.5 py-1 font-label text-[11px] text-[#2f3334]/64">
                          #{tag}
                        </span>
                      ))}
                      {entry.tags.length > 4 && (
                        <span className="rounded-full border border-black/[0.04] bg-[#f9faf9] px-2.5 py-1 font-label text-[11px] text-[#2f3334]/64">
                          +{entry.tags.length - 4}
                        </span>
                      )}
                    </div>

                    <div className="mt-6 flex items-center justify-between gap-4 border-t border-black/[0.04] pt-4">
                      <span className="font-body text-[12px] text-[#2f3334]/48">
                        更新于 {formatDateTime(entry.updatedAt)}
                      </span>
                      <span className="inline-flex items-center gap-1 font-label text-[11px] font-semibold text-[#546354]">
                        查看档案
                        <WikiIcon name="arrow_outward" className="text-[14px]" />
                      </span>
                    </div>

                    <div className="absolute bottom-0 left-0 h-[3px] w-full origin-left scale-x-0 bg-[#546354] opacity-0 transition-all duration-500 ease-out group-hover:scale-x-100 group-hover:opacity-100 group-focus-visible:scale-x-100 group-focus-visible:opacity-100" />
                  </button>
                </article>
              ))}
            </div>
          )}
        </div>

        {items.length > 0 && (
          <footer className="mt-10 md:mt-10">
            {mobileFeed && (
              <div className="flex flex-col items-center gap-2 md:hidden">
                <div className="inline-flex w-full max-w-[260px] items-center gap-3 rounded-full bg-[#fcfdfc]/96 px-4 py-1">
                  <span className="h-px flex-1 bg-[#cfd8cf]" />
                  <span className="h-[3px] w-7 rounded-full bg-[#d6ddd6]" />
                  <span className="h-px flex-1 bg-[#d9ded9]" />
                </div>
                <div className="inline-flex items-center bg-[#fcfdfc]/96 px-2 py-0.5">
                  <span className="font-label text-[11px] font-semibold tracking-[0.13em] text-[#2f3334]/56">
                    {mobileFooterHint}
                  </span>
                </div>
              </div>
            )}

            <div className="hidden md:block">
              <div className="mb-2 flex justify-center">
                <div className="inline-flex w-full max-w-[340px] items-center gap-4 rounded-full bg-[#fcfdfc]/96 px-5 py-1">
                  <span className="h-px flex-1 bg-[#cfd8cf]" />
                  <span className="h-[3px] w-10 rounded-full bg-[#d6ddd6]" />
                  <span className="h-px flex-1 bg-[#d9ded9]" />
                </div>
              </div>

              <div className="relative flex min-h-[40px] items-center justify-center">
                <div className="relative flex w-full items-center justify-center">
                  {totalPages > 1 && (
                    <button
                      type="button"
                      disabled={page <= 1}
                      onClick={() => onPageChange(page - 1)}
                      className={`${footerActionClassName} absolute left-0 top-1/2 -translate-y-1/2`}
                    >
                      <WikiIcon name="west" className="text-[14px] transition-transform duration-300 group-hover:-translate-x-0.5" />
                      上一页
                    </button>
                  )}

                  <div className="relative inline-flex items-center rounded-full border border-black/[0.04] bg-white/88 px-4 py-1 shadow-[0px_6px_18px_rgba(47,51,52,0.03)]">
                    <span className="font-label text-[11px] font-semibold tracking-[0.13em] text-[#2f3334]/54">
                      第 {String(page).padStart(2, '0')} 页 / 共 {String(totalPages).padStart(2, '0')} 页
                    </span>
                  </div>

                  {totalPages > 1 && (
                    <button
                      type="button"
                      disabled={page >= totalPages}
                      onClick={() => onPageChange(page + 1)}
                      className={`${footerActionClassName} absolute right-0 top-1/2 -translate-y-1/2`}
                    >
                      下一页
                      <WikiIcon name="east" className="text-[14px] transition-transform duration-300 group-hover:translate-x-0.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </footer>
        )}
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

          <MarkdownRenderer
            content={narrative}
            className="pt-8 font-body text-base leading-loose text-[#2f3334]/80 [&_p]:mb-5 [&_blockquote]:my-5 [&_ol]:my-5 [&_ul]:my-5 [&_pre]:my-5"
          />
        </main>
      </div>
    </div>
  );
};

const WikiEntryNarrativeCard: React.FC<{
  entry: WikiEntry;
  mode?: 'detail' | 'export';
}> = ({ entry, mode = 'detail' }) => {
  const headerClassName = mode === 'export'
    ? 'space-y-5 border-b border-black/5 pb-8'
    : 'space-y-5 border-b border-black/5 pb-8 md:space-y-6 md:pb-10';
  const titleClassName = mode === 'export'
    ? 'font-headline text-5xl font-extrabold leading-tight tracking-tight text-[#2f3334]'
    : 'font-headline text-4xl font-extrabold leading-tight tracking-tight text-[#2f3334] md:text-5xl lg:text-6xl';
  const bodyClassName = mode === 'export'
    ? 'font-body text-lg leading-loose text-[#2f3334]/80 [&_p]:mb-6 [&_blockquote]:my-6 [&_ol]:my-6 [&_ul]:my-6 [&_pre]:my-6'
    : 'font-body text-base leading-loose text-[#2f3334]/80 md:text-lg [&_p]:mb-6 [&_blockquote]:my-6 [&_ol]:my-6 [&_ul]:my-6 [&_pre]:my-6';

  return (
    <div className="relative z-10 mx-auto max-w-2xl space-y-10 md:space-y-12">
      <div className={headerClassName}>
        <span className="inline-block rounded border border-[#546354]/20 bg-[#546354]/5 px-2.5 py-1 font-label text-[9px] font-bold tracking-widest text-[#546354]">公开档案</span>
        <h1 className={titleClassName}>{entry.name}</h1>
        <div className="flex flex-wrap gap-2 pt-2">
          {entry.tags.map((tag) => (
            <span key={tag} className="rounded-md bg-[#f9faf9] px-2.5 py-1 font-label text-[10px] text-[#2f3334]/70 border border-black/5 shadow-sm">#{tag}</span>
          ))}
        </div>
      </div>

      <MarkdownRenderer content={entry.narrative} className={bodyClassName} />
    </div>
  );
};

const WikiEntryExportCard = React.forwardRef<HTMLDivElement, { entry: WikiEntry }>(({ entry }, ref) => (
  <div className="pointer-events-none fixed inset-x-0 top-0 z-[-1] flex justify-center opacity-0" aria-hidden="true">
    <div className="w-[1080px] bg-[#fcfdfc] px-12 py-12">
      <div
        ref={ref}
        className="rounded-[32px] border border-black/5 bg-white px-16 py-16 shadow-[0px_24px_80px_rgba(47,51,52,0.12)]"
      >
        <WikiEntryNarrativeCard entry={entry} mode="export" />
        <div className="mt-12 border-t border-black/5 pt-6 text-center">
          <div className="font-label text-sm font-bold tracking-[0.18em] text-[#2f3334]/48">
            吃瓜到 JX3 瓜田
          </div>
          <div className="mt-2 font-label text-xs font-bold tracking-[0.16em] text-[#2f3334]/32">
            jx3gua.com · 公开档案第 {entry.versionNumber} 版
          </div>
        </div>
      </div>
    </div>
  </div>
));

WikiEntryExportCard.displayName = 'WikiEntryExportCard';

const WikiEntryDetail: React.FC<{
  entry: WikiEntry | null;
  history: WikiRevision[];
  loading: boolean;
  error: string;
  onBack: () => void;
  onEdit: (entry: WikiEntry) => void;
  onSearchCurrentEntry: () => void;
}> = ({ entry, history, loading, error, onBack, onEdit, onSearchCurrentEntry }) => {
  const [selectedRevision, setSelectedRevision] = useState<WikiRevision | null>(null);
  const [exportEntry, setExportEntry] = useState<WikiEntry | null>(null);
  const exportCardRef = useRef<HTMLDivElement | null>(null);
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
    if (!entry || exportEntry) {
      return;
    }

    try {
      setExportEntry(entry);
      await waitForNextPaint();
      const exportNode = exportCardRef.current;
      if (!exportNode) {
        throw new Error('保存失败，请稍后重试');
      }
      await saveWikiEntryCardImage(entry, exportNode);
      showFeedback('瓜条图片已保存');
    } catch (error) {
      showFeedback(error instanceof Error ? error.message : '保存失败，请稍后重试', 'error');
    } finally {
      setExportEntry(null);
    }
  }, [entry, exportEntry, showFeedback]);

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
  const entryUpdatedLabel = formatDateTime(entry.updatedAt);
  const entryCreatedLabel = formatDateTime(entry.createdAt);
  const detailActionButtonClassName = 'inline-flex h-11 items-center justify-center gap-2 rounded-full border border-black/5 bg-white/92 px-3.5 font-label text-[11px] font-semibold text-[#2f3334]/72 shadow-sm transition-all hover:-translate-y-0.5 hover:border-[#546354]/35 hover:text-[#546354]';
  const primaryActionButtonClassName = 'inline-flex h-11 items-center justify-center gap-2 rounded-full border border-transparent bg-[#2f3334] px-3.5 font-label text-[11px] font-semibold text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-[#546354]';

  return (
    <div className="relative z-10 flex h-full w-full flex-col overflow-y-auto bg-[#fcfdfc] sm:bg-white/95 sm:backdrop-blur-3xl lg:flex-row lg:overflow-hidden">
      <WikiFloatingFeedback feedback={feedback} />

      <article className="relative z-0 flex-none px-5 py-8 pb-20 md:px-16 md:pb-24 lg:flex-1 lg:overflow-y-auto lg:py-16 lg:pb-24">
        <div className="sticky top-0 z-20 -mx-5 mb-8 border-b border-black/5 bg-[#fcfdfc]/92 px-5 py-4 backdrop-blur-xl md:-mx-16 md:mb-10 md:px-16 lg:mx-0 lg:rounded-[28px] lg:border lg:bg-white/92 lg:px-6 xl:px-8">
          <div className="mx-auto max-w-2xl">
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-[#546354]/18 bg-[#546354]/6 px-3 py-1.5 font-label text-[11px] font-semibold text-[#546354]">
                  公开档案
                </span>
                <span className="rounded-full border border-black/5 bg-[#f8faf8] px-3 py-1.5 font-label text-[11px] text-[#2f3334]/64">
                  第 {entry.versionNumber} 版
                </span>
                {entryUpdatedLabel && (
                  <span className="rounded-full border border-black/5 bg-[#f8faf8] px-3 py-1.5 font-body text-[12px] text-[#2f3334]/56">
                    更新于 {entryUpdatedLabel}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={onBack} aria-label="返回矩阵" title="返回矩阵" className={detailActionButtonClassName}>
                  <WikiIcon name="west" className="text-[16px]" />
                  <span className="hidden sm:inline">返回</span>
                </button>
                <button type="button" onClick={() => onEdit(entry)} aria-label="编辑瓜条" title="编辑瓜条" className={detailActionButtonClassName}>
                  <WikiIcon name="edit" className="text-[16px]" />
                  <span className="hidden sm:inline">编辑</span>
                </button>
                <button type="button" onClick={onSearchCurrentEntry} aria-label="搜索瓜条" title="搜索瓜条" className={detailActionButtonClassName}>
                  <WikiIcon name="search" className="text-[16px]" />
                  <span className="hidden sm:inline">搜索</span>
                </button>
                <button type="button" onClick={handleShare} aria-label="分享瓜条" title="分享瓜条" className={detailActionButtonClassName}>
                  <WikiIcon name="ios_share" className="text-[16px]" />
                  <span className="hidden sm:inline">分享</span>
                </button>
                <button type="button" onClick={handleSaveImage} aria-label="保存瓜条图片" title="保存瓜条图片" className={primaryActionButtonClassName}>
                  <WikiIcon name="download" className="text-[16px]" />
                  <span className="hidden sm:inline">保存</span>
                </button>
              </div>
            </div>
          </div>
        </div>
        <div className="pointer-events-none absolute -top-8 right-0 select-none opacity-[0.02]">
          <span className="font-serif text-[16rem] leading-none md:text-[22rem]">{decorativeChar}</span>
        </div>

        <WikiEntryNarrativeCard entry={entry} />
      </article>

      {exportEntry ? <WikiEntryExportCard ref={exportCardRef} entry={exportEntry} /> : null}

      {/* 右侧版本信息 */}
      <aside className="z-10 w-full shrink-0 border-t border-black/5 bg-[#fcfdfc] p-5 pb-28 shadow-[-20px_0_40px_rgba(0,0,0,0.02)] md:p-8 md:pb-32 lg:w-[320px] lg:overflow-y-auto lg:border-l lg:border-t-0 lg:pb-12 xl:w-[400px] xl:p-12 xl:pb-16">
        <div className="hidden justify-end gap-3">
          <button onClick={() => onEdit(entry)} className="group flex h-11 w-11 items-center justify-center rounded-xl border border-black/5 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:border-[#546354]/50 hover:bg-[#f9faf9] hover:shadow-md">
            <WikiIcon name="edit" className="text-[18px] text-[#2f3334] group-hover:text-[#546354]" />
          </button>
          <button onClick={onBack} className="group flex h-11 w-11 items-center justify-center rounded-xl border border-transparent bg-black/[0.03] shadow-sm transition-all hover:-translate-y-0.5 hover:bg-[#2f3334] hover:shadow-md">
            <WikiIcon name="close" className="text-[18px] text-[#2f3334] group-hover:text-white" />
          </button>
        </div>
        <div className="hidden border-b border-black/5 pb-8">
          <div className="grid grid-cols-1 gap-3">
            <button onClick={() => onEdit(entry)} className="flex items-center justify-center gap-1.5 rounded-xl bg-[#2f3334] py-3 font-label text-[10px] font-bold tracking-widest text-white shadow-sm hover:bg-[#546354] hover:-translate-y-0.5 transition-all">
              <WikiIcon name="edit" className="text-[15px]" /> 编辑
            </button>
          </div>
        </div>

        <div className="mb-12 rounded-[28px] border border-black/5 bg-white p-6 shadow-sm">
          <WikiIcon name="verified_user" className="mb-3 text-[24px] text-[#546354]" />
          <div className="font-label text-[11px] font-bold tracking-[0.14em] text-[#2f3334]/42">审核状态</div>
          <div className="mt-1 font-body text-sm font-medium text-[#2f3334]/80">档案委员会已通过</div>
          <div className="mt-4 space-y-3 border-t border-black/5 pt-4">
            <div className="flex items-center justify-between gap-4">
              <span className="font-label text-[11px] text-[#2f3334]/42">版本</span>
              <span className="font-mono text-sm font-bold text-[#2f3334]">第 {entry.versionNumber} 版</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="font-label text-[11px] text-[#2f3334]/42">发布</span>
              <span className="font-body text-sm text-[#2f3334]/68">{entryCreatedLabel || '暂无记录'}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="font-label text-[11px] text-[#2f3334]/42">更新</span>
              <span className="font-body text-sm text-[#2f3334]/68">{entryUpdatedLabel || '暂无记录'}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="font-label text-[11px] text-[#2f3334]/42">历史版本</span>
              <span className="font-body text-sm text-[#2f3334]/68">{history.length} 条</span>
            </div>
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
  const closeTimerRef = useRef<number | null>(null);
  const { feedback, showFeedback } = useWikiFeedback();

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const handleClose = useCallback(() => {
    clearCloseTimer();
    onClose();
  }, [clearCloseTimer, onClose]);

  useEscapeToClose(open, handleClose);

  useEffect(() => {
    clearCloseTimer();
    if (!open) {
      return;
    }
    setName(entry?.name || '');
    setNarrative(entry?.narrative || '');
    setTagInput((entry?.tags || []).join('，'));
    setEditSummary('');
    setMessage('');
    setSubmitting(false);
  }, [clearCloseTimer, entry, open]);

  useEffect(() => () => {
    clearCloseTimer();
  }, [clearCloseTimer]);

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
    if (trimmedNarrative.length > WIKI_NARRATIVE_MAX_LENGTH) {
      setMessage(`记录叙述不能超过 ${WIKI_NARRATIVE_MAX_LENGTH} 个字符。`);
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
      clearCloseTimer();
      closeTimerRef.current = window.setTimeout(() => {
        closeTimerRef.current = null;
        onClose();
      }, 900);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '提交失败，请稍后再试。');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div data-wiki-overlay-modal="true" className="fixed inset-0 z-[80] flex items-center justify-center p-4 md:p-6">
      <WikiFloatingFeedback feedback={feedback} />
      <button type="button" aria-label="关闭弹窗" className="fixed inset-0 bg-on-surface/5 backdrop-blur-sm" onClick={handleClose} />
      <form
        onSubmit={handleSubmit}
        className="relative z-10 flex max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-surface-container-lowest shadow-[0px_4px_20px_rgba(47,51,52,0.06)] md:max-h-[calc(100vh-3rem)]"
      >
        <header className="flex shrink-0 items-center justify-between bg-surface-container-lowest/80 px-5 py-5 backdrop-blur-md md:px-8 md:py-6">
          <div className="space-y-1">
            <h1 className="font-headline text-xl font-bold text-on-surface">{mode === 'edit' ? '编辑瓜条' : '提交瓜条'}</h1>
            <p className="font-body text-xs text-on-surface-variant opacity-60">提交后进入后台审核</p>
          </div>
          <button type="button" onClick={handleClose} className="text-on-surface-variant transition-colors duration-300 hover:text-primary">
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
          <div className="block">
            <span className="mb-2 block font-label text-[10px] font-semibold uppercase text-on-surface-variant">记录叙述</span>
            <WikiMarkdownComposer
              value={narrative}
              onChange={setNarrative}
              placeholder="客观中立的描述该词条..."
              maxLength={WIKI_NARRATIVE_MAX_LENGTH}
              minHeight="260px"
              ariaLabel={mode === 'edit' ? '编辑瓜条 Markdown 编辑器' : '新增瓜条 Markdown 编辑器'}
              toolbarLabel="记录叙述"
              emptyPreviewText="预览区为空，请先填写记录叙述。"
              renderClassName="font-body text-[15px] leading-loose text-[#2f3334]/80 [&_p]:mb-5 [&_blockquote]:my-5 [&_ol]:my-5 [&_ul]:my-5 [&_pre]:my-5"
              theme="wiki"
            />
          </div>
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
          <button type="button" onClick={handleClose} className="font-label text-sm text-on-surface-variant transition-colors duration-300 hover:text-on-surface">
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

  const rules = [
    {
      icon: 'fact_check',
      title: '写可核对的信息',
      description: '优先写时间、人物、版本和公开线索。',
    },
    {
      icon: 'visibility',
      title: '保持中性',
      description: '不攻击，不吹捧，也不揣测。',
    },
    {
      icon: 'history_edu',
      title: '按线索整理',
      description: '按来龙去脉组织内容，方便后续查阅。',
    },
  ];

  return (
    <div data-wiki-overlay-modal="true" className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-6">
      <button
        type="button"
        aria-label="关闭提示"
        className="wiki-modal-backdrop-enter fixed inset-0 bg-[#eef2ec]/72"
        onClick={onCancel}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="wiki-neutral-notice-title"
        aria-describedby="wiki-neutral-notice-description"
        className="wiki-modal-panel-enter relative z-10 flex max-h-[min(86vh,52rem)] w-full max-w-2xl flex-col overflow-hidden rounded-t-[30px] border border-[#546354]/12 bg-[#fcfdf9] shadow-[0px_34px_90px_rgba(47,51,52,0.16)] sm:rounded-[30px]"
      >
        <div className="absolute inset-x-0 top-0 h-px bg-white/85" />
        <div className="border-b border-black/5 bg-[radial-gradient(circle_at_top_right,rgba(84,99,84,0.14),transparent_42%),linear-gradient(180deg,rgba(255,255,255,0.96),rgba(247,249,246,0.92))] px-6 py-6 sm:px-8 sm:py-8">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[#546354]/12 bg-white/88 text-[#546354] shadow-sm">
              <WikiIcon name="balance" className="text-[22px]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-label text-[10px] font-bold tracking-[0.24em] text-[#546354]/62">
                编审提醒
              </p>
              <h2 id="wiki-neutral-notice-title" className="mt-2 font-headline text-[26px] font-bold leading-tight text-[#2f3334] sm:text-[30px]">
                新建前请确认
              </h2>
              <p id="wiki-neutral-notice-description" className="mt-3 max-w-[34rem] font-body text-sm leading-7 text-[#2f3334]/66">
                请按客观、中性的方式整理信息。
              </p>
            </div>
            <button
              type="button"
              onClick={onCancel}
              aria-label="关闭提示"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-black/5 bg-white/84 text-[#2f3334]/54 shadow-sm transition-all hover:-translate-y-0.5 hover:border-[#546354]/26 hover:text-[#2f3334]"
            >
              <WikiIcon name="close" className="text-[20px]" />
            </button>
          </div>
        </div>

        <div className="space-y-3 overflow-y-auto px-6 py-6 sm:px-8">
          {rules.map((rule, index) => (
            <div
              key={rule.title}
              className="rounded-[22px] border border-black/5 bg-white/82 px-4 py-4 shadow-[0px_12px_30px_rgba(47,51,52,0.05)]"
            >
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#f1f5ef] font-label text-[12px] font-bold text-[#546354]">
                  0{index + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[#546354]">
                    <WikiIcon name={rule.icon} className="text-[18px]" />
                    <h3 className="font-label text-[12px] font-bold tracking-[0.08em] text-[#2f3334]">
                      {rule.title}
                    </h3>
                  </div>
                  <p className="mt-2 font-body text-sm leading-6 text-[#2f3334]/66">
                    {rule.description}
                  </p>
                </div>
              </div>
            </div>
          ))}

        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-black/5 bg-white/78 px-6 py-5 sm:flex-row sm:items-center sm:justify-end sm:px-8">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-11 items-center justify-center rounded-full border border-black/6 bg-white px-5 font-label text-[12px] font-semibold text-[#2f3334]/68 transition-all hover:-translate-y-0.5 hover:border-[#546354]/24 hover:text-[#2f3334]"
          >
            返回
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-[#2f3334] px-5 font-label text-[12px] font-semibold text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-[#546354]"
          >
            <span>继续新建</span>
            <WikiIcon name="east" className="text-[18px]" />
          </button>
        </div>
      </div>
    </div>
  );
};

const WikiView: React.FC = () => {
  const { state } = useApp();
  const initialListState = useMemo(() => getWikiListStateFromHref(window.location.href), []);
  const [path, setPath] = useState(window.location.pathname);
  const [entries, setEntries] = useState<WikiEntry[]>([]);
  const [tags, setTags] = useState<Array<{ name: string; count: number }>>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(initialListState.page);
  const [query, setQuery] = useState(initialListState.query);
  const [activeTag, setActiveTag] = useState(initialListState.tag);
  const [sortBy, setSortBy] = useState<WikiEntrySort>(initialListState.sortBy);
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
  const listUrl = useMemo(() => createWikiListUrl({ query, tag: activeTag, sortBy, page }), [activeTag, page, query, sortBy]);

  const syncListStateFromHref = useCallback((href: string) => {
    const nextState = getWikiListStateFromHref(href);
    setQuery(nextState.query);
    setActiveTag(nextState.tag);
    setSortBy(nextState.sortBy);
    setPage(nextState.page);
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      const nextPath = window.location.pathname;
      setPath(nextPath);
      if (!getSlugFromPath(nextPath)) {
        syncListStateFromHref(window.location.href);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [syncListStateFromHref]);

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
    const url = new URL(targetPath, window.location.origin);
    const nextUrl = `${url.pathname}${url.search}`;
    const currentUrl = `${window.location.pathname}${window.location.search}`;
    if (currentUrl !== nextUrl) {
      window.history.pushState({}, '', nextUrl);
    }
    setPath(url.pathname);
    if (!getSlugFromPath(url.pathname)) {
      syncListStateFromHref(url.toString());
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [syncListStateFromHref]);

  useEffect(() => {
    if (isDetail) {
      return;
    }
    const currentUrl = `${window.location.pathname}${window.location.search}`;
    if (currentUrl !== listUrl) {
      window.history.replaceState(window.history.state, '', listUrl);
    }
  }, [isDetail, listUrl]);

  useEffect(() => {
    if (!detailActive) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) {
        return;
      }

      if (document.querySelector(WIKI_OVERLAY_MODAL_SELECTOR)) {
        return;
      }

      event.preventDefault();
      navigateTo(listUrl);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [detailActive, listUrl, navigateTo]);

  const loadEntries = useCallback(async () => {
    const requestId = listRequestRef.current + 1;
    listRequestRef.current = requestId;
    const shouldAppend = isMobileFeed && page > 1;
    const requestedPage = page;

    setListLoading(true);
    try {
      const data: WikiListResponse = await api.getWikiEntries({
        q: query,
        tag: activeTag,
        sort: sortBy,
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

      if (shouldAppend) {
        setPage((prev) => (prev === requestedPage ? Math.max(requestedPage - 1, 1) : prev));
      } else {
        setEntries([]);
        setTags([]);
        setTotal(0);
      }
    } finally {
      if (requestId === listRequestRef.current) {
        setListLoading(false);
      }
    }
  }, [activeTag, isMobileFeed, page, query, sortBy]);

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

  const clearListFilters = useCallback(() => {
    setQuery('');
    setActiveTag('');
    setSortBy('updated');
    setPage(1);
  }, []);

  return (
    <WikiShell
      tags={tags}
      activeTag={activeTag}
      onTagChange={(val) => { setActiveTag(val); setPage(1); }}
      onOpenSubmit={openCreate}
      onNavigateHome={() => navigateTo(listUrl)}
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
        sortBy={sortBy}
        query={query}
        activeTag={activeTag}
        onPageChange={setPage}
        onSortChange={(value) => {
          setSortBy(value);
          setPage(1);
        }}
        onClearFilters={clearListFilters}
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
          className={`absolute inset-y-0 right-0 w-full overflow-hidden bg-[#fcfdfc] transition-[transform,opacity,box-shadow,border-color] motion-reduce:transition-none lg:border-l ${detailVisible ? 'translate-x-0 border-black/5 opacity-100 shadow-[-30px_0_40px_rgba(47,51,52,0.08)]' : 'translate-x-full border-transparent opacity-0 shadow-none'}`}
          style={{
            transitionDuration: `${detailVisible ? WIKI_DETAIL_ENTER_MS : WIKI_DETAIL_EXIT_MS}ms`,
            transitionTimingFunction: detailVisible ? 'cubic-bezier(0.0, 0, 0.2, 1)' : 'cubic-bezier(0.4, 0, 1, 1)',
          }}
        >
          <div
            className={`absolute inset-y-0 right-0 w-full min-w-0 transition-[opacity,transform,filter] motion-reduce:transition-none ${detailVisible ? 'translate-x-0 opacity-100 delay-[60ms] duration-180 ease-out blur-0' : 'translate-x-3 opacity-0 delay-0 duration-120 ease-in blur-[2px]'}`}
          >
            {detailActive && (
              <WikiEntryDetail
                entry={detailEntry}
                history={history}
                loading={detailLoading}
                error={detailError}
                onBack={() => navigateTo(listUrl)}
                onEdit={openEdit}
                onSearchCurrentEntry={handleSearchCurrentEntry}
              />
            )}
          </div>
        </div>
      </div>

      {/* 移动端点击遮罩返回画廊 */}
      <div
        className={`fixed inset-0 z-[55] bg-[#2f3334]/12 backdrop-blur-[2px] transition-opacity motion-reduce:transition-none lg:hidden ${detailActive ? 'pointer-events-auto' : 'pointer-events-none'} ${detailVisible ? 'opacity-100' : 'opacity-0'}`}
        style={{
          transitionDuration: `${detailVisible ? WIKI_DETAIL_ENTER_MS : WIKI_DETAIL_EXIT_MS}ms`,
          transitionTimingFunction: detailVisible ? 'cubic-bezier(0.0, 0, 0.2, 1)' : 'cubic-bezier(0.4, 0, 1, 1)',
        }}
        onClick={() => navigateTo(listUrl)}
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
