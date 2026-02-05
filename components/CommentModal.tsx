import React, { useEffect, useRef, useState } from 'react';
import { Send, Smile, ThumbsUp } from 'lucide-react';
import { SketchButton } from './SketchUI';
import { api } from '../api';
import { Comment } from '../types';
import { useApp } from '../store/AppContext';
import MarkdownRenderer from './MarkdownRenderer';
import Turnstile, { TurnstileHandle } from './Turnstile';
import ReportModal from './ReportModal';
import MemePicker, { useMemeInsert } from './MemePicker';
import CommentInputModal from './CommentInputModal';

interface CommentModalProps {
  isOpen: boolean;
  onClose: () => void;
  postId: string;
  contentPreview?: string;
  focusCommentId?: string | null;
}

const MAX_LENGTH = 300;

const formatCompactTime = (value?: number | null) => {
  if (!value) {
    return '';
  }

  const diffMs = Date.now() - value;
  if (diffMs < 0) {
    return 'now';
  }

  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) {
    return 'now';
  }
  if (diffMs < hour) {
    return `${Math.floor(diffMs / minute)}m`;
  }
  if (diffMs < day) {
    return `${Math.floor(diffMs / hour)}h`;
  }

  const days = Math.floor(diffMs / day);
  if (days <= 7) {
    return `${days}d`;
  }

  const date = new Date(value);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${mm}/${dd}`;
};

type CommentPick = {
  comment: Comment;
  likes: number;
  createdAt: number;
};

const getMostLikedComment = (items: Comment[]): Comment | null => {
  let best: CommentPick | null = null;

  const walk = (list: Comment[]) => {
    list.forEach((item) => {
      if (!item.deleted) {
        const likes = Number(item.likes || 0);
        const createdAt = Number(item.createdAt || 0);
        if (
          !best
          || likes > best.likes
          || (likes === best.likes && createdAt > best.createdAt)
        ) {
          best = { comment: item, likes, createdAt };
        }
      }
      if (item.replies?.length) {
        walk(item.replies);
      }
    });
  };

  walk(items);
  return best?.comment || null;
};

const CommentModal: React.FC<CommentModalProps> = ({
  isOpen,
  onClose,
  postId,
  contentPreview,
  focusCommentId,
}) => {
  const { addComment, showToast, state } = useApp();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [text, setText] = useState('');
  const [memeOpen, setMemeOpen] = useState(false);
  const [replyToId, setReplyToId] = useState<string | null>(null);
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set());
  const [lastAddedId, setLastAddedId] = useState<string | null>(null);
  const [focusTargetId, setFocusTargetId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [reportModal, setReportModal] = useState<{ isOpen: boolean; commentId: string; content: string }>({
    isOpen: false,
    commentId: '',
    content: '',
  });
  const listRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const turnstileRef = useRef<TurnstileHandle | null>(null);
  const memeButtonRef = useRef<HTMLButtonElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputOverlayRef = useRef<HTMLDivElement | null>(null);
  const pageSize = 10;
  const turnstileEnabled = state.settings.turnstileEnabled;
  const { textareaRef: inlineTextareaRef, insertMeme: inlineInsertMeme } = useMemeInsert(text, setText);
  const overlayTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [keyboardMode, setKeyboardMode] = useState(false);
  const [overlayTop, setOverlayTop] = useState<number | null>(null);
  const [fallbackOverlayTop, setFallbackOverlayTop] = useState<number | null>(null);
  const [inputModalOpen, setInputModalOpen] = useState(false);

  const isMobile = typeof window !== 'undefined' ? window.matchMedia('(max-width: 767px)').matches : false;
  // debugComment 调试输出已移除

  useEffect(() => {
    if (!isOpen) {
      setKeyboardInset(0);
      setKeyboardMode(false);
      setOverlayTop(null);
      setFallbackOverlayTop(null);
      return;
    }
    const vv = window.visualViewport;
    if (!vv) {
      return;
    }

    let rafId: number | null = null;
    const update = () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      rafId = requestAnimationFrame(() => {
        const viewportHeight = vv.height;
        const layoutHeight = window.innerHeight;
        const delta = Math.max(0, Math.round(layoutHeight - viewportHeight - vv.offsetTop));
        setKeyboardInset(delta);
        if (delta > 0) {
          const centeredTop = Math.max(12, Math.round(vv.offsetTop + viewportHeight * 0.5));
          setOverlayTop(centeredTop);
        }
      });
    };

    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !isMobile || !keyboardInset) {
      return;
    }
    const update = () => {
      // 计算 fallback 位置：屏幕顶部 1/3 处，确保不与键盘重叠
      setFallbackOverlayTop(Math.max(12, Math.round(window.innerHeight * 0.15)));
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [isMobile, isOpen, keyboardInset]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const onFocusOut = () => {
      setOverlayTop(null);
    };
    rootRef.current?.addEventListener('focusout', onFocusOut);
    return () => {
      rootRef.current?.removeEventListener('focusout', onFocusOut);
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const openInputModal = () => {
    if (!isMobile) {
      return;
    }
    setInputModalOpen(true);
  };

  useEffect(() => {
    if (!isOpen || !isMobile) {
      return;
    }
    if (inputModalOpen) {
      document.body.style.overflow = 'hidden';
      return;
    }
    document.body.style.overflow = '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isMobile, inputModalOpen, isOpen]);

  useEffect(() => {
    if (!isOpen || !isMobile || keyboardInset <= 0) {
      return;
    }
    const root = rootRef.current;
    if (!root) {
      return;
    }
    requestAnimationFrame(() => {
      root.scrollIntoView({ block: 'end' });
    });
  }, [isMobile, isOpen, keyboardInset]);

  useEffect(() => {
    if (!isOpen || !postId) return;
    setComments([]);
    setReplyToId(null);
    setExpandedThreads(new Set());
    setLastAddedId(null);
    setFocusTargetId(null);
    setReportModal({ isOpen: false, commentId: '', content: '' });
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

  useEffect(() => {
    if (!isOpen || !postId || !focusCommentId) {
      return;
    }
    const loadThread = async () => {
      try {
        const data = await api.getCommentThread(postId, focusCommentId);
        const thread = data?.thread;
        if (!thread?.id) {
          return;
        }
        setComments((prev) => {
          const exists = prev.find((item) => item.id === thread.id);
          if (exists) {
            return prev.map((item) => (item.id === thread.id ? { ...item, replies: thread.replies || [] } : item));
          }
          return [thread, ...prev];
        });
        setExpandedThreads((prev) => {
          const next = new Set(prev);
          next.add(thread.id);
          return next;
        });
        setFocusTargetId(focusCommentId);
      } catch {
        // 忽略跳转失败
      }
    };
    loadThread();
  }, [isOpen, postId, focusCommentId]);

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

  const updateCommentLike = (items: Comment[], commentId: string, likes: number, viewerLiked: boolean): Comment[] => {
    return items.map((item) => {
      if (item.id === commentId) {
        return { ...item, likes, viewerLiked };
      }
      if (item.replies?.length) {
        return { ...item, replies: updateCommentLike(item.replies, commentId, likes, viewerLiked) };
      }
      return item;
    });
  };

  const handleToggleLike = async (commentId: string) => {
    try {
      const data = await api.toggleCommentLike(commentId);
      const likes = Number(data?.likes || 0);
      const viewerLiked = Boolean(data?.viewerLiked);
      setComments((prev) => updateCommentLike(prev, commentId, likes, viewerLiked));
    } catch (error) {
      const message = error instanceof Error ? error.message : '点赞失败';
      showToast(message, 'error');
    }
  };

  const submitText = async (nextText: string) => {
    const trimmed = nextText.trim();
    if (!trimmed) {
      showToast('评论不能为空', 'warning');
      return false;
    }
    if (trimmed.length > MAX_LENGTH) {
      showToast('评论长度不能超过 300 字', 'error');
      return false;
    }

    setSubmitting(true);
    try {
      let turnstileToken = '';
      if (turnstileEnabled) {
        if (!turnstileRef.current) {
          throw new Error('安全验证加载中，请稍后再试');
        }
        turnstileToken = await turnstileRef.current.execute();
      }
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
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : '评论失败，请稍后重试';
      showToast(message, 'error');
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    await submitText(text);
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

  useEffect(() => {
    if (!focusTargetId || !listRef.current) {
      return;
    }
    const target = listRef.current.querySelector(`[data-comment-id="${focusTargetId}"]`);
    if (target) {
      requestAnimationFrame(() => {
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
    }
    setFocusTargetId(null);
  }, [focusTargetId, comments]);

  if (!isOpen) {
    return null;
  }

  const totalCount = countComments(comments);
  const mostLikedComment = getMostLikedComment(comments);
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
  const replyTargetLabel = replyToId ? (labelMap.get(replyToId) || '') : '';

  return (
    <div
      ref={rootRef}
      className="fixed inset-x-0 bottom-0 z-40 max-h-75vh-safe rounded-t-xl border border-gray-200 bg-white p-4 shadow-lg font-sans animate-in slide-in-from-bottom-2 duration-200 md:static md:mt-4 md:max-h-none md:rounded-xl md:shadow-sm md:animate-none"
      style={{
        paddingBottom: keyboardInset ? keyboardInset + 16 : undefined,
        bottom: undefined,
      }}
    >
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

      <div className="p-3 bg-gray-50 border border-dashed border-ink rounded-lg mb-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="text-xs text-gray-600 font-sans">
            {mostLikedComment ? '热门评论' : '暂无热门评论'}
          </div>
          {mostLikedComment && (
            <div className="text-xs text-gray-500 font-sans flex items-center gap-1 whitespace-nowrap">
              <ThumbsUp className="w-3.5 h-3.5" />
              <span className="font-bold">{Number(mostLikedComment.likes || 0)}</span>
            </div>
          )}
        </div>

        {mostLikedComment ? (
          <div className="max-h-28 overflow-hidden">
            <MarkdownRenderer
              content={mostLikedComment.content}
              className="markdown-preview text-sm text-pencil [&_.markdown-image-link]:block [&_.markdown-image]:max-h-32 md:[&_.markdown-image]:max-h-44 [&_.markdown-image]:object-contain [&_.markdown-image]:mx-auto [&_.markdown-image]:w-auto [&_.markdown-image]:!max-w-52 md:[&_.markdown-image]:!max-w-64"
            />
          </div>
        ) : (
          <div className="text-sm text-gray-400 font-sans">
            还没有评论，先来抢个沙发吧
          </div>
        )}

        {!mostLikedComment && contentPreview && (
          <div className="mt-2 pt-2 border-t border-gray-200/70">
            <div className="text-xs text-gray-500 font-sans mb-1">帖子详情</div>
            <div className="max-h-20 overflow-hidden">
              <MarkdownRenderer
                content={contentPreview}
                className="markdown-preview text-sm text-pencil [&_.markdown-image-link]:block [&_.markdown-image]:max-h-24 md:[&_.markdown-image]:max-h-28 [&_.markdown-image]:object-contain [&_.markdown-image]:mx-auto [&_.markdown-image]:w-auto [&_.markdown-image]:!max-w-52 md:[&_.markdown-image]:!max-w-64"
              />
            </div>
          </div>
        )}
      </div>

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
                const isDeleted = Boolean(item.deleted);
                const replyLabel = depth > 0
                  ? (labelMap.get(item.replyToId || '') || parentLabel)
                  : '';
                const replyOrderMap = replies.length ? buildOrderMap(orderedReplies) : null;

                return (
                  <div key={item.id} data-comment-id={item.id} style={{ marginLeft: maxIndent }} className="group px-3 pt-2">
                    <div className="flex items-center justify-between text-[12px] text-gray-500 font-sans">
                      <div className="min-w-0 flex items-center gap-2 overflow-hidden whitespace-nowrap">
                        <span className="text-[12px] font-mono text-gray-500">{threadLabel}楼</span>
                        <span className="text-gray-800">匿名用户</span>
                        {isDeleted && <span className="text-[11px] text-gray-400">已处理</span>}
                        {replyLabel && (
                          <span className="text-[11px] text-gray-500 sm:inline hidden">回复 {replyLabel}楼</span>
                        )}
                        {replyLabel && (
                          <span className="text-[11px] text-gray-500 sm:hidden inline font-mono">↪{replyLabel}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 whitespace-nowrap">
                        <span className="text-gray-400" title={item.timestamp}>
                          <span className="sm:inline hidden">{item.timestamp}</span>
                          <span className="sm:hidden inline">{formatCompactTime(item.createdAt) || item.timestamp}</span>
                        </span>
                        {!isDeleted && (
                          <button
                            type="button"
                            onClick={() => handleToggleLike(item.id)}
                            className={`flex items-center gap-1 rounded-full px-2 py-1 border border-gray-200 bg-white hover:bg-highlight transition-colors ${item.viewerLiked ? 'text-blue-600' : 'text-gray-500'}`}
                            aria-label="点赞"
                            title={item.viewerLiked ? '取消点赞' : '点赞'}
                          >
                            <ThumbsUp className="w-3.5 h-3.5" fill={item.viewerLiked ? 'currentColor' : 'none'} />
                            <span className="text-[12px] font-bold">{Number(item.likes || 0)}</span>
                          </button>
                        )}
                        {!isDeleted && (
                          <button
                            type="button"
                            onClick={() => setReportModal({ isOpen: true, commentId: item.id, content: item.content })}
                            className="text-gray-400 hover:text-red-600 transition-colors text-[12px] opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                            aria-label="举报"
                            title="举报"
                          >
                            举报
                          </button>
                        )}
                        {!isDeleted && (
                          <button
                            type="button"
                            onClick={() => setReplyToId(item.id)}
                            className="text-gray-500 hover:text-ink transition-colors opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                            aria-label="回复"
                            title="回复"
                          >
                            回复
                          </button>
                        )}
                      </div>
                    </div>
                    <div className={depth === 0 ? `text-[13px] mt-1 ${isDeleted ? 'text-gray-400 italic' : 'text-ink'}` : `text-[12px] mt-1 ${isDeleted ? 'text-gray-400 italic' : 'text-ink/90'}`}>
                      <MarkdownRenderer
                        content={item.content}
                        className={`${depth === 0 ? 'leading-5' : 'leading-4'} [&_.markdown-image-link]:block [&_.markdown-image]:max-h-32 md:[&_.markdown-image]:max-h-44 [&_.markdown-image]:object-contain [&_.markdown-image]:mx-auto [&_.markdown-image]:w-auto [&_.markdown-image]:!max-w-52 md:[&_.markdown-image]:!max-w-64`}
                      />
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
            ref={inlineTextareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="留下你的评论...（支持 Markdown / 表情包）"
            maxLength={MAX_LENGTH + 10}
            className="flex-1 h-16 p-3 border-2 border-ink rounded-lg resize-none font-sans bg-white focus:outline-none focus:shadow-sketch-sm transition-shadow"
            onFocus={() => {
              if (isMobile) {
                openInputModal();
              }
            }}
            readOnly={isMobile}
          />
          <div className="relative">
            <button
              ref={memeButtonRef}
              type="button"
              onClick={() => setMemeOpen((prev) => !prev)}
              className="px-3 h-16 flex items-center justify-center border-2 border-ink rounded-lg bg-white hover:bg-highlight transition-colors shadow-sketch"
              aria-label="插入表情包"
              title="表情包"
            >
              <Smile className="w-4 h-4" />
            </button>
            <MemePicker
              open={memeOpen}
              onClose={() => setMemeOpen(false)}
              anchorRef={memeButtonRef}
              onSelect={(packName, label) => {
                inlineInsertMeme(packName, label);
                setMemeOpen(false);
              }}
            />
          </div>
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

      <CommentInputModal
        isOpen={isMobile && inputModalOpen}
        onClose={() => setInputModalOpen(false)}
        title={replyToId ? '回复评论' : '写评论'}
        helperText={replyToId ? `正在回复 ${replyTargetLabel || '某一'}楼` : undefined}
        onCancelReply={replyToId ? () => setReplyToId(null) : undefined}
        initialText={text}
        maxLength={MAX_LENGTH}
        submitting={submitting}
        onSubmit={async (nextText) => {
          setText(nextText);
          const ok = await submitText(nextText);
          if (ok) {
            setInputModalOpen(false);
          }
        }}
      />

      <Turnstile ref={turnstileRef} action="comment" enabled={isOpen && turnstileEnabled} />

      <ReportModal
        isOpen={reportModal.isOpen}
        onClose={() => setReportModal({ isOpen: false, commentId: '', content: '' })}
        postId={postId}
        commentId={reportModal.commentId}
        targetType="comment"
        contentPreview={reportModal.content.substring(0, 80)}
      />
    </div>
  );
};

export default CommentModal;
