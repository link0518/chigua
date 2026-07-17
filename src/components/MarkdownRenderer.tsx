import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import createDOMPurify from 'dompurify';
import { marked } from 'marked';
import { PhotoSlider } from 'react-photo-view';

import { DEFAULT_MEME_PACK, MEME_KEY_TO_FILE } from './memeManifest';
import { acquireModalScrollLock } from './modalScrollLock';
import { requestOverlayHistoryBack } from './overlayHistory';

interface MarkdownRendererProps {
  content: string;
  className?: string;
  enableImageViewer?: boolean;
  historyOverlayKey?: string;
  historyCommentPostId?: string;
}

type ViewerImage = {
  key: string;
  src: string;
};

type ViewerHistoryState = Record<string, unknown> & {
  homeOverlay?: 'comments' | 'comment-composer';
  homeCommentPostId?: string;
  homeSecondaryOverlay?: 'comment-report' | 'comment-meme' | 'markdown-image';
  homeSecondaryOverlayId?: string;
  homeSecondaryOverlayIndex?: number;
};

const readViewerHistoryState = (): ViewerHistoryState => (
  window.history.state && typeof window.history.state === 'object'
    ? window.history.state as ViewerHistoryState
    : {}
);

type ViewerHistoryListener = (state: ViewerHistoryState) => void;

const viewerHistoryListeners = new Map<string, Set<ViewerHistoryListener>>();
let activeViewerHistoryId: string | null = null;
let viewerHistoryPopStateAttached = false;

const handleViewerHistoryPopState = () => {
  const currentState = readViewerHistoryState();
  const nextViewerHistoryId = currentState.homeSecondaryOverlay === 'markdown-image'
    ? String(currentState.homeSecondaryOverlayId || '') || null
    : null;
  const affectedViewerIds = new Set(
    [activeViewerHistoryId, nextViewerHistoryId].filter((value): value is string => Boolean(value))
  );
  activeViewerHistoryId = nextViewerHistoryId;
  affectedViewerIds.forEach((viewerId) => {
    viewerHistoryListeners.get(viewerId)?.forEach((listener) => listener(currentState));
  });
};

const subscribeViewerHistory = (viewerId: string, listener: ViewerHistoryListener) => {
  const listeners = viewerHistoryListeners.get(viewerId) || new Set<ViewerHistoryListener>();
  listeners.add(listener);
  viewerHistoryListeners.set(viewerId, listeners);

  if (!viewerHistoryPopStateAttached) {
    window.addEventListener('popstate', handleViewerHistoryPopState);
    viewerHistoryPopStateAttached = true;
  }

  return () => {
    const currentListeners = viewerHistoryListeners.get(viewerId);
    currentListeners?.delete(listener);
    if (currentListeners?.size === 0) {
      viewerHistoryListeners.delete(viewerId);
    }
    if (viewerHistoryListeners.size === 0 && viewerHistoryPopStateAttached) {
      window.removeEventListener('popstate', handleViewerHistoryPopState);
      viewerHistoryPopStateAttached = false;
      activeViewerHistoryId = null;
    }
  };
};

const markViewerHistoryActive = (viewerId: string) => {
  activeViewerHistoryId = viewerId;
};

const VIEWER_FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const canRestoreViewerFocus = (element: HTMLElement | null | undefined) => {
  if (!element?.isConnected || element.closest('[inert]')) {
    return false;
  }
  if ('disabled' in element && Boolean((element as HTMLButtonElement).disabled)) {
    return false;
  }
  const style = getComputedStyle(element);
  return element.getClientRects().length > 0
    && style.display !== 'none'
    && style.visibility !== 'hidden';
};

const deferViewerPostUnmountCleanup = (callback: () => void) => {
  // react-photo-view 在 passive effect 中恢复焦点与 body overflow；跨两个任务确保我们的最终收口最后执行。
  window.setTimeout(() => {
    window.setTimeout(callback, 0);
  }, 0);
};

