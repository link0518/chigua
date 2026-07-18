import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AlertTriangle, Image, Send, Smile, ThumbsUp } from 'lucide-react';
import { SketchButton } from './SketchUI';
import { api } from '../api';
import { Comment } from '../types';
import { useAppActions } from '../store/AppActionsContext';
import { useAppShell } from '../store/AppShellContext';
import MarkdownRenderer from './MarkdownRenderer';
import Turnstile, { TurnstileHandle } from './Turnstile';
import ReportModal from './ReportModal';
import MemePicker, { useMemeInsert } from './MemePicker';
import CommentInputModal from './CommentInputModal';
import useMediaQuery from './useMediaQuery';
import { useInsertAtCursor } from './useInsertAtCursor';
import { isImageUploadFile, uploadImageAsMarkdown } from './imageUpload';
import { AUTO_HIDDEN_EVENT, HIDDEN_COMMENT_PLACEHOLDER, type AutoHiddenEventDetail } from '../store/contentVisibility';
import ColorfulName from './ColorfulName';
import { requestOverlayHistoryBack, requestOverlayHistoryNavigation } from './overlayHistory';

interface CommentModalProps {
  isOpen: boolean;
  onClose: () => void;
  postId: string;
  contentPreview?: string;
  focusCommentId?: string | null;
}

type CommentHistoryState = Record<string, unknown> & {
  homeOverlay?: 'comments' | 'comment-composer';
  homeCommentPostId?: string;
  homeSecondaryOverlay?: 'comment-report' | 'comment-meme' | 'markdown-image';
  homeSecondaryOverlayId?: string;
  homeSecondaryOverlayIndex?: number;
};

const readCommentHistoryState = (): CommentHistoryState => (
  window.history.state && typeof window.history.state === 'object'
    ? window.history.state as CommentHistoryState
    : {}
);

const MAX_LENGTH = 300;
const COMMENTS_CACHE_KEY_PREFIX = 'comments:v3';
const PREVIOUS_COMMENTS_CACHE_KEY_PREFIX = 'comments:v2';
const LEGACY_COMMENTS_CACHE_KEY_PREFIX = 'comments';
const COMMENT_DRAFT_CACHE_KEY_PREFIX = 'comment-draft:v1';
const COMMENT_IDENTITY_FALLBACK_LABEL = '匿名用户';

const findCommentById = (items: Comment[], commentId: string): Comment | null => {
  for (const item of items) {
    if (item.id === commentId) {
      return item;
    }
    const nested = findCommentById(item.replies || [], commentId);
    if (nested) {
      return nested;
    }
  }
  return null;
};

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

const getCommentIdentityLabel = (comment?: Comment | null) => (
  String(comment?.postIdentity?.label || COMMENT_IDENTITY_FALLBACK_LABEL)
);

