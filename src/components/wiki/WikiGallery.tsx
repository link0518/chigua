import React, { useCallback, useEffect, useRef } from 'react';
import { Badge, Button, LayerCard, Pagination, Select } from '@cloudflare/kumo';
import {
  ArrowClockwise,
  ArrowRight,
  Books,
  Clock,
  FileMagnifyingGlass,
  FunnelSimpleX,
} from '@phosphor-icons/react';

import type { WikiEntry, WikiEntrySort } from './wikiTypes';
import { PAGE_SIZE, WIKI_SORT_OPTIONS } from './wikiConstants';
import { formatDateTime } from './wikiUtils';
import { getWikiMarkdownExcerpt } from './wikiMarkdownPlainText';
import { WikiPageHeader, WikiResourceListPage } from './kumoBlocks';

interface WikiGalleryProps {
  items: WikiEntry[];
  total: number;
  page: number;
  loading: boolean;
  loadingMore: boolean;
  mobileFeed: boolean;
  hasMore: boolean;
  sortBy: WikiEntrySort;
  query: string;
  activeTag: string;
  onPageChange: (value: number) => void;
  onSortChange: (value: WikiEntrySort) => void;
  onClearFilters: () => void;
  onLoadMore: () => void;
  onOpenEntry: (slug: string) => void;
}