const escapeHtml = (value: unknown) => {
  const text = typeof value === 'string' ? value : value == null ? '' : String(value);
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const parseInlineMarkdown = (value: string) => marked.parseInline(value, { gfm: true, breaks: true });

const createRenderer = () => {
  const renderer = new marked.Renderer();

  renderer.heading = function (token) {
    const safeLevel = Math.min(Math.max(token.depth || 1, 1), 3);
    const sizeClass = safeLevel === 1 ? 'text-2xl' : safeLevel === 2 ? 'text-xl' : 'text-lg';
    const text = token.tokens ? this.parser.parseInline(token.tokens) : parseInlineMarkdown(token.text || '');
    return `<h${safeLevel} class="font-display ${sizeClass} text-ink mt-3 mb-1">${text}</h${safeLevel}>`;
  };

  renderer.blockquote = function (token) {
    const content = token.tokens ? this.parser.parse(token.tokens) : '';
    return `<blockquote class="border-l-4 border-gray-300 pl-3 my-2 text-pencil italic">${content}</blockquote>`;
  };

  renderer.list = function (token) {
    const ordered = Boolean(token.ordered);
    const start = typeof token.start === 'number' ? token.start : 1;
    let body = '';
    for (const item of token.items || []) {
      body += this.listitem(item);
    }
    const tag = ordered ? 'ol' : 'ul';
    const startAttr = ordered && start !== 1 ? ` start="${start}"` : '';
    return `<${tag}${startAttr} class="ml-5 ${ordered ? 'list-decimal' : 'list-disc'}">${body}</${tag}>`;
  };

  renderer.listitem = function (token) {
    const content = token.tokens ? this.parser.parse(token.tokens) : parseInlineMarkdown(token.text || '');
    return `<li class="my-1">${content}</li>`;
  };

  renderer.codespan = function (token) {
    return `<code class="bg-gray-100 px-1.5 py-0.5 rounded text-sm font-mono border border-gray-200">${escapeHtml(token.text)}</code>`;
  };

  renderer.code = function (token) {
    return `<pre class="bg-gray-100 border border-gray-200 rounded p-3 overflow-x-auto"><code class="font-mono text-sm">${escapeHtml(token.text)}</code></pre>`;
  };

  renderer.link = function (token) {
    const href = token.href || '';
    const safeHref = escapeHtml(href);
    const safeTitle = token.title ? escapeHtml(token.title) : '';
    const safeText = token.tokens ? this.parser.parseInline(token.tokens) : escapeHtml(token.text);
    const titleAttr = safeTitle ? ` title="${safeTitle}"` : '';
    return `<a href="${safeHref}"${titleAttr} target="_blank" rel="noopener noreferrer" class="text-blue-600 underline hover:text-blue-800">${safeText}</a>`;
  };

  renderer.paragraph = function (token) {
    const text = token.tokens ? this.parser.parseInline(token.tokens) : parseInlineMarkdown(token.text || '');
    return `<p class="my-2">${text}</p>`;
  };

  renderer.strong = function (token) {
    return `<strong>${token.tokens ? this.parser.parseInline(token.tokens) : parseInlineMarkdown(token.text || '')}</strong>`;
  };

  renderer.em = function (token) {
    return `<em>${token.tokens ? this.parser.parseInline(token.tokens) : parseInlineMarkdown(token.text || '')}</em>`;
  };

  renderer.del = function (token) {
    return `<del>${token.tokens ? this.parser.parseInline(token.tokens) : parseInlineMarkdown(token.text || '')}</del>`;
  };

  renderer.image = function (token) {
    const href = token.href || '';
    const normalizedHref = normalizeImageUrl(href);
    if (!normalizedHref || !isAllowedImageUrl(normalizedHref)) {
      return '';
    }
    const safeHref = escapeHtml(normalizedHref);
    const altText = escapeHtml(token.text || '');
    const titleAttr = token.title ? ` title="${escapeHtml(token.title)}"` : '';
    if (isAllowedMemePath(normalizedHref)) {
      return `<img src="${safeHref}" alt="${altText}"${titleAttr} class="meme-image inline-block ml-1 w-[22px] h-[22px] object-contain align-text-bottom" loading="lazy" decoding="async" />`;
    }
    return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer" class="markdown-image-link inline-block">
    <img src="${safeHref}" alt="${altText}"${titleAttr} class="markdown-image max-w-full max-h-[420px] w-auto h-auto object-contain rounded-md border border-gray-200 cursor-zoom-in bg-white" loading="lazy" decoding="async" />
  </a>`;
  };

  return renderer;
};

const ALLOWED_TAGS = [
  'a',
  'img',
  'p',
  'br',
  'strong',
  'em',
  'del',
  'code',
  'pre',
  'blockquote',
  'ul',
  'ol',
  'li',
  'hr',
  'h1',
  'h2',
  'h3',
];

const ALLOWED_ATTR = [
  'href',
  'title',
  'target',
  'rel',
  'class',
  'src',
  'alt',
  // 图片加载策略必须进入白名单，否则 DOMPurify 会静默移除生成的属性。
  'loading',
  'decoding',
];

const IMAGE_HOSTS = new Set(['img.zsix.de', 'ibed.933211.xyz']);
let cachedPurifier: ReturnType<typeof createDOMPurify> | null = null;
let purifierReady = false;

const isAllowedMemePath = (value: string) => {
  const raw = String(value || '').trim();
  if (!raw) return false;

  const normalized = raw.startsWith('/meme/')
    ? raw
    : raw.startsWith('meme/')
      ? `/${raw}`
      : '';

  if (!normalized) {
    return false;
  }
  if (normalized.includes('..')) {
    return false;
  }

  const pathname = normalized.split('?')[0]?.split('#')[0] || '';
  // 至少包含 /meme/<pack>/<file>
  if (!/^\/meme\/[^/]+\/[^/]+/i.test(pathname)) {
    return false;
  }
  return /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(pathname);
};

const normalizeImageUrl = (value: string) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return '';
  }
  if (isAllowedMemePath(trimmed)) {
    return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  try {
    const url = new URL(`https://${trimmed}`);
    if (!IMAGE_HOSTS.has(url.hostname)) {
      return '';
    }
    return url.toString();
  } catch {
    return '';
  }
};

const isAllowedImageSrc = (value: string) => {
  if (isAllowedMemePath(value)) {
    return true;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return false;
    }
    return IMAGE_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
};

const isAllowedImageUrl = (value: string) => {
  if (!value) return false;
  if (isAllowedMemePath(value)) {
    return true;
  }
  try {
    const normalized = normalizeImageUrl(value);
    if (!normalized) {
      return false;
    }
    if (isAllowedMemePath(normalized)) {
      return true;
    }
    const url = new URL(normalized);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return false;
    }
    if (!IMAGE_HOSTS.has(url.hostname)) {
      return false;
    }
    return /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(url.pathname);
  } catch {
    return false;
  }
};

