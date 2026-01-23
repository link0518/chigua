import React, { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { SketchButton } from './SketchUI';
import { api } from '../api';
import { Comment } from '../types';
import { useApp } from '../store/AppContext';
import MarkdownRenderer from './MarkdownRenderer';
import Turnstile, { TurnstileHandle } from './Turnstile';

interface CommentModalProps {
  isOpen: boolean;
  onClose: () => void;
  postId: string;
  contentPreview?: string;
}

const MAX_LENGTH = 300;

const CommentModal: React.FC<CommentModalProps> = ({
  isOpen,
  onClose,
  postId,
  contentPreview,
}) => {
  const { addComment, showToast } = useApp();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [text, setText] = useState('');
  const [replyToId, setReplyToId] = useState<string | null>(null);
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set());
  const [lastAddedId, setLastAddedId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const listRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const turnstileRef = useRef<TurnstileHandle | null>(null);
  const pageSize = 10;

  useEffect(() => {
    if (!isOpen || !postId) return;
    setComments([]);
    setReplyToId(null);
    setExpandedThreads(new Set());
    setLastAddedId(null);
    setPage(0);
    setHasMore(true);
    setLoading(true);
    const cacheKey = `comments:${postId}`;
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed.items)) {
          setComments(parsed.items);
          setPage(Number(parsed.page || 0));
          setHasMore(Boolean(parsed.hasMore));
        }
      } catch {
        // ignore cache errors
      }
    }

    api
      .getComments(postId, 0, pageSize)
      .then((data) => {
        const items = data.items || [];
        const total = Number(data.total || 0);
        const nextHasMore = items.length + 0 < total;
        setComments(items);
        setPage(1);
        setHasMore(nextHasMore);
        sessionStorage.setItem(cacheKey, JSON.stringify({
          items,
          page: 1,
          hasMore: nextHasMore,
        }));
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : '评论加载失败';
        showToast(message, 'error');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [isOpen, postId, showToast]);

  const handleLoadMore = async () => {
    if (loadingMore || !hasMore) {
      return;
    }
    setLoadingMore(true);
    try {
      const offset = page * pageSize;
      const data = await api.getComments(postId, offset, pageSize);
      const items = data.items || [];
      const total = Number(data.total || 0);
      setComments((prev) => [...prev, ...items]);
      const nextPage = page + 1;
      const nextHasMore = offset + items.length < total;
      setPage(nextPage);
      setHasMore(nextHasMore);
      sessionStorage.setItem(`comments:${postId}`, JSON.stringify({
        items: [...comments, ...items],
        page: nextPage,
        hasMore: nextHasMore,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : '加载更多失败';
      showToast(message, 'error');
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    if (!hasMore || loading || loadingMore) {
      return;
    }
    const root = listRef.current;
    const sentinel = loadMoreRef.current;
    if (!root || !sentinel) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          handleLoadMore();
        }
      },
      { root, rootMargin: '60px', threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loading, loadingMore, page]);

  const toggleThread = (commentId: string) => {
    setExpandedThreads((prev) => {
      const next = new Set(prev);
      if (next.has(commentId)) {
        next.delete(commentId);
      } else {
        next.add(commentId);
      }
      return next;
    });
  };

  const insertReply = (items: Comment[], parentId: string, comment: Comment): Comment[] => {
    return items.map((item) => {
      if (item.id === parentId) {
        const replies = item.replies ? [comment, ...item.replies] : [comment];
        return { ...item, replies };
      }
      if (item.replies?.length) {
        return { ...item, replies: insertReply(item.replies, parentId, comment) };
      }
      return item;
    });
  };

  const findAncestorChain = (items: Comment[], targetId: string, chain: string[] = []): string[] | null => {
    for (const item of items) {
      if (item.id === targetId) {
        return [...chain, item.id];
      }
      if (item.replies?.length) {
        const result = findAncestorChain(item.replies, targetId, [...chain, item.id]);
        if (result) {
          return result;
        }
      }
    }
    return null;
  };

  const buildOrderMap = (items: Comment[]) => {
    const sorted = [...items].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    const map = new Map<string, number>();
    sorted.forEach((item, index) => {
      map.set(item.id, index + 1);
    });
    return map;
  };

  const countComments = (items: Comment[]): number => {
    return items.reduce((sum, item) => sum + 1 + countComments(item.replies || []), 0);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) {
      showToast('评论不能为空', 'warning');
      return;
    }
    if (trimmed.length > MAX_LENGTH) {
      showToast('评论长度不能超过 300 字', 'error');
      return;
    }

    setSubmitting(true);
    try {
      if (!turnstileRef.current) {
        throw new Error('安全验证加载中，请稍后再试');
      }
      const turnstileToken = await turnstileRef.current.execute();
      const comment = await addComment(postId, trimmed, turnstileToken, replyToId, replyToId);
      let effectiveParentId = comment.parentId || null;
      if (replyToId) {
        const chain = findAncestorChain(comments, replyToId);
        if (chain && chain.length > 1) {
          effectiveParentId = chain[0];
        }
      }

      const nextComment = { ...comment, parentId: effectiveParentId, replyToId: comment.replyToId || replyToId || null, replies: comment.replies || [] };
      const expandedTargets = effectiveParentId
        ? findAncestorChain(comments, effectiveParentId) || [effectiveParentId]
        : [];
      setComments((prev) => (
        effectiveParentId
          ? insertReply(prev, effectiveParentId, nextComment)
          : [nextComment, ...prev]
      ));
      sessionStorage.setItem(`comments:${postId}`, JSON.stringify({
        items: effectiveParentId
          ? insertReply(comments, effectiveParentId, nextComment)
          : [nextComment, ...comments],
        page,
        hasMore,
      }));
      setLastAddedId(nextComment.id);
      if (expandedTargets.length) {
        setExpandedThreads((prev) => {
          const next = new Set(prev);
          expandedTargets.forEach((id) => next.add(id));
          return next;
        });
      }
      setText('');
      setReplyToId(null);
      showToast('评论已发布', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '评论失败，请稍后重试';
      showToast(message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (!lastAddedId || !listRef.current) {
      return;
    }
    const target = listRef.current.querySelector(`[data-comment-id="${lastAddedId}"]`);
    if (target) {
      requestAnimationFrame(() => {
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
    }
    setLastAddedId(null);
  }, [lastAddedId, comments]);

  if (!isOpen) {
    return null;
  }

  const totalCount = countComments(comments);
  const buildLabelMap = (items: Comment[], parentLabel = '', result = new Map<string, string>()) => {
    const orderMap = buildOrderMap(items);
    items
      .slice()
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
      .forEach((item) => {
        const currentLabel = parentLabel
          ? `${parentLabel}.${orderMap.get(item.id) || 1}`
          : `${orderMap.get(item.id) || 1}`;
        result.set(item.id, currentLabel);
        if (item.replies?.length) {
          buildLabelMap(item.replies, currentLabel, result);
        }
      });
    return result;
  };

  const labelMap = buildLabelMap(comments);

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 max-h-[75vh] rounded-t-xl border border-gray-200 bg-white p-4 shadow-lg font-sans animate-in slide-in-from-bottom-2 duration-200 md:static md:mt-4 md:max-h-none md:rounded-xl md:shadow-sm md:animate-none">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="font-sans font-semibold text-lg text-ink">评论</h3>
          <span className="text-xs text-gray-500">{totalCount}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs font-sans text-gray-500 hover:text-ink transition-colors"
        >
          收起
        </button>
      </div>

      {contentPreview && (
        <div className="p-3 bg-gray-50 border border-dashed border-ink rounded-lg mb-3 max-h-28 overflow-hidden">
          <MarkdownRenderer content={contentPreview} className="markdown-preview text-sm text-pencil" />
        </div>
      )}

      <div
        ref={listRef}
        className="max-h-64 overflow-y-auto rounded-lg border border-gray-200 bg-white flex flex-col gap-3 pr-1"
      >
        {loading ? (
          <div className="flex flex-col gap-3 px-3 pt-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={`skeleton-${index}`} className="animate-pulse">
                <div className="h-3 w-24 bg-gray-200 rounded mb-2" />
                <div className="h-3 w-5/6 bg-gray-200 rounded" />
              </div>
            ))}
          </div>
        ) : comments.length === 0 ? (
          <div className="text-center text-gray-500">还没有评论，来当第一个吃瓜群众吧！</div>
        ) : (
          [...comments]
            .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
            .map((comment) => {
              const rootOrderMap = buildOrderMap(comments);
              const renderComment = (item: Comment, depth: number, parentLabel: string, siblingOrderMap: Map<string, number>) => {
                const replies = item.replies || [];
                const orderedReplies = [...replies].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
                const isExpanded = expandedThreads.has(item.id);
                const visibleReplies = isExpanded ? orderedReplies : [];
                const maxIndent = depth > 0 ? 14 : 0;
                const currentIndex = siblingOrderMap.get(item.id) || 1;
                const threadLabel = parentLabel ? `${parentLabel}.${currentIndex}` : `${currentIndex}`;
                    const replyLabel = depth > 0
                      ? (labelMap.get(item.replyToId || '') || parentLabel)
                      : '';
                const replyOrderMap = replies.length ? buildOrderMap(orderedReplies) : null;

                return (
                  <div key={item.id} data-comment-id={item.id} style={{ marginLeft: maxIndent }} className="group px-3 pt-2">
                    <div className="flex items-start justify-between text-[12px] text-gray-500 font-sans">
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-mono text-gray-500">{threadLabel}楼</span>
                        <span className="text-gray-800">匿名用户</span>
                        {replyLabel && (
                          <span className="text-[11px] text-gray-500">回复 {replyLabel}楼</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-gray-400">{item.timestamp}</span>
                        <button
                          type="button"
                          onClick={() => setReplyToId(item.id)}
                          className="text-gray-500 hover:text-ink transition-colors opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                          aria-label="回复"
                          title="回复"
                        >
                          回复
                        </button>
                      </div>
                    </div>
                    <div className={depth === 0 ? 'text-[13px] text-ink mt-1' : 'text-[12px] text-ink/90 mt-1'}>
                      <MarkdownRenderer content={item.content} className={depth === 0 ? 'leading-5' : 'leading-4'} />
                    </div>
                        {depth === 0 && visibleReplies.length > 0 && (
                          <div className="mt-2 rounded-md bg-gray-50 border border-gray-200 p-2 flex flex-col gap-2">
                            {visibleReplies.map((reply) => (
                              renderComment(reply, depth + 1, threadLabel, replyOrderMap || new Map())
                            ))}
                          </div>
                        )}
                        {depth === 0 && replies.length > 0 && (
                          <div className={`mt-2 text-[12px] text-gray-500 ${isExpanded ? 'flex justify-end' : ''}`}>
                            <button
                              type="button"
                              onClick={() => toggleThread(item.id)}
                              className="hover:text-ink transition-colors"
                            >
                              {isExpanded ? '收起回复' : `查看 ${replies.length} 条回复`}
                            </button>
                          </div>
                        )}
                    <div className="border-b border-gray-100 mt-3" />
                  </div>
                );
              };

              return renderComment(comment, 0, '', rootOrderMap);
            })
        )}
        <div ref={loadMoreRef} className="h-8" />
        {!loading && loadingMore && (
          <div className="flex justify-center py-2 text-xs text-gray-400">加载中...</div>
        )}
      </div>

      <form className="flex flex-col gap-3 mt-4" onSubmit={handleSubmit}>
        {replyToId && (
          <div className="flex items-center justify-between text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
            <span>正在回复某条评论</span>
            <button
              type="button"
              onClick={() => setReplyToId(null)}
              className="hover:text-ink transition-colors"
            >
              取消回复
            </button>
          </div>
        )}
        <div className="flex items-stretch gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="留下你的评论..."
            maxLength={MAX_LENGTH + 10}
            className="flex-1 h-16 p-3 border-2 border-ink rounded-lg resize-none font-sans focus:outline-none focus:shadow-sketch-sm transition-shadow"
          />
          <SketchButton
            type="submit"
            className="px-3 h-16 flex items-center justify-center"
            disabled={submitting}
            aria-label="发布评论"
          >
            <Send className="w-4 h-4" />
          </SketchButton>
        </div>
        <div className="flex items-center justify-between text-xs text-pencil">
          <span>{text.length} / {MAX_LENGTH}</span>
          {text.length > MAX_LENGTH && <span className="text-red-500">超出限制</span>}
        </div>
      </form>

      <Turnstile ref={turnstileRef} action="comment" enabled={isOpen} />
    </div>
  );
};

export default CommentModal;
