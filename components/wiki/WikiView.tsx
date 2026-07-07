import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '../../api';
import { useApp } from '../../store/AppContext';
import {
  PAGE_SIZE,
  WIKI_DETAIL_ENTER_MS,
  WIKI_DETAIL_EXIT_MS,
  WIKI_OVERLAY_MODAL_SELECTOR,
} from './wikiConstants';
import WikiEntryDetail from './WikiEntryDetail';
import WikiFloatingFeedback from './WikiFeedback';
import WikiGallery from './WikiGallery';
import { useWikiFeedback, useWikiMobileFeed } from './wikiHooks';
import WikiNeutralNoticeModal from './WikiNeutralNoticeModal';
import WikiShell from './WikiShell';
import type {
  WikiDetailResponse,
  WikiEntry,
  WikiEntrySort,
  WikiFormMode,
  WikiListResponse,
  WikiRevision,
} from './wikiTypes';
import {
  createWikiListUrl,
  getSlugFromPath,
  getWikiListStateFromHref,
} from './wikiUtils';

const loadWikiEntryFormModal = () => import('./WikiEntryFormModal');
const WikiEntryFormModal = React.lazy(loadWikiEntryFormModal);

const WikiView: React.FC = () => {
  const { state } = useApp();
  const initialListState = useMemo(() => getWikiListStateFromHref(window.location.href), []);
  const [path, setPath] = useState(window.location.pathname);
  const [entries, setEntries] = useState<WikiEntry[]>([]);
  const [tags, setTags] = useState<Array<{ name: string; count: number }>>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(initialListState.page);
  const [query, setQuery] = useState(initialListState.query);
  const [activeTag, setActiveTag] = useState(initialListState.tag);
  const [sortBy, setSortBy] = useState<WikiEntrySort>(initialListState.sortBy);
  const [listLoading, setListLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailEntry, setDetailEntry] = useState<WikiEntry | null>(null);
  const [history, setHistory] = useState<WikiRevision[]>([]);
  const [formMode, setFormMode] = useState<WikiFormMode>('create');
  const [formEntry, setFormEntry] = useState<WikiEntry | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [neutralNoticeOpen, setNeutralNoticeOpen] = useState(false);
  const { feedback, showFeedback } = useWikiFeedback();
  const isMobileFeed = useWikiMobileFeed();
  const listRequestRef = useRef(0);
  const detailAnimationFrameRef = useRef<number | null>(null);
  const detailCloseTimerRef = useRef<number | null>(null);
  const slug = useMemo(() => getSlugFromPath(path), [path]);
  const isDetail = Boolean(slug);
  const [detailMounted, setDetailMounted] = useState(isDetail);
  const [detailVisible, setDetailVisible] = useState(false);
  const detailActive = isDetail || detailMounted;
  const detailTransitionStyle = useMemo(() => ({
    '--wiki-detail-enter-ms': `${WIKI_DETAIL_ENTER_MS}ms`,
    '--wiki-detail-exit-ms': `${WIKI_DETAIL_EXIT_MS}ms`,
  }) as React.CSSProperties, []);
  const listUrl = useMemo(
    () => createWikiListUrl({ query, tag: activeTag, sortBy, page }),
    [activeTag, page, query, sortBy],
  );

  const syncListStateFromHref = useCallback((href: string) => {
    const nextState = getWikiListStateFromHref(href);
    setQuery(nextState.query);
    setActiveTag(nextState.tag);
    setSortBy(nextState.sortBy);
    setPage(nextState.page);
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      const nextPath = window.location.pathname;
      setPath(nextPath);
      if (!getSlugFromPath(nextPath)) {
        syncListStateFromHref(window.location.href);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [syncListStateFromHref]);

  useEffect(() => () => {
    if (detailAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(detailAnimationFrameRef.current);
    }
    if (detailCloseTimerRef.current !== null) {
      window.clearTimeout(detailCloseTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (detailAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(detailAnimationFrameRef.current);
      detailAnimationFrameRef.current = null;
    }
    if (detailCloseTimerRef.current !== null) {
      window.clearTimeout(detailCloseTimerRef.current);
      detailCloseTimerRef.current = null;
    }

    if (isDetail) {
      setDetailMounted(true);
      setDetailVisible(false);
      detailAnimationFrameRef.current = window.requestAnimationFrame(() => {
        detailAnimationFrameRef.current = window.requestAnimationFrame(() => {
          setDetailVisible(true);
          detailAnimationFrameRef.current = null;
        });
      });
      return;
    }

    setDetailVisible(false);
    if (!detailMounted) {
      return;
    }

    detailCloseTimerRef.current = window.setTimeout(() => {
      setDetailMounted(false);
      detailCloseTimerRef.current = null;
    }, WIKI_DETAIL_EXIT_MS);
  }, [detailMounted, isDetail]);

  useEffect(() => {
    setPage(1);
  }, [isMobileFeed]);

  const navigateTo = useCallback((targetPath: string) => {
    const url = new URL(targetPath, window.location.origin);
    const nextUrl = `${url.pathname}${url.search}`;
    const currentUrl = `${window.location.pathname}${window.location.search}`;
    if (currentUrl !== nextUrl) {
      window.history.pushState({}, '', nextUrl);
    }
    setPath(url.pathname);
    if (!getSlugFromPath(url.pathname)) {
      syncListStateFromHref(url.toString());
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [syncListStateFromHref]);

  useEffect(() => {
    if (isDetail) {
      return;
    }
    const currentUrl = `${window.location.pathname}${window.location.search}`;
    if (currentUrl !== listUrl) {
      window.history.replaceState(window.history.state, '', listUrl);
    }
  }, [isDetail, listUrl]);

  useEffect(() => {
    if (!detailActive) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) {
        return;
      }

      if (document.querySelector(WIKI_OVERLAY_MODAL_SELECTOR)) {
        return;
      }

      event.preventDefault();
      navigateTo(listUrl);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [detailActive, listUrl, navigateTo]);

  const loadEntries = useCallback(async () => {
    const requestId = listRequestRef.current + 1;
    listRequestRef.current = requestId;
    const shouldAppend = isMobileFeed && page > 1;
    const requestedPage = page;

    setListLoading(true);
    try {
      const data: WikiListResponse = await api.getWikiEntries({
        q: query,
        tag: activeTag,
        sort: sortBy,
        page,
        limit: PAGE_SIZE,
      });
      if (requestId !== listRequestRef.current) {
        return;
      }

      const nextItems = Array.isArray(data?.items) ? data.items : [];
      setEntries((prev) => {
        if (!shouldAppend) {
          return nextItems;
        }

        const existingIds = new Set(prev.map((item) => item.id));
        const mergedItems = nextItems.filter((item) => !existingIds.has(item.id));
        return [...prev, ...mergedItems];
      });
      setTags(Array.isArray(data?.tags) ? data.tags : []);
      setTotal(Number(data?.total || 0));
    } catch {
      if (requestId !== listRequestRef.current) {
        return;
      }

      if (shouldAppend) {
        setPage((prev) => (prev === requestedPage ? Math.max(requestedPage - 1, 1) : prev));
      } else {
        setEntries([]);
        setTags([]);
        setTotal(0);
      }
    } finally {
      if (requestId === listRequestRef.current) {
        setListLoading(false);
      }
    }
  }, [activeTag, isMobileFeed, page, query, sortBy]);

  const loadDetail = useCallback(async () => {
    if (!slug) {
      return;
    }
    setDetailLoading(true);
    setDetailError('');
    try {
      const data: WikiDetailResponse = await api.getWikiEntry(slug);
      setDetailEntry(data.entry || null);
      setHistory(Array.isArray(data.history) ? data.history : []);
    } catch (error) {
      setDetailEntry(null);
      setHistory([]);
      setDetailError(error instanceof Error ? error.message : '瓜条不存在或尚未公开。');
    } finally {
      setDetailLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  useEffect(() => {
    if (isDetail) {
      loadDetail();
    }
  }, [isDetail, loadDetail]);

  const openCreate = () => {
    void loadWikiEntryFormModal();
    setNeutralNoticeOpen(true);
  };

  const confirmCreate = () => {
    setNeutralNoticeOpen(false);
    setFormMode('create');
    setFormEntry(null);
    setFormOpen(true);
  };

  const openEdit = (entry: WikiEntry) => {
    void loadWikiEntryFormModal();
    setFormMode('edit');
    setFormEntry(entry);
    setFormOpen(true);
  };

  const handleSubmitted = (message: string) => {
    showFeedback(message);
    if (isDetail) {
      loadDetail();
    } else {
      loadEntries();
    }
  };

  const handleSearchCurrentEntry = useCallback(() => {
    const keyword = String(detailEntry?.name || '').trim();
    if (!keyword) {
      return;
    }

    const params = new URLSearchParams();
    params.set('q', keyword);
    const targetUrl = `${window.location.origin}/search?${params.toString()}`;
    const newWindow = window.open(targetUrl, '_blank', 'noopener,noreferrer');
    if (newWindow) {
      newWindow.opener = null;
    }
  }, [detailEntry]);

  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const hasMoreEntries = isMobileFeed && !isDetail && page < totalPages && entries.length < total;
  const loadingMore = isMobileFeed && page > 1 && listLoading;

  const loadMoreEntries = useCallback(() => {
    if (!hasMoreEntries || listLoading) {
      return;
    }

    setPage((prev) => Math.min(prev + 1, totalPages));
  }, [hasMoreEntries, listLoading, totalPages]);

  const clearListFilters = useCallback(() => {
    setQuery('');
    setActiveTag('');
    setSortBy('updated');
    setPage(1);
  }, []);

  return (
    <WikiShell
      tags={tags}
      activeTag={activeTag}
      total={total}
      onTagChange={(val) => {
        setActiveTag(val);
        setPage(1);
      }}
      onOpenSubmit={openCreate}
      onNavigateHome={() => navigateTo(listUrl)}
      query={query}
      onQueryChange={(val) => {
        setQuery(val);
        setPage(1);
      }}
    >
      <WikiFloatingFeedback feedback={feedback} />

      <WikiGallery
        items={entries}
        total={total}
        page={page}
        loading={listLoading && (!isMobileFeed || page === 1 || entries.length === 0)}
        loadingMore={loadingMore}
        mobileFeed={isMobileFeed}
        hasMore={hasMoreEntries}
        sortBy={sortBy}
        query={query}
        activeTag={activeTag}
        onPageChange={setPage}
        onSortChange={(value) => {
          setSortBy(value);
          setPage(1);
        }}
        onClearFilters={clearListFilters}
        onLoadMore={loadMoreEntries}
        onOpenEntry={(entrySlug) => navigateTo(`/wiki/${encodeURIComponent(entrySlug)}`)}
      />

      <div
        className={`wiki-detail-overlay pointer-events-none fixed inset-0 right-0 z-[60] w-full lg:left-80 lg:w-auto 2xl:left-auto 2xl:w-[1300px] ${detailVisible ? 'is-open' : ''}`}
        style={detailTransitionStyle}
      >
        <button
          type="button"
          aria-label="关闭瓜条详情"
          className={`wiki-detail-scrim absolute inset-0 z-0 lg:hidden ${detailActive ? 'pointer-events-auto' : 'pointer-events-none'}`}
          onClick={() => navigateTo(listUrl)}
        />
        <div
          className={`wiki-detail-shell absolute inset-y-0 right-0 z-10 w-full overflow-hidden bg-kumo-overlay lg:border-l ${detailActive ? 'pointer-events-auto' : 'pointer-events-none'}`}
        >
          <div
            className="wiki-detail-content absolute inset-y-0 right-0 w-full min-w-0"
          >
            {detailActive && (
              <WikiEntryDetail
                entry={detailEntry}
                history={history}
                loading={detailLoading}
                error={detailError}
                onBack={() => navigateTo(listUrl)}
                onEdit={openEdit}
                onSearchCurrentEntry={handleSearchCurrentEntry}
              />
            )}
          </div>
        </div>
      </div>

      {formOpen && (
        <React.Suspense
          fallback={(
            <div data-wiki-overlay-modal="true" className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-6">
              <button
                type="button"
                aria-label="关闭表单载入层"
                className="wiki-modal-backdrop-enter fixed inset-0 bg-kumo-scrim/45 backdrop-blur-sm"
                onClick={() => setFormOpen(false)}
              />
              <div
                role="dialog"
                aria-modal="true"
                aria-label="表单载入中"
                className="wiki-modal-panel-enter wiki-form-modal-panel wiki-surface-soft relative z-10 flex w-full max-w-lg flex-col gap-4 overflow-hidden rounded-t-2xl border border-kumo-line bg-kumo-base px-5 py-5 text-sm text-kumo-subtle shadow-2xl sm:rounded-2xl"
              >
                <div>
                  <div className="text-base font-semibold text-kumo-strong">表单载入中...</div>
                  <p className="mt-1 leading-6">正在准备 Markdown 编辑器和审核字段。</p>
                </div>
                <button
                  type="button"
                  className="wiki-motion-button wiki-focus-ring min-h-10 rounded-lg border border-kumo-line bg-kumo-base px-4 py-2 text-sm font-semibold text-kumo-default"
                  onClick={() => setFormOpen(false)}
                >
                  取消
                </button>
              </div>
            </div>
          )}
        >
          <WikiEntryFormModal
            mode={formMode}
            open={formOpen}
            entry={formEntry}
            turnstileEnabled={state.settings.turnstileEnabled}
            onClose={() => setFormOpen(false)}
            onSubmitted={handleSubmitted}
          />
        </React.Suspense>
      )}
      <WikiNeutralNoticeModal
        open={neutralNoticeOpen}
        onCancel={() => setNeutralNoticeOpen(false)}
        onConfirm={confirmCreate}
      />
    </WikiShell>
  );
};

export default WikiView;