const transformInlineTokens = (tokens: any[], inBlockquote: boolean): any[] => {
  return tokens.map((token) => {
    if (!token) {
      return token;
    }
    if (!inBlockquote && token.type === 'link') {
      const normalizedHref = normalizeImageUrl(token.href || '');
      if (normalizedHref && isAllowedImageUrl(normalizedHref)) {
        return {
          type: 'image',
          href: normalizedHref,
          title: token.title || null,
          text: token.text || '',
        };
      }
    }
    if (!inBlockquote && token.type === 'text') {
      const normalizedText = normalizeImageUrl(token.text || '');
      if (normalizedText && isAllowedImageUrl(normalizedText)) {
        return {
          type: 'image',
          href: normalizedText,
          title: null,
          text: '',
        };
      }
    }
    if (token.tokens && Array.isArray(token.tokens)) {
      token.tokens = transformInlineTokens(token.tokens, inBlockquote);
    }
    return token;
  });
};

const transformTokens = (tokens: any[], inBlockquote: boolean): any[] => {
  const result: any[] = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token) continue;

    if (token.type === 'paragraph') {
      if (token.tokens && Array.isArray(token.tokens)) {
        token.tokens = transformInlineTokens(token.tokens, inBlockquote);
      }
      result.push(token);
      continue;
    }

    if (token.type === 'list' && token.items) {
      token.items = token.items.map((item: any) => {
        if (item.tokens) {
          item.tokens = transformTokens(item.tokens, inBlockquote);
        }
        return item;
      });
      result.push(token);
      continue;
    }

    if (token.type === 'table') {
      if (Array.isArray(token.header)) {
        token.header = token.header.map((cell: any) => {
          if (cell.tokens) {
            cell.tokens = transformInlineTokens(cell.tokens, inBlockquote);
          }
          return cell;
        });
      }
      if (Array.isArray(token.rows)) {
        token.rows = token.rows.map((row: any[]) =>
          row.map((cell: any) => {
            if (cell.tokens) {
              cell.tokens = transformInlineTokens(cell.tokens, inBlockquote);
            }
            return cell;
          })
        );
      }
      result.push(token);
      continue;
    }

    if (token.type === 'blockquote' && token.tokens) {
      token.tokens = transformTokens(token.tokens, true);
      result.push(token);
      continue;
    }

    if (token.tokens && Array.isArray(token.tokens)) {
      token.tokens = transformTokens(token.tokens, inBlockquote);
    }
    result.push(token);
  }

  return result;
};

