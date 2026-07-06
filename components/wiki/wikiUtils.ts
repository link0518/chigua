import type { WikiEntry, WikiEntrySort, WikiRevision } from '../../types';
import type { WikiListState } from './wikiTypes';

export const waitForNextPaint = () => new Promise<void>((resolve) => {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => resolve());
  });
});

const normalizeTag = (value: string) => value
  .trim()
  .replace(/^#+/, '')
  .replace(/\s+/g, ' ');

export const parseTagInput = (value: string) => {
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

export const formatDateTime = (value?: number | null) => {
  if (!value) {
    return '';
  }
  return new Date(value).toLocaleString('zh-CN');
};

export const getRevisionVersion = (revision: WikiRevision) => (
  revision.versionNumber || revision.baseVersionNumber + 1
);

export const getRevisionSummary = (revision: WikiRevision) => (
  revision.editSummary || (revision.actionType === 'create' ? '创建公开瓜条' : '提交瓜条编辑')
);

export const getWikiEntryUrl = (entry: WikiEntry) => (
  `${window.location.origin}/wiki/${encodeURIComponent(entry.slug)}`
);

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
  const cleanup = () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    window.clearTimeout(timer);
    image.removeEventListener('load', handleLoad);
    image.removeEventListener('error', handleError);
  };
  const timer = window.setTimeout(() => {
    cleanup();
    reject(new Error('图片加载超时，无法导出'));
  }, 15000);

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

export const saveWikiEntryCardImage = async (entry: WikiEntry, node: HTMLElement) => {
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

export const getSlugFromPath = (pathname: string) => {
  const normalized = String(pathname || '').replace(/\/+$/, '');
  const match = normalized.match(/^\/wiki\/([^/]+)$/);
  return match ? decodeSlugSegment(match[1]) : '';
};

export const normalizeWikiSort = (value?: string | null): WikiEntrySort => (
  value === 'number' ? 'number' : 'updated'
);

const parseWikiPage = (value?: string | null) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
};

export const getWikiListStateFromHref = (href: string): WikiListState => {
  const url = new URL(href, window.location.origin);
  return {
    query: String(url.searchParams.get('q') || '').trim(),
    tag: String(url.searchParams.get('tag') || '').trim(),
    sortBy: normalizeWikiSort(url.searchParams.get('sort')),
    page: parseWikiPage(url.searchParams.get('page')),
  };
};

export const createWikiListUrl = ({ query, tag, sortBy, page }: WikiListState) => {
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
