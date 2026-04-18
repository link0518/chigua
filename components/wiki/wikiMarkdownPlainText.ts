import { marked } from 'marked';

type MarkdownToken = {
  type?: string;
  text?: string;
  raw?: string;
  tokens?: MarkdownToken[];
  items?: Array<MarkdownToken & { tokens?: MarkdownToken[] }>;
  header?: Array<{ text?: string; tokens?: MarkdownToken[] }>;
  rows?: Array<Array<{ text?: string; tokens?: MarkdownToken[] }>>;
};

const normalizeText = (value: string) => value
  .replace(/\r/g, '')
  .replace(/\u00a0/g, ' ')
  .replace(/[ \t]+\n/g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

const stripHtmlTags = (value: string) => String(value || '').replace(/<[^>]*>/g, ' ');

const normalizeMemeShortcodes = (content: string) => String(content || '').replace(
  /\[:([^\]\n]{1,80}):\]/g,
  (_match, innerRaw) => {
    const inner = String(innerRaw || '').trim();
    if (!inner) {
      return '';
    }
    const parts = inner.split('/');
    return parts[parts.length - 1]?.trim() || '';
  }
);

const stringifyInlineTokens = (tokens: MarkdownToken[] = []): string => tokens
  .map((token) => {
    if (!token) {
      return '';
    }

    switch (token.type) {
      case 'text':
      case 'escape':
      case 'codespan':
        return token.text || '';
      case 'strong':
      case 'em':
      case 'del':
      case 'link':
        return token.tokens?.length ? stringifyInlineTokens(token.tokens) : (token.text || '');
      case 'image':
        return token.text || '';
      case 'br':
        return '\n';
      case 'html':
        return stripHtmlTags(token.raw || token.text || '');
      default:
        if (token.tokens?.length) {
          return stringifyInlineTokens(token.tokens);
        }
        return token.text || '';
    }
  })
  .join('');

const stringifyBlockTokens = (tokens: MarkdownToken[] = []): string => tokens
  .map((token) => {
    if (!token) {
      return '';
    }

    switch (token.type) {
      case 'space':
      case 'hr':
        return '';
      case 'paragraph':
      case 'heading':
        return stringifyInlineTokens(token.tokens || []);
      case 'blockquote':
        return stringifyBlockTokens(token.tokens || []);
      case 'list':
        return (token.items || [])
          .map((item) => stringifyBlockTokens(item.tokens || []))
          .filter(Boolean)
          .join('\n');
      case 'code':
        return token.text || '';
      case 'table': {
        const header = (token.header || [])
          .map((cell) => cell.tokens?.length ? stringifyInlineTokens(cell.tokens) : (cell.text || ''))
          .filter(Boolean)
          .join(' | ');
        const rows = (token.rows || [])
          .map((row) => row
            .map((cell) => cell.tokens?.length ? stringifyInlineTokens(cell.tokens) : (cell.text || ''))
            .filter(Boolean)
            .join(' | '))
          .filter(Boolean)
          .join('\n');
        return [header, rows].filter(Boolean).join('\n');
      }
      case 'html':
        return stripHtmlTags(token.raw || token.text || '');
      case 'text':
        return token.tokens?.length ? stringifyInlineTokens(token.tokens) : (token.text || '');
      default:
        if (token.tokens?.length) {
          return stringifyBlockTokens(token.tokens);
        }
        return token.text || '';
    }
  })
  .filter(Boolean)
  .join('\n\n');

export const getWikiMarkdownPlainText = (content: string) => {
  const normalized = normalizeMemeShortcodes(String(content || ''));
  if (!normalized.trim()) {
    return '';
  }

  const tokens = marked.lexer(normalized, {
    gfm: true,
    breaks: true,
  }) as MarkdownToken[];

  return normalizeText(stringifyBlockTokens(tokens));
};

export const getWikiMarkdownExcerpt = (content: string, maxLength = 140) => {
  const plainText = getWikiMarkdownPlainText(content).replace(/\s+/g, ' ').trim();
  if (plainText.length <= maxLength) {
    return plainText;
  }
  return `${plainText.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
};
