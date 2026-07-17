import React from 'react';
import { Badge, Button, Empty, LayerCard } from '@cloudflare/kumo';
import {
  ArrowSquareOut,
  CaretDown,
  ClockCounterClockwise,
  FileText,
  X,
} from '@phosphor-icons/react';

import MarkdownRenderer from '../MarkdownRenderer';
import { WikiAttachmentList } from './WikiAttachmentViewer';
import { useEscapeToClose, useWikiModalFocus } from './wikiHooks';
import { WikiResolvedRelatedPostList } from './WikiRelatedPostField';
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

const WikiRevisionTimeline: React.FC<{
  revisions: WikiRevision[];
  latest?: boolean;
  onOpenRevision: (revision: WikiRevision) => void;
}> = ({ revisions, latest = false, onOpenRevision }) => (
  <ol className="wiki-history-list divide-y divide-kumo-line">
    {revisions.map((revision, index) => (
      <li key={revision.id}>
        <button
          type="button"
          onClick={() => onOpenRevision(revision)}
          className="wiki-history-row wiki-motion-button wiki-focus-ring group w-full px-4 py-3 text-left"
        >
          <div className="flex items-center justify-between gap-3">
            <Badge variant="secondary">
              {latest && index === 0 ? '最新 · ' : ''}第 {getRevisionVersion(revision)} 版
            </Badge>
            <span className="flex min-w-0 items-center gap-1.5 text-xs tabular-nums text-kumo-subtle">
              <span className="truncate">{formatDateTime(revision.reviewedAt || revision.createdAt)}</span>
              <ArrowSquareOut size={14} className="shrink-0 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </span>
          </div>
          <div className="mt-2 text-xs font-semibold text-kumo-default">
            {revision.actionType === 'create' ? '创建公开瓜条' : '编辑公开瓜条'}
          </div>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-kumo-subtle">
            {getRevisionSummary(revision)}
          </p>
        </button>
      </li>
    ))}
  </ol>
);

export const WikiRevisionHistory: React.FC<WikiRevisionHistoryProps> = ({ history, onOpenRevision }) => {
  const [expanded, setExpanded] = React.useState(false);
  const previousHistoryId = React.useId();
  const latestRevision = history[0];
  const previousRevisions = history.slice(1);

  React.useEffect(() => {
    setExpanded(false);
  }, [latestRevision?.id]);

  return (
    <section className="wiki-history-panel min-h-0">
      <LayerCard className="wiki-sidebar-card wiki-surface-soft flex min-h-0 flex-col overflow-hidden p-0 shadow-sm">
        <LayerCard.Secondary className="wiki-sidebar-card-header flex shrink-0 items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-kumo-strong">
            <ClockCounterClockwise size={18} />
            编辑历史
          </div>
          <Badge variant="outline">{history.length} 条</Badge>
        </LayerCard.Secondary>

        <LayerCard.Primary className="wiki-history-body flex min-h-0 flex-1 flex-col p-0">
          {history.length === 0 ? (
            <div className="flex h-full min-h-40 items-center justify-center">
              <Empty
                size="sm"
                icon={<FileText size={28} />}
                title="暂无公开编辑记录"
                description="公开版本会保留在这里"
              />
            </div>
          ) : (
            <>
              <div className="shrink-0">
                <WikiRevisionTimeline
                  revisions={[latestRevision]}
                  latest
                  onOpenRevision={onOpenRevision}
                />
              </div>

              {previousRevisions.length > 0 ? (
                <div className="wiki-history-collapsible flex min-h-0 flex-1 flex-col">
                  {expanded ? (
                    <div id={previousHistoryId} className="wiki-history-previous min-h-0 flex-1 overflow-y-auto">
                      <WikiRevisionTimeline
                        revisions={previousRevisions}
                        onOpenRevision={onOpenRevision}
                      />
                    </div>
                  ) : (
                    <div className="min-h-0 flex-1" aria-hidden="true" />
                  )}

                  <div className="shrink-0 border-t border-kumo-line p-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="wiki-motion-button w-full justify-between px-3"
                      aria-expanded={expanded}
                      aria-controls={previousHistoryId}
                      onClick={() => setExpanded((value) => !value)}
                    >
                      <span>{expanded ? '收起前序历史' : `展开前序历史（${previousRevisions.length}）`}</span>
                      <CaretDown
                        size={15}
                        className={`transition-transform ${expanded ? 'rotate-180' : ''}`}
                      />
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </LayerCard.Primary>
      </LayerCard>
    </section>
  );
};

interface WikiRevisionDetailModalProps {
  revision: WikiRevision | null;
  onClose: () => void;
}

export const WikiRevisionDetailModal: React.FC<WikiRevisionDetailModalProps> = ({ revision, onClose }) => {
  const [attachmentViewerVisible, setAttachmentViewerVisible] = React.useState(false);
  const modalRef = React.useRef<HTMLDivElement | null>(null);
  useEscapeToClose(Boolean(revision) && !attachmentViewerVisible, onClose);
  useWikiModalFocus(Boolean(revision), modalRef);

  React.useEffect(() => {
    if (!revision) {
      setAttachmentViewerVisible(false);
    }
  }, [revision]);

  if (!revision) {
    return null;
  }

  const tags = Array.isArray(revision.data.tags) ? revision.data.tags : [];
  const narrative = revision.data.narrative || '';
  const relatedPostIds = Array.isArray(revision.data.relatedPostIds)
    ? revision.data.relatedPostIds
    : [];
  const attachments = Array.isArray(revision.data.attachments)
    ? revision.data.attachments
    : [];
  const hasResources = relatedPostIds.length > 0 || attachments.length > 0;

  return (
    <div data-wiki-overlay-modal="true" className="fixed inset-0 z-[90] flex items-end justify-center p-0 sm:items-center sm:p-6">
      <button
        type="button"
        aria-label="关闭历史瓜条"
        className="wiki-modal-backdrop-enter fixed inset-0 bg-kumo-scrim/45 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="wiki-revision-title"
        data-wiki-modal-initial-focus="true"
        tabIndex={-1}
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

          {hasResources ? (
            <section className="mt-8 space-y-5 border-t border-kumo-line pt-8" aria-label="历史版本相关资料">
              <WikiAttachmentList
                attachments={attachments}
                title="该版本附件"
                onViewerVisibleChange={setAttachmentViewerVisible}
              />
              <WikiResolvedRelatedPostList
                postIds={relatedPostIds}
                title="该版本相关帖子"
              />
            </section>
          ) : null}
        </main>
      </div>
    </div>
  );
};

export default WikiRevisionHistory;
