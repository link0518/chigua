import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronRight,
  CirclePlus,
  Clock3,
  Flag,
  Inbox,
  ListFilter,
  LockKeyhole,
  MessageCircle,
  MoreHorizontal,
  RefreshCw,
  Send,
  SquarePen,
  UsersRound,
  X,
} from 'lucide-react';

import { api } from '@/api';
import Modal from '@/components/Modal';
import Turnstile, { type TurnstileHandle } from '@/components/Turnstile';
import { buildRecruitmentChatPath, getRecruitmentThreadIdFromPath } from '@/features/app/routing';
import { useAppActions } from '@/store/AppActionsContext';
import { useAppShell } from '@/store/AppShellContext';
import type {
  RecruitmentPost,
  RecruitmentReportTargetType,
  RecruitmentStatus,
  RecruitmentThread,
  RecruitmentThreadStatus,
  RecruitmentXinfaOption,
} from '@/types';

import {
  IdentityNoticeDialog,
  RecruitmentReportDialog,
  XinfaSelect,
} from './RecruitmentDialogs';
import RecruitmentChatView from './RecruitmentChatView';
import { useRecruitmentIdentityNotice } from './useRecruitmentIdentityNotice';
import {
  FALLBACK_XINFA_OPTIONS,
  findXinfaName,
  normalizeXinfaOptions,
} from './xinfaCatalog';

const headerPublishBtn = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white transition-colors duration-200 hover:bg-pencil focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 active:translate-y-px';

/** 招募沿用项目马克笔色：蓝色为交互主色，绿、黄、红分别表示成功、待处理和危险。 */
const AVATAR_TONES = [
  'bg-paper-shadow text-ink',
  'bg-marker-blue/25 text-ink',
  'bg-paper-rule/70 text-ink',
  'bg-white text-ink',
] as const;

type RecruitmentTab = 'square' | 'mine' | 'chats';
type PostListKind = 'square' | 'mine';

interface ListState<T> {
  items: T[];
  total: number;
  page: number;
  loading: boolean;
  loadingMore: boolean;
  initialized: boolean;
  error: string | null;
}

const createListState = <T,>(): ListState<T> => ({
  items: [],
  total: 0,
  page: 0,
  loading: false,
  loadingMore: false,
  initialized: false,
  error: null,
});

const readTabFromLocation = (): RecruitmentTab => {
  if (getRecruitmentThreadIdFromPath(window.location.pathname)) return 'chats';
  const value = new URLSearchParams(window.location.search).get('tab');
  return value === 'mine' || value === 'chats' ? value : 'square';
};

const readChatThreadFromLocation = () => getRecruitmentThreadIdFromPath(window.location.pathname);

const readXinfaFilterFromLocation = () => (
  new URLSearchParams(window.location.search).get('xinfaId') || ''
);

const readMineStatusFromLocation = (): RecruitmentStatus => (
  new URLSearchParams(window.location.search).get('status') === 'closed' ? 'closed' : 'open'
);

const readThreadStatusFromLocation = (): RecruitmentThreadStatus => (
  new URLSearchParams(window.location.search).get('status') === 'closed' ? 'closed' : 'active'
);

const toValidDate = (value?: number | null) => {
  if (!Number.isFinite(value)) return null;
  const date = new Date(Number(value));
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatPostTime = (value?: number | null) => {
  const date = toValidDate(value);
  if (!date) return '时间未知';
  const now = new Date();
  const sameDay = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  if (sameDay) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }
  const options: Intl.DateTimeFormatOptions = {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  };
  if (date.getFullYear() !== now.getFullYear()) options.year = 'numeric';
  return date.toLocaleString('zh-CN', options);
};

const formatFullTime = (value?: number | null) => (
  toValidDate(value)?.toLocaleString('zh-CN') || '时间未知'
);

const formatDateTimeAttribute = (value?: number | null) => toValidDate(value)?.toISOString();

/** 会话列表右侧时间：今天显示时刻，同年显示月日，跨年带年份。 */
const formatListTime = (value?: number | null) => {
  const date = toValidDate(value);
  if (!date) return '时间未知';
  const now = new Date();
  const sameDay = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  if (sameDay) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }
  const options: Intl.DateTimeFormatOptions = { month: 'numeric', day: 'numeric' };
  if (date.getFullYear() !== now.getFullYear()) options.year = 'numeric';
  return date.toLocaleDateString('zh-CN', options);
};

const displayXinfaName = (value?: RecruitmentXinfaOption | null) => (
  value?.id === 'cangjian' ? '藏剑（问水诀 / 山居剑意）' : value?.name || '未选择'
);

const mergeUnique = <T extends { id: string }>(current: T[], incoming: T[]) => {
  const ids = new Set(current.map((item) => item.id));
  return [...current, ...incoming.filter((item) => !ids.has(item.id))];
};

const formatXinfaOptionLabel = (item: RecruitmentXinfaOption) => (
  item.school && !item.name.startsWith(item.school) ? `${item.school} · ${item.name}` : item.name
);

const formatXinfaChipLabel = (xinfa?: RecruitmentXinfaOption | null, fallbackName = '未选择') => {
  if (!xinfa) return fallbackName;
  if (xinfa.id === 'cangjian') return '藏剑';
  if (xinfa.school && xinfa.name && !xinfa.name.startsWith(xinfa.school)) {
    return `${xinfa.school} · ${xinfa.name}`;
  }
  return xinfa.name || fallbackName;
};

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
  return AVATAR_TONES[hash % AVATAR_TONES.length];
};

const LoadMoreButton: React.FC<{
  loading: boolean;
  onClick: () => void;
}> = ({ loading, onClick }) => (
  <button
    type="button"
    disabled={loading}
    onClick={onClick}
    className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-ink/15 bg-white px-4 py-2.5 text-sm font-semibold text-ink shadow-[0_6px_18px_rgba(44,44,44,0.04)] transition-all hover:-translate-y-0.5 hover:border-ink/30 hover:bg-paper-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
  >
    {loading ? '加载中...' : '加载更多'}
  </button>
);

const LoadingPostCards: React.FC = () => (
  <div className="overflow-hidden rounded-lg border border-ink/10 bg-[#fffdfc]" aria-busy="true" aria-label="招募加载中">
    {[0, 1, 2, 3].map((item) => (
      <div
        key={item}
        className="grid min-h-24 grid-cols-[2.5rem_minmax(0,1fr)_5rem] gap-3 border-b border-ink/8 px-4 py-4 last:border-b-0 sm:grid-cols-[2.75rem_minmax(0,1fr)_8.5rem] sm:px-5"
      >
        <div className="size-10 animate-pulse rounded-lg bg-paper-rule motion-reduce:animate-none" />
        <div className="min-w-0 space-y-2.5">
          <div className="h-4 w-36 animate-pulse rounded bg-paper-rule motion-reduce:animate-none" />
          <div className="space-y-2">
            <div className="h-4 w-full animate-pulse rounded bg-paper-rule motion-reduce:animate-none" />
            <div className="h-4 w-3/5 animate-pulse rounded bg-paper-rule motion-reduce:animate-none" />
          </div>
        </div>
        <div className="h-4 w-full animate-pulse self-center rounded bg-paper-rule motion-reduce:animate-none" />
      </div>
    ))}
  </div>
);

