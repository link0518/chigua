import React from 'react';
import MarkdownRenderer from '@/components/MarkdownRenderer';

interface AnnouncementContentProps {
  content: string;
}

/** 公告正文只在弹窗打开时挂载，避免首屏执行 Markdown 解析和净化。 */
const AnnouncementContent: React.FC<AnnouncementContentProps> = ({ content }) => (
  <MarkdownRenderer content={content} className="text-sm text-ink" />
);

export default AnnouncementContent;
