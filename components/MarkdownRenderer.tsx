import React, { useMemo } from 'react';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

/**
 * Simple Markdown renderer that supports:
 * - **bold** and *italic*
 * - ~~strikethrough~~
 * - `inline code`
 * - [links](url)
 * - Line breaks
 * - > blockquotes
 * - Lists (- or *)
 */
const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, className = '' }) => {
  const rendered = useMemo(() => {
    if (!content) return '';

    let html = content
      // Escape HTML to prevent XSS
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      // Bold: **text** or __text__
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/__(.+?)__/g, '<strong>$1</strong>')
      // Italic: *text* or _text_
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/_(.+?)_/g, '<em>$1</em>')
      // Strikethrough: ~~text~~
      .replace(/~~(.+?)~~/g, '<del class="text-pencil">$1</del>')
      // Inline code: `code`
      .replace(/`(.+?)`/g, '<code class="bg-gray-100 px-1.5 py-0.5 rounded text-sm font-mono border border-gray-200">$1</code>')
      // Links: [text](url)
      .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-blue-600 underline hover:text-blue-800">$1</a>')
      // Line breaks
      .replace(/\n/g, '<br />');

    // Process blockquotes: lines starting with >
    html = html.replace(/(^|<br \/>)&gt;\s?(.+?)(?=<br \/>|$)/g,
      '$1<blockquote class="border-l-4 border-gray-300 pl-3 my-2 text-pencil italic">$2</blockquote>');

    // Process unordered lists: lines starting with - or *
    html = html.replace(/(^|<br \/>)[-*]\s+(.+?)(?=<br \/>|$)/g,
      '$1<li class="ml-4 list-disc">$2</li>');

    return html;
  }, [content]);

  return (
    <div
      className={`markdown-content leading-relaxed ${className}`}
      dangerouslySetInnerHTML={{ __html: rendered }}
    />
  );
};

export default MarkdownRenderer;
