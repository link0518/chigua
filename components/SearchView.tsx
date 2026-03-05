import React, { useCallback, useEffect, useState } from 'react';
import { Search, Star } from 'lucide-react';
import { api } from '../api';
import type { Post } from '../types';
import { useApp } from '../store/AppContext';
import { SketchButton, Badge } from './SketchUI';

const PAGE_SIZE = 20;

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

const buildSearchPath = (query: string, tag: string, page: number) => {
  const params = new URLSearchParams();
  if (query) {
    params.set('q', query);
  }
  if (tag) {
    params.set('tag', tag);
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
  return { nextQuery, nextTag, nextPage };
};

const SearchView: React.FC = () => {
  const { showToast, isFavorited, toggleFavoritePost } = useApp();
  const [keyword, setKeyword] = useState('');
  const [query, setQuery] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Post[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

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
    const { nextQuery, nextTag, nextPage } = readSearchStateFromLocation();
    setKeyword(nextQuery);
    setQuery(nextQuery);
    setTagFilter(nextTag);
    setPage(nextPage);
  }, []);

  const applySearchState = useCallback((nextQuery: string, nextTag: string, nextPage = 1, replace = false) => {
    const normalizedQuery = String(nextQuery || '').trim();
    const normalizedTag = normalizeTag(nextTag);
    const pageNumber = parsePositiveInt(nextPage, 1);
    setKeyword(normalizedQuery);
    setQuery(normalizedQuery);
    setTagFilter(normalizedTag);
    setPage(pageNumber);
    const targetPath = buildSearchPath(normalizedQuery, normalizedTag, pageNumber);
    if (window.location.pathname + window.location.search !== targetPath) {
      if (replace) {
        window.history.replaceState({}, '', targetPath);
      } else {
        window.history.pushState({}, '', targetPath);
      }
    }
  }, []);

  const runSearch = useCallback(async (nextQuery: string, nextPage: number, nextTag: string) => {
    setLoading(true);
    try {
      const data = await api.searchPosts(nextQuery, nextPage, PAGE_SIZE, { tag: nextTag || undefined });
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
    if (!query && !tagFilter) {
      setItems([]);
      setTotal(0);
      return;
    }
    runSearch(query, page, tagFilter);
  }, [page, query, runSearch, tagFilter]);

  const submitSearch = () => {
    const input = keyword.trim();
    const inputTag = /^(#|\uFF03)/.test(input) ? normalizeTag(input) : '';
    const nextQuery = inputTag ? '' : input;
    const nextTag = inputTag || tagFilter;
    if (!nextQuery && !nextTag) {
      showToast('请输入关键字或选择标签', 'warning');
      return;
    }
    applySearchState(nextQuery, nextTag, 1);
  };

  const handleTagSearch = (tag: string) => {
    applySearchState('', tag, 1);
  };

  const clearTagFilter = () => {
    applySearchState(query, '', 1);
  };

  return (
    <div className="max-w-2xl mx-auto px-4 pb-20 pt-6">
      <div className="text-center mb-10 relative">
        <h2 className="font-display text-4xl inline-block relative z-10">
          搜索帖子
          <div className="absolute -bottom-2 left-0 w-full h-3 bg-highlight/60 -z-10 -rotate-1 skew-x-12"></div>
        </h2>
        <p className="mt-3 text-sm text-pencil font-sans">支持关键字与标签搜索，输入 #标签 可直接按标签查找</p>

        <div className="mt-6 flex justify-center">
          <form
            className="w-full max-w-md flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              submitSearch();
            }}
          >
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-pencil w-4 h-4" />
              <input
                type="text"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="输入关键字，或输入 #标签"
                className="w-full pl-9 pr-4 py-2 rounded-full border-2 border-ink bg-white text-sm focus:shadow-sketch-sm outline-none transition-all font-sans"
                disabled={loading}
              />
            </div>
            <SketchButton
              type="submit"
              variant="primary"
              className="h-10 px-4 text-base"
              disabled={loading}
            >
              搜索
            </SketchButton>
          </form>
        </div>

        {tagFilter && (
          <div className="mt-3 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={clearTagFilter}
              className="inline-flex items-center gap-1 px-3 py-1 border border-ink rounded-full bg-highlight text-xs font-bold text-ink"
            >
              标签 #{tagFilter} · 清除
            </button>
          </div>
        )}

        {(query || tagFilter) && (
          <div className="mt-4 text-sm text-pencil">
            {query ? `关键字“${query}” ` : ''}
            {tagFilter ? `标签 #${tagFilter} ` : ''}
            · 共 {total} 条 · 第 {page} / {totalPages} 页
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4">
        {!query && !tagFilter ? (
          <div className="text-center py-16">
            <span className="text-6xl mb-4 block">🔎</span>
            <h3 className="font-display text-2xl text-ink mb-2">输入关键字或点击标签开始搜索</h3>
          </div>
        ) : loading ? (
          <div className="text-center py-16">
            <span className="text-5xl mb-4 block">⏳</span>
            <p className="font-hand text-lg text-pencil">正在搜索...</p>
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-16">
            <span className="text-6xl mb-4 block">🍉</span>
            <h3 className="font-display text-2xl text-ink mb-2">没有找到结果</h3>
            <p className="font-hand text-lg text-pencil">换个关键字或标签试试</p>
          </div>
        ) : (
          items.map((post) => (
            <div key={post.id} className="bg-white border-2 border-ink p-5 rounded-lg shadow-sketch hover:shadow-sketch-hover transition-all">
              <div className="flex gap-2 mb-2 flex-wrap">
                {post.isHot && <Badge color="bg-highlight">🔥 热门</Badge>}
                {(post.tags || []).slice(0, 2).map((tag) => (
                  <button
                    type="button"
                    key={tag}
                    onClick={() => handleTagSearch(tag)}
                    className="inline-flex"
                  >
                    <Badge>#{tag}</Badge>
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => openPost(post.id)}
                className="w-full text-left"
              >
                <div className="text-ink font-sans text-base leading-relaxed line-clamp-4">
                  {post.content}
                </div>
              </button>

              <div className="mt-3 flex items-center justify-between text-xs text-pencil font-sans">
                <div className="flex items-center gap-2">
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

      {(query || tagFilter) && totalPages > 1 && (
        <div className="mt-10 flex items-center justify-center gap-3">
          <SketchButton
            type="button"
            variant="secondary"
            className="h-10 px-4 text-base"
            disabled={loading || page <= 1}
            onClick={() => applySearchState(query, tagFilter, Math.max(page - 1, 1))}
          >
            上一页
          </SketchButton>
          <SketchButton
            type="button"
            variant="secondary"
            className="h-10 px-4 text-base"
            disabled={loading || page >= totalPages}
            onClick={() => applySearchState(query, tagFilter, Math.min(page + 1, totalPages))}
          >
            下一页
          </SketchButton>
        </div>
      )}
    </div>
  );
};

export default SearchView;