const WikiGallery: React.FC<WikiGalleryProps> = ({
  items,
  total,
  page,
  loading,
  loadingMore,
  mobileFeed,
  hasMore,
  sortBy,
  query,
  activeTag,
  onPageChange,
  onSortChange,
  onClearFilters,
  onLoadMore,
  onOpenEntry,
}) => {
  const listRef = useRef<HTMLElement | null>(null);
  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const itemOffset = mobileFeed ? 0 : (page - 1) * PAGE_SIZE;
  const latestUpdatedAt = items.reduce((max, item) => Math.max(max, Number(item.updatedAt || 0)), 0);
  const hasListFilters = Boolean(query || activeTag || sortBy !== 'updated' || page > 1);
  const activeFilterLabels = [
    query ? `搜索：${query}` : '',
    activeTag ? `#${activeTag}` : '',
    sortBy !== 'updated' ? WIKI_SORT_OPTIONS.find((option) => option.value === sortBy)?.label || '' : '',
    page > 1 ? `第 ${page} 页` : '',
  ].filter(Boolean);

  const handleScroll = useCallback((event: React.UIEvent<HTMLElement>) => {
    if (!mobileFeed || loading || loadingMore || !hasMore) {
      return;
    }

    const target = event.currentTarget;
    const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    if (distanceToBottom < 360) {
      onLoadMore();
    }
  }, [hasMore, loading, loadingMore, mobileFeed, onLoadMore]);

  useEffect(() => {
    if (!mobileFeed || loading || loadingMore || !hasMore) {
      return;
    }

    const listNode = listRef.current;
    if (listNode && listNode.scrollHeight <= listNode.clientHeight + 120) {
      onLoadMore();
    }
  }, [hasMore, items.length, loading, loadingMore, mobileFeed, onLoadMore]);

  const getEntryDisplayNumber = (entry: WikiEntry, index: number) => {
    if (typeof entry.displayOrder === 'number' && entry.displayOrder > 0) {
      return entry.displayOrder;
    }
    return Math.max(total - itemOffset - index, 1);
  };

  const overviewAside = (
    <div className="space-y-4">
      <LayerCard className="wiki-surface-soft overflow-hidden p-0 shadow-sm">
        <div className="border-b border-kumo-line px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-kumo-strong">
            <Books size={18} />
            档案概览
          </div>
        </div>
        <dl className="grid grid-cols-3 divide-x divide-kumo-line border-b border-kumo-line text-center">
          <div className="px-3 py-4">
            <dt className="text-[11px] font-semibold uppercase text-kumo-subtle">Total</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums text-kumo-strong">{total}</dd>
          </div>
          <div className="px-3 py-4">
            <dt className="text-[11px] font-semibold uppercase text-kumo-subtle">Page</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums text-kumo-strong">{page}</dd>
          </div>
          <div className="px-3 py-4">
            <dt className="text-[11px] font-semibold uppercase text-kumo-subtle">Pages</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums text-kumo-strong">{totalPages}</dd>
          </div>
        </dl>
        <div className="space-y-3 px-4 py-4 text-sm">
          <div className="flex items-center justify-between gap-4">
            <span className="text-kumo-subtle">排序方式</span>
            <span className="font-semibold text-kumo-strong">
              {WIKI_SORT_OPTIONS.find((option) => option.value === sortBy)?.label || '更新时间'}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-kumo-subtle">筛选标签</span>
            <span className="max-w-[12rem] truncate font-semibold text-kumo-strong">
              {activeTag ? `#${activeTag}` : '全部'}
            </span>
          </div>
        </div>
      </LayerCard>

      <LayerCard className="wiki-surface-soft p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <Clock size={20} className="mt-0.5 shrink-0 text-kumo-brand" />
          <div>
            <h3 className="text-sm font-semibold text-kumo-strong">最近更新</h3>
            <p className="mt-1 text-sm leading-6 text-kumo-subtle">
              {latestUpdatedAt > 0 ? formatDateTime(latestUpdatedAt) : '等待第一条公开记录。'}
            </p>
          </div>
        </div>
      </LayerCard>
    </div>
  );

  return (
    <section ref={listRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto">
      <WikiPageHeader
        eyebrow={<Badge variant="secondary">公开档案</Badge>}
        title="公开档案库"
        description="按更新时间、编号和标签整理已审核公开的瓜条。"
        meta={(
          <>
            <Badge variant="secondary">公开 {total} 条</Badge>
            <Badge variant="outline">第 {String(page).padStart(2, '0')} / {String(totalPages).padStart(2, '0')} 页</Badge>
            {activeTag && <Badge variant="outline">#{activeTag}</Badge>}
            {query && <Badge variant="secondary">搜索 “{query}”</Badge>}
          </>
        )}
        actions={hasListFilters && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="wiki-motion-button"
            icon={<FunnelSimpleX size={16} />}
            onClick={onClearFilters}
          >
            清空筛选
          </Button>
        )}
      >
        <LayerCard className="wiki-surface-soft overflow-hidden p-0 shadow-sm">
          <div className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-kumo-strong">
              <FileMagnifyingGlass size={18} />
              目录控制
            </div>
            <Select
              aria-label="Wiki 排序方式"
              value={sortBy}
              onValueChange={(value) => onSortChange(value === 'number' ? 'number' : 'updated')}
              renderValue={(value) => (
                WIKI_SORT_OPTIONS.find((option) => option.value === value)?.label || '更新时间'
              )}
              size="sm"
              className="w-full md:w-40"
            >
              {WIKI_SORT_OPTIONS.map((option) => (
                <React.Fragment key={option.value}>
                  <Select.Option value={option.value}>
                    {option.label}
                  </Select.Option>
                </React.Fragment>
              ))}
            </Select>
          </div>
        </LayerCard>
      </WikiPageHeader>

      <WikiResourceListPage aside={overviewAside}>
        {loading ? (
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3" aria-label="档案数据读取中">
            {Array.from({ length: 6 }).map((_, index) => (
              <LayerCard
                key={index}
                className="wiki-entry-card wiki-skeleton-card flex min-h-[15.5rem] flex-col p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-2">
                    <span className="block h-3 w-10 rounded-full bg-kumo-tint" />
                    <span className="block h-8 w-20 rounded-lg bg-kumo-tint" />
                  </div>
                  <span className="block h-6 w-16 rounded-full bg-kumo-tint" />
                </div>
                <div className="mt-6 space-y-3">
                  <span className="block h-7 w-2/3 rounded-lg bg-kumo-tint" />
                  <span className="block h-4 w-full rounded-full bg-kumo-tint" />
                  <span className="block h-4 w-5/6 rounded-full bg-kumo-tint" />
                </div>
                <div className="mt-auto flex items-center gap-2 pt-6 text-xs text-kumo-subtle">
                  <ArrowClockwise size={14} className="animate-spin" />
                  档案数据读取中
                </div>
              </LayerCard>
            ))}
          </div>
        ) : items.length === 0 ? (
          <LayerCard className="wiki-empty-state wiki-surface-soft p-6 shadow-sm md:p-8">
            <div className="mx-auto flex max-w-xl flex-col items-center text-center">
              <div className="flex size-14 items-center justify-center rounded-2xl border border-kumo-line bg-kumo-base text-kumo-strong shadow-sm">
                <FileMagnifyingGlass size={28} />
              </div>
              <h2 className="mt-5 text-xl font-semibold text-kumo-strong">
                没有找到对应瓜条
              </h2>
              <p className="mt-2 text-sm leading-6 text-kumo-subtle">
                当前条件没有匹配的公开档案，可以清空筛选后重新浏览。
              </p>
              {activeFilterLabels.length > 0 && (
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  {activeFilterLabels.map((label) => (
                    <React.Fragment key={label}>
                      <Badge variant="outline">{label}</Badge>
                    </React.Fragment>
                  ))}
                </div>
              )}
              {hasListFilters && (
                <Button type="button" variant="secondary" className="wiki-motion-button mt-6" onClick={onClearFilters} icon={<FunnelSimpleX size={16} />}>
                  清空筛选
                </Button>
              )}
            </div>
          </LayerCard>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {items.map((entry, index) => (
              <article key={entry.id} className="min-w-0">
                <button
                  type="button"
                  onClick={() => onOpenEntry(entry.slug)}
                  style={{ '--wiki-row-index': index } as React.CSSProperties}
                  className="wiki-entry-card wiki-row-enter group flex h-full min-h-[15.5rem] w-full flex-col rounded-xl border border-kumo-line bg-kumo-base p-4 text-left shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-kumo-focus/40 md:p-5"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <span className="text-[11px] font-semibold uppercase text-kumo-subtle">No.</span>
                      <div className="mt-1 font-mono text-3xl font-semibold leading-none tabular-nums text-kumo-strong">
                        {String(getEntryDisplayNumber(entry, index)).padStart(3, '0')}
                      </div>
                    </div>
                    <span className="rounded-full border border-kumo-line px-2.5 py-1 text-xs font-semibold text-kumo-subtle">
                      第 {entry.versionNumber} 版
                    </span>
                  </div>

                  <div className="mt-6 min-w-0 flex-1">
                    <h3 className="line-clamp-2 text-2xl font-semibold leading-snug text-kumo-strong transition-colors group-hover:text-kumo-default">
                      {entry.name}
                    </h3>
                    <p className="mt-3 line-clamp-3 text-sm leading-6 text-kumo-subtle">
                      {getWikiMarkdownExcerpt(entry.narrative, 132) || '暂无叙述详情...'}
                    </p>
                  </div>

                  <div className="mt-5 flex flex-wrap gap-2">
                    {entry.tags.length === 0 ? (
                      <Badge variant="outline">暂无标签</Badge>
                    ) : entry.tags.slice(0, 2).map((tag) => (
                      <React.Fragment key={tag}>
                        <Badge variant="secondary">#{tag}</Badge>
                      </React.Fragment>
                    ))}
                    {entry.tags.length > 2 && <Badge variant="outline">+{entry.tags.length - 2}</Badge>}
                  </div>

                  <div className="mt-5 flex items-center justify-between gap-3 border-t border-kumo-line pt-4 text-xs text-kumo-subtle">
                    <span className="truncate">更新于 {formatDateTime(entry.updatedAt)}</span>
                    <span className="inline-flex shrink-0 items-center gap-1 font-semibold text-kumo-strong">
                      打开档案
                      <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </div>
                </button>
              </article>
            ))}
          </div>
        )}

        {items.length > 0 && (
          <footer className="mt-5 flex flex-col items-center gap-3">
            {mobileFeed ? (
              <>
                {hasMore ? (
                  <Button type="button" variant="secondary" className="wiki-motion-button" loading={loadingMore} onClick={onLoadMore}>
                    {loadingMore ? '继续加载中' : '加载更多'}
                  </Button>
                ) : (
                  <Badge variant="outline">已浏览到末页</Badge>
                )}
              </>
            ) : (
              <LayerCard className="wiki-surface-soft w-full p-3 shadow-sm">
                <Pagination
                  page={page}
                  setPage={onPageChange}
                  perPage={PAGE_SIZE}
                  totalCount={total}
                  labels={{
                    navigation: '档案分页',
                    firstPage: '第一页',
                    previousPage: '上一页',
                    nextPage: '下一页',
                    lastPage: '最后一页',
                    pageNumber: '页码',
                  }}
                  className="flex-col gap-3 md:flex-row"
                >
                  <Pagination.Info className="grow">
                    {({ pageShowingRange, totalCount }) => (
                      <span>显示 {pageShowingRange} / {totalCount || 0} 条</span>
                    )}
                  </Pagination.Info>
                  <Pagination.Controls controls="full" pageSelector={totalPages <= 12 ? 'dropdown' : 'input'} />
                </Pagination>
              </LayerCard>
            )}
          </footer>
        )}
      </WikiResourceListPage>
    </section>
  );
};

export default WikiGallery;