const getMostLikedComment = (items: Comment[]): Comment | null => {
  let best: CommentPick | null = null;

  const walk = (list: Comment[]) => {
    list.forEach((item) => {
      if (!item.deleted && !item.hidden && item.rumorStatus !== 'suspected') {
        const likes = Number(item.likes || 0);
        const createdAt = Number(item.createdAt || 0);
        // 只有实际获得点赞的评论才能成为热评；全为 0 赞时不按时间兜底。
        if (
          likes > 0
          && (
            !best
            || likes > best.likes
            || (likes === best.likes && createdAt > best.createdAt)
          )
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

const sortCommentsByCreatedAt = (a: Comment, b: Comment) => (a.createdAt || 0) - (b.createdAt || 0);

const mergeCommentLists = (current: Comment[], incoming: Comment[]): Comment[] => {
  const map = new Map<string, Comment>();

  const upsert = (items: Comment[]) => {
    items.forEach((item) => {
      const normalizedReplies = mergeCommentLists([], item.replies || []);
      const existing = map.get(item.id);
      map.set(
        item.id,
        existing
          ? {
            ...existing,
            ...item,
            replies: mergeCommentLists(existing.replies || [], normalizedReplies),
          }
          : { ...item, replies: normalizedReplies }
      );
    });
  };

  upsert(current);
  upsert(incoming);

  return Array.from(map.values()).sort(sortCommentsByCreatedAt);
};

const CommentModal: React.FC<CommentModalProps> = ({
  isOpen,
  onClose,
  postId,
  contentPreview,
  focusCommentId,
}) => {
  const { addComment, showToast } = useAppActions();
  const { settings } = useAppShell();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [reloadVersion, setReloadVersion] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [text, setText] = useState('');
  const [memeOpen, setMemeOpen] = useState(false);
  const [replyToId, setReplyToId] = useState<string | null>(null);
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set());
  const [expandedRumorComments, setExpandedRumorComments] = useState<Set<string>>(new Set());
  const [lastAddedId, setLastAddedId] = useState<string | null>(null);
  const [focusTargetId, setFocusTargetId] = useState<string | null>(null);
  const [highlightedCommentId, setHighlightedCommentId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [reportModal, setReportModal] = useState<{ isOpen: boolean; commentId: string; content: string }>({
    isOpen: false,
    commentId: '',
    content: '',
  });
  const commentsRef = useRef<Comment[]>([]);
  const pageRef = useRef(0);
  const hasMoreRef = useRef(true);
  const loadingMoreRef = useRef(false);
  const requestTokenRef = useRef(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const turnstileRef = useRef<TurnstileHandle | null>(null);
  const memeButtonRef = useRef<HTMLButtonElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const pageSize = 10;
  const turnstileEnabled = settings.turnstileEnabled;
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const uploadLockRef = useRef(false);
  const submittingRef = useRef(false);
  const uploadDraftVersionRef = useRef(0);
  const mobileDraftRef = useRef('');
  const draftRevisionRef = useRef(0);
  const composerSessionRef = useRef(0);
  const currentPostIdRef = useRef(postId);
  const draftWriteTimerRef = useRef<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [inputModalOpen, setInputModalOpen] = useState(false);
  const inputModalOpenRef = useRef(false);

  const isMobile = useMediaQuery('(max-width: 767px)');
  const wasMobileRef = useRef(isMobile);
  const updateInlineText = useCallback<React.Dispatch<React.SetStateAction<string>>>((nextValue) => {
    const nextText = typeof nextValue === 'function'
      ? nextValue(mobileDraftRef.current)
      : nextValue;
    if (mobileDraftRef.current !== nextText) {
      draftRevisionRef.current += 1;
    }
    mobileDraftRef.current = nextText;
    setText(nextText);
  }, []);
  const { textareaRef: inlineTextareaRef, insertMeme: inlineInsertMeme } = useMemeInsert(text, updateInlineText);
  const { insertAtCursor } = useInsertAtCursor(text, updateInlineText, inlineTextareaRef);
  // debugComment 调试输出已移除

  useLayoutEffect(() => {
    currentPostIdRef.current = postId;
  }, [postId]);

  useEffect(() => {
    commentsRef.current = comments;
  }, [comments]);

  useEffect(() => {
    pageRef.current = page;
  }, [page]);

  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  const writeCommentsCache = (items: Comment[], nextPage: number, nextHasMore: boolean) => {
    sessionStorage.setItem(`${COMMENTS_CACHE_KEY_PREFIX}:${postId}`, JSON.stringify({
      items,
      page: nextPage,
      hasMore: nextHasMore,
    }));
  };

  const writeCommentDraft = useCallback((nextText: string) => {
    try {
      const cacheKey = `${COMMENT_DRAFT_CACHE_KEY_PREFIX}:${postId}`;
      if (nextText.trim()) {
        sessionStorage.setItem(cacheKey, nextText);
      } else {
        sessionStorage.removeItem(cacheKey);
      }
    } catch {
      // 草稿缓存失败不应阻断评论输入。
    }
  }, [postId]);

  const clearScheduledDraftWrite = useCallback(() => {
    if (draftWriteTimerRef.current !== null) {
      window.clearTimeout(draftWriteTimerRef.current);
      draftWriteTimerRef.current = null;
    }
  }, []);

  const flushCommentDraft = useCallback((nextText: string) => {
    clearScheduledDraftWrite();
    writeCommentDraft(nextText);
  }, [clearScheduledDraftWrite, writeCommentDraft]);

  const scheduleCommentDraftWrite = useCallback((nextText: string) => {
    clearScheduledDraftWrite();
    draftWriteTimerRef.current = window.setTimeout(() => {
      draftWriteTimerRef.current = null;
      writeCommentDraft(nextText);
    }, 250);
  }, [clearScheduledDraftWrite, writeCommentDraft]);

  const commitMobileDraft = useCallback(() => {
    const nextText = mobileDraftRef.current;
    setText(nextText);
    flushCommentDraft(nextText);
  }, [flushCommentDraft]);

  useEffect(() => {
    if (!isOpen || isMobile) {
      return undefined;
    }
    if (mobileDraftRef.current !== text) {
      mobileDraftRef.current = text;
      draftRevisionRef.current += 1;
    }
    scheduleCommentDraftWrite(text);
    return undefined;
  }, [isMobile, isOpen, scheduleCommentDraftWrite, text]);

  useEffect(() => {
    if (!isOpen || isMobile) {
      return undefined;
    }
    return () => {
      flushCommentDraft(mobileDraftRef.current);
    };
  }, [flushCommentDraft, isMobile, isOpen, postId]);

  useEffect(() => {
    if (!isOpen || !isMobile) {
      return undefined;
    }
    return () => {
      if (inputModalOpenRef.current) {
        flushCommentDraft(mobileDraftRef.current);
      }
    };
  }, [flushCommentDraft, isMobile, isOpen, postId]);

  useLayoutEffect(() => {
    if (wasMobileRef.current && !isMobile && inputModalOpenRef.current) {
      // 跨过移动断点时先同步本地草稿，避免桌面输入框和缓存回退到旧父状态。
      commitMobileDraft();
    }
    wasMobileRef.current = isMobile;
  }, [commitMobileDraft, isMobile]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    const flushLatestDraft = () => flushCommentDraft(mobileDraftRef.current);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushLatestDraft();
      }
    };
    window.addEventListener('pagehide', flushLatestDraft);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', flushLatestDraft);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [flushCommentDraft, isOpen]);

  useLayoutEffect(() => {
    // 关闭评论区、切换帖子或卸载后，旧上传结果不能写入新的草稿。
    uploadDraftVersionRef.current += 1;
    return () => {
      uploadDraftVersionRef.current += 1;
    };
  }, [isOpen, postId]);

  const tryAcquireUpload = () => {
    if (uploadLockRef.current || submittingRef.current) {
      return null;
    }

    uploadLockRef.current = true;
    setUploading(true);
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      uploadLockRef.current = false;
      setUploading(false);
    };
  };

  const handlePickUpload = () => {
    if (uploadLockRef.current || submittingRef.current) {
      return;
    }
    uploadInputRef.current?.click();
  };

  const handleClose = useCallback(() => {
    uploadDraftVersionRef.current += 1;
    onClose();
  }, [onClose]);

  const handleUploadFile = async (file: File) => {
    if (!file) {
      return;
    }
    if (!isImageUploadFile(file)) {
      showToast('只支持上传图片文件', 'warning');
      return;
    }

    const releaseUpload = tryAcquireUpload();
    if (!releaseUpload) {
      showToast('图片上传或评论提交正在进行，请稍候', 'info');
      return;
    }

    const draftVersion = uploadDraftVersionRef.current;
    try {
      const markdown = await uploadImageAsMarkdown(file, { usage: 'comment' });
      if (uploadDraftVersionRef.current !== draftVersion) {
        return;
      }
      insertAtCursor(markdown);
      showToast('图片上传成功', 'success');
    } catch (error) {
      if (uploadDraftVersionRef.current !== draftVersion) {
        return;
      }
      const message = error instanceof Error ? error.message : '图片上传失败，请稍后重试';
      showToast(message, 'error');
    } finally {
      releaseUpload();
    }
  };

  const openInputModal = useCallback(() => {
    if (!isMobile) {
      return;
    }
    if (!inputModalOpenRef.current) {
      composerSessionRef.current += 1;
    }
    if (mobileDraftRef.current !== text) {
      mobileDraftRef.current = text;
      draftRevisionRef.current += 1;
    }
    inputModalOpenRef.current = true;
    setInputModalOpen(true);
    const currentState = readCommentHistoryState();
    if (currentState.homeOverlay !== 'comment-composer') {
      window.history.pushState({
        ...currentState,
        homeOverlay: 'comment-composer',
      }, '', window.location.pathname + window.location.search);
    }
  }, [isMobile, text]);

  const closeInputModal = useCallback(() => {
    commitMobileDraft();
    const currentState = readCommentHistoryState();
    if (currentState.homeOverlay === 'comment-composer') {
      requestOverlayHistoryBack();
      return;
    }
    inputModalOpenRef.current = false;
    setInputModalOpen(false);
  }, [commitMobileDraft]);

  const openCommentReportModal = (commentId: string, content: string) => {
    setReportModal({ isOpen: true, commentId, content });
    if (!isMobile) {
      return;
    }
    const currentState = readCommentHistoryState();
    if (currentState.homeSecondaryOverlay === 'comment-report') {
      return;
    }
    window.history.pushState({
      ...currentState,
      homeSecondaryOverlay: 'comment-report',
      homeSecondaryOverlayId: commentId,
    }, '', window.location.pathname + window.location.search);
  };

  const closeCommentReportModal = () => {
    const currentState = readCommentHistoryState();
    if (currentState.homeSecondaryOverlay === 'comment-report') {
      requestOverlayHistoryBack();
      return;
    }
    setReportModal({ isOpen: false, commentId: '', content: '' });
  };

  const closeInlineMemePicker = () => {
    const currentState = readCommentHistoryState();
    if (
      currentState.homeSecondaryOverlay === 'comment-meme'
      && currentState.homeSecondaryOverlayId === 'comment-inline'
    ) {
      if (isMobile) {
        requestOverlayHistoryBack();
        return;
      }
      // 跨断点后移动端历史层可能仍在，但桌面端监听已经卸载；同步关闭本地状态再退栈。
      setMemeOpen(false);
      requestOverlayHistoryBack();
      return;
    }
    setMemeOpen(false);
  };

  const toggleInlineMemePicker = () => {
    if (memeOpen) {
      closeInlineMemePicker();
      return;
    }
    setMemeOpen(true);
  };

  useLayoutEffect(() => {
    if (!isOpen || !isMobile) {
      return;
    }
    let initialState = readCommentHistoryState();
    if (!initialState.homeOverlay) {
      const currentPath = window.location.pathname + window.location.search;
      const searchParams = new URLSearchParams(window.location.search);
      const hasRouteComment = searchParams.has('comment');
      const secondaryOverlay = initialState.homeSecondaryOverlay;
      const secondaryOverlayId = initialState.homeSecondaryOverlayId;
      const secondaryOverlayIndex = initialState.homeSecondaryOverlayIndex;
      const baseState = { ...initialState };
      delete baseState.homeOverlay;
      delete baseState.homeCommentPostId;
      delete baseState.homeSecondaryOverlay;
      delete baseState.homeSecondaryOverlayId;
      delete baseState.homeSecondaryOverlayIndex;
      const commentsState: CommentHistoryState = {
        ...baseState,
        homeOverlay: 'comments',
        homeCommentPostId: postId,
      };

      if (hasRouteComment) {
        searchParams.delete('comment');
        const nextSearch = searchParams.toString();
        const basePath = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}`;
        window.history.replaceState(baseState, '', basePath);
        window.history.pushState(commentsState, '', currentPath);
        initialState = commentsState;
      } else if (secondaryOverlay) {
        // 子层先于评论层接管历史时，将当前记录改为评论，再把子层补回栈顶。
        window.history.replaceState(commentsState, '', currentPath);
        initialState = {
          ...commentsState,
          homeSecondaryOverlay: secondaryOverlay,
          homeSecondaryOverlayId: secondaryOverlayId,
          homeSecondaryOverlayIndex: secondaryOverlayIndex,
        };
        window.history.pushState(initialState, '', currentPath);
      } else {
        initialState = commentsState;
        // 桌面评论在旋转或缩窄为移动布局后补建评论层，确保 Back 只收起评论。
        window.history.pushState(initialState, '', currentPath);
      }
    }
    if (
      reportModal.isOpen
      && reportModal.commentId
      && initialState.homeSecondaryOverlay !== 'comment-report'
    ) {
      initialState = {
        ...initialState,
        homeSecondaryOverlay: 'comment-report',
        homeSecondaryOverlayId: reportModal.commentId,
      };
      window.history.pushState(initialState, '', window.location.pathname + window.location.search);
    } else if (
      memeOpen
      && initialState.homeSecondaryOverlay !== 'comment-meme'
    ) {
      initialState = {
        ...initialState,
        homeSecondaryOverlay: 'comment-meme',
        homeSecondaryOverlayId: 'comment-inline',
      };
      window.history.pushState(initialState, '', window.location.pathname + window.location.search);
    }
    const initialInputModalOpen = initialState.homeOverlay === 'comment-composer';
    if (initialInputModalOpen && !inputModalOpenRef.current) {
      composerSessionRef.current += 1;
    }
    inputModalOpenRef.current = initialInputModalOpen;
    setInputModalOpen(initialInputModalOpen);
    const handlePopState = () => {
      const currentState = readCommentHistoryState();
      const nextInputModalOpen = currentState.homeOverlay === 'comment-composer';
      if (inputModalOpenRef.current && !nextInputModalOpen) {
        commitMobileDraft();
      } else if (!inputModalOpenRef.current && nextInputModalOpen) {
        composerSessionRef.current += 1;
      }
      inputModalOpenRef.current = nextInputModalOpen;
      setInputModalOpen(nextInputModalOpen);
      setMemeOpen(
        currentState.homeSecondaryOverlay === 'comment-meme'
        && currentState.homeSecondaryOverlayId === 'comment-inline'
      );
      if (currentState.homeSecondaryOverlay === 'comment-report' && currentState.homeSecondaryOverlayId) {
        const targetComment = findCommentById(commentsRef.current, currentState.homeSecondaryOverlayId);
        if (targetComment) {
          setReportModal({ isOpen: true, commentId: targetComment.id, content: targetComment.content });
        }
      } else {
        setReportModal({ isOpen: false, commentId: '', content: '' });
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [commitMobileDraft, isMobile, isOpen, memeOpen, postId, reportModal.commentId, reportModal.isOpen]);

  useEffect(() => {
    if (!isOpen || isMobile) {
      return;
    }
    const currentState = readCommentHistoryState();
    if (
      currentState.homeSecondaryOverlay === 'comment-meme'
      && currentState.homeSecondaryOverlayId === 'comment-inline'
    ) {
      // 从移动端回到桌面时移除仅用于移动端 Back 的表情层，保留当前桌面弹层状态。
      requestOverlayHistoryBack();
      return;
    }
    if (currentState.homeOverlay !== 'comment-composer') {
      return;
    }
    const composerMemeDepth = (
      currentState.homeSecondaryOverlay === 'comment-meme'
      && currentState.homeSecondaryOverlayId !== 'comment-inline'
    ) ? 1 : 0;
    requestOverlayHistoryNavigation(-(1 + composerMemeDepth));
  }, [isMobile, isOpen]);

  useEffect(() => {
    if (!isOpen || !isMobile || reportModal.isOpen) {
      return;
    }
    const currentState = readCommentHistoryState();
    if (currentState.homeSecondaryOverlay !== 'comment-report' || !currentState.homeSecondaryOverlayId) {
      return;
    }
    const targetComment = findCommentById(comments, currentState.homeSecondaryOverlayId);
    if (targetComment) {
      setReportModal({ isOpen: true, commentId: targetComment.id, content: targetComment.content });
    }
  }, [comments, isMobile, isOpen, reportModal.isOpen]);

  useEffect(() => {
    if (!isOpen || !postId) return;
    const requestToken = requestTokenRef.current + 1;
    requestTokenRef.current = requestToken;
    loadingMoreRef.current = false;
    commentsRef.current = [];
    pageRef.current = 0;
    hasMoreRef.current = true;
    setComments([]);
    setReplyToId(null);
    setExpandedThreads(new Set());
    setExpandedRumorComments(new Set());
    setLastAddedId(null);
    setFocusTargetId(null);
    setHighlightedCommentId(null);
    clearScheduledDraftWrite();
    let restoredDraft = '';
    try {
      restoredDraft = sessionStorage.getItem(`${COMMENT_DRAFT_CACHE_KEY_PREFIX}:${postId}`) || '';
    } catch {
      restoredDraft = '';
    }
    if (mobileDraftRef.current !== restoredDraft) {
      mobileDraftRef.current = restoredDraft;
      draftRevisionRef.current += 1;
    }
    setText(restoredDraft);
    setReportModal({ isOpen: false, commentId: '', content: '' });
    setPage(0);
    setHasMore(true);
    setLoading(true);
    setLoadError('');
    setLoadingMore(false);
    const cacheKey = `${COMMENTS_CACHE_KEY_PREFIX}:${postId}`;
    sessionStorage.removeItem(`${PREVIOUS_COMMENTS_CACHE_KEY_PREFIX}:${postId}`);
    sessionStorage.removeItem(`${LEGACY_COMMENTS_CACHE_KEY_PREFIX}:${postId}`);
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed.items)) {
          const cachedItems = mergeCommentLists([], parsed.items);
          const cachedPage = Number(parsed.page || 0);
          const cachedHasMore = Boolean(parsed.hasMore);
          commentsRef.current = cachedItems;
          pageRef.current = cachedPage;
          hasMoreRef.current = cachedHasMore;
          setComments(cachedItems);
          setPage(cachedPage);
          setHasMore(cachedHasMore);
        }
      } catch {
        // ignore cache errors
      }
    }

    api
      .getComments(postId, 0, pageSize)
      .then((data) => {
        if (requestTokenRef.current !== requestToken) {
          return;
        }
        const items = data.items || [];
        const total = Number(data.total || 0);
        const nextHasMore = items.length + 0 < total;
        const mergedItems = mergeCommentLists([], items);
        commentsRef.current = mergedItems;
        pageRef.current = 1;
        hasMoreRef.current = nextHasMore;
        setComments(mergedItems);
        setPage(1);
        setHasMore(nextHasMore);
        writeCommentsCache(mergedItems, 1, nextHasMore);
      })
      .catch((error) => {
        if (requestTokenRef.current !== requestToken) {
          return;
        }
        const message = error instanceof Error ? error.message : '评论加载失败';
        setLoadError(message);
        showToast(message, 'error');
      })
      .finally(() => {
        if (requestTokenRef.current === requestToken) {
          setLoading(false);
        }
      });
    return () => {
      if (requestTokenRef.current === requestToken) {
        requestTokenRef.current += 1;
      }
      loadingMoreRef.current = false;
    };
  }, [clearScheduledDraftWrite, isOpen, postId, reloadVersion, showToast]);

  useEffect(() => {
    if (!isOpen || !postId || !focusCommentId) {
      return;
    }
    const requestToken = requestTokenRef.current;
    const loadThread = async () => {
      try {
        const data = await api.getCommentThread(postId, focusCommentId);
        if (requestTokenRef.current !== requestToken) {
          return;
        }
        const thread = data?.thread;
        if (!thread?.id) {
          return;
        }
        let nextComments: Comment[] = [];
        setComments((prev) => {
          nextComments = mergeCommentLists(prev, [thread]);
          commentsRef.current = nextComments;
          return nextComments;
        });
        writeCommentsCache(nextComments, pageRef.current, hasMoreRef.current);
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

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleAutoHidden = (event: Event) => {
      const detail = (event as CustomEvent<AutoHiddenEventDetail>).detail;
      if (!detail?.autoHidden || detail.targetType !== 'comment' || !detail.targetId) {
        return;
      }

      setComments((prev) => {
        const next = markCommentHidden(prev, detail.targetId || '');
        commentsRef.current = next;
        writeCommentsCache(next, pageRef.current, hasMoreRef.current);
        return next;
      });

      if (replyToId === detail.targetId) {
        setReplyToId(null);
      }
    };

    window.addEventListener(AUTO_HIDDEN_EVENT, handleAutoHidden as EventListener);
    return () => {
      window.removeEventListener(AUTO_HIDDEN_EVENT, handleAutoHidden as EventListener);
    };
  }, [isOpen, postId, replyToId]);

  const handleLoadMore = async () => {
    if (loadingMoreRef.current || !hasMoreRef.current) {
      return;
    }
    const requestToken = requestTokenRef.current;
    const currentPage = pageRef.current;
    const offset = currentPage * pageSize;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const data = await api.getComments(postId, offset, pageSize);
      if (requestTokenRef.current !== requestToken) {
        return;
      }
      const items = data.items || [];
      const total = Number(data.total || 0);
      const mergedItems = mergeCommentLists(commentsRef.current, items);
      const nextPage = currentPage + 1;
      const nextHasMore = offset + items.length < total;
      commentsRef.current = mergedItems;
      pageRef.current = nextPage;
      hasMoreRef.current = nextHasMore;
      setComments(mergedItems);
      setPage(nextPage);
      setHasMore(nextHasMore);
      writeCommentsCache(mergedItems, nextPage, nextHasMore);
    } catch (error) {
      if (requestTokenRef.current !== requestToken) {
        return;
      }
      const message = error instanceof Error ? error.message : '加载更多失败';
      showToast(message, 'error');
    } finally {
      loadingMoreRef.current = false;
      if (requestTokenRef.current === requestToken) {
        setLoadingMore(false);
      }
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

  const toggleRumorCommentExpand = (commentId: string) => {
    setExpandedRumorComments((prev) => {
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
        return { ...item, replies: mergeCommentLists(item.replies || [], [comment]) };
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

  const markCommentHidden = (items: Comment[], commentId: string): Comment[] => {
    return items.map((item) => {
      if (item.id === commentId) {
        return {
          ...item,
          hidden: true,
          hiddenAt: Date.now(),
          content: HIDDEN_COMMENT_PLACEHOLDER,
          viewerLiked: false,
        };
      }
      if (item.replies?.length) {
        return { ...item, replies: markCommentHidden(item.replies, commentId) };
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
    if (submittingRef.current) {
      return false;
    }
    if (uploadLockRef.current) {
      showToast('图片上传完成后才能发布评论', 'warning');
      return false;
    }
    const trimmed = nextText.trim();
    if (!trimmed) {
      showToast('评论不能为空', 'warning');
      return false;
    }
    if (trimmed.length > MAX_LENGTH) {
      showToast('评论长度不能超过 300 字', 'error');
      return false;
    }

    if (mobileDraftRef.current !== nextText) {
      mobileDraftRef.current = nextText;
      draftRevisionRef.current += 1;
    }
    flushCommentDraft(nextText);
    const submittedDraftRevision = draftRevisionRef.current;
    const submittedComposerSession = composerSessionRef.current;
    const submittedPostId = postId;
    const submittedReplyToId = replyToId;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      let turnstileToken = '';
      if (turnstileEnabled) {
        if (!turnstileRef.current) {
          throw new Error('安全验证加载中，请稍后再试');
        }
        turnstileToken = await turnstileRef.current.execute();
      }
      const comment = await addComment(
        submittedPostId,
        trimmed,
        turnstileToken,
        submittedReplyToId,
        submittedReplyToId,
      );
      const isCurrentPost = currentPostIdRef.current === submittedPostId;

      if (isCurrentPost) {
        const currentComments = commentsRef.current;
        let effectiveParentId = comment.parentId || null;
        if (submittedReplyToId) {
          const chain = findAncestorChain(currentComments, submittedReplyToId);
          if (chain && chain.length > 1) {
            effectiveParentId = chain[0];
          }
        }

        const nextComment = {
          ...comment,
          parentId: effectiveParentId,
          replyToId: comment.replyToId || submittedReplyToId || null,
          replies: comment.replies || [],
        };
        const expandedTargets = effectiveParentId
          ? findAncestorChain(currentComments, effectiveParentId) || [effectiveParentId]
          : [];
        const nextComments = effectiveParentId
          ? insertReply(currentComments, effectiveParentId, nextComment)
          : mergeCommentLists(currentComments, [nextComment]);
        commentsRef.current = nextComments;
        setComments(nextComments);
        writeCommentsCache(nextComments, pageRef.current, hasMoreRef.current);
        setLastAddedId(nextComment.id);
        if (expandedTargets.length) {
          setExpandedThreads((prev) => {
            const next = new Set(prev);
            expandedTargets.forEach((id) => next.add(id));
            return next;
          });
        }
      }

      const shouldFinalizeDraft = (
        isCurrentPost
        && draftRevisionRef.current === submittedDraftRevision
        && composerSessionRef.current === submittedComposerSession
      );
      if (shouldFinalizeDraft) {
        uploadDraftVersionRef.current += 1;
        mobileDraftRef.current = '';
        draftRevisionRef.current += 1;
        setText('');
        flushCommentDraft('');
        setReplyToId(null);
      }
      showToast('评论已发布', 'success');
      return shouldFinalizeDraft;
    } catch (error) {
      const message = error instanceof Error ? error.message : '评论失败，请稍后重试';
      showToast(message, 'error');
      return false;
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    await submitText(text);
  };

  const scrollCommentIntoView = (commentId: string) => {
    const list = listRef.current;
    const target = list?.querySelector<HTMLElement>(`[data-comment-id="${commentId}"]`);
    if (!list || !target) {
      return false;
    }
    const listRect = list.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const nextTop = list.scrollTop
      + targetRect.top
      - listRect.top
      - Math.max(0, (list.clientHeight - targetRect.height) / 2);
    list.scrollTo({ top: Math.max(0, nextTop), behavior: 'smooth' });
    return true;
  };

  useEffect(() => {
    if (!lastAddedId || !listRef.current) {
      return;
    }
    if (scrollCommentIntoView(lastAddedId)) {
      requestAnimationFrame(() => {
        setHighlightedCommentId(lastAddedId);
      });
    }
    setLastAddedId(null);
  }, [lastAddedId, comments]);

  useEffect(() => {
    if (!focusTargetId || !listRef.current) {
      return;
    }
    if (scrollCommentIntoView(focusTargetId)) {
      requestAnimationFrame(() => {
        setHighlightedCommentId(focusTargetId);
      });
    }
    setFocusTargetId(null);
  }, [focusTargetId, comments]);

  useEffect(() => {
    if (!highlightedCommentId) {
      return;
    }
    const timer = window.setTimeout(() => setHighlightedCommentId(null), 1500);
    return () => window.clearTimeout(timer);
  }, [highlightedCommentId]);

  if (!isOpen) {
    return null;
  }

  const totalCount = countComments(comments);
  const mostLikedComment = getMostLikedComment(comments);
  const rootOrderMap = buildOrderMap(comments);
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

  const commentPanel = (
    <div
      ref={rootRef}
      tabIndex={-1}
      className="fixed inset-x-0 bottom-0 z-40 flex max-h-75vh-safe flex-col overflow-hidden rounded-t-xl border border-gray-200 bg-white p-4 font-sans shadow-lg animate-in slide-in-from-bottom-2 duration-200 md:static md:mt-4 md:max-h-none md:rounded-xl md:shadow-sm md:animate-none"
    >
      <div className="mb-3 flex shrink-0 items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="font-sans font-semibold text-lg text-ink">评论</h3>
          <span className="text-xs text-gray-500">{totalCount}</span>
        </div>
        <button
          type="button"
          onClick={handleClose}
          className="text-xs font-sans text-gray-500 hover:text-ink transition-colors"
        >
          收起
        </button>
      </div>

      <div className="mb-3 shrink-0 rounded-lg border border-dashed border-ink bg-gray-50 p-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="text-xs text-gray-600 font-sans">
            {mostLikedComment ? '热门评论' : '暂无热门评论'}
          </div>
          {mostLikedComment && (
            <button
              type="button"
              onClick={() => handleToggleLike(mostLikedComment.id)}
              className={`text-xs font-sans flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-1 border border-gray-200 bg-white hover:bg-highlight transition-colors ${
                mostLikedComment.viewerLiked ? 'text-blue-600' : 'text-gray-500'
              }`}
              aria-label="点赞热门评论"
              title={mostLikedComment.viewerLiked ? '取消点赞' : '点赞'}
            >
              <ThumbsUp
                className="w-3.5 h-3.5"
                fill={mostLikedComment.viewerLiked ? 'currentColor' : 'none'}
              />
              <span className="font-bold">{Number(mostLikedComment.likes || 0)}</span>
            </button>
          )}
        </div>

        {mostLikedComment ? (
          <div className="max-h-28 overflow-hidden">
            <MarkdownRenderer
              content={mostLikedComment.content}
              enableImageViewer
              historyOverlayKey={`comment-hot:${mostLikedComment.id}`}
              historyCommentPostId={postId}
              className="markdown-preview text-sm text-pencil [&_.markdown-image]:max-h-24 md:[&_.markdown-image]:max-h-28 [&_.markdown-image]:object-contain [&_.markdown-image]:mx-auto [&_.markdown-image]:w-auto [&_.markdown-image]:!max-w-40 md:[&_.markdown-image]:!max-w-48"
            />
          </div>
        ) : (
          <div className="text-sm text-gray-400 font-sans">
            {totalCount > 0 ? '暂无热评' : '还没有评论，先来抢个沙发吧'}
          </div>
        )}

        {/* 评论区不展示帖子详情（即使没有评论） */}
      </div>

      <div
        ref={listRef}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-lg border border-gray-200 bg-white pr-1"
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
        ) : loadError && comments.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
            <p className="text-sm text-red-600">{loadError}</p>
            <button
              type="button"
              onClick={() => setReloadVersion((value) => value + 1)}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border-2 border-ink bg-white px-4 font-hand text-sm font-bold text-ink shadow-sketch transition-colors hover:bg-highlight"
            >
              重新加载
            </button>
          </div>
        ) : comments.length === 0 ? (
          <div className="px-3 py-6 text-center text-gray-500 text-sm">还没有评论，来当第一个吃瓜群众吧！</div>
        ) : (
          [...comments]
            .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
            .map((comment) => {
              const renderComment = (item: Comment, depth: number, parentLabel: string, siblingOrderMap: Map<string, number>) => {
                const replies = item.replies || [];
                const orderedReplies = [...replies].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
                const isExpanded = expandedThreads.has(item.id);
                const visibleReplies = isExpanded ? orderedReplies : [];
                const currentIndex = siblingOrderMap.get(item.id) || 1;
                const threadLabel = parentLabel ? `${parentLabel}.${currentIndex}` : `${currentIndex}`;
                const isDeleted = Boolean(item.deleted);
                const isHidden = Boolean(item.hidden);
                const isUnavailable = isDeleted || isHidden;
                const isRumor = !isUnavailable && item.rumorStatus === 'suspected';
                const isRumorExpanded = expandedRumorComments.has(item.id);
                const replyLabel = depth > 0
                  ? (labelMap.get(item.replyToId || '') || parentLabel)
                  : '';
                const replyOrderMap = replies.length ? buildOrderMap(orderedReplies) : null;

                return (
                  <div
                    key={item.id}
                    data-comment-id={item.id}
                    className={`${depth === 0 ? 'group px-3 pt-2' : 'group px-2.5 pt-1'} rounded-lg transition-colors duration-300 ${highlightedCommentId === item.id ? 'bg-highlight/70' : ''}`}
                  >
                    <div className="flex flex-nowrap items-center justify-between gap-2 text-[12px] text-gray-500 font-sans">
                      <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-1.5 overflow-hidden">
                        {/* 楼层 + 身份锁同一行，避免 ColorfulName / 窄屏把「楼主」挤下去 */}
                        <span className="inline-flex min-w-0 max-w-full flex-nowrap items-baseline gap-1.5">
                          <span className="shrink-0 font-mono text-[12px] text-gray-500">
                            {threadLabel}楼
                          </span>
                          {item.id === mostLikedComment?.id && (
                            <span className="shrink-0 rounded-sm border border-ink/40 bg-highlight px-1.5 py-0.5 font-hand text-[10px] font-bold leading-none text-ink">
                              热评
                            </span>
                          )}
                          <ColorfulName
                            styleId={item.authorNameStyleId}
                            className="min-w-0 truncate text-[12px] font-sans text-gray-800"
                          >
                            {getCommentIdentityLabel(item)}
                          </ColorfulName>
                        </span>
                        {isDeleted && <span className="shrink-0 text-[11px] text-gray-400">已处理</span>}
                        {isHidden && <span className="shrink-0 text-[11px] text-orange-500">已隐藏</span>}
                        {replyLabel && (
                          <span className="hidden shrink-0 text-[11px] text-gray-500 sm:inline">
                            回复 {replyLabel}楼
                          </span>
                        )}
                        {replyLabel && (
                          <span className="inline shrink-0 font-mono text-[11px] text-gray-500 sm:hidden">
                            ↪{replyLabel}
                          </span>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-nowrap items-center gap-2 whitespace-nowrap">
                        <span className="text-gray-400" title={item.timestamp}>
                          <span className="hidden sm:inline">{item.timestamp}</span>
                          <span className="inline sm:hidden">{formatCompactTime(item.createdAt) || item.timestamp}</span>
                        </span>
                        {!isUnavailable && (
                          <button
                            type="button"
                            onClick={() => handleToggleLike(item.id)}
                            className={`flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-1 transition-colors hover:bg-highlight ${item.viewerLiked ? 'text-blue-600' : 'text-gray-500'}`}
                            aria-label="点赞"
                            title={item.viewerLiked ? '取消点赞' : '点赞'}
                          >
                            <ThumbsUp className="w-3.5 h-3.5" fill={item.viewerLiked ? 'currentColor' : 'none'} />
                            <span className="text-[12px] font-bold">{Number(item.likes || 0)}</span>
                          </button>
                        )}
                        {!isUnavailable && (
                          <button
                            type="button"
                            onClick={() => openCommentReportModal(item.id, item.content)}
                            className="text-[12px] text-gray-400 opacity-100 transition-colors hover:text-red-600 sm:opacity-0 sm:group-hover:opacity-100"
                            aria-label="举报"
                            title="举报"
                          >
                            举报
                          </button>
                        )}
                        {!isUnavailable && (
                          <button
                            type="button"
                            onClick={() => setReplyToId(item.id)}
                            className="text-gray-500 opacity-100 transition-colors hover:text-ink sm:opacity-0 sm:group-hover:opacity-100"
                            aria-label="回复"
                            title="回复"
                          >
                            回复
                          </button>
                        )}
                      </div>
                    </div>
                    {isRumor && (
                      <div className="mt-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-[12px] text-orange-700">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-2">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                            <span>该评论疑似谣言，请谨慎辨别。</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleRumorCommentExpand(item.id)}
                            className="shrink-0 font-bold hover:text-orange-900"
                          >
                            {isRumorExpanded ? '收起原文' : '展开原文'}
                          </button>
                        </div>
                      </div>
                    )}
                    <div className={depth === 0 ? `mt-1 text-[13px] ${isUnavailable ? 'text-gray-400 italic' : 'text-ink'}` : `mt-0.5 text-[12px] ${isUnavailable ? 'text-gray-400 italic' : 'text-ink/90'}`}>
                      {isRumor && !isRumorExpanded ? (
                        <div className="rounded-lg border border-dashed border-orange-200 bg-orange-50/50 px-3 py-3 text-[12px] leading-5 text-orange-700">
                          原文已折叠，点击“展开原文”查看。
                        </div>
                      ) : (
                        <MarkdownRenderer
                          content={item.content}
                          enableImageViewer
                          historyOverlayKey={`comment:${item.id}`}
                          historyCommentPostId={postId}
                          className={`${depth === 0 ? 'leading-5' : 'leading-4'} [&_.markdown-image]:max-h-32 md:[&_.markdown-image]:max-h-44 [&_.markdown-image]:object-contain [&_.markdown-image]:mx-auto [&_.markdown-image]:w-auto [&_.markdown-image]:!max-w-52 md:[&_.markdown-image]:!max-w-64`}
                        />
                      )}
                    </div>
                    {depth === 0 && visibleReplies.length > 0 && (
                      <div className="mt-2 rounded-md bg-gray-50 border border-gray-200 px-1.5 py-2 flex flex-col gap-2">
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
                          className="transition-colors hover:text-ink"
                        >
                          {isExpanded ? '收起回复' : `查看 ${replies.length} 条回复`}
                        </button>
                      </div>
                    )}
                    <div className={depth === 0 ? 'border-b border-gray-100 mt-3' : 'border-b border-gray-100 mt-2'} />
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

      <form className="mt-3 flex shrink-0 flex-col gap-3" onSubmit={handleSubmit}>
        {replyToId && (
          <div className="flex items-center justify-between text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
            <span>正在回复 {replyTargetLabel || '某一'}楼</span>
            <button
              type="button"
              onClick={() => setReplyToId(null)}
              className="hover:text-ink transition-colors"
            >
              取消回复
            </button>
          </div>
        )}
        <div className="flex w-full min-w-0 max-w-full items-stretch gap-2">
          <textarea
            ref={inlineTextareaRef}
            value={text}
            onChange={(e) => updateInlineText(e.target.value)}
            onBlur={() => flushCommentDraft(mobileDraftRef.current)}
            onPaste={(e) => {
              const items = e.clipboardData?.items;
              if (!items) return;
              for (let i = 0; i < items.length; i++) {
                const item = items[i];
                if (item.kind === 'file' && item.type.startsWith('image/')) {
                  const file = item.getAsFile();
                  if (file) {
                    e.preventDefault();
                    void handleUploadFile(file);
                    return;
                  }
                }
              }
            }}
            placeholder="留下你的评论..."
            maxLength={MAX_LENGTH + 10}
            className="min-w-0 flex-1 h-16 p-3 border-2 border-ink rounded-lg resize-none font-sans bg-white focus:outline-none focus:shadow-sketch-sm transition-shadow"
            onClick={() => {
              if (isMobile) {
                openInputModal();
              }
            }}
            onKeyDown={(event) => {
              if (!isMobile || (event.key !== 'Enter' && event.key !== ' ')) {
                return;
              }
              event.preventDefault();
              openInputModal();
            }}
            readOnly={isMobile}
          />
          <input
            ref={uploadInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                void handleUploadFile(file);
              }
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={handlePickUpload}
            disabled={uploading || submitting}
            className="shrink-0 px-3 h-16 flex items-center justify-center border-2 border-ink rounded-lg bg-white hover:bg-highlight transition-colors shadow-sketch disabled:opacity-60"
            aria-label="上传图片"
            title={uploading ? '正在上传...' : submitting ? '评论提交中' : '上传图片'}
          >
            <Image className="w-4 h-4" />
          </button>
          <div className="relative shrink-0">
            <button
              ref={memeButtonRef}
              type="button"
              onClick={toggleInlineMemePicker}
              className="px-3 h-16 flex items-center justify-center border-2 border-ink rounded-lg bg-white hover:bg-highlight transition-colors shadow-sketch"
              aria-label="表情"
              title="表情"
            >
              <Smile className="w-4 h-4" />
            </button>
            <MemePicker
              open={memeOpen}
              onClose={closeInlineMemePicker}
              anchorRef={memeButtonRef}
              onSelect={(packName, label) => {
                inlineInsertMeme(packName, label);
                closeInlineMemePicker();
              }}
            />
          </div>
          <SketchButton
            type="submit"
            className="shrink-0 px-3 h-16 flex items-center justify-center"
            disabled={submitting || uploading}
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
        key={postId}
        isOpen={isMobile && inputModalOpen}
        onClose={closeInputModal}
        title={replyToId ? '回复评论' : '写评论'}
        helperText={replyToId ? `正在回复 ${replyTargetLabel || '某一'}楼` : undefined}
        onCancelReply={replyToId ? () => setReplyToId(null) : undefined}
        initialText={text}
        maxLength={MAX_LENGTH}
        submitting={submitting}
        uploading={uploading}
        tryAcquireUpload={tryAcquireUpload}
        showToast={showToast}
        onSubmit={async (nextText) => {
          const ok = await submitText(nextText);
          if (ok) {
            closeInputModal();
          }
        }}
      />

      <Turnstile ref={turnstileRef} action="comment" enabled={isOpen && turnstileEnabled} />

      <ReportModal
        isOpen={reportModal.isOpen}
        onClose={closeCommentReportModal}
        postId={postId}
        commentId={reportModal.commentId}
        targetType="comment"
        contentPreview={reportModal.content.substring(0, 80)}
      />
    </div>
  );

  return commentPanel;
};

export default CommentModal;
