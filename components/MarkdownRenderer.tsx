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

const renderer = new marked.Renderer();

renderer.heading = function (token) {
  const safeLevel = Math.min(Math.max(token.depth || 1, 1), 3);
  const sizeClass = safeLevel === 1 ? 'text-2xl' : safeLevel === 2 ? 'text-xl' : 'text-lg';
  const text = token.tokens ? this.parser.parseInline(token.tokens) : marked.parseInline(token.text || '');
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
  const content = token.tokens ? this.parser.parse(token.tokens) : marked.parseInline(token.text || '');
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
  if (isAllowedImageUrl(href) && (!token.text || token.text === href)) {
    return `<img src="${safeHref}" alt="" class="max-w-full rounded-md border border-gray-200" loading="lazy" />`;
  }
  return `<a href="${safeHref}"${titleAttr} target="_blank" rel="noopener noreferrer" class="text-blue-600 underline hover:text-blue-800">${safeText}</a>`;
};

renderer.paragraph = function (token) {
  const text = token.tokens ? this.parser.parseInline(token.tokens) : marked.parseInline(token.text || '');
  return `<p>${text}</p>`;
};

renderer.strong = function (token) {
  return `<strong>${token.tokens ? this.parser.parseInline(token.tokens) : marked.parseInline(token.text || '')}</strong>`;
};

renderer.em = function (token) {
  return `<em>${token.tokens ? this.parser.parseInline(token.tokens) : marked.parseInline(token.text || '')}</em>`;
};

renderer.del = function (token) {
  return `<del>${token.tokens ? this.parser.parseInline(token.tokens) : marked.parseInline(token.text || '')}</del>`;
};

renderer.image = function (token) {
  const href = token.href || '';
  if (!isAllowedImageUrl(href)) {
    return '';
  }
  const safeHref = escapeHtml(href);
  const altText = escapeHtml(token.text || '');
  const titleAttr = token.title ? ` title="${escapeHtml(token.title)}"` : '';
  return `<img src="${safeHref}" alt="${altText}"${titleAttr} class="max-w-full rounded-md border border-gray-200" loading="lazy" />`;
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
    const quotedMatch = trimmed.match(/^["'](https?:\/\/[^"']+)["']$/);
    const candidate = quotedMatch ? quotedMatch[1] : trimmed;
    if (isAllowedImageUrl(candidate)) {
      return `![](${candidate})`;
    }
    return line;
  });
  return normalized.join('\n');
};

const preserveExtraBlankLines = (value: string) => {
  return value.replace(/\n{2,}/g, (match) => {
    const blanks = Math.max(match.length - 1, 1);
    const fillers = Array.from({ length: blanks }, () => '<p class="md-blank">&nbsp;</p>\n\n').join('');
    return `\n\n${fillers}`;
  });
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
    const normalizedContent = preserveExtraBlankLines(normalizeImageOnlyLines(content));
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