const getSanitizer = () => {
  if (typeof window === 'undefined') {
    return null;
  }
  if (!cachedPurifier) {
    cachedPurifier = createDOMPurify(window);
  }
  if (!purifierReady && cachedPurifier) {
    cachedPurifier.setConfig({
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      // 自定义 URI 规则会作用于所有非安全属性；这两个枚举属性不应按 URL 校验。
      ADD_URI_SAFE_ATTR: ['loading', 'decoding'],
      ALLOW_DATA_ATTR: false,
      // 允许站内根路径资源（例如 /meme/Default/...），但不允许 //example.com 这种 scheme-relative。
      ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|\/(?!\/))/i,
    });
    cachedPurifier.addHook('uponSanitizeAttribute', (node, data) => {
      if (node.nodeName === 'IMG' && data.attrName === 'src') {
        if (!isAllowedImageSrc(data.attrValue)) {
          data.keepAttr = false;
        }
      }
    });
    purifierReady = true;
  }
  return cachedPurifier;
};

const encodePathSegment = (value: string) => encodeURIComponent(value).replace(/%2F/g, '/');

const expandMemeShortcodes = (content: string) => {
  const input = String(content || '');
  if (!input) return '';

  // 支持短码：
  // - 默认包：[:微笑:]
  // - 指定包：[:萌鸡/b害羞:]
  return input.replace(/\[:([^\]\n]{1,80}):\]/g, (match, innerRaw) => {
    const inner = String(innerRaw || '').trim();
    if (!inner) return match;

    let packName: string = DEFAULT_MEME_PACK;
    let label = inner;
    if (inner.includes('/')) {
      const parts = inner.split('/');
      packName = String(parts.shift() || '').trim();
      label = parts.join('/').trim();
      if (!packName || !label) {
        return match;
      }
    }

    const key = `${packName}/${label}`;
    const file = MEME_KEY_TO_FILE.get(key);
    if (!file) {
      return match;
    }

    const url = `/meme/${encodePathSegment(packName)}/${encodePathSegment(file)}`;
    return `![](${url})`;
  });
};

const viewerLoadingElement = (
  <div className="markdown-photo-viewer-state" role="status" aria-live="polite">
    <div className="markdown-photo-viewer-spinner" aria-hidden="true" />
    <p className="markdown-photo-viewer-title">图片加载中</p>
    <p className="markdown-photo-viewer-text">稍等一下，马上就好。</p>
  </div>
);