const LoadingThreadRows: React.FC = () => (
  <div className="overflow-hidden rounded-lg border border-ink/10 bg-[#fffdfc]" aria-busy="true" aria-label="密聊加载中">
    {[0, 1, 2, 3, 4].map((item) => (
      <div
        key={item}
        className="flex items-center gap-3 border-b border-ink/8 px-4 py-4 last:border-b-0 sm:gap-4 sm:px-5"
      >
        <div className="size-10 shrink-0 animate-pulse rounded-lg bg-paper-rule motion-reduce:animate-none" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-4 w-36 animate-pulse rounded bg-paper-rule motion-reduce:animate-none" />
          <div className="h-3.5 w-full max-w-md animate-pulse rounded bg-paper-rule motion-reduce:animate-none" />
        </div>
        <div className="h-3.5 w-10 shrink-0 animate-pulse rounded bg-paper-rule motion-reduce:animate-none" />
      </div>
    ))}
  </div>
);

interface EmptyStateProps {
  title: string;
  detail: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: React.ReactNode;
}

const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  detail,
  actionLabel,
  onAction,
  icon,
}) => (
  <div className="flex min-h-72 flex-col items-center justify-center rounded-lg border border-dashed border-ink/15 bg-paper-soft/80 px-6 py-12 text-center shadow-[0_10px_28px_rgba(44,44,44,0.04)]">
    <span className="mb-4 inline-flex size-12 items-center justify-center rounded-lg bg-marker-blue/20 text-ink ring-1 ring-inset ring-marker-blue/45">
      {icon || <Inbox className="size-6" aria-hidden="true" />}
    </span>
    <h3 className="font-display text-2xl text-ink sm:text-3xl">{title}</h3>
    <p className="mt-2 max-w-sm break-words text-sm leading-6 text-pencil">{detail}</p>
    {actionLabel && onAction && (
      <button
        type="button"
        onClick={onAction}
        className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-pencil focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 active:scale-[0.98]"
      >
        {actionLabel}
      </button>
    )}
  </div>
);

interface ErrorStateProps {
  message: string;
  onRetry: () => void;
}

const ErrorState: React.FC<ErrorStateProps> = ({ message, onRetry }) => (
  <div className="flex min-h-56 flex-col items-center justify-center rounded-lg border border-alert/45 bg-red-50/70 px-6 py-10 text-center shadow-[0_10px_28px_rgba(44,44,44,0.04)]" role="alert">
    <p className="max-w-md break-words text-sm leading-6 text-pencil">{message}</p>
    <button
      type="button"
      onClick={onRetry}
      className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-lg border border-ink/70 bg-white px-4 py-2 text-sm font-semibold text-ink shadow-sm transition-colors hover:bg-paper-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink active:translate-y-px"
    >
      <RefreshCw className="size-4" aria-hidden="true" />
      重试
    </button>
  </div>
);

interface RecruitmentPostCardProps {
  post: RecruitmentPost;
  options: RecruitmentXinfaOption[];
  mine?: boolean;
  closing?: boolean;
  onApply: (post: RecruitmentPost) => void;
  onClosePost: (post: RecruitmentPost) => void;
  onOpenThreads: () => void;
  onReport: (targetType: RecruitmentReportTargetType, targetId: string) => void;
}

