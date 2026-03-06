import React, { useCallback, useEffect, useState } from 'react';
import { Search, Star } from 'lucide-react';
import { api } from '../api';
import type { Post } from '../types';
import { useApp } from '../store/AppContext';
import { SketchButton, Badge } from './SketchUI';

const PAGE_SIZE = 20;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DATE_RANGE_DAYS = 7;
const DATE_INPUT_RE = /^\d{4}-\d{2}-\d{2}$/;

const normalizeTag = (value: string) => String(value || '')
  .trim()
  .replace(/^#+/, '')
  .replace(/\s+/g, ' ');

const parsePositiveInt = (value: unknown, fallback = 1) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const normalized = Math.floor(parsed);
  return normalized >= 1 ? normalized : fallback;
};

const formatDateInput = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseDateInput = (value: string) => {
  const normalized = String(value || '').trim();
  if (!DATE_INPUT_RE.test(normalized)) {
    return null;
  }
  const [year, month, day] = normalized.split('-').map((item) => Number(item));
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) {
    return null;
  }
  return date;
};

const getDateRangeState = (startValue: string, endValue: string) => {
  const startDate = String(startValue || '').trim();
  const endDate = String(endValue || '').trim();
  if (!startDate && !endDate) {
    return { startDate: '', endDate: '', hasRange: false, error: '' };
  }
  if (!startDate || !endDate) {
    return { startDate, endDate, hasRange: false, error: '请完整选择开始和结束日期' };
  }

  const start = parseDateInput(startDate);
  const end = parseDateInput(endDate);
  if (!start || !end) {
    return { startDate, endDate, hasRange: false, error: '日期格式无效' };
  }

  const diffDays = Math.round((end.getTime() - start.getTime()) / DAY_MS);
  if (diffDays < 0) {
    return { startDate, endDate, hasRange: false, error: '结束日期不能早于开始日期' };
  }
  if (diffDays >= MAX_DATE_RANGE_DAYS) {
    return { startDate, endDate, hasRange: false, error: `时间范围最多 ${MAX_DATE_RANGE_DAYS} 天` };
  }

  return { startDate, endDate, hasRange: true, error: '' };
};

const addDaysToDateInput = (value: string, offset: number) => {
  const date = parseDateInput(value);
  if (!date) {
    return '';
  }
  const next = new Date(date);
  next.setDate(next.getDate() + offset);
  return formatDateInput(next);
};

const minDateString = (left?: string, right?: string) => {
  if (!left) {
    return right || '';
  }
  if (!right) {
    return left;
  }
  return left < right ? left : right;
};

const buildSearchPath = (query: string, tag: string, startDate: string, endDate: string, page: number) => {
  const params = new URLSearchParams();
  if (query) {
    params.set('q', query);
  }
  if (tag) {
    params.set('tag', tag);
  }
  if (startDate && endDate) {
    params.set('startDate', startDate);
    params.set('endDate', endDate);
  }
  if (page > 1) {
    params.set('page', String(page));
  }
  const qs = params.toString();
  return qs ? `/search?${qs}` : '/search';
};

const readSearchStateFromLocation = () => {
  const params = new URLSearchParams(window.location.search);
  const nextQuery = String(params.get('q') || '').trim();
  const nextTag = normalizeTag(params.get('tag') || '');
  const nextPage = parsePositiveInt(params.get('page'), 1);
  const dateRange = getDateRangeState(
    String(params.get('startDate') || '').trim(),
    String(params.get('endDate') || '').trim()
  );
  return {
    nextQuery,
    nextTag,
    nextPage,
    nextStartDate: dateRange.hasRange ? dateRange.startDate : '',
    nextEndDate: dateRange.hasRange ? dateRange.endDate : '',
  };
};