const renderViewerBrokenElement = () => (
  <div className="markdown-photo-viewer-state markdown-photo-viewer-state-broken" role="status" aria-live="polite">
    <div className="markdown-photo-viewer-badge" aria-hidden="true">!</div>
    <p className="markdown-photo-viewer-title">图片加载失败</p>
    <p className="markdown-photo-viewer-text">这张图暂时没能打开，可以稍后再试。</p>
  </div>
);

// Markdown 仍然通过 innerHTML 输出，这里在渲染完成后回收当前块内的图片，
// 让每个渲染实例只管理自己的图片分组，不串到别的帖子或评论上。
const collectViewerImages = (root: HTMLDivElement | null) => {
  if (!root) {
    return { images: [] as ViewerImage[], anchors: [] as HTMLAnchorElement[] };
  }

  const anchors = Array.from(root.querySelectorAll<HTMLAnchorElement>('a.markdown-image-link[href]'));
  const viewerAnchors: HTMLAnchorElement[] = [];
  const images: ViewerImage[] = [];

  anchors.forEach((anchor, index) => {
    const image = anchor.querySelector<HTMLImageElement>('img.markdown-image');
    if (!image || image.classList.contains('meme-image') || !anchor.href) {
      return;
    }

    viewerAnchors.push(anchor);
    images.push({
      key: `${index}-${anchor.href}`,
      src: anchor.href,
    });
  });

  return { images, anchors: viewerAnchors };
};

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  className = '',
  enableImageViewer = false,
  historyOverlayKey,
  historyCommentPostId,
}) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const generatedViewerHistoryId = useId();
  const viewerHistoryId = historyOverlayKey || generatedViewerHistoryId;
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [viewerImages, setViewerImages] = useState<ViewerImage[]>([]);
  const viewerDialogRef = useRef<HTMLDivElement | null>(null);
  const viewerCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const viewerTriggerRef = useRef<HTMLElement | null>(null);
  const isOwnedViewerHistory = useCallback((state: ViewerHistoryState) => (
    state.homeSecondaryOverlay === 'markdown-image'
    && state.homeSecondaryOverlayId === viewerHistoryId
  ), [viewerHistoryId]);
  const dismissOwnedViewerHistory = useCallback(() => {
    const currentState = readViewerHistoryState();
    if (!isOwnedViewerHistory(currentState)) {
      return false;
    }
    if (!requestOverlayHistoryBack()) {
      // 若另一个退栈正在进行，至少同步清掉当前幽灵层，避免页面被不可见 viewer 锁住。
      const nextState = { ...currentState };
      delete nextState.homeSecondaryOverlay;
      delete nextState.homeSecondaryOverlayId;
      delete nextState.homeSecondaryOverlayIndex;
      window.history.replaceState(nextState, '', window.location.pathname + window.location.search);
      if (activeViewerHistoryId === viewerHistoryId) {
        activeViewerHistoryId = null;
      }
    }
    return true;
  }, [isOwnedViewerHistory, viewerHistoryId]);

  const pushImageHistoryLayer = useCallback((imageIndex: number) => {
    let currentState = readViewerHistoryState();
    const currentPath = window.location.pathname + window.location.search;

    if (historyCommentPostId && !currentState.homeOverlay) {
      const searchParams = new URLSearchParams(window.location.search);
      const baseState = { ...currentState };
      delete baseState.homeOverlay;
      delete baseState.homeCommentPostId;
      delete baseState.homeSecondaryOverlay;
      delete baseState.homeSecondaryOverlayId;
      delete baseState.homeSecondaryOverlayIndex;
      const commentsState: ViewerHistoryState = {
        ...baseState,
        homeOverlay: 'comments',
        homeCommentPostId: historyCommentPostId,
      };

      if (searchParams.has('comment')) {
        searchParams.delete('comment');
        const nextSearch = searchParams.toString();
        const basePath = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}`;
        window.history.replaceState(baseState, '', basePath);
      }
      window.history.pushState(commentsState, '', currentPath);
      currentState = commentsState;
    }

    if (
      currentState.homeSecondaryOverlay === 'markdown-image'
      && currentState.homeSecondaryOverlayId === viewerHistoryId
    ) {
      markViewerHistoryActive(viewerHistoryId);
      window.history.replaceState({
        ...currentState,
        homeSecondaryOverlayIndex: imageIndex,
      }, '', currentPath);
      return;
    }

    markViewerHistoryActive(viewerHistoryId);
    window.history.pushState({
      ...currentState,
      homeSecondaryOverlay: 'markdown-image',
      homeSecondaryOverlayId: viewerHistoryId,
      homeSecondaryOverlayIndex: imageIndex,
    }, '', currentPath);
  }, [historyCommentPostId, viewerHistoryId]);

  const rendered = useMemo(() => {
    if (!content) return '';
    const normalizedContent = expandMemeShortcodes(content);
    const baseTokens: any = marked.lexer(normalizedContent, { gfm: true, breaks: true });
    const tokens = transformTokens(baseTokens, false) as any[] & { links?: Record<string, { href: string; title: string }> };
    if (baseTokens?.links) {
      tokens.links = baseTokens.links;
    }
    const rawHtml = marked.parser(tokens, { renderer: createRenderer(), gfm: true, breaks: true });
    const purifier = getSanitizer();
    if (!purifier) {
      return '';
    }
    return purifier.sanitize(rawHtml);
  }, [content]);

  useEffect(() => {
    if (!enableImageViewer) {
      dismissOwnedViewerHistory();
      setViewerImages([]);
      setViewerVisible(false);
      setViewerIndex(0);
      viewerTriggerRef.current = null;
      return;
    }

    const { images } = collectViewerImages(rootRef.current);
    setViewerImages(images);
    setViewerIndex((prev) => Math.min(prev, Math.max(images.length - 1, 0)));
    if (!images.length) {
      dismissOwnedViewerHistory();
      setViewerVisible(false);
      viewerTriggerRef.current = null;
    }
  }, [dismissOwnedViewerHistory, enableImageViewer, rendered]);

  useEffect(() => {
    if (!enableImageViewer) {
      return undefined;
    }
    const handleHistoryChange = (currentState: ViewerHistoryState) => {
      const belongsToThisViewer = (
        currentState.homeSecondaryOverlay !== 'markdown-image'
          ? false
          : currentState.homeSecondaryOverlayId === viewerHistoryId
      );
      if (belongsToThisViewer && viewerImages.length === 0) {
        dismissOwnedViewerHistory();
        setViewerVisible(false);
        return;
      }
      if (belongsToThisViewer && Number.isFinite(currentState.homeSecondaryOverlayIndex)) {
        const nextIndex = Math.max(0, Math.min(
          Number(currentState.homeSecondaryOverlayIndex),
          Math.max(viewerImages.length - 1, 0),
        ));
        setViewerIndex(nextIndex);
        const { anchors } = collectViewerImages(rootRef.current);
        viewerTriggerRef.current = anchors[nextIndex] || viewerTriggerRef.current;
      }
      setViewerVisible(belongsToThisViewer);
    };
    return subscribeViewerHistory(viewerHistoryId, handleHistoryChange);
  }, [dismissOwnedViewerHistory, enableImageViewer, viewerHistoryId, viewerImages.length]);

  useEffect(() => {
    if (!enableImageViewer || viewerImages.length === 0) {
      return;
    }
    const currentState = readViewerHistoryState();
    if (
      currentState.homeSecondaryOverlay !== 'markdown-image'
      || currentState.homeSecondaryOverlayId !== viewerHistoryId
    ) {
      return;
    }
    const nextIndex = Number.isFinite(currentState.homeSecondaryOverlayIndex)
      ? Math.max(0, Math.min(Number(currentState.homeSecondaryOverlayIndex), viewerImages.length - 1))
      : 0;
    const { anchors } = collectViewerImages(rootRef.current);
    viewerTriggerRef.current = anchors[nextIndex] || viewerTriggerRef.current;
    setViewerIndex(nextIndex);
    setViewerVisible(true);
    markViewerHistoryActive(viewerHistoryId);
  }, [enableImageViewer, viewerHistoryId, viewerImages.length]);

  const closeImageViewer = useCallback(() => {
    dismissOwnedViewerHistory();
    setViewerVisible(false);
  }, [dismissOwnedViewerHistory]);

  useEffect(() => {
    if (!enableImageViewer || !viewerVisible) {
      return undefined;
    }
    const mobileMedia = window.matchMedia('(max-width: 767px)');
    const ensureMobileHistoryLayer = () => {
      if (!mobileMedia.matches) {
        return;
      }
      pushImageHistoryLayer(viewerIndex);
    };
    ensureMobileHistoryLayer();
    mobileMedia.addEventListener('change', ensureMobileHistoryLayer);
    return () => mobileMedia.removeEventListener('change', ensureMobileHistoryLayer);
  }, [enableImageViewer, pushImageHistoryLayer, viewerIndex, viewerVisible]);

  useEffect(() => {
    if (!enableImageViewer || !viewerVisible) {
      return undefined;
    }

    const focusFrame = window.requestAnimationFrame(() => {
      const closeButton = viewerCloseButtonRef.current;
      const dialog = closeButton?.closest<HTMLElement>('[role="dialog"]')
        || document.querySelector<HTMLElement>('.markdown-photo-slider.PhotoView-Portal[role="dialog"]');
      if (!dialog) {
        return;
      }
      viewerDialogRef.current = dialog as HTMLDivElement;
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-label', '图片预览');
      dialog.tabIndex = -1;
      (closeButton || dialog).focus({ preventScroll: true });
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      const dialog = viewerDialogRef.current;
      if (!dialog) {
        return;
      }

      const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'))
        .filter((element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');
      if (dialogs[dialogs.length - 1] !== dialog) {
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        // 阻止事件继续冒泡到 react-photo-view 的 window 监听，避免同一次 Escape 重复退栈。
        event.stopPropagation();
        closeImageViewer();
        return;
      }
      if (event.key !== 'Tab') {
        return;
      }

      const focusableElements = [...dialog.querySelectorAll<HTMLElement>(VIEWER_FOCUSABLE_SELECTOR)]
        .filter((element) => element.getClientRects().length > 0);
      if (focusableElements.length === 0) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? lastElement : firstElement).focus({ preventScroll: true });
      } else if (document.activeElement === dialog) {
        event.preventDefault();
        (event.shiftKey ? lastElement : firstElement).focus({ preventScroll: true });
      } else if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus({ preventScroll: true });
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus({ preventScroll: true });
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleKeyDown);
      viewerDialogRef.current = null;
      const focusTarget = viewerTriggerRef.current;
      const focusHref = focusTarget instanceof HTMLAnchorElement ? focusTarget.href : '';
      deferViewerPostUnmountCleanup(() => {
        let nextFocusTarget = canRestoreViewerFocus(focusTarget) ? focusTarget : null;
        if (!nextFocusTarget && focusHref) {
          nextFocusTarget = Array.from(
            document.querySelectorAll<HTMLAnchorElement>('a.markdown-image-link[href]')
          ).find((anchor) => anchor.href === focusHref && canRestoreViewerFocus(anchor)) || null;
        }
        if (!nextFocusTarget) {
          const visibleDialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'))
            .filter((element) => (
              !element.classList.contains('markdown-photo-slider')
              && element.getClientRects().length > 0
              && getComputedStyle(element).visibility !== 'hidden'
            ));
          const parentDialog = visibleDialogs[visibleDialogs.length - 1] || null;
          nextFocusTarget = parentDialog?.querySelector<HTMLElement>(VIEWER_FOCUSABLE_SELECTOR)
            || parentDialog;
        }
        if (canRestoreViewerFocus(nextFocusTarget)) {
          nextFocusTarget?.focus({ preventScroll: true });
        }
      });
    };
  }, [closeImageViewer, enableImageViewer, viewerVisible]);

  useLayoutEffect(() => {
    if (!enableImageViewer || !viewerVisible) {
      return undefined;
    }
    // 在 react-photo-view 的 passive effect 写 overflow 前先保存页面状态。
    const releaseScrollLock = acquireModalScrollLock();
    return () => {
      // 等库自身清理完成后再做最终恢复，避免跨断点卸载后遗留 overflow:hidden。
      deferViewerPostUnmountCleanup(releaseScrollLock);
    };
  }, [enableImageViewer, viewerVisible]);

  const openImageViewer = (imageIndex: number, images: ViewerImage[]) => {
    setViewerImages(images);
    setViewerIndex(imageIndex);
    setViewerVisible(true);

    if (!window.matchMedia('(max-width: 767px)').matches) {
      return;
    }
    pushImageHistoryLayer(imageIndex);
  };

  const handleViewerIndexChange = (nextIndex: number) => {
    setViewerIndex(nextIndex);
    const currentState = readViewerHistoryState();
    if (
      currentState.homeSecondaryOverlay === 'markdown-image'
      && currentState.homeSecondaryOverlayId === viewerHistoryId
    ) {
      window.history.replaceState({
        ...currentState,
        homeSecondaryOverlayIndex: nextIndex,
      }, '', window.location.pathname + window.location.search);
    }
  };

  const handleLinkClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.button !== 0) {
      return;
    }
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    const target = event.target as HTMLElement | null;
    const anchor = target?.closest?.('a') as HTMLAnchorElement | null;
    if (!anchor || !anchor.href) {
      return;
    }

    if (enableImageViewer && anchor.classList.contains('markdown-image-link')) {
      const { images, anchors } = collectViewerImages(rootRef.current);
      const imageIndex = anchors.indexOf(anchor);
      if (imageIndex >= 0 && images.length > 0) {
        event.preventDefault();
        viewerTriggerRef.current = anchor;
        openImageViewer(imageIndex, images);
        return;
      }
    }

    event.preventDefault();
    window.open(anchor.href, '_blank', 'noopener,noreferrer');
  };

  return (
    <>
      <div
        ref={rootRef}
        className={`markdown-content min-w-0 max-w-full leading-relaxed ${enableImageViewer ? 'markdown-content--image-viewer' : ''} ${className}`}
        dangerouslySetInnerHTML={{ __html: rendered }}
        onClick={handleLinkClick}
      />
      {enableImageViewer && viewerVisible && viewerImages.length > 0 ? (
        <PhotoSlider
          images={viewerImages}
          visible
          index={viewerIndex}
          onIndexChange={handleViewerIndexChange}
          onClose={closeImageViewer}
          loop={false}
          maskClosable
          pullClosable
          bannerVisible
          maskOpacity={0.94}
          speed={(type) => (type === 3 ? 520 : 280)}
          easing={() => 'cubic-bezier(0.22, 1, 0.36, 1)'}
          className="markdown-photo-slider"
          maskClassName="markdown-photo-slider-mask"
          photoWrapClassName="markdown-photo-slider-wrap"
          photoClassName="markdown-photo-slider-photo"
          toolbarRender={({ onClose }) => (
            <button
              ref={viewerCloseButtonRef}
              type="button"
              onClick={(event) => onClose(event)}
              aria-label="关闭图片预览"
              className="markdown-photo-slider-close inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/30 bg-black/55 text-white shadow-lg backdrop-blur-md transition-colors hover:bg-black/75 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
          loadingElement={viewerLoadingElement}
          brokenElement={renderViewerBrokenElement}
        />
      ) : null}
    </>
  );
};

export default MarkdownRenderer;