const RecruitmentPostCard: React.FC<RecruitmentPostCardProps> = ({
  post,
  options,
  mine = false,
  closing = false,
  onApply,
  onClosePost,
  onOpenThreads,
  onReport,
}) => {
  const [contentExpanded, setContentExpanded] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const isOpen = post.status === 'open';
  const xinfa = options.find((item) => item.id === post.xinfaId) || post.xinfa || null;
  const xinfaName = displayXinfaName(xinfa) || findXinfaName(post.xinfaId, options);
  const chipLabel = formatXinfaChipLabel(xinfa, xinfaName);
  const damageType = xinfa?.damageType === '外' || xinfa?.damageType === '内' ? xinfa.damageType : null;
  const isOwnerView = mine || Boolean(post.isOwner);
  const canReport = !isOwnerView;
  const threadCount = Number(post.threadCount || 0);

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

  return (
    <article className={`${isOpen ? 'bg-white' : 'bg-paper-soft/65'} transition-colors duration-200`}>
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={() => setContentExpanded((value) => !value)}
          className="group grid min-w-0 flex-1 grid-cols-[2.5rem_minmax(0,1fr)_auto] gap-x-3 px-4 py-4 text-left transition-colors duration-200 hover:bg-marker-blue/25 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ink/45 sm:grid-cols-[2.75rem_minmax(0,1fr)_8.5rem] sm:items-center sm:px-5"
          aria-expanded={contentExpanded}
          aria-controls={`recruitment-post-details-${post.id}`}
        >
          <span className={`inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-ink/10 text-[11px] font-bold tracking-[0.03em] ${avatarToneFor(xinfa?.school || xinfa?.id || xinfaName)}`} aria-hidden="true">
            {xinfaInitials(xinfaName)}
          </span>

          <span className="min-w-0">
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="truncate text-sm font-semibold text-ink sm:text-[15px]">{chipLabel}</span>
              {damageType && <span className="text-[11px] text-pencil">{damageType}功</span>}
              {isOwnerView && <span className="inline-flex rounded-sm bg-marker-blue/30 px-1.5 py-0.5 text-[10px] font-bold text-ink">我发布的</span>}
              <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${isOpen ? 'text-ink' : 'text-pencil'}`}>
                <span className={`size-1.5 rounded-full ${isOpen ? 'bg-marker-green ring-1 ring-inset ring-ink/20' : 'bg-pencil/35'}`} aria-hidden="true" />
                {isOpen ? '招募中' : '已结束'}
              </span>
            </span>
            <span className="mt-1.5 line-clamp-2 whitespace-pre-wrap break-words text-sm leading-5 text-pencil sm:text-[15px] sm:leading-6">{post.content}</span>
            <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-pencil sm:hidden">
              <time dateTime={formatDateTimeAttribute(post.createdAt)}>{formatPostTime(post.createdAt)}</time>
              {(isOwnerView || threadCount > 0) && <span>{threadCount > 0 ? `${threadCount} 条密聊` : '暂无密聊'}</span>}
            </span>
          </span>

          <span className="flex shrink-0 items-center gap-2 self-start pt-0.5 sm:self-center sm:justify-end sm:pt-0">
            <span className="hidden text-right text-[11px] leading-5 text-pencil sm:block">
              <time className="block tabular-nums" dateTime={formatDateTimeAttribute(post.createdAt)} title={formatFullTime(post.createdAt)}>{formatPostTime(post.createdAt)}</time>
              {(isOwnerView || threadCount > 0) && <span className="block">{threadCount > 0 ? `${threadCount} 条密聊` : '暂无密聊'}</span>}
            </span>
            <ChevronRight className={`size-4 text-pencil/55 transition-transform duration-200 ${contentExpanded ? 'rotate-90' : ''}`} aria-hidden="true" />
          </span>
        </button>

        {canReport && (
          <div ref={moreMenuRef} className="relative flex shrink-0 items-start pr-3 pt-3.5 sm:items-center sm:pr-4 sm:pt-0">
            <button
              type="button"
              onClick={() => setMoreMenuOpen((value) => !value)}
              className="inline-flex size-8 items-center justify-center rounded-md border border-ink/12 bg-white text-pencil transition-colors hover:border-ink/30 hover:bg-paper-soft hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink sm:size-9"
              title="更多操作"
              aria-label="更多操作"
              aria-expanded={moreMenuOpen}
              aria-haspopup="menu"
            >
              <MoreHorizontal className="size-4" aria-hidden="true" />
            </button>
            {moreMenuOpen && (
              <div
                className="absolute right-3 top-[calc(100%-0.15rem)] z-30 min-w-36 overflow-hidden rounded-lg border border-ink/15 bg-white py-1.5 shadow-[0_14px_32px_rgba(44,44,44,0.14)] sm:right-4"
                role="menu"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    onReport('post', post.id);
                  }}
                  className="flex min-h-10 w-full items-center gap-2.5 px-3 text-left text-sm font-medium text-pencil transition-colors hover:bg-paper-soft hover:text-ink focus-visible:outline-none focus-visible:bg-paper-soft"
                >
                  <Flag className="size-4" aria-hidden="true" />
                  举报
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {contentExpanded && (
        <div id={`recruitment-post-details-${post.id}`} className="border-t border-ink/8 bg-marker-blue/10 px-4 py-4 sm:pl-[4.75rem] sm:pr-5">
          <p className="max-w-3xl whitespace-pre-wrap break-words text-sm leading-6 text-ink">{post.content}</p>
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-1">
              {canReport && (
                <button type="button" onClick={() => onReport('post', post.id)} className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-pencil transition-colors hover:bg-alert/15 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink">
                  <Flag className="size-3.5" aria-hidden="true" />
                  举报
                </button>
              )}
              {mine && isOpen && (
                <button type="button" disabled={closing} onClick={() => onClosePost(post)} className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-melon-deep transition-colors hover:bg-alert/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink disabled:opacity-50">
                  <LockKeyhole className="size-3.5" aria-hidden="true" />
                  {closing ? '结束中...' : '结束招募'}
                </button>
              )}
            </div>
            {isOwnerView ? (
              <button type="button" onClick={onOpenThreads} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-ink/18 bg-white px-4 text-sm font-semibold text-ink transition-colors hover:border-ink/35 hover:bg-paper-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink">
                <MessageCircle className="size-4" aria-hidden="true" />
                查看密聊
              </button>
            ) : (
              <button type="button" disabled={!isOpen && !post.viewerThreadId} onClick={() => onApply(post)} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-white transition-colors hover:bg-pencil focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40">
                <MessageCircle className="size-4" aria-hidden="true" />
                {post.viewerThreadId ? '继续密聊' : '申请密聊'}
              </button>
            )}
          </div>
        </div>
      )}
    </article>
  );
};

interface RecruitmentThreadRowProps {
  thread: RecruitmentThread;
  onOpen: (threadId: string) => void;
}

const RecruitmentThreadRow: React.FC<RecruitmentThreadRowProps> = ({ thread, onOpen }) => {
  const unread = thread.unreadCount > 0;
  const peerXinfaOption = thread.role === 'publisher' ? thread.applicantXinfa : thread.publisherXinfa;
  const peerXinfa = displayXinfaName(peerXinfaOption);
  const peerSeed = peerXinfaOption?.school || peerXinfaOption?.id || peerXinfa || thread.id;
  const roleLabel = thread.role === 'publisher' ? '你的招募' : '你申请的';
  const threadStateLabel = thread.locked
    ? '已锁定'
    : thread.status === 'active'
      ? thread.writable ? null : '不可继续'
      : '已结束';
  const unreadLabel = unread
    ? `未读 ${thread.unreadCount > 99 ? '99+' : thread.unreadCount} 条`
    : undefined;

  return (
    <button
      type="button"
      onClick={() => onOpen(thread.id)}
      aria-label={unreadLabel ? `打开与 ${peerXinfa} 的密聊，${unreadLabel}` : `打开与 ${peerXinfa} 的密聊`}
      className="group relative flex w-full items-start gap-3 bg-white px-4 py-4 text-left transition-colors duration-200 hover:bg-marker-blue/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink sm:px-5"
    >
      <span
        className={`mt-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-ink/10 text-xs font-bold tracking-[0.03em] ${avatarToneFor(peerSeed)}`}
        aria-hidden="true"
      >
        {xinfaInitials(peerXinfa)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              {unread && <span className="size-2 shrink-0 rounded-full bg-alert ring-1 ring-inset ring-ink/25" aria-hidden="true" />}
              <span className={`truncate text-[15px] leading-5 ${unread ? 'font-bold text-ink' : 'font-semibold text-ink'}`}>
                对方 · {peerXinfa || '未选择'}
              </span>
              {threadStateLabel && (
                <span className="inline-flex shrink-0 items-center rounded-md bg-paper-rule/70 px-1.5 py-0.5 text-[10px] font-medium text-pencil">
                  {threadStateLabel}
                </span>
              )}
            </div>
            <p className="mt-1 line-clamp-1 break-words text-sm leading-5 text-pencil">
              <span className="font-medium text-ink/70">{roleLabel}</span>
              <span className="mx-1.5 text-ink/25" aria-hidden="true">·</span>
              <span>{thread.postContent || '招募内容已不可见'}</span>
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5 pt-0.5">
            <time
              dateTime={formatDateTimeAttribute(thread.updatedAt || thread.createdAt)}
              title={formatFullTime(thread.updatedAt || thread.createdAt)}
              className={`text-[11px] tabular-nums ${unread ? 'font-semibold text-ink' : 'text-pencil'}`}
            >
              {formatListTime(thread.updatedAt || thread.createdAt)}
            </time>
            {unread ? (
              <span className="inline-flex min-h-5 min-w-5 items-center justify-center rounded-md border border-ink/20 bg-alert/80 px-1.5 text-[11px] font-bold leading-none text-ink">
                <span className="tabular-nums">{thread.unreadCount > 99 ? '99+' : thread.unreadCount}</span>
              </span>
            ) : (
              <ChevronRight className="size-4 text-pencil/60 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
            )}
          </div>
        </div>
      </div>
    </button>
  );
};

const RecruitmentView: React.FC = () => {
  const { showToast } = useAppActions();
  const { settings } = useAppShell();
  const identityNotice = useRecruitmentIdentityNotice();
  const publishTurnstileRef = useRef<TurnstileHandle | null>(null);
  const publishTriggerRef = useRef<HTMLButtonElement | null>(null);
  const composerPanelRef = useRef<HTMLElement | null>(null);
  const composerPreviousFocusRef = useRef<HTMLElement | null>(null);

  const [activeTab, setActiveTab] = useState<RecruitmentTab>(readTabFromLocation);
  const [xinfaFilter, setXinfaFilter] = useState(readXinfaFilterFromLocation);
  const [mineStatus, setMineStatus] = useState<RecruitmentStatus>(readMineStatusFromLocation);
  const [threadStatus, setThreadStatus] = useState<RecruitmentThreadStatus>(readThreadStatusFromLocation);
  const [squarePosts, setSquarePosts] = useState<ListState<RecruitmentPost>>(createListState);
  const [myPosts, setMyPosts] = useState<ListState<RecruitmentPost>>(createListState);
  const [threads, setThreads] = useState<ListState<RecruitmentThread>>(createListState);
  const [threadUnreadCount, setThreadUnreadCount] = useState(0);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(readChatThreadFromLocation);
  const [xinfaOptions, setXinfaOptions] = useState<RecruitmentXinfaOption[]>(FALLBACK_XINFA_OPTIONS);
  const [xinfaLoading, setXinfaLoading] = useState(true);
  const [xinfaError, setXinfaError] = useState<string | null>(null);

  const [composerOpen, setComposerOpen] = useState(false);
  const [publishXinfaId, setPublishXinfaId] = useState('');
  const [publishContent, setPublishContent] = useState('');
  const [publishing, setPublishing] = useState(false);
  const publishingRef = useRef(false);
  publishingRef.current = publishing;
  const [applyPost, setApplyPost] = useState<RecruitmentPost | null>(null);
  const [applicationXinfaId, setApplicationXinfaId] = useState('');
  const [applying, setApplying] = useState(false);
  const [closePost, setClosePost] = useState<RecruitmentPost | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<{
    targetType: RecruitmentReportTargetType;
    targetId: string;
  } | null>(null);
  const postRequestVersionRef = useRef<Record<PostListKind, number>>({ square: 0, mine: 0 });
  const threadRequestVersionRef = useRef(0);
  const threadUnreadRefreshRef = useRef(0);

  const handleThreadRead = useCallback((threadId: string) => {
    const clearedUnread = Math.max(0, Number(threads.items.find((item) => item.id === threadId)?.unreadCount) || 0);
    setThreads((previous) => {
      const hasUnread = previous.items.some((item) => item.id === threadId && item.unreadCount > 0);
      if (!hasUnread) return previous;
      return {
        ...previous,
        items: previous.items.map((item) => (
          item.id === threadId ? { ...item, unreadCount: 0 } : item
        )),
      };
    });
    if (clearedUnread > 0) {
      setThreadUnreadCount((previous) => Math.max(0, previous - clearedUnread));
    }
  }, [threads.items]);

  /** 静默刷新密聊未读角标（不打断列表 loading 状态）。 */
  const refreshThreadUnreadCount = useCallback(async () => {
    const requestId = ++threadUnreadRefreshRef.current;
    try {
      const data = await api.getRecruitmentThreads({ limit: 1, page: 1 });
      if (threadUnreadRefreshRef.current !== requestId) return;
      setThreadUnreadCount(Math.max(0, Number(data?.unreadCount) || 0));
    } catch {
      // 角标刷新失败静默忽略，避免打扰主流程
    }
  }, []);

  useEffect(() => {
    const handleNotificationsRefreshed = () => {
      void refreshThreadUnreadCount();
    };
    window.addEventListener('recruitment:notifications-refreshed', handleNotificationsRefreshed);
    return () => {
      window.removeEventListener('recruitment:notifications-refreshed', handleNotificationsRefreshed);
    };
  }, [refreshThreadUnreadCount]);

  const pageSize = 20;
  const maxContentLength = 100;

  const loadXinfaCatalog = useCallback(async () => {
    setXinfaLoading(true);
    setXinfaError(null);
    try {
      const data = await api.getRecruitmentXinfa();
      const source = Array.isArray(data) ? data : data?.items;
      const normalized = normalizeXinfaOptions(Array.isArray(source) ? source : []);
      if (!normalized.length) throw new Error('心法目录为空');
      setXinfaOptions(normalized);
    } catch (error) {
      setXinfaOptions(FALLBACK_XINFA_OPTIONS);
      setXinfaError(error instanceof Error ? error.message : '心法目录加载失败');
    } finally {
      setXinfaLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadXinfaCatalog();
  }, [loadXinfaCatalog]);

  useEffect(() => {
    const handlePopState = () => {
      setActiveTab(readTabFromLocation());
      setXinfaFilter(readXinfaFilterFromLocation());
      setMineStatus(readMineStatusFromLocation());
      setThreadStatus(readThreadStatusFromLocation());
      setSelectedThreadId(readChatThreadFromLocation());
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const loadPosts = async (kind: PostListKind, append = false, filterId = xinfaFilter) => {
    const current = kind === 'mine' ? myPosts : squarePosts;
    const setState = kind === 'mine' ? setMyPosts : setSquarePosts;
    const requestedPage = append ? current.page + 1 : 1;
    const requestVersion = ++postRequestVersionRef.current[kind];
    setState((previous) => ({
      ...previous,
      loading: !append,
      loadingMore: append,
      error: null,
    }));
    try {
      const data = await api.getRecruitmentPosts({
        limit: pageSize,
        page: requestedPage,
        xinfaId: kind === 'square' ? filterId || undefined : undefined,
        status: kind === 'mine' ? mineStatus : undefined,
        mine: kind === 'mine' ? true : undefined,
      });
      const incoming = Array.isArray(data?.items) ? data.items : [];
      if (postRequestVersionRef.current[kind] !== requestVersion) return;
      setState((previous) => ({
        ...previous,
        items: append ? mergeUnique(previous.items, incoming) : incoming,
        total: Number(data?.total || incoming.length),
        page: Number(data?.page || requestedPage),
        loading: false,
        loadingMore: false,
        initialized: true,
        error: null,
      }));
    } catch (error) {
      if (postRequestVersionRef.current[kind] !== requestVersion) return;
      setState((previous) => ({
        ...previous,
        loading: false,
        loadingMore: false,
        initialized: true,
        error: error instanceof Error ? error.message : '招募加载失败',
      }));
    }
  };

  useEffect(() => {
    postRequestVersionRef.current.mine += 1;
    setMyPosts(createListState<RecruitmentPost>());
  }, [mineStatus]);

  useEffect(() => {
    threadRequestVersionRef.current += 1;
    setThreads(createListState<RecruitmentThread>());
  }, [threadStatus]);

  const loadThreads = async (append = false) => {
    const requestedPage = append ? threads.page + 1 : 1;
    const requestVersion = ++threadRequestVersionRef.current;
    setThreads((previous) => ({
      ...previous,
      loading: !append,
      loadingMore: append,
      error: null,
    }));
    try {
      const data = await api.getRecruitmentThreads({
        limit: pageSize,
        page: requestedPage,
        status: threadStatus,
      });
      const incoming = Array.isArray(data?.items) ? data.items : [];
      if (threadRequestVersionRef.current !== requestVersion) return;
      setThreadUnreadCount(Math.max(0, Number(data?.unreadCount) || 0));
      setThreads((previous) => ({
        ...previous,
        items: append ? mergeUnique(previous.items, incoming) : incoming,
        total: Number(data?.total || incoming.length),
        page: Number(data?.page || requestedPage),
        loading: false,
        loadingMore: false,
        initialized: true,
        error: null,
      }));
    } catch (error) {
      if (threadRequestVersionRef.current !== requestVersion) return;
      setThreads((previous) => ({
        ...previous,
        loading: false,
        loadingMore: false,
        initialized: true,
        error: error instanceof Error ? error.message : '密聊加载失败',
      }));
    }
  };

  useEffect(() => {
    if (activeTab === 'square' && !squarePosts.initialized && !squarePosts.loading) {
      void loadPosts('square');
    } else if (activeTab === 'mine' && !myPosts.initialized && !myPosts.loading) {
      void loadPosts('mine');
    } else if (activeTab === 'chats' && !threads.initialized && !threads.loading) {
      void loadThreads();
    }
  }, [
    activeTab,
    xinfaFilter,
    mineStatus,
    threadStatus,
    myPosts.initialized,
    myPosts.loading,
    squarePosts.initialized,
    squarePosts.loading,
    threads.initialized,
    threads.loading,
  ]);

  const selectTab = (tab: RecruitmentTab) => {
    setActiveTab(tab);
    setSelectedThreadId(null);
    const params = new URLSearchParams();
    if (tab !== 'square') params.set('tab', tab);
    if (tab === 'square' && xinfaFilter) params.set('xinfaId', xinfaFilter);
    if (tab === 'mine' && mineStatus === 'closed') params.set('status', mineStatus);
    if (tab === 'chats' && threadStatus === 'closed') params.set('status', threadStatus);
    const query = params.toString() ? `?${params.toString()}` : '';
    const targetPath = `/recruitment${query}`;
    if (window.location.pathname + window.location.search !== targetPath) {
      window.history.pushState({}, '', targetPath);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
    // 每次点击都只刷新当前业务列表；重复点击当前标签也能获取最新内容。
    if (tab === 'square') void loadPosts('square');
    else if (tab === 'mine') void loadPosts('mine');
    else void loadThreads();
  };

  const changeXinfaFilter = (value: string) => {
    setXinfaFilter(value);
    postRequestVersionRef.current.square += 1;
    setSquarePosts(createListState<RecruitmentPost>());
    const params = new URLSearchParams(window.location.search);
    if (value) params.set('xinfaId', value);
    else params.delete('xinfaId');
    const query = params.toString() ? `?${params.toString()}` : '';
    const targetPath = `/recruitment${query}`;
    window.history.replaceState({}, '', targetPath);
    if (activeTab === 'square') {
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  const changeMineStatus = (value: RecruitmentStatus) => {
    setMineStatus(value);
    const params = new URLSearchParams();
    params.set('tab', 'mine');
    if (value === 'closed') params.set('status', value);
    const targetPath = `/recruitment?${params.toString()}`;
    window.history.replaceState({}, '', targetPath);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  const changeThreadStatus = (value: RecruitmentThreadStatus) => {
    setThreadStatus(value);
    const params = new URLSearchParams();
    params.set('tab', 'chats');
    if (value === 'closed') params.set('status', value);
    const targetPath = `/recruitment?${params.toString()}`;
    window.history.replaceState({}, '', targetPath);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  const openChat = (threadId: string) => {
    setActiveTab('chats');
    setSelectedThreadId(threadId);
    window.history.pushState({}, '', buildRecruitmentChatPath(threadId));
  };

  const closeChat = () => {
    setSelectedThreadId(null);
    const targetPath = threadStatus === 'closed'
      ? '/recruitment?tab=chats&status=closed'
      : '/recruitment?tab=chats';
    window.history.replaceState({}, '', targetPath);
    void loadThreads();
  };

  const openComposer = async () => {
    if (!(await identityNotice.requestAcknowledgement())) return;
    composerPreviousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : publishTriggerRef.current;
    setComposerOpen(true);
  };

  const requestPublishToken = async () => {
    if (!settings.turnstileEnabled) return '';
    if (!publishTurnstileRef.current) throw new Error('安全验证加载中，请稍后再试');
    return publishTurnstileRef.current.execute();
  };

  const publish = async (event: React.FormEvent) => {
    event.preventDefault();
    const content = publishContent.trim();
    if (!publishXinfaId) {
      showToast('请选择自己的 DPS 心法', 'warning');
      return;
    }
    if (!content) {
      showToast('请填写招募正文', 'warning');
      return;
    }
    if (xinfaError) {
      showToast('心法目录尚未加载成功', 'error');
      return;
    }

    setPublishing(true);
    try {
      const turnstileToken = await requestPublishToken();
      const created = await api.createRecruitmentPost({
        xinfaId: publishXinfaId,
        content,
        turnstileToken,
      });
      const item = { ...created.post, isOwner: true };
      const matchesFilter = !xinfaFilter || item.xinfaId === xinfaFilter;
      if (matchesFilter) {
        setSquarePosts((previous) => ({
          ...previous,
          items: [item, ...previous.items.filter((post) => post.id !== item.id)],
          total: previous.total + (previous.items.some((post) => post.id === item.id) ? 0 : 1),
          initialized: true,
        }));
      }
      if (mineStatus === 'open') {
        setMyPosts((previous) => ({
          ...previous,
          items: [item, ...previous.items.filter((post) => post.id !== item.id)],
          total: previous.total + (previous.items.some((post) => post.id === item.id) ? 0 : 1),
        }));
      }
      setPublishContent('');
      setPublishXinfaId('');
      setComposerOpen(false);
      selectTab('square');
      showToast('招募已发布', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '发布失败，请稍后重试', 'error');
    } finally {
      setPublishing(false);
    }
  };

  const submitApplication = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!applyPost || !applicationXinfaId) {
      showToast('请选择自己的 DPS 心法', 'warning');
      return;
    }
    if (!(await identityNotice.requestAcknowledgement())) return;
    setApplying(true);
    try {
      const data = await api.applyRecruitmentPost(applyPost.id, applicationXinfaId);
      const thread = 'thread' in data ? data.thread : data;
      const patchAppliedPost = (item: RecruitmentPost) => (
        item.id === applyPost.id ? { ...item, viewerThreadId: thread.id } : item
      );
      setSquarePosts((previous) => ({ ...previous, items: previous.items.map(patchAppliedPost) }));
      setMyPosts((previous) => ({ ...previous, items: previous.items.map(patchAppliedPost) }));
      setApplyPost(null);
      setApplicationXinfaId('');
      openChat(thread.id);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '密聊发起失败，请稍后重试', 'error');
    } finally {
      setApplying(false);
    }
  };

  const confirmClosePost = async () => {
    if (!closePost) return;
    setClosingId(closePost.id);
    try {
      const closed = await api.closeRecruitmentPost(closePost.id);
      const patch = (item: RecruitmentPost) => (
        item.id === closePost.id ? { ...item, ...closed.post, status: 'closed' as const } : item
      );
      setSquarePosts((previous) => ({
        ...previous,
        items: previous.items.filter((item) => item.id !== closePost.id),
        total: Math.max(0, previous.total - (previous.items.some((item) => item.id === closePost.id) ? 1 : 0)),
      }));
      setMyPosts((previous) => (
        mineStatus === 'open'
          ? {
            ...previous,
            items: previous.items.filter((item) => item.id !== closePost.id),
            total: Math.max(0, previous.total - (previous.items.some((item) => item.id === closePost.id) ? 1 : 0)),
          }
          : { ...previous, items: previous.items.map(patch) }
      ));
      threadRequestVersionRef.current += 1;
      setThreads(createListState<RecruitmentThread>());
      setClosePost(null);
      showToast('招募及相关密聊已结束', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '结束招募失败', 'error');
    } finally {
      setClosingId(null);
    }
  };

  const currentList = activeTab === 'mine' ? myPosts : activeTab === 'chats' ? threads : squarePosts;
  const unreadThreadCount = threadUnreadCount;
  const currentListLabel = activeTab === 'mine'
    ? mineStatus === 'open' ? '进行中的招募' : '已结束的招募'
    : activeTab === 'chats'
      ? threadStatus === 'active' ? '进行中的密聊' : '已结束的密聊'
      : '招募广场';

  useEffect(() => {
    if (!composerOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    const panel = composerPanelRef.current;
    const focusableSelector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !publishingRef.current) {
        event.preventDefault();
        setComposerOpen(false);
        return;
      }
      if (event.key !== 'Tab' || !panel) return;
      const focusable = (Array.from(panel.querySelectorAll(focusableSelector)) as HTMLElement[])
        .filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) {
        event.preventDefault();
        panel.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.body.style.overflow = 'hidden';
    const frameId = window.requestAnimationFrame(() => {
      const preferredField = panel?.querySelector<HTMLElement>('#recruitment-publish-xinfa:not([disabled])');
      const firstFocusable = preferredField || panel?.querySelector<HTMLElement>(focusableSelector);
      (firstFocusable || panel)?.focus({ preventScroll: true });
    });
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frameId);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      const previousFocus = composerPreviousFocusRef.current;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      composerPreviousFocusRef.current = null;
    };
  }, [composerOpen]);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-grow flex-col px-4 pb-24 pt-5 sm:px-6 lg:px-8 lg:pt-7">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2.5">
            <h1 className="text-2xl font-bold tracking-[-0.025em] text-ink sm:text-[1.75rem]">招募</h1>
            <span className="recruitment-callout-label pointer-events-none select-none">来人！</span>
          </div>
          <p className="mt-1 max-w-xl text-sm leading-5 text-pencil">行走江湖，带上我吧！</p>
        </div>
        <button
          type="button"
          ref={publishTriggerRef}
          onClick={() => void openComposer()}
          className={`${headerPublishBtn} w-full shrink-0 sm:w-auto`}
        >
          <CirclePlus className="size-4" aria-hidden="true" />
          发布招募
        </button>
      </header>

      <nav aria-label="招募页面" className="mt-5 flex items-center gap-1.5 overflow-x-auto py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:gap-3">
        {([
          { id: 'square' as const, label: '招募广场', count: squarePosts.total, emphasizeUnread: false, icon: <UsersRound className="size-4" aria-hidden="true" />, tilt: 'rotate-[0.15deg]' },
          { id: 'mine' as const, label: '我的招募', count: myPosts.total, emphasizeUnread: false, icon: <SquarePen className="size-4" aria-hidden="true" />, tilt: '-rotate-[0.2deg]' },
          { id: 'chats' as const, label: '密聊', count: unreadThreadCount, emphasizeUnread: unreadThreadCount > 0, icon: <MessageCircle className="size-4" aria-hidden="true" />, tilt: 'rotate-[0.25deg]' },
        ]).map(({ id, label, count, emphasizeUnread, icon, tilt }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => selectTab(id)}
              aria-current={active ? 'page' : undefined}
              className={`${tilt} group relative inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border-2 px-2 py-2 text-sm font-bold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 active:translate-y-px active:shadow-none motion-reduce:transform-none motion-reduce:transition-none sm:gap-2 sm:px-3 ${active ? '-translate-y-0.5 border-ink bg-highlight text-ink shadow-sketch' : 'border-ink/15 bg-white/70 text-pencil hover:-translate-y-0.5 hover:rotate-0 hover:border-ink hover:bg-marker-blue/25 hover:text-ink hover:shadow-sketch'}`}
            >
              <span className={`inline-flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors sm:size-6 ${active ? 'border-ink/15 bg-white/60' : 'border-transparent bg-paper-soft group-hover:border-ink/10 group-hover:bg-white/65'}`}>
                {icon}
              </span>
              <span>{label}</span>
              {count > 0 && (
                <span className={`inline-flex min-h-5 min-w-5 items-center justify-center rounded-md px-1.5 py-0.5 text-center text-[11px] tabular-nums leading-none ${emphasizeUnread
                  ? active
                    ? 'bg-ink text-white'
                    : 'border border-ink/20 bg-alert/80 text-ink'
                  : active
                    ? 'bg-white/70 text-ink ring-1 ring-inset ring-ink/15'
                    : 'bg-paper-shadow text-pencil ring-1 ring-inset ring-ink/10 group-hover:bg-white/70 group-hover:text-ink'
                  }`}>
                  {count > 99 ? '99+' : count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {(activeTab !== 'chats' || !selectedThreadId) && (
        <section className="flex flex-col gap-3 border-b border-ink/10 bg-white/35 py-3 sm:flex-row sm:items-center sm:justify-between" aria-label="招募筛选">
          <div className="flex min-w-0 items-center gap-2.5">
            <ListFilter className="size-4 shrink-0 text-pencil" aria-hidden="true" />
            {activeTab === 'square' ? (
              <>
                <label htmlFor="recruitment-xinfa-filter" className="sr-only">心法</label>
                <select
                  id="recruitment-xinfa-filter"
                  value={xinfaFilter}
                  onChange={(event) => changeXinfaFilter(event.target.value)}
                  disabled={xinfaLoading}
                  className="min-h-9 min-w-0 flex-1 rounded-md border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink outline-none transition-colors hover:border-ink/35 focus:border-ink focus:ring-2 focus:ring-ink/10 disabled:cursor-not-allowed disabled:opacity-60 sm:w-56 sm:flex-none"
                >
                  <option value="">全部心法</option>
                  {xinfaOptions.map((item) => <option key={item.id} value={item.id}>{formatXinfaOptionLabel(item)}</option>)}
                </select>
              </>
            ) : activeTab === 'mine' ? (
              <div className="inline-flex gap-1" role="group" aria-label="招募状态">
                {([
                  { value: 'open' as const, label: '进行中' },
                  { value: 'closed' as const, label: '已结束' },
                ]).map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => changeMineStatus(item.value)}
                    aria-pressed={mineStatus === item.value}
                    className={`min-h-8 rounded-md border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink ${mineStatus === item.value
                      ? 'border-ink bg-highlight text-ink'
                      : 'border-transparent text-pencil hover:bg-marker-blue/25 hover:text-ink'
                      }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ) : (
              <div className="inline-flex gap-1" role="group" aria-label="密聊状态">
                {([
                  { value: 'active' as const, label: '进行中' },
                  { value: 'closed' as const, label: '已结束' },
                ]).map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => changeThreadStatus(item.value)}
                    aria-pressed={threadStatus === item.value}
                    className={`min-h-8 rounded-md border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink ${threadStatus === item.value
                      ? 'border-ink bg-highlight text-ink'
                      : 'border-transparent text-pencil hover:bg-marker-blue/25 hover:text-ink'
                      }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center justify-between gap-3 sm:justify-end">
            <span className="text-xs text-pencil">{currentListLabel}</span>
            <span className="text-xs font-medium tabular-nums text-ink">
              {currentList.loading ? '加载中' : `${currentList.total} 条结果`}
            </span>
          </div>
        </section>
      )}

      {xinfaError && (
        <div className="mt-4 flex flex-col gap-3 rounded-lg border border-alert/45 bg-red-50/70 p-4 text-sm text-ink sm:flex-row sm:items-center sm:justify-between" role="alert">
          <span className="min-w-0 break-words">心法目录加载失败，暂时不能发布或发起密聊。</span>
          <button type="button" onClick={() => void loadXinfaCatalog()} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-ink/40 bg-white px-3 py-2 text-sm font-semibold transition-colors hover:bg-paper-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink">
            <RefreshCw className="size-4" aria-hidden="true" />
            重试
          </button>
        </div>
      )}

      <section className="relative mt-4" aria-label={activeTab === 'chats' ? selectedThreadId ? '密聊对话' : '密聊列表' : currentListLabel}>
        {activeTab === 'chats' ? (
          selectedThreadId ? (
            <RecruitmentChatView
              key={selectedThreadId}
              threadId={selectedThreadId}
              embedded
              onNavigateBack={closeChat}
              onThreadRead={handleThreadRead}
            />
          ) : threads.loading ? (
            <LoadingThreadRows />
          ) : threads.error ? (
            <ErrorState message={threads.error} onRetry={() => void loadThreads()} />
          ) : threads.items.length === 0 ? (
            <EmptyState
              title={threadStatus === 'active' ? '没有进行中的密聊' : '还没有已结束的密聊'}
              detail={threadStatus === 'active' ? '从招募广场发起密聊后，会显示在这里。' : '关闭的密聊会保留在这里，仍可查看历史内容。'}
              actionLabel={threadStatus === 'active' ? '去招募广场' : '查看进行中'}
              onAction={threadStatus === 'active' ? () => selectTab('square') : () => changeThreadStatus('active')}
              icon={<MessageCircle className="size-6" aria-hidden="true" />}
            />
          ) : (
            <div className="space-y-3">
              <div className="divide-y divide-ink/8 overflow-hidden rounded-lg border border-ink/10 bg-[#fffdfc]">
                {threads.items.map((thread) => (
                  <RecruitmentThreadRow key={thread.id} thread={thread} onOpen={openChat} />
                ))}
              </div>
              {threads.items.length < threads.total && (
                <LoadMoreButton loading={threads.loadingMore} onClick={() => void loadThreads(true)} />
              )}
            </div>
          )
        ) : currentList.loading ? (
          <LoadingPostCards />
        ) : currentList.error ? (
          <ErrorState message={currentList.error} onRetry={() => void loadPosts(activeTab as PostListKind)} />
        ) : currentList.items.length === 0 ? (
          <EmptyState
            title={activeTab === 'mine' ? '还没有发布招募' : xinfaFilter ? '没有匹配的招募' : '暂时没有招募'}
            detail={
              activeTab === 'mine'
                ? '发布后可在这里查看和结束招募。'
                : xinfaFilter
                  ? '换一个心法筛选，或稍后再来看看。'
                  : '稍后再来看看，也可以直接发布一条。'
            }
            actionLabel={
              activeTab === 'mine'
                ? '发布招募'
                : xinfaFilter
                  ? '清空筛选'
                  : '发布招募'
            }
            onAction={
              activeTab === 'mine' || !xinfaFilter
                ? () => { void openComposer(); }
                : () => changeXinfaFilter('')
            }
            icon={activeTab === 'mine' ? <SquarePen className="size-6" aria-hidden="true" /> : <UsersRound className="size-6" aria-hidden="true" />}
          />
        ) : (
          <div className="space-y-4">
            <div className="divide-y divide-ink/8 rounded-lg border border-ink/10 bg-[#fffdfc] [&>article:first-child]:rounded-t-lg [&>article:last-child]:rounded-b-lg">
              {currentList.items.map((post) => (
                <RecruitmentPostCard
                  key={post.id}
                  post={post}
                  options={xinfaOptions}
                  mine={activeTab === 'mine'}
                  closing={closingId === post.id}
                  onApply={(item) => {
                    if (item.viewerThreadId) {
                      openChat(item.viewerThreadId);
                      return;
                    }
                    setApplyPost(item);
                    setApplicationXinfaId('');
                  }}
                  onClosePost={setClosePost}
                  onOpenThreads={() => selectTab('chats')}
                  onReport={(targetType, targetId) => setReportTarget({ targetType, targetId })}
                />
              ))}
            </div>
            {currentList.items.length < currentList.total && (
              <LoadMoreButton
                loading={currentList.loadingMore}
                onClick={() => void loadPosts(activeTab as PostListKind, true)}
              />
            )}
          </div>
        )}
      </section>

      {composerOpen && (
        <div className="fixed inset-0 z-[70] bg-ink/30 backdrop-blur-[2px]" role="presentation" onClick={() => { if (!publishing) setComposerOpen(false); }}>
          <aside ref={composerPanelRef} tabIndex={-1} className="absolute inset-x-0 bottom-0 max-h-[92dvh] overflow-y-auto rounded-t-lg border border-ink/15 bg-[#fffdfc] p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-[0_-20px_56px_rgba(44,44,44,0.15)] outline-none sm:inset-y-0 sm:right-0 sm:left-auto sm:h-full sm:max-h-none sm:w-[min(26.25rem,100vw)] sm:rounded-none sm:rounded-l-lg sm:p-7" role="dialog" aria-modal="true" aria-labelledby="recruitment-compose-title" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 border-b border-ink/10 pb-5">
              <div>
                <h2 id="recruitment-compose-title" className="text-xl font-bold tracking-[-0.02em] text-ink">发布招募</h2>
                <p className="mt-2 text-sm leading-6 text-pencil">匿名发布，招募将在 24 小时后自动结束</p>
              </div>
              <button type="button" disabled={publishing} onClick={() => { if (!publishing) setComposerOpen(false); }} className="inline-flex size-10 shrink-0 items-center justify-center rounded-md text-pencil transition-colors hover:bg-white hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink disabled:cursor-not-allowed disabled:opacity-45" title="关闭发布面板" aria-label="关闭发布面板"><X className="size-5" aria-hidden="true" /></button>
            </div>
            <form className="mt-6 grid gap-5" onSubmit={publish}>
              <XinfaSelect id="recruitment-publish-xinfa" label="我的 DPS 心法" value={publishXinfaId} options={xinfaOptions} onChange={setPublishXinfaId} disabled={xinfaLoading || Boolean(xinfaError)} autoFocus />
              <div className="grid gap-2">
                <label htmlFor="recruitment-publish-content" className="text-sm font-semibold text-ink">招募内容</label>
                <textarea id="recruitment-publish-content" value={publishContent} onChange={(event) => setPublishContent(event.target.value)} maxLength={maxContentLength} rows={4} placeholder="想要什么样的队友呢" className="w-full resize-y rounded-lg border border-ink/20 bg-white p-3 text-sm leading-6 text-ink outline-none transition-colors placeholder:text-pencil/55 hover:border-ink/45 focus:border-ink focus:ring-2 focus:ring-ink/15" />
                <span className="justify-self-end text-xs tabular-nums text-pencil">{publishContent.length}/{maxContentLength}</span>
              </div>
              <div className="grid grid-cols-2 gap-3 border-t border-ink/8 pt-5">
                <button type="button" disabled={publishing} onClick={() => setComposerOpen(false)} className="inline-flex min-h-10 items-center justify-center rounded-md border border-ink/15 bg-white px-4 text-sm font-semibold text-ink transition-colors hover:bg-paper-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink disabled:cursor-not-allowed disabled:opacity-45">取消</button>
                <button type="submit" disabled={publishing || !publishXinfaId || !publishContent.trim() || Boolean(xinfaError)} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-white transition-colors hover:bg-pencil focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45"><Send className="size-4" aria-hidden="true" />{publishing ? '发布中...' : '发布招募'}</button>
              </div>
              <Turnstile ref={publishTurnstileRef} action="recruitment" enabled={settings.turnstileEnabled} />
            </form>
          </aside>
        </div>
      )}

      <Modal
        isOpen={Boolean(applyPost)}
        onClose={applying ? () => undefined : () => setApplyPost(null)}
        title="发起密聊"
        showCloseButton={!applying}
        panelClassName="!max-w-md !rounded-lg !border !border-ink/15 !shadow-[0_18px_50px_rgba(44,44,44,0.16)]"
        titleClassName="!mb-5 !rotate-0 !font-sans !text-xl !font-semibold"
        closeButtonClassName="!right-3 !top-3 !h-9 !w-9 !rounded-md !border !border-ink/15 !shadow-none hover:!bg-paper-soft focus-visible:!ring-ink"
      >
        <form className="grid gap-5" onSubmit={submitApplication}>
          <XinfaSelect
            id="recruitment-application-xinfa"
            label="我的 DPS 心法"
            value={applicationXinfaId}
            options={xinfaOptions}
            onChange={setApplicationXinfaId}
            disabled={xinfaLoading || Boolean(xinfaError)}
            autoFocus
          />
          <button type="submit" disabled={applying || !applicationXinfaId || Boolean(xinfaError)} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-ink px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-pencil focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45">
            <Send className="size-4" aria-hidden="true" />
            {applying ? '进入中...' : '进入密聊'}
          </button>
        </form>
      </Modal>

      <Modal
        isOpen={Boolean(closePost)}
        onClose={closingId ? () => undefined : () => setClosePost(null)}
        title="结束招募"
        showCloseButton={!closingId}
        panelClassName="!max-w-md !rounded-lg !border !border-ink/15 !shadow-[0_18px_50px_rgba(44,44,44,0.16)]"
        titleClassName="!mb-5 !rotate-0 !font-sans !text-xl !font-semibold"
        closeButtonClassName="!right-3 !top-3 !h-9 !w-9 !rounded-md !border !border-ink/15 !shadow-none hover:!bg-paper-soft focus-visible:!ring-ink"
      >
        <p className="break-words text-sm leading-6 text-pencil">结束后不再接受新的申请，相关密聊会同时关闭，双方仍可查看历史内容。</p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button type="button" disabled={Boolean(closingId)} onClick={() => setClosePost(null)} className="inline-flex min-h-10 items-center justify-center rounded-md border border-ink/20 bg-white px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-paper-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink disabled:cursor-not-allowed disabled:opacity-50">
            取消
          </button>
          <button type="button" disabled={Boolean(closingId)} onClick={() => void confirmClosePost()} className="inline-flex min-h-10 items-center justify-center rounded-md bg-alert px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-alert/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink disabled:cursor-not-allowed disabled:opacity-50">
            {closingId ? '处理中...' : '确认结束'}
          </button>
        </div>
      </Modal>

      <IdentityNoticeDialog
        open={identityNotice.open}
        onCancel={identityNotice.cancel}
        onConfirm={identityNotice.confirm}
      />

      {reportTarget && (
        <RecruitmentReportDialog
          open
          targetType={reportTarget.targetType}
          targetId={reportTarget.targetId}
          onClose={() => setReportTarget(null)}
        />
      )}
    </main>
  );
};

export default RecruitmentView;
