import React, { useCallback, useRef, useState } from 'react';
import { Badge, Button, Empty, LayerCard } from '@cloudflare/kumo';
import {
  ArrowLeft,
  DownloadSimple,
  FileText,
  MagnifyingGlass,
  PencilSimpleLine,
  ShareNetwork,
} from '@phosphor-icons/react';

import { copyTextToClipboard } from '../clipboard';
import MarkdownRenderer from '../MarkdownRenderer';
import { WikiAttachmentList } from './WikiAttachmentViewer';
import WikiFloatingFeedback from './WikiFeedback';
import WikiLoadingScreen from './WikiLoadingScreen';
import { useWikiFeedback } from './wikiHooks';
import { WikiRelatedPostList } from './WikiRelatedPostField';
import type { WikiEntry, WikiRevision } from './wikiTypes';
import {
  formatDateTime,
  getWikiEntryUrl,
  saveWikiEntryCardImage,
  waitForNextPaint,
} from './wikiUtils';
import {
  WikiRevisionDetailModal,
  WikiRevisionHistory,
} from './WikiRevisionHistory';

const WikiEntryNarrativeCard: React.FC<{
  entry: WikiEntry;
  mode?: 'detail' | 'export';
}> = ({ entry, mode = 'detail' }) => (
  <div className={mode === 'export' ? '' : 'mx-auto max-w-4xl space-y-5 md:space-y-6'}>
    <header className={mode === 'export'
      ? ''
      : 'wiki-entry-cover wiki-surface-soft rounded-2xl border border-kumo-line bg-kumo-base p-5 shadow-sm md:p-8'}
    >
      {mode === 'export' ? (
        <div className="flex items-start justify-between gap-8 border-b border-kumo-line pb-6">
          <div>
            <div className="text-lg font-semibold tracking-[0.16em] text-kumo-strong">JX3 瓜田</div>
            <div className="mt-2 whitespace-nowrap text-sm tracking-[0.12em] text-kumo-subtle">
              公开档案 · 第 {entry.versionNumber} 版
            </div>
          </div>
          {entry.updatedAt ? (
            <div className="pt-1 text-right text-sm tabular-nums text-kumo-subtle">
              <div className="text-xs tracking-[0.12em]">最后更新</div>
              <div className="mt-2 font-medium text-kumo-default">{formatDateTime(entry.updatedAt)}</div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">公开档案</Badge>
          <Badge variant="outline">第 {entry.versionNumber} 版</Badge>
          {entry.updatedAt ? <Badge variant="secondary">更新于 {formatDateTime(entry.updatedAt)}</Badge> : null}
        </div>
      )}
      <h1 className={mode === 'export'
        ? 'mt-10 text-5xl font-semibold leading-tight tracking-[-0.04em] text-kumo-strong'
        : 'mt-5 max-w-3xl text-4xl font-semibold leading-tight text-kumo-strong md:mt-6 md:text-5xl'}
      >
        {entry.name}
      </h1>
      <div className={mode === 'export' ? 'mt-5 flex flex-wrap gap-2' : 'mt-6 flex flex-wrap gap-2'}>
        {entry.tags.length === 0 ? (
          <Badge variant="outline">暂无标签</Badge>
        ) : entry.tags.map((tag) => (
          <React.Fragment key={tag}>
            <Badge variant="secondary">#{tag}</Badge>
          </React.Fragment>
        ))}
      </div>
    </header>

    <section className={mode === 'export'
      ? 'mt-9 border-t border-kumo-line pt-9'
      : 'wiki-reading-card rounded-2xl border border-kumo-line bg-kumo-base p-5 shadow-sm md:p-8'}
      aria-label="档案正文"
    >
      <MarkdownRenderer
        content={entry.narrative}
        className={mode === 'export'
          ? 'wiki-markdown-body text-lg leading-9 text-kumo-default [&_blockquote]:my-6 [&_ol]:my-6 [&_p]:mb-6 [&_pre]:my-6 [&_ul]:my-6'
          : 'wiki-markdown-body text-base leading-8 text-kumo-default md:text-[17px] md:leading-9 [&_blockquote]:my-6 [&_ol]:my-6 [&_p]:mb-6 [&_pre]:my-6 [&_ul]:my-6'}
      />
    </section>
  </div>
);

interface WikiEntryActionButtonsProps {
  entry: WikiEntry;
  exportEntry: WikiEntry | null;
  onEdit: (entry: WikiEntry) => void;
  onSearchCurrentEntry: () => void;
  onShare: () => void;
  onSaveImage: () => void;
  compact?: boolean;
  iconOnly?: boolean;
}

const WikiEntryActionButtons: React.FC<WikiEntryActionButtonsProps> = ({
  entry,
  exportEntry,
  onEdit,
  onSearchCurrentEntry,
  onShare,
  onSaveImage,
  compact = false,
  iconOnly = false,
}) => {
  if (compact || iconOnly) {
    return (
      <>
        <Button
          type="button"
          variant="secondary"
          size="base"
          shape="square"
          aria-label="编辑瓜条"
          className="wiki-chip-button justify-center"
          onClick={() => onEdit(entry)}
          icon={<PencilSimpleLine size={16} />}
        />
        <Button
          type="button"
          variant="secondary"
          size="base"
          shape="square"
          aria-label="搜索当前瓜条"
          className="wiki-chip-button justify-center"
          onClick={onSearchCurrentEntry}
          icon={<MagnifyingGlass size={16} />}
        />
        <Button
          type="button"
          variant="secondary"
          size="base"
          shape="square"
          aria-label="保存瓜条图片"
          className="wiki-chip-button justify-center"
          loading={Boolean(exportEntry)}
          onClick={onSaveImage}
          icon={<DownloadSimple size={16} />}
        />
        <Button
          type="button"
          variant="primary"
          size="base"
          shape={iconOnly ? 'square' : 'base'}
          aria-label={iconOnly ? '分享瓜条' : undefined}
          className={`wiki-chip-button wiki-solid-action min-w-0 justify-center ${iconOnly ? '' : 'w-full px-3'}`}
          onClick={onShare}
          icon={<ShareNetwork size={16} />}
        >
          {iconOnly ? null : '分享'}
        </Button>
      </>
    );
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="base"
        className="wiki-chip-button shrink-0 justify-center px-3"
        onClick={() => onEdit(entry)}
        icon={<PencilSimpleLine size={16} />}
      >
        编辑
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="base"
        className="wiki-chip-button shrink-0 justify-center px-3"
        onClick={onSearchCurrentEntry}
        icon={<MagnifyingGlass size={16} />}
      >
        搜索
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="base"
        shape="square"
        aria-label="保存瓜条图片"
        className="wiki-chip-button shrink-0 justify-center"
        loading={Boolean(exportEntry)}
        onClick={onSaveImage}
        icon={<DownloadSimple size={16} />}
      />
      <Button
        type="button"
        variant="primary"
        size="base"
        className="wiki-chip-button wiki-solid-action min-w-[6.75rem] shrink-0 justify-center px-3"
        onClick={onShare}
        icon={<ShareNetwork size={16} />}
      >
        分享
      </Button>
    </>
  );
};

const WikiEntryExportCard = React.forwardRef<HTMLDivElement, { entry: WikiEntry }>(({ entry }, ref) => (
  <div className="pointer-events-none fixed inset-x-0 top-0 z-[-1] flex justify-center opacity-0" aria-hidden="true">
    <div ref={ref} className="w-[1080px] shrink-0 bg-kumo-overlay p-10">
      <div className="overflow-hidden rounded-3xl border border-kumo-line bg-kumo-base px-14 py-12 shadow-xl">
        <WikiEntryNarrativeCard entry={entry} mode="export" />
        <footer className="mt-10 flex items-end justify-between gap-8 border-t border-kumo-line pt-6">
          <div>
            <div className="text-sm font-semibold tracking-[0.14em] text-kumo-default">
              档案快照
            </div>
            <div className="mt-2 text-xs leading-5 text-kumo-subtle">
              内容来自公开瓜条，由用户共同整理
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-sm font-semibold tracking-[0.12em] text-kumo-strong">jx3gua.com</div>
            <div className="mt-2 text-xs tracking-[0.1em] text-kumo-subtle">吃瓜到 JX3 瓜田</div>
          </div>
        </footer>
      </div>
    </div>
  </div>
));

WikiEntryExportCard.displayName = 'WikiEntryExportCard';

interface WikiEntryDetailProps {
  entry: WikiEntry | null;
  history: WikiRevision[];
  loading: boolean;
  error: string;
  onBack: () => void;
  onEdit: (entry: WikiEntry) => void;
  onSearchCurrentEntry: () => void;
}

interface WikiDetailCommandBarProps {
  onBack: () => void;
  children: React.ReactNode;
}

const WikiDetailCommandBar: React.FC<WikiDetailCommandBarProps> = ({ onBack, children }) => (
  <header className="wiki-detail-command relative z-20 mx-auto mb-5 w-full max-w-4xl shrink-0 border-b border-kumo-line pb-3">
    <div className="flex min-w-0 items-center justify-between gap-3">
      <Button
        type="button"
        variant="secondary"
        size="base"
        className="wiki-motion-button shrink-0 justify-center px-3"
        onClick={onBack}
        icon={<ArrowLeft size={16} />}
      >
        返回
      </Button>
      {children}
    </div>
  </header>
);

const WikiEntryLoadingLayout: React.FC<Pick<WikiEntryDetailProps, 'onBack'>> = ({ onBack }) => (
  <div className="wiki-detail-panel relative z-10 flex h-full w-full flex-col overflow-hidden bg-kumo-overlay">
    <article className="wiki-detail-main relative flex min-h-0 min-w-0 flex-1 flex-col px-4 md:px-8 xl:px-12">
      <WikiDetailCommandBar onBack={onBack}>
        <div className="hidden items-center gap-2 md:flex" aria-hidden="true">
          <span className="wiki-skeleton-card h-9 w-9 rounded-lg bg-kumo-tint" />
          <span className="wiki-skeleton-card h-9 w-9 rounded-lg bg-kumo-tint" />
          <span className="wiki-skeleton-card h-9 w-9 rounded-lg bg-kumo-tint" />
          <span className="wiki-skeleton-card h-9 w-16 rounded-lg bg-kumo-tint" />
        </div>
      </WikiDetailCommandBar>
      <WikiLoadingScreen
        variant="detail"
        title="正在读取档案详情"
        description="同步记录叙述、版本历史和分享信息"
        className="min-h-0 flex-1 bg-transparent py-4"
      />
    </article>
  </div>
);

const WikiEntryDetail: React.FC<WikiEntryDetailProps> = ({
  entry,
  history,
  loading,
  error,
  onBack,
  onEdit,
  onSearchCurrentEntry,
}) => {
  const [selectedRevision, setSelectedRevision] = useState<WikiRevision | null>(null);
  const [exportEntry, setExportEntry] = useState<WikiEntry | null>(null);
  const exportCardRef = useRef<HTMLDivElement | null>(null);
  const { feedback, showFeedback } = useWikiFeedback();

  const handleShare = useCallback(async () => {
    if (!entry) {
      return;
    }

    const shareUrl = getWikiEntryUrl(entry);
    try {
      if (navigator.share) {
        try {
          await navigator.share({
            title: `${entry.name} - 瓜条档案`,
            text: `查看瓜条：${entry.name}`,
            url: shareUrl,
          });
          showFeedback('分享面板已打开');
          return;
        } catch (shareError) {
          if (shareError instanceof DOMException && shareError.name === 'AbortError') {
            return;
          }
        }
      }
      await copyTextToClipboard(shareUrl);
      showFeedback('链接已复制');
    } catch {
      showFeedback('分享失败，请手动复制链接', 'error');
    }
  }, [entry, showFeedback]);

  const handleSaveImage = useCallback(async () => {
    if (!entry || exportEntry) {
      return;
    }

    try {
      setExportEntry(entry);
      await waitForNextPaint();
      const exportNode = exportCardRef.current;
      if (!exportNode) {
        throw new Error('保存失败，请稍后重试');
      }
      await saveWikiEntryCardImage(entry, exportNode);
      showFeedback('瓜条图片已保存');
    } catch (saveError) {
      showFeedback(saveError instanceof Error ? saveError.message : '保存失败，请稍后重试', 'error');
    } finally {
      setExportEntry(null);
    }
  }, [entry, exportEntry, showFeedback]);

  if (loading) {
    return <WikiEntryLoadingLayout onBack={onBack} />;
  }

  if (error || !entry) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-kumo-overlay p-6">
        <LayerCard className="w-full max-w-lg p-0">
          <Empty
            icon={<FileText size={46} />}
            title="未找到瓜条"
            description={error || '该瓜条不存在或尚未公开。'}
            contents={(
              <Button type="button" variant="primary" className="wiki-motion-button wiki-solid-action" onClick={onBack}>
                返回矩阵
              </Button>
            )}
          />
        </LayerCard>
      </div>
    );
  }

  const relatedPosts = Array.isArray(entry.relatedPosts) && entry.relatedPosts.length > 0
    ? entry.relatedPosts
    : (entry.relatedPostIds || []).map((postId) => ({
      id: postId,
      available: true,
    }));

  return (
    <div className="wiki-detail-panel relative z-10 flex h-full w-full flex-col overflow-y-auto bg-kumo-overlay lg:flex-row lg:overflow-hidden">
      <WikiFloatingFeedback feedback={feedback} />

      <article className="wiki-detail-main relative min-w-0 flex-1 px-4 md:px-8 lg:overflow-y-auto xl:px-12">
        <WikiDetailCommandBar onBack={onBack}>
          <div className="wiki-detail-action-group wiki-action-strip hidden min-w-0 shrink-0 gap-2 overflow-x-auto pb-1 md:flex xl:hidden">
            <WikiEntryActionButtons
              entry={entry}
              exportEntry={exportEntry}
              onEdit={onEdit}
              onSearchCurrentEntry={onSearchCurrentEntry}
              onShare={handleShare}
              onSaveImage={handleSaveImage}
              iconOnly
            />
          </div>

          <div className="wiki-detail-action-group wiki-action-strip hidden min-w-0 shrink-0 gap-2 overflow-x-auto pb-1 xl:flex xl:justify-end xl:overflow-visible xl:pb-0">
            <WikiEntryActionButtons
              entry={entry}
              exportEntry={exportEntry}
              onEdit={onEdit}
              onSearchCurrentEntry={onSearchCurrentEntry}
              onShare={handleShare}
              onSaveImage={handleSaveImage}
            />
          </div>
        </WikiDetailCommandBar>

        <WikiEntryNarrativeCard entry={entry} />
      </article>

      {exportEntry ? <WikiEntryExportCard ref={exportCardRef} entry={exportEntry} /> : null}

      <aside className="wiki-detail-aside flex min-w-0 w-full shrink-0 flex-col gap-4 overflow-x-hidden border-t border-kumo-line bg-kumo-base p-5 shadow-xl md:p-6 lg:grid lg:w-[22rem] lg:min-h-0 lg:overflow-y-auto lg:border-l lg:border-t-0 xl:w-[24rem]">
        <div className="wiki-detail-related min-h-0 min-w-0">
          <WikiRelatedPostList posts={relatedPosts} className="wiki-related-post-card" />
        </div>
        <div className="wiki-detail-attachments min-h-0 min-w-0">
          <WikiAttachmentList
            attachments={entry.attachments}
            className="wiki-attachment-card"
            compact
            showEmpty
          />
        </div>
        <WikiRevisionHistory history={history} onOpenRevision={setSelectedRevision} />
      </aside>

      <div className="wiki-mobile-action-bar fixed inset-x-0 bottom-0 z-40 border-t border-kumo-line bg-kumo-base/95 px-4 py-3 shadow-[0_-14px_34px_rgba(0,0,0,0.08)] backdrop-blur md:hidden">
        <div className="mx-auto grid max-w-md grid-cols-[repeat(3,2.25rem)_minmax(0,1fr)] gap-2">
          <WikiEntryActionButtons
            entry={entry}
            exportEntry={exportEntry}
            onEdit={onEdit}
            onSearchCurrentEntry={onSearchCurrentEntry}
            onShare={handleShare}
            onSaveImage={handleSaveImage}
            compact
          />
        </div>
      </div>

      <WikiRevisionDetailModal revision={selectedRevision} onClose={() => setSelectedRevision(null)} />
    </div>
  );
};

export default WikiEntryDetail;
