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
  return `<a href="${safeHref}"${titleAttr} target="_blank" rel="noopener noreferrer" class="text-blue-600 underline hover:text-blue-800">${safeText}</a>`;
};

renderer.paragraph = function (token) {
  const text = token.tokens ? this.parser.parseInline(token.tokens) : marked.parseInline(token.text || '');
  return `<p class="my-2">${text}</p>`;
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

const transformInlineTokens = (tokens: any[], inBlockquote: boolean): any[] => {
  return tokens.map((token) => {
    if (!token) {
      return token;
    }
    if (!inBlockquote && token.type === 'link' && isAllowedImageUrl(token.href || '')) {
      return {
        type: 'image',
        href: token.href,
        title: token.title || null,
        text: token.text || '',
      };
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
    const baseTokens: any = marked.lexer(content);
    const tokens = transformTokens(baseTokens, false) as any[] & { links?: Record<string, { href: string; title: string }> };
    if (baseTokens?.links) {
      tokens.links = baseTokens.links;
    }
    const rawHtml = marked.parser(tokens, { renderer, gfm: true, breaks: true });
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
