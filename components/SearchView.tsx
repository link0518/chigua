import React, { useCallback, useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { api } from '../api';
import type { Post } from '../types';
import { useApp } from '../store/AppContext';
import { SketchButton, Badge } from './SketchUI';

const PAGE_SIZE = 20;

const SearchView: React.FC = () => {
  const { showToast } = useApp();
  const [keyword, setKeyword] = useState('');
  const [query, setQuery] = useState('');
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

  const runSearch = useCallback(async (nextQuery: string, nextPage: number) => {
    setLoading(true);
    try {
      const data = await api.searchPosts(nextQuery, nextPage, PAGE_SIZE);
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

  const submitSearch = () => {
    const nextQuery = keyword.trim();
    if (!nextQuery) {
      showToast('请输入关键字', 'warning');
      return;
    }
    setQuery(nextQuery);
    setPage(1);
    runSearch(nextQuery, 1);
  };

  useEffect(() => {
    if (!query) {
      return;
    }
    runSearch(query, page);
  }, [page, query, runSearch]);

  return (
    <div className="max-w-2xl mx-auto px-4 pb-20 pt-6">
      <div className="text-center mb-10 relative">
        <h2 className="font-display text-4xl inline-block relative z-10">
          搜索帖子
          <div className="absolute -bottom-2 left-0 w-full h-3 bg-highlight/60 -z-10 -rotate-1 skew-x-12"></div>
        </h2>
        <p className="mt-3 text-sm text-pencil font-sans">仅按正文关键字搜索（全站）</p>

        <div className="mt-6 flex justify-center">
          <div className="w-full max-w-md flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-pencil w-4 h-4" />
              <input
                type="text"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="输入关键字..."
                className="w-full pl-9 pr-4 py-2 rounded-full border-2 border-ink bg-white text-sm focus:shadow-sketch-sm outline-none transition-all font-sans"
                disabled={loading}
              />
            </div>
            <SketchButton
              type="button"
              variant="primary"
              className="h-10 px-4 text-base"
              onClick={submitSearch}
              disabled={loading}
            >
              搜索
            </SketchButton>
          </div>
        </div>

        {query && (
          <div className="mt-4 text-sm text-pencil">
            关键字 “{query}” · 共 {total} 条 · 第 {page} / {totalPages} 页
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4">
        {!query ? (
          <div className="text-center py-16">
            <span className="text-6xl mb-4 block">🔎</span>
            <h3 className="font-display text-2xl text-ink mb-2">输入关键字开始搜索</h3>

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
            <p className="font-hand text-lg text-pencil">换个关键词试试</p>
          </div>
        ) : (
          items.map((post) => (
            <div key={post.id} className="bg-white border-2 border-ink p-5 rounded-lg shadow-sketch hover:shadow-sketch-hover transition-all">
              <div className="flex gap-2 mb-2 flex-wrap">
                {post.isHot && <Badge color="bg-highlight">🔥 热门</Badge>}
                {(post.tags || []).slice(0, 3).map((tag) => (
                  <Badge key={tag}>{tag}</Badge>
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
                  <span>评 {post.comments}</span>
                </div>
                <button
                  type="button"
                  onClick={() => openPost(post.id)}
                  className="font-bold text-ink hover:underline"
                >
                  打开
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {query && totalPages > 1 && (
        <div className="mt-10 flex items-center justify-center gap-3">
          <SketchButton
            type="button"
            variant="secondary"
            className="h-10 px-4 text-base"
            disabled={loading || page <= 1}
            onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
          >
            上一页
          </SketchButton>
          <SketchButton
            type="button"
            variant="secondary"
            className="h-10 px-4 text-base"
            disabled={loading || page >= totalPages}
            onClick={() => setPage((prev) => Math.min(prev + 1, totalPages))}
          >
            下一页
          </SketchButton>
        </div>
      )}
    </div>
  );
};

export default SearchView;
