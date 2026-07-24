import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Flag,
  Handshake,
  LockKeyhole,
  MessageCircle,
  MoreHorizontal,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react';

import { api } from '@/api';
import Modal from '@/components/Modal';
import { getRecruitmentThreadIdFromPath } from '@/features/app/routing';
import { useAppActions } from '@/store/AppActionsContext';
import type {
  RecruitmentContactExchange,
  RecruitmentMessage,
  RecruitmentReportTargetType,
  RecruitmentThread,
} from '@/types';

import { RecruitmentReportDialog } from './RecruitmentDialogs';

interface ChatMessage extends RecruitmentMessage {
  pending?: boolean;
  failed?: boolean;
}

const createClientMessageId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const toValidChatDate = (value?: number | string | Date | null) => {
  if (value instanceof Date) {
    const date = new Date(value.getTime());
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === 'string' && value.trim()) {
    const numericValue = Number(value);
    const date = Number.isFinite(numericValue) ? new Date(numericValue) : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
};

const formatChatTime = (value?: number | string | Date | null) => {
  const date = toValidChatDate(value);
  if (!date) return '';
  const now = new Date();
  const sameDay = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  const timeLabel = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  if (sameDay) {
    return timeLabel;
  }
  const dateOptions = date.getFullYear() === now.getFullYear()
    ? { month: 'numeric' as const, day: 'numeric' as const }
    : { year: 'numeric' as const, month: 'numeric' as const, day: 'numeric' as const };
  return `${date.toLocaleDateString('zh-CN', dateOptions)} ${timeLabel}`;
};

const formatFullChatTime = (value?: number | string | Date | null) => {
  const date = toValidChatDate(value);
  return date ? date.toLocaleString('zh-CN') : '';
};

const formatChatDateTime = (value?: number | string | Date | null) => {
  const date = toValidChatDate(value);
  return date ? date.toISOString() : undefined;
};

/*
 * 消息序号来自服务端，运行时仍需防御字符串、负数和 NaN，避免游标请求进入
 * 无效状态后不断重复请求。
 */
const normalizeMessageSeq = (value: unknown): number | null => {
  const seq = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(seq) && seq > 0 ? seq : null;
};

const displayXinfaName = (value?: { id?: string; name?: string } | null) => (
  value?.id === 'cangjian' ? '藏剑（问水诀 / 山居剑意）' : value?.name || '未选择'
);

const CHAT_AVATAR_TONES = [
  'bg-paper-shadow text-ink',
  'bg-marker-blue/25 text-ink',
  'bg-paper-rule/70 text-ink',
  'bg-white text-ink',
] as const;

/** 心法身份章与密聊列表使用相同规则，确保同一心法在两个入口保持稳定识别。 */
const xinfaInitials = (name: string) => {
  const cleaned = String(name || '')
    .replace(/（[^）]*）|\([^)]*\)/g, '')
    .replace(/\s+/g, '')
    .trim();
  return cleaned.slice(0, 2) || '招';
};

const avatarToneFor = (seed: string) => {
  let hash = 0;
  const source = seed || 'default';
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash + source.charCodeAt(index) * (index + 3)) % 997;
  }
  return CHAT_AVATAR_TONES[hash % CHAT_AVATAR_TONES.length];
};

const sortMessages = (items: ChatMessage[]) => [...items].sort((a, b) => {
  if (a.seq !== b.seq) return a.seq - b.seq;
  return a.createdAt - b.createdAt;
});

const mergeMessages = (current: ChatMessage[], incoming: RecruitmentMessage[]) => {
  const next = [...current];
  for (const message of incoming) {
    const pendingIndex = message.clientMsgId
      ? next.findIndex((item) => item.clientMsgId === message.clientMsgId)
      : -1;
    const idIndex = next.findIndex((item) => item.id === message.id);
    const index = pendingIndex >= 0 ? pendingIndex : idIndex;
    if (index >= 0) {
      next[index] = { ...next[index], ...message, pending: false, failed: false };
    } else {
      next.push(message);
    }
  }
  return sortMessages(next);
};

const reconcileMessageModeration = (current: ChatMessage[], changes: RecruitmentMessage[]) => {
  if (!changes.length) return current;
  const byId = new Map(changes.map((message) => [message.id, message]));
  return current.map((message) => {
    const changed = byId.get(message.id);
    return changed ? { ...message, ...changed, pending: false, failed: false } : message;
  });
};

const normalizeExchange = (value: unknown): RecruitmentContactExchange | null => {
  if (!value || typeof value !== 'object') return null;
  const item = value as RecruitmentContactExchange & { exchange?: RecruitmentContactExchange };
  return item.exchange || item;
};

interface RecruitmentChatViewProps {
  threadId?: string | null;
  embedded?: boolean;
  onNavigateBack?: () => void;
  onThreadRead?: (threadId: string) => void;
}

