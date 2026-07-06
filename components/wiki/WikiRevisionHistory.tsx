import React from 'react';
import { Badge, Button, Empty, LayerCard } from '@cloudflare/kumo';
import {
  ArrowSquareOut,
  ClockCounterClockwise,
  FileText,
  X,
} from '@phosphor-icons/react';

import MarkdownRenderer from '../MarkdownRenderer';
import { useEscapeToClose } from './wikiHooks';
import type { WikiRevision } from './wikiTypes';
import {
  formatDateTime,
  getRevisionSummary,
  getRevisionVersion,
} from './wikiUtils';

interface WikiRevisionHistoryProps {
  history: WikiRevision[];
  onOpenRevision: (revision: WikiRevision) => void;
}

export const WikiRevisionHistory: React.FC<WikiRevisionHistoryProps> = ({ history, onOpenRevision }) => (
  <section className="space-y-4">
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-kumo-strong">
        <ClockCounterClockwise size={18} />
        编辑历史
      </div>
      <Badge variant="outline">{history.length} 条</Badge>
    </div>

    {history.length === 0 ? (
      <LayerCard className="p-0">
        <Empty
          size="sm"
          icon={<FileText size={32} />}
          title="暂无公开编辑记录"
          description="通过审核的创建和编辑会在这里形成可回溯版本。"
        />
      </LayerCard>
    ) : (
      <ol className="wiki-timeline">
        {history.map((revision) => (
          <li key={revision.id} className="wiki-timeline-item">
            <span className="wiki-timeline-dot" aria-hidden="true" />
            <button
              type="button"
              onClick={() => onOpenRevision(revision)}
              className="wiki-timeline-card wiki-motion-button wiki-focus-ring group w-full rounded-xl border border-kumo-line bg-kumo-base p-4 text-left shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Badge variant="secondary">
                  第 {getRevisionVersion(revision)} 版
                </Badge>
                <span className="text-xs text-kumo-subtle">
                  {formatDateTime(revision.reviewedAt || revision.createdAt)}
                </span>
              </div>
              <div className="mt-3 text-xs font-semibold text-kumo-subtle">
                {revision.actionType === 'create' ? '创建公开瓜条' : '编辑公开瓜条'}
              </div>
              <p className="mt-2 line-clamp-3 text-sm leading-6 text-kumo-default">
                {getRevisionSummary(revision)}
              </p>
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-kumo-strong opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                查看历史瓜条
                <ArrowSquareOut size={14} />
              </span>
            </button>
          </li>
        ))}
      </ol>
    )}
  </section>
);

interface WikiRevisionDetailModalProps {
  revision: WikiRevision | null;
  onClose: () => void;
}

export const WikiRevisionDetailModal: React.FC<WikiRevisionDetailModalProps> = ({ revision, onClose }) => {
  useEscapeToClose(Boolean(revision), onClose);

  if (!revision) {
    return null;
  }

  const tags = Array.isArray(revision.data.tags) ? revision.data.tags : [];
  const narrative = revision.data.narrative || '';

  return (
    <div data-wiki-overlay-modal="true" className="fixed inset-0 z-[90] flex items-end justify-center p-0 sm:items-center sm:p-6">
      <button
        type="button"
        aria-label="关闭历史瓜条"
        className="wiki-modal-backdrop-enter fixed inset-0 bg-kumo-scrim/45 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="wiki-revision-title"
        className="wiki-modal-panel-enter relative z-10 flex max-h-[min(92vh,58rem)] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl border border-kumo-line bg-kumo-base shadow-2xl sm:rounded-2xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-kumo-line px-5 py-5 md:px-8 md:py-6">
          <div className="min-w-0 space-y-2">
            <Badge variant="secondary">历史瓜条</Badge>
            <h2 id="wiki-revision-title" className="text-xl font-semibold tracking-tight text-kumo-strong md:text-2xl">
              第 {getRevisionVersion(revision)} 版 · {revision.actionType === 'create' ? '创建' : '编辑'}
            </h2>
            <p className="text-xs text-kumo-subtle">
              {formatDateTime(revision.reviewedAt || revision.createdAt)}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            shape="square"
            className="wiki-motion-button"
            aria-label="关闭历史瓜条"
            onClick={onClose}
            icon={<X size={18} />}
          />
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto px-5 py-6 md:px-8 md:py-8">
          <LayerCard className="mb-6 p-4">
            <div className="text-xs font-semibold text-kumo-subtle">修改原因</div>
            <p className="mt-2 text-sm leading-6 text-kumo-default">
              {getRevisionSummary(revision)}
            </p>
          </LayerCard>

          <div className="border-b border-kumo-line pb-6">
            <h3 className="text-3xl font-semibold tracking-tight text-kumo-strong md:text-4xl">
              {revision.data.name}
            </h3>
            <div className="mt-4 flex flex-wrap gap-2">
              {tags.length === 0 ? (
                <Badge variant="outline">暂无标签</Badge>
              ) : tags.map((tag) => (
                <React.Fragment key={tag}>
                  <Badge variant="secondary">#{tag}</Badge>
                </React.Fragment>
              ))}
            </div>
          </div>

          <MarkdownRenderer
            content={narrative}
            className="wiki-markdown-body pt-8 text-base leading-8 text-kumo-default [&_blockquote]:my-5 [&_ol]:my-5 [&_p]:mb-5 [&_pre]:my-5 [&_ul]:my-5"
          />
        </main>
      </div>
    </div>
  );
};

export default WikiRevisionHistory;
