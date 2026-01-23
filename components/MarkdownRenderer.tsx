import React, { useMemo } from 'react';
import createDOMPurify from 'dompurify';
import { marked } from 'marked';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

const escapeHtml = (value: unknown) => {
  const text = typeof value === 'string' ? value : value == null ? '' : String(value);
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const normalizeLink = (
  href: string | { href?: string; title?: string; text?: string },
  title?: string | null,
  text?: string,
) => {
  if (typeof href === 'object' && href !== null) {
    return {
      href: href.href ?? '',
      title: href.title ?? null,
      text: href.text ?? '',
    };
  }
  return {
    href: href ?? '',
    title: title ?? null,
    text: text ?? '',
  };
};

const renderer = new marked.Renderer();

renderer.heading = (text, level) => {
  const safeLevel = Math.min(Math.max(level, 1), 3);
  const sizeClass = safeLevel === 1 ? 'text-2xl' : safeLevel === 2 ? 'text-xl' : 'text-lg';
  return `<h${safeLevel} class="font-display ${sizeClass} text-ink mt-3 mb-1">${text}</h${safeLevel}>`;
};

renderer.blockquote = (quote) =>
  `<blockquote class="border-l-4 border-gray-300 pl-3 my-2 text-pencil italic">${quote}</blockquote>`;

renderer.list = (body, ordered) =>
  `<${ordered ? 'ol' : 'ul'} class="ml-5 ${ordered ? 'list-decimal' : 'list-disc'}">${body}</${ordered ? 'ol' : 'ul'}>`;

renderer.listitem = (text) => `<li class="my-1">${text}</li>`;

renderer.codespan = (code) =>
  `<code class="bg-gray-100 px-1.5 py-0.5 rounded text-sm font-mono border border-gray-200">${escapeHtml(code)}</code>`;

renderer.code = (code) =>
  `<pre class="bg-gray-100 border border-gray-200 rounded p-3 overflow-x-auto"><code class="font-mono text-sm">${escapeHtml(code)}</code></pre>`;

renderer.link = (href, title, text) => {
  const normalized = normalizeLink(href, title, text);
  const safeHref = escapeHtml(normalized.href);
  const safeTitle = normalized.title ? escapeHtml(normalized.title) : '';
  const safeText =
    typeof normalized.text === 'string' ? normalized.text : escapeHtml(normalized.text);
  const titleAttr = safeTitle ? ` title="${safeTitle}"` : '';
  return `<a href="${safeHref}"${titleAttr} target="_blank" rel="noopener noreferrer" class="text-blue-600 underline hover:text-blue-800">${safeText}</a>`;
};

marked.setOptions({
  renderer,
  breaks: true,
  gfm: true,
});

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

const ALLOWED_ATTR = ['href', 'title', 'target', 'rel', 'class', 'src', 'alt'];

const IMAGE_HOSTS = new Set(['img.zsix.de', 'ibed.933211.xyz']);
let cachedPurifier: ReturnType<typeof createDOMPurify> | null = null;
let purifierReady = false;

const isAllowedImageSrc = (value: string) => {
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
  try {
    const url = new URL(value.trim());
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

const normalizeImageOnlyLines = (value: string) => {
  const lines = value.split(/\r?\n/);
  const normalized = lines.map((line) => {
    const trimmed = line.trim();
    if (isAllowedImageUrl(trimmed)) {
      return `![](${trimmed})`;
    }
    return line;
  });
  return normalized.join('\n');
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
      ALLOW_DATA_ATTR: false,
      ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
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

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, className = '' }) => {
  const rendered = useMemo(() => {
    if (!content) return '';
    const normalizedContent = normalizeImageOnlyLines(content);
    const rawHtml = marked.parse(normalizedContent);
    const purifier = getSanitizer();
    if (!purifier) {
      return '';
    }
    return purifier.sanitize(rawHtml);
  }, [content]);

  return (
    <div
      className={`markdown-content leading-relaxed ${className}`}
      dangerouslySetInnerHTML={{ __html: rendered }}
    />
  );
};

export default MarkdownRenderer;