const RecruitmentChatView: React.FC<RecruitmentChatViewProps> = ({
  threadId: threadIdProp,
  embedded = false,
  onNavigateBack,
  onThreadRead,
}) => {
  const { showToast } = useAppActions();
  const threadId = useMemo(
    () => threadIdProp || getRecruitmentThreadIdFromPath(window.location.pathname),
    [threadIdProp],
  );
  const [thread, setThread] = useState<RecruitmentThread | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [initialError, setInitialError] = useState<string | null>(null);
  const [pollingError, setPollingError] = useState<string | null>(null);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);
  const [contactPanelOpen, setContactPanelOpen] = useState(false);
  const [contactText, setContactText] = useState('');
  const [contactSubmitting, setContactSubmitting] = useState(false);
  const [exchanges, setExchanges] = useState<RecruitmentContactExchange[]>([]);
  const [contactLoading, setContactLoading] = useState(true);
  const [contactError, setContactError] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<{
    targetType: RecruitmentReportTargetType;
    targetId: string;
  } | null>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [closingThread, setClosingThread] = useState(false);

  const listRef = useRef<HTMLDivElement | null>(null);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const pendingExchangeIdRef = useRef<string | null>(null);
  const contactUnlockStateRef = useRef<{
    threadId: string | null;
    initialized: boolean;
    unlocked: boolean;
  }>({ threadId: null, initialized: false, unlocked: false });
  const lastSeqRef = useRef(0);
  const lastReadSeqRef = useRef(0);
  const moderationSeqRef = useRef(0);
  const oldestSeqRef = useRef<number | null>(null);
  const pollingRef = useRef(false);
  const loadingOlderRef = useRef(false);
  const pendingBottomScrollRef = useRef<ScrollBehavior | null>(null);
  const pendingOlderScrollRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);

  const ownRole = thread?.role || 'applicant';
  const canSend = Boolean(thread?.writable);
  const canCloseThread = Boolean(thread && thread.status === 'active');
  const chatStatusLabel = loading
    ? '加载中'
    : !thread
      ? '不可访问'
      : thread.writable
        ? '进行中'
        : thread.writeBlockedReason === 'thread_locked' || thread.locked
          ? '已锁定'
          : thread.writeBlockedReason === 'post_unavailable'
            ? '招募已下架'
            : '已结束';
  const ownExchange = exchanges.find((item) => item.ownerRole === ownRole) || null;
  const otherExchange = exchanges.find((item) => item.ownerRole && item.ownerRole !== ownRole) || null;
  const contactCompleted = exchanges.some((item) => item.status === 'unlocked' || item.unlockedAt);
  const canExchangeContact = canSend;
  const canConfirmPendingExchange = Boolean(canExchangeContact && otherExchange?.id && !contactCompleted);
  const availableContactValue = contactText.trim() || ownExchange?.contact?.value?.trim() || '';

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const element = listRef.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior });
  }, []);

  const isNearBottom = useCallback(() => {
    const element = listRef.current;
    if (!element) return true;
    return element.scrollHeight - element.scrollTop - element.clientHeight <= 80;
  }, []);

  const applyThread = useCallback((value: RecruitmentThread | null | undefined) => {
    if (!value) return;
    setThread(value);
    // 另一方关闭密聊后，轮询会带回最新会话状态；同步收起已失效的确认框。
    if (value.status !== 'active') setCloseConfirmOpen(false);
  }, []);

  const acknowledgeRead = useCallback((seq: number) => {
    if (!threadId || !Number.isSafeInteger(seq) || seq <= lastReadSeqRef.current) return;
    const previousSeq = lastReadSeqRef.current;
    lastReadSeqRef.current = seq;
    void api.markRecruitmentThreadRead(threadId, seq)
      .then(() => onThreadRead?.(threadId))
      .catch(() => {
        // 失败时恢复游标，让下一轮轮询可以重试；新的更大游标不回退。
        if (lastReadSeqRef.current === seq) lastReadSeqRef.current = previousSeq;
      });
  }, [onThreadRead, threadId]);

  const applyContactExchangeItems = useCallback((
    source: RecruitmentContactExchange[] | null | undefined,
    viewerRole = ownRole,
    notifyUnlock = true,
  ) => {
    const items = Array.isArray(source) ? source.filter((item) => !item.deleted) : [];
    const unlocked = items.some((item) => item.status === 'unlocked' || Boolean(item.unlockedAt));
    const previousUnlockState = contactUnlockStateRef.current;
    const shouldNotifyUnlock = Boolean(
      notifyUnlock
      && previousUnlockState.threadId === threadId
      && previousUnlockState.initialized
      && !previousUnlockState.unlocked
      && unlocked
    );
    contactUnlockStateRef.current = {
      threadId: threadId || null,
      initialized: true,
      unlocked,
    };
    const pendingFromPeer = items.find((item) => (
      item.ownerRole && item.ownerRole !== viewerRole && item.id && item.status !== 'unlocked' && !item.unlockedAt
    ));
    const shouldRevealPrompt = Boolean(
      pendingFromPeer?.id
      && pendingFromPeer.id !== pendingExchangeIdRef.current
      && isNearBottom()
    );
    pendingExchangeIdRef.current = pendingFromPeer?.id || null;
    setExchanges(items);
    setContactError(null);
    setContactLoading(false);
    // 新请求出现时，仅在用户原本位于消息底部的情况下展示确认卡片，避免打断历史消息阅读。
    if (shouldRevealPrompt) {
      window.requestAnimationFrame(() => scrollToBottom('smooth'));
    }
    if (shouldNotifyUnlock) {
      setContactPanelOpen(true);
      setContextOpen(false);
      setMoreMenuOpen(false);
      showToast('对方已同意交换联系方式，联系方式已解锁', 'success');
    }
  }, [isNearBottom, ownRole, scrollToBottom, showToast, threadId]);

  const loadContactExchanges = useCallback(async (showLoading = false, notifyUnlock = true) => {
    if (!threadId) return;
    if (showLoading) setContactLoading(true);
    try {
      const exchangeData = await api.getRecruitmentContactExchanges(threadId);
      applyContactExchangeItems(exchangeData?.items, ownRole, notifyUnlock);
    } catch (exchangeError) {
      setContactError(exchangeError instanceof Error ? exchangeError.message : '联系方式加载失败');
    } finally {
      if (showLoading) setContactLoading(false);
    }
  }, [applyContactExchangeItems, ownRole, threadId]);

  const loadMessages = useCallback(async (initial = false) => {
    if (!threadId || pollingRef.current || loadingOlderRef.current) return;
    pollingRef.current = true;
    const shouldStickToBottom = initial || isNearBottom();
    if (initial) {
      setLoading(true);
      setInitialError(null);
    }
    try {
      const data = await api.getRecruitmentMessages(
        threadId,
        initial
          ? { includeContactExchanges: true, limit: 80 }
          : {
            afterSeq: lastSeqRef.current,
            afterModerationSeq: moderationSeqRef.current,
            includeContactExchanges: true,
            limit: 80,
          },
      );
      applyThread(data?.thread);
      if (Array.isArray(data?.contactExchanges)) {
        applyContactExchangeItems(data.contactExchanges, data?.thread?.role || ownRole);
      } else if (initial) {
        // 兼容后端滚动发布期间的旧响应；新版本会在消息响应中直接携带联系方式。
        await loadContactExchanges(true);
      }
      const incoming = Array.isArray(data?.items) ? data.items : [];
      if (incoming.length) {
        if (shouldStickToBottom) pendingBottomScrollRef.current = initial ? 'auto' : 'smooth';
        setMessages((previous) => mergeMessages(previous, incoming));
        const validSequences = incoming
          .map((item) => normalizeMessageSeq(item.seq))
          .filter((seq): seq is number => seq !== null);
        if (validSequences.length) {
          lastSeqRef.current = Math.max(lastSeqRef.current, ...validSequences);
          if (initial) {
            oldestSeqRef.current = normalizeMessageSeq(data?.oldestSeq)
              || Math.min(...validSequences);
          }
        }
      }
      const moderationItems = Array.isArray(data?.moderationItems) ? data.moderationItems : [];
      if (moderationItems.length) {
        setMessages((previous) => reconcileMessageModeration(previous, moderationItems));
      }
      const nextModerationCursor = Number(data?.moderationCursor);
      if (Number.isSafeInteger(nextModerationCursor) && nextModerationCursor >= 0) {
        moderationSeqRef.current = initial
          ? nextModerationCursor
          : Math.max(moderationSeqRef.current, nextModerationCursor);
      }
      if (initial) setHasMoreMessages(Boolean(data?.hasMore));
      acknowledgeRead(lastSeqRef.current);
      if (initial) setInitialError(null);
      setPollingError(null);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : '密聊加载失败';
      if (initial) {
        setInitialError(message);
        setContactLoading(false);
      } else {
        setPollingError(message);
      }
    } finally {
      pollingRef.current = false;
      if (initial) setLoading(false);
    }
  }, [acknowledgeRead, applyContactExchangeItems, applyThread, isNearBottom, loadContactExchanges, ownRole, threadId]);

  const loadOlderMessages = useCallback(async () => {
    const beforeSeq = oldestSeqRef.current;
    if (
      !threadId
      || !hasMoreMessages
      || !beforeSeq
      || loadingOlderRef.current
      || pollingRef.current
    ) return;

    const list = listRef.current;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const data = await api.getRecruitmentMessages(threadId, { beforeSeq, limit: 80 });
      applyThread(data?.thread);
      const incoming = Array.isArray(data?.items) ? data.items : [];
      const validSequences = incoming
        .map((item) => normalizeMessageSeq(item.seq))
        .filter((seq): seq is number => seq !== null);
      setHasMoreMessages(Boolean(data?.hasMore));
      if (!incoming.length || !validSequences.length) {
        if (!incoming.length) setHasMoreMessages(false);
        return;
      }

      oldestSeqRef.current = normalizeMessageSeq(data?.oldestSeq)
        || Math.min(...validSequences);
      if (list) {
        pendingOlderScrollRef.current = {
          scrollHeight: list.scrollHeight,
          scrollTop: list.scrollTop,
        };
      }
      setMessages((previous) => mergeMessages(previous, incoming));
    } catch (requestError) {
      showToast(requestError instanceof Error ? requestError.message : '更早消息加载失败', 'error');
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [applyThread, hasMoreMessages, showToast, threadId]);

  useEffect(() => {
    if (!threadId) {
      setLoading(false);
      setInitialError('密聊地址无效');
      return;
    }
    if (contactUnlockStateRef.current.threadId !== threadId) {
      pendingExchangeIdRef.current = null;
      contactUnlockStateRef.current = {
        threadId,
        initialized: false,
        unlocked: false,
      };
    }
    void loadMessages(true);
    const timer = window.setInterval(() => {
      if (!document.hidden) void loadMessages(false);
    }, 3500);
    const handleVisibility = () => {
      if (!document.hidden) void loadMessages(false);
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [loadMessages, threadId]);

  useEffect(() => {
    if (!moreMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!moreMenuRef.current?.contains(event.target as Node)) setMoreMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMoreMenuOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [moreMenuOpen]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const olderScroll = pendingOlderScrollRef.current;
    if (olderScroll) {
      list.scrollTop = olderScroll.scrollTop + (list.scrollHeight - olderScroll.scrollHeight);
      pendingOlderScrollRef.current = null;
      return;
    }

    const bottomBehavior = pendingBottomScrollRef.current;
    if (!loading && bottomBehavior) {
      pendingBottomScrollRef.current = null;
      scrollToBottom(bottomBehavior);
    }
  }, [loading, messages, scrollToBottom]);

  const navigateBack = () => {
    if (onNavigateBack) {
      onNavigateBack();
      // 应用路由负责切换视图，这里补上密聊列表标签并通知同一视图刷新。
      window.history.replaceState({}, '', '/recruitment?tab=chats');
      window.dispatchEvent(new PopStateEvent('popstate'));
      return;
    }
    window.history.pushState({}, '', '/recruitment?tab=chats');
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  const updateExchange = (value: unknown) => {
    const next = normalizeExchange(value);
    if (!next) return;
    setExchanges((previous) => {
      const exists = previous.some((item) => item.id === next.id);
      return exists
        ? previous.map((item) => (item.id === next.id ? next : item))
        : [...previous, next];
    });
  };

  const sendMessage = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!threadId || !canSend || sending) return;
    const content = messageText.trim();
    if (!content) return;
    const clientMsgId = createClientMessageId();
    const optimistic: ChatMessage = {
      id: `pending-${clientMsgId}`,
      seq: lastSeqRef.current + 1,
      senderRole: ownRole,
      content,
      createdAt: Date.now(),
      clientMsgId,
      pending: true,
    };
    pendingBottomScrollRef.current = 'smooth';
    setMessages((previous) => sortMessages([...previous, optimistic]));
    setMessageText('');
    setSending(true);
    try {
      const result = await api.sendRecruitmentMessage(threadId, { content, clientMsgId });
      const sent = result.message;
      pendingBottomScrollRef.current = 'smooth';
      setMessages((previous) => mergeMessages(previous, [sent]));
      lastSeqRef.current = Math.max(lastSeqRef.current, normalizeMessageSeq(sent.seq) || 0);
    } catch (requestError) {
      setMessages((previous) => previous.map((item) => (
        item.clientMsgId === clientMsgId ? { ...item, pending: false, failed: true } : item
      )));
      showToast(requestError instanceof Error ? requestError.message : '发送失败，请重试', 'error');
    } finally {
      setSending(false);
    }
  };

  const retryMessage = async (message: ChatMessage) => {
    if (!threadId || !canSend || sending || !message.clientMsgId) return;
    pendingBottomScrollRef.current = 'smooth';
    setMessages((previous) => previous.map((item) => (
      item.clientMsgId === message.clientMsgId ? { ...item, failed: false, pending: true } : item
    )));
    setSending(true);
    try {
      const result = await api.sendRecruitmentMessage(threadId, {
        content: message.content || '',
        clientMsgId: message.clientMsgId,
      });
      const sent = result.message;
      pendingBottomScrollRef.current = 'smooth';
      setMessages((previous) => mergeMessages(previous, [sent]));
      lastSeqRef.current = Math.max(lastSeqRef.current, normalizeMessageSeq(sent.seq) || 0);
    } catch (requestError) {
      setMessages((previous) => previous.map((item) => (
        item.clientMsgId === message.clientMsgId ? { ...item, pending: false, failed: true } : item
      )));
      showToast(requestError instanceof Error ? requestError.message : '发送失败，请重试', 'error');
    } finally {
      setSending(false);
    }
  };

  const submitContact = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!threadId || !canExchangeContact || !availableContactValue || contactSubmitting) return;
    setContactSubmitting(true);
    try {
      const contact = { type: 'other' as const, value: availableContactValue, label: '' };
      const result = canConfirmPendingExchange
        ? await api.consentRecruitmentContactExchange(otherExchange.id, contact)
        : await api.createRecruitmentContactExchange(threadId, contact);
      if ('items' in result && Array.isArray(result.items)) {
        // 本人操作已有明确成功提示，同时更新轮询基线，避免下一轮再次提示解锁。
        applyContactExchangeItems(result.items, ownRole, false);
      } else {
        updateExchange(result);
        await loadContactExchanges(false, false);
      }
      setContactText('');
      showToast(canConfirmPendingExchange ? '联系方式已交换' : '交换请求已发出', 'success');
    } catch (requestError) {
      showToast(requestError instanceof Error ? requestError.message : '提交联系方式失败', 'error');
    } finally {
      setContactSubmitting(false);
    }
  };

  const confirmCloseThread = async () => {
    if (!threadId || !canCloseThread || closingThread) return;
    setClosingThread(true);
    try {
      const result = await api.closeRecruitmentThread(threadId);
      setThread(result.thread);
      setCloseConfirmOpen(false);
      showToast('密聊已关闭，双方均不可继续发送消息', 'success');
    } catch (requestError) {
      showToast(requestError instanceof Error ? requestError.message : '关闭密聊失败', 'error');
    } finally {
      setClosingThread(false);
    }
  };

  const RootElement: React.ElementType = embedded ? 'div' : 'main';
  const rootClassName = embedded
    ? 'flex w-full flex-col'
    : 'mx-auto flex w-full max-w-[980px] flex-grow flex-col px-3 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-3 sm:px-6 sm:pb-8 sm:pt-6';
  const workspaceClassName = embedded
    ? 'flex h-[calc(100dvh-14rem)] min-h-[34rem] max-h-[760px] shrink-0 flex-col overflow-hidden rounded-lg border border-ink/12 bg-[#fffdfc]'
    : 'flex h-[calc(100dvh-8.5rem)] min-h-0 shrink-0 flex-col overflow-hidden rounded-lg border border-ink/12 bg-[#fffdfc] lg:h-[min(760px,calc(100dvh-10rem))] lg:min-h-[580px]';

  if (!threadId) {
    return (
      <RootElement className={`${embedded ? 'min-h-[32rem]' : 'min-h-70vh-safe'} mx-auto flex w-full max-w-2xl flex-col items-center justify-center px-4 py-12 text-center`}>
        <div className="flex size-12 items-center justify-center rounded-lg bg-marker-blue/20 text-ink">
          <MessageCircle className="size-6" aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-xl font-semibold text-ink">密聊不存在</h1>
        <button
          type="button"
          onClick={navigateBack}
          className="mt-6 inline-flex min-h-10 items-center gap-2 rounded-md border border-ink/20 bg-white px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-paper-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          返回密聊
        </button>
      </RootElement>
    );
  }

  const myXinfaName = (
    thread?.role === 'publisher' ? displayXinfaName(thread.publisherXinfa) : displayXinfaName(thread?.applicantXinfa)
  );
  const peerXinfaName = (
    thread?.role === 'publisher' ? displayXinfaName(thread.applicantXinfa) : displayXinfaName(thread?.publisherXinfa)
  );
  const myXinfaSeed = thread?.role === 'publisher'
    ? thread?.publisherXinfa?.school || thread?.publisherXinfa?.id || myXinfaName
    : thread?.applicantXinfa?.school || thread?.applicantXinfa?.id || myXinfaName;
  const peerXinfaSeed = thread?.role === 'publisher'
    ? thread?.applicantXinfa?.school || thread?.applicantXinfa?.id || peerXinfaName
    : thread?.publisherXinfa?.school || thread?.publisherXinfa?.id || peerXinfaName;
  const recruitmentRoleLabel = thread?.role === 'publisher' ? '你的招募' : '你申请的招募';

  return (
    <RootElement className={rootClassName}>
      <section className={workspaceClassName} aria-label="密聊工作区">
        <header className="flex min-w-0 items-center gap-3 border-b border-ink/10 bg-paper/90 px-3 py-3 sm:px-5 sm:py-3.5">
          <button
            type="button"
            onClick={navigateBack}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-ink/15 bg-white text-ink transition-all duration-200 hover:-translate-y-0.5 hover:border-ink/35 hover:bg-paper-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 active:translate-y-0 active:scale-[0.98] sm:size-10"
            title="返回密聊列表"
            aria-label="返回密聊列表"
          >
            <ArrowLeft className="size-4 sm:size-5" aria-hidden="true" />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span
              className={`hidden size-10 shrink-0 items-center justify-center rounded-xl border border-ink/10 text-xs font-bold tracking-[0.03em] sm:inline-flex ${avatarToneFor(peerXinfaSeed)}`}
              aria-label={`对方心法：${peerXinfaName}`}
            >
              {xinfaInitials(peerXinfaName)}
            </span>
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <h1 className="truncate text-base font-bold tracking-[-0.015em] text-ink sm:text-lg">与「{peerXinfaName}」密聊</h1>
                <span className={`hidden shrink-0 items-center gap-1 text-[11px] font-medium sm:inline-flex ${canSend ? 'text-ink' : 'text-pencil'}`}>
                  <span className={`size-1.5 rounded-full ${canSend ? 'bg-marker-green ring-1 ring-inset ring-ink/20' : 'bg-pencil/40'}`} aria-hidden="true" />
                  {chatStatusLabel}
                </span>
              </div>
              <p className="mt-0.5 truncate text-xs text-pencil">{recruitmentRoleLabel} · 匿名会话</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setContactPanelOpen((value) => {
                const next = !value;
                if (next) {
                  setContextOpen(false);
                  setMoreMenuOpen(false);
                }
                return next;
              })}
              className={`relative inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 active:translate-y-px sm:min-h-10 sm:gap-2 sm:px-3 sm:text-sm ${contactCompleted ? 'border-ink/15 bg-marker-green/25 text-ink hover:bg-marker-green/40' : canConfirmPendingExchange ? 'border-ink/15 bg-highlight/45 text-ink hover:bg-highlight/65' : 'border-ink/15 bg-white text-ink hover:border-ink/35 hover:bg-paper-soft'}`}
              title="联系方式交换"
              aria-label={canConfirmPendingExchange ? '联系方式交换，待确认' : '联系方式交换'}
              aria-expanded={contactPanelOpen}
            >
              <Handshake className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">{contactCompleted ? '已交换' : canConfirmPendingExchange ? '待确认' : '联系方式'}</span>
              {canConfirmPendingExchange && <span className="absolute -right-1 -top-1 size-2.5 rounded-full border-2 border-paper bg-highlight ring-1 ring-ink/20" aria-hidden="true" />}
            </button>
            <div ref={moreMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setMoreMenuOpen((value) => !value)}
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-ink/15 bg-white text-pencil transition-colors hover:border-ink/35 hover:bg-paper-soft hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 sm:size-10"
                title="更多会话操作"
                aria-label="更多会话操作"
                aria-expanded={moreMenuOpen}
              >
                <MoreHorizontal className="size-5" aria-hidden="true" />
              </button>
              {moreMenuOpen && (
                <div className="absolute right-0 top-[calc(100%+0.5rem)] z-20 min-w-40 overflow-hidden rounded-lg border border-ink/15 bg-white py-1.5 shadow-[0_14px_32px_rgba(44,44,44,0.14)]" role="menu">
                  {thread?.postId && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMoreMenuOpen(false);
                        setReportTarget({ targetType: 'post', targetId: thread.postId });
                      }}
                      className="flex min-h-10 w-full items-center gap-2.5 px-3 text-left text-sm font-medium text-pencil transition-colors hover:bg-paper-soft hover:text-ink focus-visible:outline-none focus-visible:bg-paper-soft"
                    >
                      <Flag className="size-4" aria-hidden="true" />
                      举报招募
                    </button>
                  )}
                  {thread?.id && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMoreMenuOpen(false);
                        setReportTarget({ targetType: 'thread', targetId: thread.id });
                      }}
                      className="flex min-h-10 w-full items-center gap-2.5 px-3 text-left text-sm font-medium text-pencil transition-colors hover:bg-paper-soft hover:text-ink focus-visible:outline-none focus-visible:bg-paper-soft"
                    >
                      <ShieldAlert className="size-4" aria-hidden="true" />
                      举报会话
                    </button>
                  )}
                  {canCloseThread && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMoreMenuOpen(false);
                        setCloseConfirmOpen(true);
                      }}
                      className="flex min-h-10 w-full items-center gap-2.5 px-3 text-left text-sm font-medium text-melon-deep transition-colors hover:bg-alert/15 focus-visible:outline-none focus-visible:bg-alert/15"
                    >
                      <LockKeyhole className="size-4" aria-hidden="true" />
                      关闭密聊
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </header>

        <section className="border-b border-ink/10 bg-paper-soft/90" aria-label="招募上下文">
          <div className="flex items-center justify-between gap-3 px-3 py-2.5 sm:px-5">
            <div className="flex min-w-0 items-center gap-2 text-xs text-pencil">
              <span className="inline-flex shrink-0 rounded-md border border-ink/15 bg-white px-2 py-0.5 font-bold text-ink">招募</span>
              <span className="truncate">{thread?.postContent || '招募内容已不可见'}</span>
            </div>
            <button
              type="button"
              onClick={() => setContextOpen((value) => {
                const next = !value;
                if (next) {
                  setContactPanelOpen(false);
                  setMoreMenuOpen(false);
                }
                return next;
              })}
              className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-semibold text-pencil transition-colors hover:bg-white/70 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-1"
              aria-expanded={contextOpen}
            >
              {contextOpen ? '收起' : '展开'}
              <ChevronDown className={`size-3.5 transition-transform motion-reduce:transition-none ${contextOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>
          </div>
          <div className={`${contextOpen ? 'block' : 'hidden'} max-h-[42dvh] overflow-y-auto border-t border-ink/10 px-3 py-3 sm:px-5`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
              <div className="min-w-0 flex-1">
                <p className="mb-1 text-[11px] font-semibold text-pencil">招募原文</p>
                <p className="whitespace-pre-wrap break-words text-sm leading-6 text-ink">{thread?.postContent || '招募内容已不可见'}</p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 text-xs text-pencil">
                <span>我的心法：<strong className="font-semibold text-ink">{myXinfaName}</strong></span>
                <span>对方心法：<strong className="font-semibold text-ink">{peerXinfaName}</strong></span>
              </div>
            </div>
          </div>
        </section>

        {contactPanelOpen && (
          <section className="max-h-[46dvh] overflow-y-auto border-b border-ink/10 bg-paper-soft/95 px-3 py-3 sm:px-5 sm:py-4" aria-labelledby="contact-exchange-title">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Handshake className="size-4 text-ink" aria-hidden="true" />
                  <h2 id="contact-exchange-title" className="text-sm font-bold text-ink">联系方式交换</h2>
                </div>
                <p className="mt-1 text-xs leading-5 text-pencil">双方同意后才会显示对方填写的内容。</p>
              </div>
              <button
                type="button"
                onClick={() => setContactPanelOpen(false)}
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-pencil transition-colors hover:bg-paper-rule hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                title="收起联系方式"
                aria-label="收起联系方式"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>

            {contactLoading ? (
              <div className="mt-3 grid max-w-xl gap-2" aria-busy="true" aria-label="联系方式加载中">
                <div className="h-9 w-4/5 animate-pulse rounded-md bg-paper-rule motion-reduce:animate-none" />
                <div className="h-9 w-2/5 animate-pulse rounded-md bg-paper-rule motion-reduce:animate-none" />
              </div>
            ) : contactError ? (
              <div className="mt-3 max-w-xl rounded-md border border-alert/70 bg-red-50/70 p-3 text-sm leading-6 text-ink" role="alert">
                <p className="break-words">{contactError}</p>
                <button
                  type="button"
                  onClick={() => void loadContactExchanges(true)}
                  className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-md border border-ink/20 bg-white px-3 py-2 text-xs font-semibold text-ink transition-colors hover:bg-paper-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                >
                  <RefreshCw className="size-4" aria-hidden="true" />
                  重试
                </button>
              </div>
            ) : contactCompleted ? (
              <div className="mt-3 grid max-w-xl gap-2">
                <div className="flex items-start gap-2 rounded-md border border-ink/15 bg-marker-green/25 p-3 text-sm leading-6 text-ink">
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 break-words">对方联系方式：{otherExchange?.contact?.value || '对方未提供可显示内容'}</span>
                </div>
                {otherExchange?.id && otherExchange.status === 'unlocked' && otherExchange.contact && (
                  <button
                    type="button"
                    onClick={() => setReportTarget({ targetType: 'contact_exchange', targetId: otherExchange.id })}
                    className="inline-flex min-h-8 items-center gap-1 rounded-md px-1.5 justify-self-start text-xs font-semibold text-pencil underline decoration-dashed underline-offset-4 transition-colors hover:bg-alert/20 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                  >
                    <Flag className="size-3.5" aria-hidden="true" />
                    举报联系方式
                  </button>
                )}
              </div>
            ) : !canExchangeContact ? (
              <div className="mt-3 grid max-w-xl gap-3">
                <div className="flex items-start gap-2 rounded-md border border-ink/15 bg-white p-3 text-sm leading-6 text-pencil">
                  <LockKeyhole className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
                  <span>当前会话不可继续交换联系方式，已解锁的内容仍可查看。</span>
                </div>
              </div>
            ) : !ownExchange || canConfirmPendingExchange ? (
              <form className="mt-3 grid max-w-xl gap-3" onSubmit={submitContact}>
                <label htmlFor="recruitment-contact" className="text-xs font-semibold text-ink">我的联系方式</label>
                {ownExchange?.contact?.value && (
                  <p className="break-words text-xs leading-5 text-pencil">
                    当前填写：{ownExchange.contact.value}
                  </p>
                )}
                <input
                  type="text"
                  id="recruitment-contact"
                  value={contactText}
                  onChange={(event) => setContactText(event.target.value)}
                  maxLength={300}
                  disabled={contactSubmitting}
                  placeholder={ownExchange?.contact?.value ? '留空可沿用当前内容' : '可填写游戏 ID、群号或其他方式'}
                  className="h-11 w-full rounded-md border border-ink/20 bg-white px-3 text-sm text-ink outline-none transition-colors placeholder:text-pencil/70 focus:border-ink focus:ring-2 focus:ring-ink/15 disabled:cursor-not-allowed disabled:bg-paper-rule"
                />
                <button
                  type="submit"
                  disabled={!canExchangeContact || contactSubmitting || !availableContactValue}
                  className="inline-flex min-h-10 w-fit items-center justify-center gap-2 rounded-md bg-ink px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-pencil focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Handshake className="size-4" aria-hidden="true" />
                  {contactSubmitting
                    ? '提交中...'
                    : canConfirmPendingExchange
                      ? '确认交换'
                      : '提交并请求交换'}
                </button>
              </form>
            ) : (
              <div className="mt-3 grid max-w-xl gap-3">
                <div className="flex items-start gap-2 rounded-md border border-ink/15 bg-white p-3 text-sm leading-6 text-pencil">
                  <ShieldCheck className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
                  <span>你已提交联系方式。对方填写并确认后，会同时解锁。</span>
                </div>
              </div>
            )}
          </section>
        )}

        <section className="flex min-h-0 min-w-0 flex-1 bg-white" aria-label="密聊消息">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {pollingError && !loading && !initialError && (
              <div className="flex items-center justify-between gap-3 border-b border-alert/40 bg-alert/15 px-3 py-2 text-xs text-pencil sm:px-5" role="status" title={pollingError}>
                <span>消息刷新失败，将自动重试</span>
                <button
                  type="button"
                  onClick={() => void loadMessages(false)}
                  className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-md px-2 font-semibold text-ink transition-colors hover:bg-alert/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                >
                  <RefreshCw className="size-3.5" aria-hidden="true" />
                  立即重试
                </button>
              </div>
            )}

            <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto bg-[#f6f3ed] px-3 py-5 sm:px-6 sm:py-6" aria-live="polite">
              <div className="mb-5 flex justify-center">
                <span className="inline-flex items-center gap-1.5 rounded-md border border-ink/10 bg-white/75 px-2.5 py-1 text-[11px] text-pencil">
                  <ShieldCheck className="size-3.5 text-ink" aria-hidden="true" />
                  仅会话双方可见
                </span>
              </div>
              {loading ? (
                <div className="grid gap-4" aria-busy="true" aria-label="消息加载中">
                  <div className="h-10 w-3/5 animate-pulse rounded-md bg-paper-rule motion-reduce:animate-none" />
                  <div className="ml-auto h-14 w-2/3 animate-pulse rounded-md bg-marker-blue/20 motion-reduce:animate-none" />
                  <div className="h-9 w-2/5 animate-pulse rounded-md bg-paper-rule motion-reduce:animate-none" />
                </div>
              ) : initialError ? (
                <div className="flex min-h-48 flex-col items-center justify-center text-center" role="alert">
                  <p className="max-w-sm break-words text-sm leading-6 text-pencil">{initialError}</p>
                  <button
                    type="button"
                    onClick={() => void loadMessages(true)}
                    className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-md border border-ink/20 bg-white px-3.5 py-2 text-sm font-semibold text-ink transition-colors hover:bg-paper-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
                  >
                    <RefreshCw className="size-4" aria-hidden="true" />
                    重试
                  </button>
                </div>
              ) : messages.length === 0 ? (
                <div className="flex min-h-48 flex-col items-center justify-center text-center">
                  <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-marker-blue/20 text-ink ring-1 ring-inset ring-marker-blue/45">
                    <MessageCircle className="size-5" aria-hidden="true" />
                  </div>
                  <p className="text-sm font-medium text-ink">还没有消息</p>
                  <p className="mt-1 text-xs text-pencil">发送第一条消息，开始沟通吧。</p>
                </div>
              ) : (
                <div className="grid gap-4">
                  {hasMoreMessages && (
                    <div className="flex justify-center pb-1">
                      <button
                        type="button"
                        disabled={loadingOlder}
                        onClick={() => void loadOlderMessages()}
                        className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-ink/20 bg-white px-3 py-2 text-xs font-semibold text-ink transition-colors hover:bg-paper-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink disabled:cursor-not-allowed disabled:opacity-55"
                      >
                        <RefreshCw className={`size-3.5 ${loadingOlder ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" />
                        {loadingOlder ? '加载中...' : '加载更早消息'}
                      </button>
                    </div>
                  )}
                  {messages.map((message) => {
                    const own = message.senderRole === ownRole;
                    const identityName = own ? myXinfaName : peerXinfaName;
                    const identitySeed = own ? myXinfaSeed : peerXinfaSeed;
                    return (
                      <div key={`${message.id}-${message.clientMsgId || ''}`} className={`flex min-w-0 items-start gap-2.5 ${own ? 'justify-end' : 'justify-start'}`}>
                        {!own && (
                          <span
                            className={`mt-5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-ink/10 text-[10px] font-bold tracking-[0.03em] sm:size-9 sm:text-[11px] ${avatarToneFor(identitySeed)}`}
                            aria-label={`对方心法：${identityName}`}
                            title={`对方 · ${identityName}`}
                          >
                            {xinfaInitials(identityName)}
                          </span>
                        )}
                        <div className={`group flex min-w-0 max-w-[78%] flex-col sm:max-w-[68%] ${own ? 'items-end' : 'items-start'}`}>
                          <span className="mb-1 px-1 text-[11px] font-semibold text-pencil">
                            {own ? `你 · ${identityName}` : `对方 · ${identityName}`}
                          </span>
                          <div className={`relative min-w-0 border px-3.5 py-2.5 text-sm leading-6 ${own ? 'rounded-[9px_4px_9px_9px] border-ink/10 bg-marker-blue/20 text-ink' : 'rounded-[4px_9px_9px_9px] border-ink/10 bg-[#fffdfc] text-ink'}`}>
                            <p className="whitespace-pre-wrap break-words">{message.deleted ? '消息已删除' : (message.content || '消息内容不可用')}</p>
                            {message.failed && (
                              <button
                                type="button"
                                onClick={() => void retryMessage(message)}
                                className="mt-2 inline-flex min-h-8 items-center gap-1 rounded-md border border-alert/70 bg-alert/40 px-2 text-xs font-semibold text-ink transition-colors hover:bg-alert/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                              >
                                重试发送
                              </button>
                            )}
                          </div>
                          <div className="mt-1 flex items-center gap-2 px-1 text-[11px] text-pencil">
                            <time dateTime={formatChatDateTime(message.createdAt)} title={formatFullChatTime(message.createdAt)}>
                              {message.pending ? '发送中...' : message.failed ? '发送失败' : formatChatTime(message.createdAt)}
                            </time>
                            {!own && !message.deleted && (
                              <button
                                type="button"
                                onClick={() => setReportTarget({ targetType: 'message', targetId: message.id })}
                                className="inline-flex min-h-8 items-center gap-1 rounded-md px-1.5 font-semibold transition-colors hover:bg-alert/20 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                                title="举报消息"
                                aria-label="举报消息"
                              >
                                <Flag className="size-3.5" aria-hidden="true" />
                                <span className="hidden sm:inline">举报</span>
                              </button>
                            )}
                          </div>
                        </div>
                        {own && (
                          <span
                            className={`mt-5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-ink/10 text-[10px] font-bold tracking-[0.03em] sm:size-9 sm:text-[11px] ${avatarToneFor(identitySeed)}`}
                            aria-label={`我的心法：${identityName}`}
                            title={`你 · ${identityName}`}
                          >
                            {xinfaInitials(identityName)}
                          </span>
                        )}
                      </div>
                    );
                  })}
                  {canConfirmPendingExchange && (
                    <form
                      className="mx-auto mt-2 w-full max-w-2xl border-y border-ink/15 bg-highlight/15 px-3 py-4 sm:px-4"
                      onSubmit={submitContact}
                      aria-labelledby="pending-contact-exchange-title"
                    >
                      <div className="flex items-start gap-3">
                        <span className={`inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-ink/10 text-[10px] font-bold tracking-[0.03em] ${avatarToneFor(peerXinfaSeed)}`} aria-hidden="true">
                          {xinfaInitials(peerXinfaName)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <Handshake className="size-4 shrink-0 text-ink" aria-hidden="true" />
                            <h2 id="pending-contact-exchange-title" className="text-sm font-bold text-ink">对方请求交换联系方式</h2>
                          </div>
                          <p className="mt-1 text-xs leading-5 text-pencil">确认后，双方填写的联系方式会同时显示。</p>
                        </div>
                      </div>

                      {ownExchange?.contact?.value ? (
                        <div className="mt-3 rounded-md border border-ink/10 bg-white/65 px-3 py-2 text-xs leading-5 text-pencil">
                          将交换：<strong className="break-words font-semibold text-ink">{ownExchange.contact.value}</strong>
                        </div>
                      ) : (
                        <div className="mt-3">
                          <label htmlFor="recruitment-contact-inline" className="sr-only">我的联系方式</label>
                          <input
                            type="text"
                            id="recruitment-contact-inline"
                            value={contactText}
                            onChange={(event) => setContactText(event.target.value)}
                            maxLength={300}
                            disabled={contactSubmitting}
                            placeholder="填写我的游戏 ID、群号或其他联系方式"
                            className="h-11 w-full rounded-md border border-ink/20 bg-white px-3 text-sm text-ink outline-none transition-colors placeholder:text-pencil/65 hover:border-ink/35 focus:border-ink focus:ring-2 focus:ring-ink/10 disabled:cursor-not-allowed disabled:bg-paper-rule"
                          />
                        </div>
                      )}

                      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-[11px] leading-5 text-pencil">仅在双方确认后公开</p>
                        <button
                          type="submit"
                          disabled={contactSubmitting || !availableContactValue}
                          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-pencil focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          <Handshake className="size-4" aria-hidden="true" />
                          {contactSubmitting ? '确认中...' : '确认交换'}
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}
            </div>

            <form className="shrink-0 border-t border-ink/10 bg-paper/95 px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-4 sm:pb-3" onSubmit={sendMessage}>
              {!canSend && (
                <div className="mb-3 flex items-start gap-2 rounded-md border border-ink/15 bg-paper-soft p-2.5 text-xs leading-5 text-pencil">
                  <LockKeyhole className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span>{thread?.status === 'closed' ? '密聊已关闭，双方均不可继续发送消息。' : '当前密聊暂不可发送消息。'}</span>
                </div>
              )}
              <div className="flex min-w-0 items-end gap-2">
                <input
                  type="text"
                  value={messageText}
                  onChange={(event) => setMessageText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      void sendMessage();
                    }
                  }}
                  disabled={!canSend || sending}
                  maxLength={100}
                  placeholder={canSend ? '写消息，Enter 发送' : '暂不可发送'}
                  className="h-11 min-w-0 flex-1 rounded-lg border border-ink/20 bg-white px-3 text-sm text-ink outline-none transition-colors placeholder:text-pencil/65 hover:border-ink/35 focus:border-ink focus:ring-2 focus:ring-ink/15 disabled:cursor-not-allowed disabled:bg-paper-rule"
                  aria-label="消息内容"
                />
                <button
                  type="submit"
                  disabled={!canSend || sending || !messageText.trim()}
                  className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg bg-ink text-white shadow-[0_5px_14px_rgba(44,44,44,0.13)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-pencil focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 active:translate-y-0 active:scale-[0.98] active:shadow-none disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0"
                  title="发送消息"
                  aria-label="发送消息"
                >
                  <Send className="size-5" aria-hidden="true" />
                </button>
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[11px] text-pencil/75">
                <span className="hidden sm:inline">Enter 发送</span>
                <span className="sm:hidden">最多 100 字</span>
                <span>{messageText.length}/100</span>
              </div>
            </form>
          </div>
        </section>
      </section>

      <Modal
        isOpen={closeConfirmOpen}
        onClose={closingThread ? () => undefined : () => setCloseConfirmOpen(false)}
        title="关闭密聊"
        showCloseButton={!closingThread}
      >
        <p className="text-sm leading-6 text-pencil">
          关闭后，双方都不能继续发送消息或交换联系方式，但仍可查看历史内容。此操作不可恢复。
        </p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            disabled={closingThread}
            onClick={() => setCloseConfirmOpen(false)}
            className="inline-flex min-h-10 items-center justify-center rounded-md border border-ink/30 bg-white px-4 text-sm font-semibold text-ink transition-colors hover:bg-paper-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            disabled={closingThread}
            onClick={() => void confirmCloseThread()}
            className="inline-flex min-h-10 items-center justify-center rounded-md border border-ink/30 bg-alert px-4 text-sm font-semibold text-ink transition-colors hover:bg-alert/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink disabled:opacity-50"
          >
            {closingThread ? '关闭中...' : '确认关闭'}
          </button>
        </div>
      </Modal>

      {reportTarget && (
        <RecruitmentReportDialog
          open
          targetType={reportTarget.targetType}
          targetId={reportTarget.targetId}
          evidenceMessages={reportTarget.targetType === 'thread'
            ? messages.filter((message) => (
              !message.pending
              && !message.failed
              && !message.deleted
              && Boolean(message.content)
              && !message.id.startsWith('pending-')
            ))
            : undefined}
          reportedRole={ownRole === 'publisher' ? 'applicant' : 'publisher'}
          onClose={() => setReportTarget(null)}
        />
      )}
    </RootElement>
  );
};

export default RecruitmentChatView;