const SearchView: React.FC = () => {
  const { showToast, isFavorited, toggleFavoritePost } = useApp();
  const [keyword, setKeyword] = useState('');
  const [query, setQuery] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [startDateInput, setStartDateInput] = useState('');
  const [endDateInput, setEndDateInput] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Post[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const hasDateRange = Boolean(startDate && endDate);
  const searchActive = Boolean(query || tagFilter || hasDateRange);
  const todayString = formatDateInput(new Date());
  const startDateMin = endDateInput
    ? addDaysToDateInput(endDateInput, -(MAX_DATE_RANGE_DAYS - 1)) || undefined
    : undefined;
  const startDateMax = endDateInput ? minDateString(endDateInput, todayString) : todayString;
  const endDateMax = startDateInput
    ? minDateString(addDaysToDateInput(startDateInput, MAX_DATE_RANGE_DAYS - 1), todayString)
    : todayString;

  const openPost = (postId: string) => {
    const targetPath = `/post/${encodeURIComponent(postId)}`;
    if (window.location.pathname + window.location.search !== targetPath) {
      window.history.pushState({}, '', targetPath);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  const handleFavorite = async (postId: string) => {
    try {
      const favorited = await toggleFavoritePost(postId);
      showToast(favorited ? '已收藏' : '已取消收藏', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '收藏失败，请稍后重试';
      showToast(message, 'error');
    }
  };

  const syncFromLocation = useCallback(() => {
    const { nextQuery, nextTag, nextPage, nextStartDate, nextEndDate } = readSearchStateFromLocation();
    setKeyword(nextQuery);
    setQuery(nextQuery);
    setTagFilter(nextTag);
    setStartDateInput(nextStartDate);
    setEndDateInput(nextEndDate);
    setStartDate(nextStartDate);
    setEndDate(nextEndDate);
    setPage(nextPage);
  }, []);

  const applySearchState = useCallback((
    nextQuery: string,
    nextTag: string,
    nextStartDate: string,
    nextEndDate: string,
    nextPage = 1,
    replace = false
  ) => {
    const normalizedQuery = String(nextQuery || '').trim();
    const normalizedTag = normalizeTag(nextTag);
    const normalizedDateRange = getDateRangeState(nextStartDate, nextEndDate);
    const normalizedStartDate = normalizedDateRange.hasRange ? normalizedDateRange.startDate : '';
    const normalizedEndDate = normalizedDateRange.hasRange ? normalizedDateRange.endDate : '';
    const pageNumber = parsePositiveInt(nextPage, 1);

    setKeyword(normalizedQuery);
    setQuery(normalizedQuery);
    setTagFilter(normalizedTag);
    setStartDateInput(normalizedStartDate);
    setEndDateInput(normalizedEndDate);
    setStartDate(normalizedStartDate);
    setEndDate(normalizedEndDate);
    setPage(pageNumber);

    const targetPath = buildSearchPath(
      normalizedQuery,
      normalizedTag,
      normalizedStartDate,
      normalizedEndDate,
      pageNumber
    );
    if (window.location.pathname + window.location.search !== targetPath) {
      if (replace) {
        window.history.replaceState({}, '', targetPath);
      } else {
        window.history.pushState({}, '', targetPath);
      }
    }
  }, []);

  const runSearch = useCallback(async (
    nextQuery: string,
    nextPage: number,
    nextTag: string,
    nextStartDate: string,
    nextEndDate: string
  ) => {
    setLoading(true);
    try {
      const data = await api.searchPosts(nextQuery, nextPage, PAGE_SIZE, {
        tag: nextTag || undefined,
        startDate: nextStartDate || undefined,
        endDate: nextEndDate || undefined,
      });
      setItems(Array.isArray(data?.items) ? data.items : []);
      setTotal(Number(data?.total || 0));
    } catch (error) {
      const message = error instanceof Error ? error.message : '搜索失败，请稍后再试';
      showToast(message, 'error');
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    syncFromLocation();
    window.addEventListener('popstate', syncFromLocation);
    return () => {
      window.removeEventListener('popstate', syncFromLocation);
    };
  }, [syncFromLocation]);

  useEffect(() => {
    if (!searchActive) {
      setItems([]);
      setTotal(0);
      return;
    }
    runSearch(query, page, tagFilter, startDate, endDate);
  }, [endDate, page, query, runSearch, searchActive, startDate, tagFilter]);

  const submitSearch = () => {
    const input = keyword.trim();
    const inputTag = /^(#|\uFF03)/.test(input) ? normalizeTag(input) : '';
    const nextQuery = inputTag ? '' : input;
    const nextTag = inputTag || tagFilter;
    const dateRange = getDateRangeState(startDateInput, endDateInput);

    if (dateRange.error) {
      showToast(dateRange.error, 'warning');
      return;
    }
    if (!nextQuery && !nextTag && !dateRange.hasRange) {
      showToast('请输入关键词、选择标签或设置时间范围', 'warning');
      return;
    }

    applySearchState(nextQuery, nextTag, dateRange.startDate, dateRange.endDate, 1);
  };

  const handleTagSearch = (tag: string) => {
    applySearchState('', tag, startDate, endDate, 1);
  };

  const clearTagFilter = () => {
    applySearchState(query, '', startDate, endDate, 1);
  };

  const clearDateRange = () => {
    applySearchState(query, tagFilter, '', '', 1);
  };

  return (
    <div className="max-w-2xl mx-auto min-w-0 px-4 pb-20 pt-6">
      <div className="text-center mb-10 relative">
        <h2 className="font-display text-4xl inline-block relative z-10">
          搜索帖子
          <div className="absolute -bottom-2 left-0 w-full h-3 bg-highlight/60 -z-10 -rotate-1 skew-x-12"></div>
        </h2>
        <p className="mt-3 text-sm text-pencil font-sans">
          支持关键词、标签和日期区间搜索，时间范围最多 7 天
        </p>

        <div className="mt-6 flex justify-center">
          <form
            className="w-full max-w-2xl space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              submitSearch();
            }}
          >
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-pencil w-4 h-4" />
                <input
                  type="text"
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder="输入关键词，或输入 #标签"
                  className="w-full pl-9 pr-4 py-2 rounded-full border-2 border-ink bg-white text-sm focus:shadow-sketch-sm outline-none transition-all font-sans"
                  disabled={loading}
                />
              </div>
              <SketchButton
                type="submit"
                variant="primary"
                className="h-10 px-4 text-base sm:min-w-24"
                disabled={loading}
              >
                搜索
              </SketchButton>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-left">
                <span className="text-xs text-pencil font-sans">开始日期</span>
                <input
                  type="date"
                  value={startDateInput}
                  min={startDateMin}
                  max={startDateMax}
                  onChange={(event) => setStartDateInput(event.target.value)}
                  className="w-full px-4 py-2 rounded-full border-2 border-ink bg-white text-sm focus:shadow-sketch-sm outline-none transition-all font-sans"
                  disabled={loading}
                />
              </label>
              <label className="flex flex-col gap-1 text-left">
                <span className="text-xs text-pencil font-sans">结束日期</span>
                <input
                  type="date"
                  value={endDateInput}
                  min={startDateInput || undefined}
                  max={endDateMax}
                  onChange={(event) => setEndDateInput(event.target.value)}
                  className="w-full px-4 py-2 rounded-full border-2 border-ink bg-white text-sm focus:shadow-sketch-sm outline-none transition-all font-sans"
                  disabled={loading}
                />
              </label>
            </div>
          </form>
        </div>

        {(tagFilter || hasDateRange) && (
          <div className="mt-3 flex min-w-0 flex-wrap items-center justify-center gap-2">
            {tagFilter && (
              <button
                type="button"
                onClick={clearTagFilter}
                className="inline-flex min-w-0 max-w-full flex-wrap items-center justify-center gap-1 break-all rounded-full border border-ink bg-highlight px-3 py-1 text-left text-xs font-bold text-ink"
              >
                标签 #{tagFilter} · 清除
              </button>
            )}
            {hasDateRange && (
              <button
                type="button"
                onClick={clearDateRange}
                className="inline-flex items-center gap-1 px-3 py-1 border border-ink rounded-full bg-paper text-xs font-bold text-ink"
              >
                时间 {startDate} 至 {endDate} · 清除
              </button>
            )}
          </div>
        )}

        {searchActive && (
          <div className="mt-4 break-all text-sm text-pencil">
            {query ? `关键词“${query}” ` : ''}
            {tagFilter ? `标签 #${tagFilter} ` : ''}
            {hasDateRange ? `时间 ${startDate} 至 ${endDate} ` : ''}
            · 共 {total} 条 · 第 {page} / {totalPages} 页
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4">
        {!searchActive ? (
          <div className="text-center py-16">
            <h3 className="font-display text-2xl text-ink mb-2">输入关键词、选择标签或设置时间范围</h3>
            <p className="font-hand text-lg text-pencil">只选时间也可以搜索对应时间内的帖子</p>
          </div>
        ) : loading ? (
          <div className="text-center py-16">
            <p className="font-hand text-lg text-pencil">正在搜索...</p>
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-16">
            <h3 className="font-display text-2xl text-ink mb-2">没有找到结果</h3>
            <p className="font-hand text-lg text-pencil">换个关键词、标签或时间试试</p>
          </div>
        ) : (
          items.map((post) => (
            <div key={post.id} className="min-w-0 rounded-lg border-2 border-ink bg-white p-5 shadow-sketch transition-all hover:shadow-sketch-hover">
              <div className="mb-2 flex min-w-0 flex-wrap gap-2">
                {post.isHot && <Badge color="bg-highlight">热门</Badge>}
                {(post.tags || []).slice(0, 2).map((tag) => (
                  <button
                    type="button"
                    key={tag}
                    onClick={() => handleTagSearch(tag)}
                    className="inline-flex min-w-0 max-w-full text-left"
                  >
                    <Badge allowWrap className="max-w-full text-left">#{tag}</Badge>
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => openPost(post.id)}
                className="w-full text-left"
              >
                <div className="line-clamp-4 break-all text-base leading-relaxed text-ink font-sans">
                  {post.content}
                </div>
              </button>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-pencil font-sans">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span>{post.timestamp}</span>
                  <span>·</span>
                  <span>赞 {post.likes}</span>
                  <span>·</span>
                  <span>踩 {post.dislikes}</span>
                  <span>·</span>
                  <span>评 {post.comments}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleFavorite(post.id)}
                    className={`inline-flex items-center gap-1 font-bold transition-colors ${isFavorited(post.id) ? 'text-amber-600' : 'text-ink hover:underline'}`}
                    title={isFavorited(post.id) ? '取消收藏' : '收藏'}
                    aria-label={isFavorited(post.id) ? '取消收藏' : '收藏'}
                  >
                    <Star className={`w-4 h-4 ${isFavorited(post.id) ? 'fill-current' : ''}`} />
                  </button>
                  <button
                    type="button"
                    onClick={() => openPost(post.id)}
                    className="font-bold text-ink hover:underline"
                  >
                    打开
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {searchActive && totalPages > 1 && (
        <div className="mt-10 flex items-center justify-center gap-3">
          <SketchButton
            type="button"
            variant="secondary"
            className="h-10 px-4 text-base"
            disabled={loading || page <= 1}
            onClick={() => applySearchState(query, tagFilter, startDate, endDate, Math.max(page - 1, 1))}
          >
            上一页
          </SketchButton>
          <SketchButton
            type="button"
            variant="secondary"
            className="h-10 px-4 text-base"
            disabled={loading || page >= totalPages}
            onClick={() => applySearchState(query, tagFilter, startDate, endDate, Math.min(page + 1, totalPages))}
          >
            下一页
          </SketchButton>
        </div>
      )}
    </div>
  );
};

export default SearchView;
