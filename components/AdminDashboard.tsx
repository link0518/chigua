import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Flag, Gavel, BarChart2, Bell, Search, Trash2, Ban, Eye, EyeOff, LayoutDashboard, LogOut, CheckCircle, XCircle, FileText, Pencil, RotateCcw, Shield, ClipboardList, MessageSquare, Menu, X, Settings, BookOpen, AlertTriangle } from 'lucide-react';
import { SketchButton, Badge } from './SketchUI';
import { AdminAuditLog, AdminComment, AdminHiddenItem, AdminPost, FeedbackMessage, Report, UpdateAnnouncementItem } from '../types';
import { useApp } from '../store/AppContext';
import Modal from './Modal';
import { api } from '../api';
import AdminIdentityCompact from './AdminIdentityCompact';
import {
  getAdminIdentitySearchValues,
  type AdminIdentityBanTargetType,
  type AdminIdentityField,
  type AdminIdentityLike,
} from './adminIdentity';
import MarkdownComposeEditor from './MarkdownComposeEditor';
import MarkdownRenderer from './MarkdownRenderer';
import AdminChatPanel from './AdminChatPanel';
import AdminWikiPanel from './AdminWikiPanel';
import AdminRumorPanel from './AdminRumorPanel';
import AdminOverviewView from '@/features/admin/views/AdminOverviewView';
import AdminFeedbackView from '@/features/admin/views/AdminFeedbackView';
import AdminBansView from '@/features/admin/views/AdminBansView';
import AdminAuditView from '@/features/admin/views/AdminAuditView';
import AdminReportsView from '@/features/admin/views/AdminReportsView';
import type { ReportAction } from '@/features/admin/types';
import AdminModerationDrawer, {
  type AdminModerationDrawerRequest,
  type AdminModerationQuickPreset,
  type AdminModerationSubmitPayload,
} from '@/features/admin/components/AdminModerationDrawer';

type AdminView = 'overview' | 'reports' | 'processed' | 'posts' | 'hidden' | 'bans' | 'audit' | 'feedback' | 'announcement' | 'settings' | 'chat' | 'wiki' | 'rumors';
type PostStatusFilter = 'all' | 'active' | 'hidden' | 'deleted';
type PostSort = 'time' | 'hot' | 'reports';
type HiddenTypeFilter = 'all' | 'post' | 'comment';
type HiddenReviewFilter = 'all' | 'pending' | 'kept';
type HiddenAction = 'keep' | 'restore';
type ReportConfirmModalState = {
  isOpen: boolean;
  reportId: string;
  targetId: string;
  action: ReportAction;
  content: string;
  reason: string;
  targetType: Report['targetType'];
  deleteComment: boolean;
  deleteChatMessage: boolean;
};

const WEEK_DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const POST_PAGE_SIZE = 10;
const HIDDEN_PAGE_SIZE = 10;
const AUDIT_PAGE_SIZE = 12;
const FEEDBACK_PAGE_SIZE = 8;
const VOCABULARY_PAGE_SIZE = 20;
const MAX_DEFAULT_POST_TAGS = 50;
const MAX_TAG_LENGTH = 6;
const BAN_PERMISSION_LABELS: Record<string, string> = {
  post: '发帖',
  comment: '回帖',
  like: '点赞',
  view: '查看',
  site: '禁止进入网站',
  chat: '聊天室',
};

const DEFAULT_BAN_PERMISSIONS = Object.keys(BAN_PERMISSION_LABELS);
const DEFAULT_BAN_PRESETS: AdminModerationQuickPreset[] = [
  { id: 'chat-7d', label: '聊天室 7 天', description: '只限制聊天室', permissions: ['chat'], duration: '7d' },
  { id: 'post-comment-7d', label: '发帖+评论 7 天', description: '保留站点查看与聊天室', permissions: ['post', 'comment'], duration: '7d' },
  { id: 'site-7d', label: '全站 7 天', description: '使用全部权限集', permissions: DEFAULT_BAN_PERMISSIONS, duration: '7d' },
  { id: 'site-forever', label: '永久封禁', description: '全站长期生效', permissions: DEFAULT_BAN_PERMISSIONS, duration: 'forever' },
];
const ADMIN_COMPOSE_INCLUDE_DEVELOPER_STORAGE_KEY = 'admin_compose_include_developer';
const EMPTY_REPORT_CONFIRM_MODAL: ReportConfirmModalState = {
  isOpen: false,
  reportId: '',
  targetId: '',
  action: 'ignore',
  content: '',
  reason: '',
  targetType: 'post',
  deleteComment: false,
  deleteChatMessage: false,
};

type ModerationDrawerState = AdminModerationDrawerRequest | null;

const normalizeTag = (value: string) => String(value || '')
  .trim()
  .replace(/^#+/, '')
  .replace(/\s+/g, ' ');

const sanitizeTagArray = (input: unknown, maxCount = MAX_DEFAULT_POST_TAGS) => {
  const source = Array.isArray(input) ? input : [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of source) {
    const normalized = normalizeTag(String(item || ''));
    if (!normalized) {
      continue;
    }
    if (normalized.length > MAX_TAG_LENGTH) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
    if (result.length >= maxCount) {
      break;
    }
  }
  return result;
};

const parseDefaultPostTagsInput = (value: string) => {
  const parts = String(value || '')
    .split(/[\r\n,，、;；|]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
  return sanitizeTagArray(parts, MAX_DEFAULT_POST_TAGS);
};

const formatDefaultPostTagsInput = (tags: unknown) => sanitizeTagArray(tags, MAX_DEFAULT_POST_TAGS).join('\n');

type RateLimitAction = 'post' | 'comment' | 'report' | 'feedback' | 'wiki';
type RateLimitItem = { limit: number; windowMs: number };
type RateLimitSettings = Record<RateLimitAction, RateLimitItem>;

const RATE_LIMIT_MAX_COUNT = 1000;
const RATE_LIMIT_MAX_WINDOW_SECONDS = 30 * 24 * 60 * 60;
const AUTO_HIDE_REPORT_THRESHOLD_DEFAULT = 10;
const AUTO_HIDE_REPORT_THRESHOLD_MAX = 1000;
const RATE_LIMIT_DEFAULTS: RateLimitSettings = {
  post: { limit: 2, windowMs: 30 * 60 * 1000 },
  comment: { limit: 1, windowMs: 10 * 1000 },
  report: { limit: 1, windowMs: 60 * 1000 },
  feedback: { limit: 1, windowMs: 60 * 60 * 1000 },
  wiki: { limit: 3, windowMs: 60 * 60 * 1000 },
};
const RATE_LIMIT_FIELDS: Array<{ key: RateLimitAction; label: string; hint: string }> = [
  { key: 'post', label: '发帖限流', hint: '限制普通用户发帖频率' },
  { key: 'comment', label: '评论限流', hint: '限制普通用户评论频率' },
  { key: 'report', label: '举报限流', hint: '限制普通用户举报频率' },
  { key: 'feedback', label: '留言限流', hint: '限制反馈留言提交频率' },
  { key: 'wiki', label: '瓜条提交限流', hint: '限制角色瓜条新建和编辑提交频率' },
];

const normalizeRateLimitNumber = (value: unknown, fallback: number, min: number, max: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(Math.trunc(parsed), min), max);
};

const normalizeAutoHideReportThreshold = (value: unknown) => normalizeRateLimitNumber(
  value,
  AUTO_HIDE_REPORT_THRESHOLD_DEFAULT,
  1,
  AUTO_HIDE_REPORT_THRESHOLD_MAX
);

const normalizeRateLimits = (input: unknown): RateLimitSettings => {
  const source = input && typeof input === 'object' ? input as Partial<Record<RateLimitAction, Partial<RateLimitItem>>> : {};
  return {
    post: {
      limit: normalizeRateLimitNumber(source?.post?.limit, RATE_LIMIT_DEFAULTS.post.limit, 1, RATE_LIMIT_MAX_COUNT),
      windowMs: normalizeRateLimitNumber(source?.post?.windowMs, RATE_LIMIT_DEFAULTS.post.windowMs, 1000, RATE_LIMIT_MAX_WINDOW_SECONDS * 1000),
    },
    comment: {
      limit: normalizeRateLimitNumber(source?.comment?.limit, RATE_LIMIT_DEFAULTS.comment.limit, 1, RATE_LIMIT_MAX_COUNT),
      windowMs: normalizeRateLimitNumber(source?.comment?.windowMs, RATE_LIMIT_DEFAULTS.comment.windowMs, 1000, RATE_LIMIT_MAX_WINDOW_SECONDS * 1000),
    },
    report: {
      limit: normalizeRateLimitNumber(source?.report?.limit, RATE_LIMIT_DEFAULTS.report.limit, 1, RATE_LIMIT_MAX_COUNT),
      windowMs: normalizeRateLimitNumber(source?.report?.windowMs, RATE_LIMIT_DEFAULTS.report.windowMs, 1000, RATE_LIMIT_MAX_WINDOW_SECONDS * 1000),
    },
    feedback: {
      limit: normalizeRateLimitNumber(source?.feedback?.limit, RATE_LIMIT_DEFAULTS.feedback.limit, 1, RATE_LIMIT_MAX_COUNT),
      windowMs: normalizeRateLimitNumber(source?.feedback?.windowMs, RATE_LIMIT_DEFAULTS.feedback.windowMs, 1000, RATE_LIMIT_MAX_WINDOW_SECONDS * 1000),
    },
    wiki: {
      limit: normalizeRateLimitNumber(source?.wiki?.limit, RATE_LIMIT_DEFAULTS.wiki.limit, 1, RATE_LIMIT_MAX_COUNT),
      windowMs: normalizeRateLimitNumber(source?.wiki?.windowMs, RATE_LIMIT_DEFAULTS.wiki.windowMs, 1000, RATE_LIMIT_MAX_WINDOW_SECONDS * 1000),
    },
  };
};

const formatRateLimitWindow = (windowMs: number) => {
  const seconds = Math.max(1, Math.round(windowMs / 1000));
  if (seconds % 3600 === 0) {
    return `${seconds / 3600} 小时`;
  }
  if (seconds % 60 === 0) {
    return `${seconds / 60} 分钟`;
  }
  return `${seconds} 秒`;
};

const AdminDashboard: React.FC = () => {
  const { state, handleReport, showToast, getPendingReports, loadReports, loadStats, loadSettings, logoutAdmin } = useApp();
  const [currentView, setCurrentView] = useState<AdminView>('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [postSearch, setPostSearch] = useState('');
  const [postStatus, setPostStatus] = useState<PostStatusFilter>('active');
  const [postSort, setPostSort] = useState<PostSort>('time');
  const [postPage, setPostPage] = useState(1);
  const [postTotal, setPostTotal] = useState(0);
  const [postItems, setPostItems] = useState<AdminPost[]>([]);
  const [postLoading, setPostLoading] = useState(false);
  const [hiddenType, setHiddenType] = useState<HiddenTypeFilter>('all');
  const [hiddenReview, setHiddenReview] = useState<HiddenReviewFilter>('pending');
  const [hiddenSearch, setHiddenSearch] = useState('');
  const [hiddenPage, setHiddenPage] = useState(1);
  const [hiddenTotal, setHiddenTotal] = useState(0);
  const [hiddenItems, setHiddenItems] = useState<AdminHiddenItem[]>([]);
  const [hiddenLoading, setHiddenLoading] = useState(false);
  const [selectedPosts, setSelectedPosts] = useState<Set<string>>(new Set());
  const [selectedReports, setSelectedReports] = useState<Set<string>>(new Set());
  const [composeText, setComposeText] = useState('');
  const [composeIncludeDeveloper, setComposeIncludeDeveloper] = useState(() => {
    if (typeof window === 'undefined') return true;
    try {
      const raw = window.localStorage.getItem(ADMIN_COMPOSE_INCLUDE_DEVELOPER_STORAGE_KEY);
      if (raw === null) return true;
      return raw === '1' || raw === 'true';
    } catch {
      return true;
    }
  });
  const [composeSubmitting, setComposeSubmitting] = useState(false);
  const [announcementText, setAnnouncementText] = useState('');
  const [announcementLoading, setAnnouncementLoading] = useState(false);
  const [announcementSubmitting, setAnnouncementSubmitting] = useState(false);
  const [announcementUpdatedAt, setAnnouncementUpdatedAt] = useState<number | null>(null);
  const [updateAnnouncementText, setUpdateAnnouncementText] = useState('');
  const [updateAnnouncementSubmitting, setUpdateAnnouncementSubmitting] = useState(false);
  const [updateAnnouncementLoading, setUpdateAnnouncementLoading] = useState(false);
  const [updateAnnouncements, setUpdateAnnouncements] = useState<UpdateAnnouncementItem[]>([]);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSubmitting, setSettingsSubmitting] = useState(false);
  const [turnstileEnabled, setTurnstileEnabled] = useState(true);
  const [cnyThemeEnabled, setCnyThemeEnabled] = useState(false);
  const [cnyThemeAutoActive, setCnyThemeAutoActive] = useState(false);
  const [cnyThemeActive, setCnyThemeActive] = useState(false);
  const [defaultPostTagsInput, setDefaultPostTagsInput] = useState('');
  const [rateLimits, setRateLimits] = useState<RateLimitSettings>(RATE_LIMIT_DEFAULTS);
  const [autoHideReportThreshold, setAutoHideReportThreshold] = useState(AUTO_HIDE_REPORT_THRESHOLD_DEFAULT);
  const [wecomWebhookEnabled, setWecomWebhookEnabled] = useState(false);
  const [wecomWebhookConfigured, setWecomWebhookConfigured] = useState(false);
  const [wecomWebhookMaskedUrl, setWecomWebhookMaskedUrl] = useState('');
  const [wecomWebhookUrlInput, setWecomWebhookUrlInput] = useState('');
  const [wecomWebhookClearUrl, setWecomWebhookClearUrl] = useState(false);
  const [wecomWebhookTesting, setWecomWebhookTesting] = useState(false);
  const [vocabularyLoading, setVocabularyLoading] = useState(false);
  const [vocabularySubmitting, setVocabularySubmitting] = useState(false);
  const [vocabularyItems, setVocabularyItems] = useState<Array<{ id: number; word: string; enabled: boolean; updatedAt: number }>>([]);
  const [vocabularySearch, setVocabularySearch] = useState('');
  const [vocabularyPage, setVocabularyPage] = useState(1);
  const [vocabularyTotal, setVocabularyTotal] = useState(0);
  const [vocabularyNewWord, setVocabularyNewWord] = useState('');
  const [editModal, setEditModal] = useState<{
    isOpen: boolean;
    postId: string;
    content: string;
    preview: boolean;
    reason: string;
  }>({ isOpen: false, postId: '', content: '', preview: false, reason: '' });
  const [bulkPostModal, setBulkPostModal] = useState<{
    isOpen: boolean;
    action: 'delete' | 'restore' | 'ban' | 'unban';
    reason: string;
  }>({ isOpen: false, action: 'delete', reason: '' });
  const [bulkReportModal, setBulkReportModal] = useState<{
    isOpen: boolean;
    reason: string;
  }>({ isOpen: false, reason: '' });
  const [bannedIps, setBannedIps] = useState<Array<{ ip: string; bannedAt: number; expiresAt?: number | null; permissions?: string[]; reason?: string | null }>>([]);
  const [bannedFingerprints, setBannedFingerprints] = useState<Array<{ type?: 'fingerprint' | 'identity'; fingerprint: string; identityKey?: string | null; identityHashes?: string[]; bannedAt: number; expiresAt?: number | null; permissions?: string[]; reason?: string | null }>>([]);
  const [banLoading, setBanLoading] = useState(false);
  const [banSearch, setBanSearch] = useState('');
  const [moderationDrawer, setModerationDrawer] = useState<ModerationDrawerState>(null);
  const [moderationSubmitting, setModerationSubmitting] = useState(false);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([]);
  const [auditSearch, setAuditSearch] = useState('');
  const [auditPage, setAuditPage] = useState(1);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditDetail, setAuditDetail] = useState<{ isOpen: boolean; log: AdminAuditLog | null }>({ isOpen: false, log: null });
  const [feedbackItems, setFeedbackItems] = useState<FeedbackMessage[]>([]);
  const [feedbackStatus, setFeedbackStatus] = useState<'all' | 'unread' | 'read'>('unread');
  const [feedbackSearch, setFeedbackSearch] = useState('');
  const [feedbackPage, setFeedbackPage] = useState(1);
  const [feedbackTotal, setFeedbackTotal] = useState(0);
  const [overviewPendingReports, setOverviewPendingReports] = useState<Report[]>([]);
  const [overviewPendingCount, setOverviewPendingCount] = useState(0);
  const [reportsLoaded, setReportsLoaded] = useState(false);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [feedbackUnreadCount, setFeedbackUnreadCount] = useState(0);
  const [wikiPendingCount, setWikiPendingCount] = useState(0);
  const [rumorPendingCount, setRumorPendingCount] = useState(0);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackActionModal, setFeedbackActionModal] = useState<{
    isOpen: boolean;
    feedbackId: string;
    action: 'delete' | 'ban';
    content: string;
    reason: string;
  }>({ isOpen: false, feedbackId: '', action: 'delete', content: '', reason: '' });
  const [confirmModal, setConfirmModal] = useState<ReportConfirmModalState>({ ...EMPTY_REPORT_CONFIRM_MODAL });
  const [postConfirmModal, setPostConfirmModal] = useState<{
    isOpen: boolean;
    postId: string;
    action: 'delete' | 'restore';
    content: string;
    reason: string;
  }>({ isOpen: false, postId: '', action: 'delete', content: '', reason: '' });
  const [postCommentsModal, setPostCommentsModal] = useState<{
    isOpen: boolean;
    postId: string;
    content: string;
  }>({ isOpen: false, postId: '', content: '' });
  const [postComments, setPostComments] = useState<AdminComment[]>([]);
  const [postCommentsLoading, setPostCommentsLoading] = useState(false);
  const [hiddenActionModal, setHiddenActionModal] = useState<{
    isOpen: boolean;
    item: AdminHiddenItem | null;
    action: HiddenAction;
    reason: string;
  }>({ isOpen: false, item: null, action: 'keep', reason: '' });
  const [reportDetail, setReportDetail] = useState<{ isOpen: boolean; report: Report | null }>({ isOpen: false, report: null });
  const composeMaxLength = 2000;
  const appVersion = import.meta.env.VITE_APP_VERSION || '0.0.0';
  const appVersionLabel = appVersion.startsWith('v') ? appVersion : `v${appVersion}`;

  useEffect(() => {
    loadStats().catch(() => { });
  }, [loadStats]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(
        ADMIN_COMPOSE_INCLUDE_DEVELOPER_STORAGE_KEY,
        composeIncludeDeveloper ? '1' : '0'
      );
    } catch {
      // ignore
    }
  }, [composeIncludeDeveloper]);

  useEffect(() => {
    const timer = setInterval(() => {
      loadStats().catch(() => { });
    }, 60000);
    return () => clearInterval(timer);
  }, [loadStats]);

  // Generate chart data from state
  const visitData = useMemo(() =>
    WEEK_DAYS.map((name, i) => ({
      name,
      value: state.stats.weeklyVisits[i] || 0
    })), [state.stats.weeklyVisits]);

  const postVolumeData = useMemo(() =>
    WEEK_DAYS.map((name, i) => ({
      name,
      value: state.stats.weeklyPosts[i] || 0
    })), [state.stats.weeklyPosts]);
  const totalWeeklyVisits = useMemo(() => visitData.reduce((sum, item) => sum + item.value, 0), [visitData]);
  const totalVocabularyPages = Math.max(Math.ceil(vocabularyTotal / VOCABULARY_PAGE_SIZE), 1);

  const pendingReports = getPendingReports();
  const processedReports = state.reports.filter(r => r.status !== 'pending');
  const visiblePendingReports = reportsLoaded ? pendingReports : overviewPendingReports;
  const pendingReportCount = reportsLoaded ? pendingReports.length : overviewPendingCount;
  const cnyThemePreviewActive = cnyThemeEnabled && cnyThemeAutoActive;
  const parsedDefaultPostTags = useMemo(
    () => parseDefaultPostTagsInput(defaultPostTagsInput),
    [defaultPostTagsInput]
  );
  const updateRateLimitCount = useCallback((key: RateLimitAction, value: string) => {
    const nextValue = normalizeRateLimitNumber(value, 0, 0, RATE_LIMIT_MAX_COUNT);
    setRateLimits((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        limit: nextValue,
      },
    }));
  }, []);
  const updateRateLimitWindowSeconds = useCallback((key: RateLimitAction, value: string) => {
    const nextSeconds = normalizeRateLimitNumber(value, 0, 0, RATE_LIMIT_MAX_WINDOW_SECONDS);
    setRateLimits((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        windowMs: nextSeconds * 1000,
      },
    }));
  }, []);

  // Filter reports by search query
  const filteredReports = useMemo(() => {
    const reports = currentView === 'processed' ? processedReports : pendingReports;
    if (!searchQuery.trim()) return reports;
    const query = searchQuery.toLowerCase();
    return reports.filter((r) => {
      const values = [
        r.id,
        r.contentSnippet,
        r.reason,
        r.postId,
        r.targetId,
        r.postContent,
        r.commentContent,
        r.targetContent,
        ...getAdminIdentitySearchValues({
          ip: r.targetIp,
          sessionId: r.targetSessionId,
          fingerprint: r.targetFingerprint,
          identityKey: r.targetIdentityKey,
          identityHashes: r.targetIdentityHashes,
        }),
        ...getAdminIdentitySearchValues({
          ip: r.reporterIp,
          fingerprint: r.reporterFingerprint,
          identityKey: r.reporterIdentityKey,
          identityHashes: r.reporterIdentityHashes,
        }),
      ].filter(Boolean) as string[];
      return values.some((value) => value.toLowerCase().includes(query));
    });
  }, [currentView, pendingReports, processedReports, searchQuery]);

  const mergedBans = useMemo(() => {
    const items = [
      ...bannedIps.map((item) => ({ ...item, type: 'ip' as const, value: item.ip })),
      ...bannedFingerprints.map((item) => ({
        ...item,
        type: item.type || (item.identityKey ? 'identity' as const : 'fingerprint' as const),
        value: item.identityKey || item.fingerprint,
        identityHashes: Array.from(new Set([...(item.identityHashes || []), item.fingerprint].filter(Boolean))),
      })),
    ];
    const query = banSearch.trim().toLowerCase();
    if (!query) {
      return items;
    }
    return items.filter((item) => {
      const identityFields = 'identityKey' in item
        ? getAdminIdentitySearchValues({
          identityKey: item.identityKey || null,
          fingerprint: item.fingerprint || null,
          identityHashes: item.identityHashes || [],
          ip: item.type === 'ip' ? item.value : null,
        })
        : [];
      const fields = [
        item.value,
        item.reason || '',
        (item.permissions || []).join(' '),
        item.type,
        ...identityFields,
      ];
      return fields.some((field) => field.toLowerCase().includes(query));
    });
  }, [bannedFingerprints, bannedIps, banSearch]);

  const fetchOverviewReports = useCallback(async () => {
    try {
      const data = await api.getReports({ status: 'pending', limit: 2 });
      setOverviewPendingReports(Array.isArray(data?.items) ? data.items : []);
      setOverviewPendingCount(Number(data?.total || 0));
    } catch (error) {
      const message = error instanceof Error ? error.message : '举报概览加载失败，请稍后重试';
      showToast(message, 'error');
    }
  }, [showToast]);

  const fetchAllReports = useCallback(async () => {
    setReportsLoading(true);
    try {
      await loadReports();
      setReportsLoaded(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : '举报列表加载失败，请稍后重试';
      showToast(message, 'error');
    } finally {
      setReportsLoading(false);
    }
  }, [loadReports, showToast]);


  const fetchAdminPosts = useCallback(async () => {
    setPostLoading(true);
    try {
      const data = await api.getAdminPosts({
        status: postStatus,
        sort: postSort,
        search: postSearch.trim(),
        page: postPage,
        limit: POST_PAGE_SIZE,
      });
      setPostItems(data.items || []);
      setPostTotal(data.total || 0);
    } catch (error) {
      const message = error instanceof Error ? error.message : '帖子加载失败，请稍后重试';
      showToast(message, 'error');
    } finally {
      setPostLoading(false);
    }
  }, [postPage, postSearch, postSort, postStatus, showToast]);

  const fetchHiddenItems = useCallback(async () => {
    setHiddenLoading(true);
    try {
      const data = await api.getAdminHiddenContent({
        type: hiddenType,
        review: hiddenReview,
        search: hiddenSearch.trim(),
        page: hiddenPage,
        limit: HIDDEN_PAGE_SIZE,
      });
      setHiddenItems(data.items || []);
      setHiddenTotal(data.total || 0);
    } catch (error) {
      const message = error instanceof Error ? error.message : '隐藏内容加载失败，请稍后重试';
      showToast(message, 'error');
    } finally {
      setHiddenLoading(false);
    }
  }, [hiddenPage, hiddenReview, hiddenSearch, hiddenType, showToast]);

  const fetchPostComments = useCallback(async (postId: string, search = '') => {
    setPostCommentsLoading(true);
    try {
      const data = await api.getAdminPostComments(postId, 1, 200, search);
      setPostComments(data.items || []);
    } catch (error) {
      const message = error instanceof Error ? error.message : '评论加载失败';
      showToast(message, 'error');
    } finally {
      setPostCommentsLoading(false);
    }
  }, [showToast]);

  const fetchBans = useCallback(async () => {
    setBanLoading(true);
    try {
      const data = await api.getAdminBans();
      setBannedIps(data.ips || []);
      setBannedFingerprints(data.fingerprints || []);
    } catch (error) {
      const message = error instanceof Error ? error.message : '封禁列表加载失败';
      showToast(message, 'error');
    } finally {
      setBanLoading(false);
    }
  }, [showToast]);

  const fetchAuditLogs = useCallback(async () => {
    setAuditLoading(true);
    try {
      const data = await api.getAdminAuditLogs({
        search: auditSearch.trim(),
        page: auditPage,
        limit: AUDIT_PAGE_SIZE,
      });
      setAuditLogs(data.items || []);
      setAuditTotal(data.total || 0);
    } catch (error) {
      const message = error instanceof Error ? error.message : '审计日志加载失败';
      showToast(message, 'error');
    } finally {
      setAuditLoading(false);
    }
  }, [auditPage, auditSearch, showToast]);

  const fetchFeedback = useCallback(async () => {
    setFeedbackLoading(true);
    try {
      const data = await api.getAdminFeedback({
        status: feedbackStatus,
        search: feedbackSearch.trim(),
        page: feedbackPage,
        limit: FEEDBACK_PAGE_SIZE,
      });
      setFeedbackItems(data.items || []);
      setFeedbackTotal(data.total || 0);
      if (feedbackStatus === 'unread') {
        setFeedbackUnreadCount(data.total || 0);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '留言加载失败';
      showToast(message, 'error');
    } finally {
      setFeedbackLoading(false);
    }
  }, [feedbackPage, feedbackSearch, feedbackStatus, showToast]);

  const fetchFeedbackUnreadCount = useCallback(async () => {
    try {
      const data = await api.getAdminFeedback({
        status: 'unread',
        page: 1,
        limit: 1,
      });
      setFeedbackUnreadCount(data.total || 0);
    } catch {
      setFeedbackUnreadCount(0);
    }
  }, []);

  const fetchWikiPendingCount = useCallback(async () => {
    try {
      const data = await api.getAdminWikiRevisions({
        status: 'pending',
        page: 1,
        limit: 1,
      });
      setWikiPendingCount(Number(data?.total || 0));
    } catch {
      setWikiPendingCount(0);
    }
  }, []);

  const fetchRumorPendingCount = useCallback(async () => {
    try {
      const data = await api.getAdminRumors({
        status: 'pending',
        page: 1,
        limit: 1,
      });
      setRumorPendingCount(Number(data?.total || 0));
    } catch {
      setRumorPendingCount(0);
    }
  }, []);

  const fetchAnnouncement = useCallback(async () => {
    setAnnouncementLoading(true);
    try {
      const data = await api.getAdminAnnouncement();
      setAnnouncementText(String(data?.content || ''));
      setAnnouncementUpdatedAt(typeof data?.updatedAt === 'number' ? data.updatedAt : null);
    } catch (error) {
      const message = error instanceof Error ? error.message : '公告加载失败';
      showToast(message, 'error');
    } finally {
      setAnnouncementLoading(false);
    }
  }, [showToast]);

  const fetchUpdateAnnouncements = useCallback(async () => {
    setUpdateAnnouncementLoading(true);
    try {
      const data = await api.getAdminUpdateAnnouncements();
      setUpdateAnnouncements(Array.isArray(data?.items) ? data.items : []);
    } catch (error) {
      const message = error instanceof Error ? error.message : '更新公告加载失败';
      showToast(message, 'error');
    } finally {
      setUpdateAnnouncementLoading(false);
    }
  }, [showToast]);

  const fetchSettings = useCallback(async () => {
    setSettingsLoading(true);
    try {
      const data = await api.getAdminSettings();
      setTurnstileEnabled(Boolean(data?.turnstileEnabled));
      setCnyThemeEnabled(Boolean(data?.cnyThemeEnabled));
      setCnyThemeAutoActive(Boolean(data?.cnyThemeAutoActive));
      setCnyThemeActive(Boolean(data?.cnyThemeActive));
      setDefaultPostTagsInput(formatDefaultPostTagsInput(data?.defaultPostTags));
      setRateLimits(normalizeRateLimits(data?.rateLimits));
      setAutoHideReportThreshold(normalizeAutoHideReportThreshold(data?.autoHideReportThreshold));
      setWecomWebhookEnabled(Boolean(data?.wecomWebhook?.enabled));
      setWecomWebhookConfigured(Boolean(data?.wecomWebhook?.configured));
      setWecomWebhookMaskedUrl(String(data?.wecomWebhook?.maskedUrl || ''));
      setWecomWebhookUrlInput('');
      setWecomWebhookClearUrl(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : '设置加载失败';
      showToast(message, 'error');
    } finally {
      setSettingsLoading(false);
    }
  }, [showToast]);

  const fetchVocabulary = useCallback(async (options?: { page?: number; search?: string }) => {
    setVocabularyLoading(true);
    try {
      const pageValue = options?.page ?? vocabularyPage;
      const searchValue = options?.search ?? vocabularySearch;
      const data = await api.getAdminVocabulary({
        search: searchValue,
        page: pageValue,
        limit: VOCABULARY_PAGE_SIZE,
      });
      setVocabularyItems(Array.isArray(data?.items) ? data.items : []);
      setVocabularyTotal(Number(data?.total || 0));
    } catch (error) {
      const message = error instanceof Error ? error.message : '违禁词加载失败';
      showToast(message, 'error');
    } finally {
      setVocabularyLoading(false);
    }
  }, [showToast, vocabularyPage, vocabularySearch]);

  useEffect(() => {
    if (currentView !== 'overview') {
      return;
    }
    if (reportsLoaded) {
      return;
    }
    fetchOverviewReports().catch(() => { });
  }, [currentView, fetchOverviewReports, reportsLoaded]);

  useEffect(() => {
    if (currentView !== 'reports' && currentView !== 'processed') {
      return;
    }
    if (reportsLoaded) {
      return;
    }
    fetchAllReports().catch(() => { });
  }, [currentView, fetchAllReports, reportsLoaded]);

  useEffect(() => {
    if (currentView !== 'posts') {
      return;
    }
    const timer = setTimeout(() => {
      fetchAdminPosts().catch(() => { });
    }, 300);
    return () => clearTimeout(timer);
  }, [currentView, fetchAdminPosts]);

  useEffect(() => {
    if (currentView !== 'hidden') {
      return;
    }
    const timer = setTimeout(() => {
      fetchHiddenItems().catch(() => { });
    }, 300);
    return () => clearTimeout(timer);
  }, [currentView, fetchHiddenItems]);

  useEffect(() => {
    if (currentView !== 'bans') {
      return;
    }
    fetchBans().catch(() => { });
  }, [currentView, fetchBans]);

  useEffect(() => {
    if (currentView !== 'audit') {
      return;
    }
    const timer = setTimeout(() => {
      fetchAuditLogs().catch(() => { });
    }, 300);
    return () => clearTimeout(timer);
  }, [currentView, fetchAuditLogs]);

  useEffect(() => {
    if (currentView !== 'feedback') {
      return;
    }
    const timer = setTimeout(() => {
      fetchFeedback().catch(() => { });
    }, 300);
    return () => clearTimeout(timer);
  }, [currentView, fetchFeedback]);

  useEffect(() => {
    fetchFeedbackUnreadCount().catch(() => { });
    fetchWikiPendingCount().catch(() => { });
    fetchRumorPendingCount().catch(() => { });
  }, [currentView, fetchFeedbackUnreadCount, fetchRumorPendingCount, fetchWikiPendingCount]);

  useEffect(() => {
    if (currentView !== 'announcement') {
      return;
    }
    const timer = setTimeout(() => {
      fetchAnnouncement().catch(() => { });
      fetchUpdateAnnouncements().catch(() => { });
    }, 300);
    return () => clearTimeout(timer);
  }, [currentView, fetchAnnouncement, fetchUpdateAnnouncements]);

  useEffect(() => {
    if (currentView !== 'settings') {
      return;
    }
    const timer = setTimeout(() => {
      fetchSettings().catch(() => { });
      fetchVocabulary().catch(() => { });
    }, 300);
    return () => clearTimeout(timer);
  }, [currentView, fetchSettings, fetchVocabulary]);

  useEffect(() => {
    if (currentView !== 'settings') {
      return;
    }
    fetchVocabulary().catch(() => { });
  }, [currentView, fetchVocabulary, vocabularyPage, vocabularySearch]);

  useEffect(() => {
    setSelectedPosts(new Set());
  }, [postItems]);

  useEffect(() => {
    setSelectedReports(new Set());
  }, [currentView, searchQuery, state.reports]);

  const openReportBanDrawer = (
    reportId: string,
    content: string,
    targetType: Report['targetType'],
    targetId: string
  ) => {
    const report = state.reports.find((item) => item.id === reportId) || overviewPendingReports.find((item) => item.id === reportId);
    const identity = report ? {
      ip: report.targetIp,
      sessionId: report.targetSessionId,
      fingerprint: report.targetFingerprint,
      identityKey: report.targetIdentityKey,
      identityHashes: report.targetIdentityHashes,
    } : undefined;
    openModerationDrawer({
      title: '举报封禁处置',
      description: '沿用举报处理接口，可直接补充附带删除选项。',
      summary: content,
      identity,
      defaultPermissions: DEFAULT_BAN_PERMISSIONS,
      defaultDuration: '7d',
      quickPresets: DEFAULT_BAN_PRESETS,
      extraOptions: [
        ...(targetType === 'comment' ? [{ key: 'deleteComment', label: '同时删除被举报评论' }] : []),
        ...(targetType === 'chat' ? [{ key: 'deleteChatMessage', label: '同时删除被举报发言' }] : []),
      ],
      submitLabel: '确认封禁',
      onSubmit: async (payload) => {
        await handleReport(reportId, 'ban', payload.reason.trim(), {
          ...buildBanOptionsFromPayload(payload),
          ...(targetType === 'comment' ? { deleteComment: Boolean(payload.extras.deleteComment) } : {}),
          ...(targetType === 'chat' ? { deleteChatMessage: Boolean(payload.extras.deleteChatMessage) } : {}),
        }, { targetId, targetType });
        setReportsLoaded(true);
        const successMessage = targetType === 'comment'
          ? (payload.extras.deleteComment ? '已封禁用户并删除被举报评论' : '已封禁用户，保留被举报评论')
          : targetType === 'chat'
            ? (payload.extras.deleteChatMessage ? '已封禁用户并删除被举报发言' : '已封禁用户，保留被举报发言')
            : '已封禁用户并删除内容';
        showToast(successMessage, 'success');
      },
    });
  };

  const handleAction = (
    reportId: string,
    action: ReportAction,
    content: string,
    targetType: Report['targetType'],
    targetId: string
  ) => {
    if (action === 'ban') {
      openReportBanDrawer(reportId, content, targetType, targetId);
      return;
    }
    setConfirmModal({
      isOpen: true,
      reportId,
      targetId,
      action,
      content,
      reason: '',
      targetType,
      deleteComment: false,
      deleteChatMessage: false,
    });
  };

  const confirmAction = async () => {
    const { reportId, targetId, action, reason, targetType } = confirmModal;
    try {
      await handleReport(reportId, action, reason, undefined, { targetId, targetType });
      setReportsLoaded(true);
      const messages = {
        ignore: '已忽略该举报',
        delete: '已删除该内容',
        mute: '已禁言用户',
        ban: '已封禁用户',
      };
      showToast(messages[action], action === 'ignore' ? 'info' : 'success');
      setConfirmModal({ ...EMPTY_REPORT_CONFIRM_MODAL });
    } catch (error) {
      const message = error instanceof Error ? error.message : '处理失败，请稍后重试';
      showToast(message, 'error');
    }
  };

  const getActionLabel = (
    action: ReportAction,
    targetType: Report['targetType'],
    deleteComment = false,
    deleteChatMessage = false
  ) => {
    switch (action) {
      case 'ignore':
        return '忽略该举报';
      case 'delete':
        return '删除该内容';
      case 'mute':
        return '禁言用户';
      case 'ban':
        if (targetType === 'comment') {
          return deleteComment ? '封禁用户并删除被举报评论' : '封禁用户（保留被举报评论）';
        }
        if (targetType === 'chat') {
          return deleteChatMessage ? '封禁用户并删除被举报发言' : '封禁用户（保留被举报发言）';
        }
        return '封禁用户并删除内容';
    }
  };

  const handlePostAction = (postId: string, action: 'delete' | 'restore', content: string) => {
    setPostConfirmModal({ isOpen: true, postId, action, content, reason: '' });
  };

  const openPostBanDrawer = (post: AdminPost) => {
    openModerationDrawer({
      title: '帖子作者封禁',
      description: '按帖子作者执行封禁，沿用现有帖子批量封禁接口。',
      summary: post.content,
      identity: post,
      defaultPermissions: DEFAULT_BAN_PERMISSIONS,
      defaultDuration: '7d',
      quickPresets: DEFAULT_BAN_PRESETS,
      submitLabel: '确认封禁',
      onSubmit: async (payload) => {
        await api.batchAdminPosts('ban', [post.id], payload.reason.trim(), buildBanOptionsFromPayload(payload));
        showToast('已封禁该用户', 'success');
        await fetchAdminPosts();
        await loadStats();
        await fetchBans();
      },
    });
  };

  const openPostComments = (post: AdminPost) => {
    setPostCommentsModal({ isOpen: true, postId: post.id, content: post.content });
    fetchPostComments(post.id, postSearch.trim()).catch(() => { });
  };

  const openCommentModerationDrawer = (comment: AdminComment) => {
    openModerationDrawer({
      title: '评论作者封禁',
      description: '会沿用评论处置接口，并保留评论封禁的既有语义。',
      summary: comment.content || '（无内容）',
      identity: comment,
      defaultPermissions: DEFAULT_BAN_PERMISSIONS,
      defaultDuration: '7d',
      quickPresets: DEFAULT_BAN_PRESETS,
      submitLabel: '确认封禁',
      onSubmit: async (payload) => {
        if (!postCommentsModal.postId) {
          throw new Error('评论列表已关闭，请重新打开后再试');
        }
        await api.handleAdminComment(comment.id, 'ban', payload.reason.trim(), buildBanOptionsFromPayload(payload));
        showToast('已封禁并删除评论', 'success');
        await fetchPostComments(postCommentsModal.postId);
        await fetchAdminPosts();
        await loadStats();
        await fetchBans();
      },
    });
  };


  const getHighlightedText = (text: string, keyword: string) => {
    const normalized = keyword.trim();
    if (!normalized) {
      return text;
    }
    const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'gi');
    const parts = text.split(regex);
    const matches = text.match(regex) || [];
    if (parts.length === 1) {
      return text;
    }
    return (
      <>
        {parts.map((part, index) => (
          <React.Fragment key={`${part}-${index}`}>
            {part}
            {index < matches.length && (
              <span className="bg-highlight/60 px-0.5 rounded-sm">{matches[index]}</span>
            )}
          </React.Fragment>
        ))}
      </>
    );
  };

  const confirmPostAction = async () => {
    const { postId, action, reason } = postConfirmModal;
    try {
      await api.handleAdminPost(postId, action, reason);
      showToast(action === 'delete' ? '帖子已删除' : '帖子已恢复', 'success');
      setPostConfirmModal({ isOpen: false, postId: '', action: 'delete', content: '', reason: '' });
      await fetchAdminPosts();
      await loadStats();
    } catch (error) {
      const message = error instanceof Error ? error.message : '操作失败，请稍后重试';
      showToast(message, 'error');
    }
  };

  const handleAdminCommentAction = async (commentId: string) => {
    if (!postCommentsModal.postId) {
      return;
    }
    try {
      await api.handleAdminComment(commentId, 'delete');
      showToast('评论已删除', 'success');
      await fetchPostComments(postCommentsModal.postId);
      await fetchAdminPosts();
      await loadStats();
    } catch (error) {
      const message = error instanceof Error ? error.message : '操作失败，请稍后重试';
      showToast(message, 'error');
    }
  };

  const openHiddenActionModal = (item: AdminHiddenItem, action: HiddenAction) => {
    setHiddenActionModal({
      isOpen: true,
      item,
      action,
      reason: '',
    });
  };

  const getHiddenActionLabel = (action: HiddenAction) => (action === 'keep' ? '保持隐藏' : '恢复内容');

  const confirmHiddenAction = async () => {
    const { item, action, reason } = hiddenActionModal;
    if (!item) {
      return;
    }
    try {
      await api.handleAdminHiddenContent(item.type, item.id, action, reason);
      const targetLabel = item.type === 'post' ? '帖子' : '评论';
      showToast(action === 'keep' ? `${targetLabel}将继续保持隐藏` : `${targetLabel}已恢复显示`, 'success');
      setHiddenActionModal({ isOpen: false, item: null, action: 'keep', reason: '' });
      await fetchHiddenItems();
      await fetchAdminPosts();
      await loadReports();
      setReportsLoaded(true);
      await loadStats();
      if (postCommentsModal.isOpen && item.type === 'comment' && item.postId && item.postId === postCommentsModal.postId) {
        await fetchPostComments(item.postId, postSearch.trim());
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '处理失败，请稍后重试';
      showToast(message, 'error');
    }
  };

  const getPostActionLabel = (action: 'delete' | 'restore') => (action === 'delete' ? '删除帖子' : '恢复帖子');
  const getBulkActionLabel = (action: 'delete' | 'restore' | 'ban' | 'unban') => {
    switch (action) {
      case 'delete':
        return '删除';
      case 'restore':
        return '恢复';
      case 'ban':
        return '封禁';
      case 'unban':
        return '解封';
      default:
        return action;
    }
  };

  const formatTimestamp = (timestamp?: number) => {
    if (!timestamp) return '-';
    return new Date(timestamp).toLocaleString('zh-CN');
  };

  const formatBanPermissions = (permissions?: string[]) => {
    const list = permissions && permissions.length ? permissions : Object.keys(BAN_PERMISSION_LABELS);
    return list.map((perm) => BAN_PERMISSION_LABELS[perm] || perm).join('、');
  };

  const toDatetimeLocalValue = (timestamp: number) => {
    const date = new Date(timestamp);
    const offset = date.getTimezoneOffset() * 60 * 1000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
  };

  const resolveDurationDefaults = (expiresAt?: number | null) => {
    if (!expiresAt) {
      return {
        defaultDuration: 'forever' as const,
        defaultCustomUntil: '',
      };
    }
    const diff = expiresAt - Date.now();
    const hourMs = 60 * 60 * 1000;
    const dayMs = 24 * hourMs;
    const within = (target: number) => Math.abs(diff - target) <= 60 * 1000;
    if (within(hourMs)) {
      return { defaultDuration: '1h' as const, defaultCustomUntil: '' };
    }
    if (within(dayMs)) {
      return { defaultDuration: '1d' as const, defaultCustomUntil: '' };
    }
    if (within(7 * dayMs)) {
      return { defaultDuration: '7d' as const, defaultCustomUntil: '' };
    }
    return {
      defaultDuration: 'custom' as const,
      defaultCustomUntil: toDatetimeLocalValue(expiresAt),
    };
  };

  const buildBanOptionsFromPayload = (payload: AdminModerationSubmitPayload) => ({
    permissions: payload.permissions.length ? payload.permissions : DEFAULT_BAN_PERMISSIONS,
    expiresAt: payload.expiresAt,
  });

  const closeModerationDrawer = useCallback(() => {
    if (moderationSubmitting) {
      return;
    }
    setModerationDrawer(null);
  }, [moderationSubmitting]);

  const openModerationDrawer = useCallback((request: AdminModerationDrawerRequest) => {
    setModerationDrawer(request);
  }, []);

  const runModerationHandler = useCallback(async (
    handler: ((payload: AdminModerationSubmitPayload) => Promise<void> | void) | undefined,
    payload: AdminModerationSubmitPayload
  ) => {
    if (!handler) {
      return;
    }
    setModerationSubmitting(true);
    try {
      await handler(payload);
      setModerationDrawer(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : '封禁操作失败';
      showToast(message, 'error');
    } finally {
      setModerationSubmitting(false);
    }
  }, [showToast]);

  const applyIdentitySearch = useCallback((value: string) => {
    const nextValue = String(value || '').trim();
    if (!nextValue) {
      return;
    }
    if (currentView === 'posts') {
      setPostSearch(nextValue);
      setPostPage(1);
      return;
    }
    if (currentView === 'hidden') {
      setHiddenSearch(nextValue);
      setHiddenPage(1);
      return;
    }
    if (currentView === 'audit') {
      setAuditSearch(nextValue);
      setAuditPage(1);
      return;
    }
    if (currentView === 'feedback') {
      setFeedbackSearch(nextValue);
      setFeedbackPage(1);
      return;
    }
    if (currentView === 'bans') {
      setBanSearch(nextValue);
      return;
    }
    setSearchQuery(nextValue);
  }, [currentView]);

  const openManualBanDrawer = useCallback((preset?: { type?: AdminIdentityBanTargetType; value?: string; reason?: string }) => {
    const type = preset?.type || 'identity';
    const value = String(preset?.value || '').trim();
    openModerationDrawer({
      title: '手动封禁',
      description: '适用于外部身份、指纹或 IP 的手动处理。',
      target: { type, value, editable: true },
      defaultReason: preset?.reason || '',
      defaultPermissions: DEFAULT_BAN_PERMISSIONS,
      defaultDuration: '7d',
      quickPresets: DEFAULT_BAN_PRESETS,
      submitLabel: '确认封禁',
      onSubmit: async (payload) => {
        if (!payload.targetValue.trim()) {
          throw new Error(`请输入要封禁的${getBanTargetLabel(payload.targetType)}`);
        }
        await api.handleAdminBan('ban', payload.targetType, payload.targetValue.trim(), payload.reason.trim(), buildBanOptionsFromPayload(payload));
        showToast(`已封禁指定${getBanTargetLabel(payload.targetType)}`, 'success');
        await fetchBans();
        await loadStats();
      },
    });
  }, [fetchBans, loadStats, openModerationDrawer, showToast]);

  const prepareManualBan = useCallback((type: AdminIdentityBanTargetType, value: string) => {
    const nextValue = String(value || '').trim();
    if (!nextValue) {
      return;
    }
    openManualBanDrawer({ type, value: nextValue });
  }, [openManualBanDrawer]);

  const handleIdentitySearch = useCallback((field: AdminIdentityField) => {
    applyIdentitySearch(field.value);
  }, [applyIdentitySearch]);

  const handleIdentityBanPrepare = useCallback((field: AdminIdentityField & { type: AdminIdentityBanTargetType }) => {
    prepareManualBan(field.type, field.value);
  }, [prepareManualBan]);

  const moderationSecondaryAction = (() => {
    const handler = moderationDrawer?.onSecondaryAction;
    if (!handler) {
      return undefined;
    }
    return (payload: AdminModerationSubmitPayload) => runModerationHandler(handler, payload);
  })();

  const renderIdentity = (
    identity?: AdminIdentityLike | null,
    options: {
      label?: string | null;
      showIp?: boolean;
      showSession?: boolean;
      enableSearchActions?: boolean;
      enableBanActions?: boolean;
      className?: string;
      textClassName?: string;
    } = {}
  ) => (
    <AdminIdentityCompact
      identity={identity}
      label={options.label}
      showIp={options.showIp}
      showSession={options.showSession}
      className={options.className}
      textClassName={options.textClassName}
      actions={{
        onSearch: options.enableSearchActions === false ? undefined : handleIdentitySearch,
        onBan: options.enableBanActions === false ? undefined : handleIdentityBanPrepare,
      }}
    />
  );

  const buildAdminCommentTree = (items: AdminComment[]) => {
    const nodes = new Map<string, AdminComment & { replies: AdminComment[] }>();
    items.forEach((item) => {
      nodes.set(item.id, { ...item, replies: [] });
    });
    const roots: Array<AdminComment & { replies: AdminComment[] }> = [];
    nodes.forEach((node) => {
      if (node.parentId && nodes.has(node.parentId)) {
        nodes.get(node.parentId)?.replies.push(node);
      } else {
        roots.push(node);
      }
    });
    const sortByCreatedAt = (a: AdminComment, b: AdminComment) => (a.createdAt || 0) - (b.createdAt || 0);
    const sortTree = (list: Array<AdminComment & { replies: AdminComment[] }>) => {
      list.sort(sortByCreatedAt);
      list.forEach((item) => {
        if (item.replies?.length) {
          sortTree(item.replies as Array<AdminComment & { replies: AdminComment[] }>);
        }
      });
    };
    sortTree(roots);
    return roots;
  };

  const renderAdminCommentItem = (item: AdminComment, depth = 0): React.ReactNode => {
    const indent = Math.min(depth * 16, 48);
    const contentClass = item.deleted ? 'text-pencil line-through' : item.hidden ? 'text-pencil' : 'text-ink';
    const content = postSearch.trim()
      ? getHighlightedText(item.content || '（无内容）', postSearch.trim())
      : (item.content || '（无内容）');
    return (
      <div key={item.id} style={{ marginLeft: indent }} className="border-l border-dashed border-gray-200 pl-3 py-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-pencil font-sans mb-1">
          <span className="bg-gray-100 border border-ink text-ink text-[10px] font-bold px-2 py-0.5 rounded font-sans">#{item.id}</span>
          <span>{item.timestamp}</span>
          {item.deleted && <Badge color="bg-gray-200">已删除</Badge>}
          {!item.deleted && item.hidden && <Badge color="bg-yellow-100">已隐藏</Badge>}
          {renderIdentity(item)}
        </div>
        <p className={`text-sm font-sans leading-6 ${contentClass}`}>{content}</p>
        <div className="flex items-center gap-2 mt-2">
          <SketchButton
            variant="danger"
            className="h-8 px-3 text-xs"
            disabled={item.deleted}
            onClick={() => handleAdminCommentAction(item.id)}
          >
            删除
          </SketchButton>
          <SketchButton
            variant="secondary"
            className="h-8 px-3 text-xs"
            onClick={() => openCommentModerationDrawer(item)}
          >
            封禁
          </SketchButton>
        </div>
        {item.replies?.length ? (
          <div className="mt-2 flex flex-col gap-2">
            {item.replies.map((reply) => renderAdminCommentItem(reply, depth + 1))}
          </div>
        ) : null}
      </div>
    );
  };


  const stripSessionFields = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(stripSessionFields);
    }
    if (value && typeof value === 'object') {
      const next: Record<string, unknown> = {};
      Object.entries(value).forEach(([key, val]) => {
        if (key === 'sessionId' || key === 'session_id') {
          return;
        }
        next[key] = stripSessionFields(val);
      });
      return next;
    }
    return value;
  };

  const formatAuditJson = (value?: string | null) => {
    if (!value) return '—';
    try {
      const parsed = JSON.parse(value);
      return JSON.stringify(stripSessionFields(parsed), null, 2);
    } catch {
      return value;
    }
  };

  const togglePostSelection = (postId: string) => {
    setSelectedPosts((prev) => {
      const next = new Set(prev);
      if (next.has(postId)) {
        next.delete(postId);
      } else {
        next.add(postId);
      }
      return next;
    });
  };

  const toggleAllPosts = () => {
    if (postItems.length === 0) {
      return;
    }
    setSelectedPosts((prev) => {
      const allSelected = postItems.every((post) => prev.has(post.id));
      if (allSelected) {
        return new Set();
      }
      return new Set(postItems.map((post) => post.id));
    });
  };

  const toggleReportSelection = (reportId: string) => {
    setSelectedReports((prev) => {
      const next = new Set(prev);
      if (next.has(reportId)) {
        next.delete(reportId);
      } else {
        next.add(reportId);
      }
      return next;
    });
  };

  const toggleAllReports = (reportIds: string[]) => {
    if (reportIds.length === 0) {
      return;
    }
    setSelectedReports((prev) => {
      const allSelected = reportIds.every((id) => prev.has(id));
      if (allSelected) {
        return new Set();
      }
      return new Set(reportIds);
    });
  };

  const openBulkPostModal = (action: 'delete' | 'restore' | 'ban' | 'unban') => {
    if (selectedPosts.size === 0) {
      showToast('请先选择帖子', 'warning');
      return;
    }
    if (action === 'ban') {
      openModerationDrawer({
        title: '批量封禁帖子作者',
        description: '会按所选帖子对应作者批量执行封禁。',
        summary: `本次将处理 ${selectedPosts.size} 条帖子对应的作者`,
        defaultPermissions: DEFAULT_BAN_PERMISSIONS,
        defaultDuration: '7d',
        quickPresets: DEFAULT_BAN_PRESETS,
        submitLabel: '确认批量封禁',
        onSubmit: async (payload) => {
          const ids = Array.from(selectedPosts);
          await api.batchAdminPosts('ban', ids, payload.reason.trim(), buildBanOptionsFromPayload(payload));
          showToast('批量封禁已完成', 'success');
          setSelectedPosts(new Set());
          await fetchAdminPosts();
          await loadStats();
          fetchBans().catch(() => { });
        },
      });
      return;
    }
    setBulkPostModal({ isOpen: true, action, reason: '' });
  };

  const confirmBulkPostAction = async () => {
    const { action, reason } = bulkPostModal;
    const ids = Array.from(selectedPosts);
    try {
      await api.batchAdminPosts(action, ids, reason);
      showToast('批量操作已完成', 'success');
      setSelectedPosts(new Set());
      setBulkPostModal({ isOpen: false, action: 'delete', reason: '' });
      await fetchAdminPosts();
      await loadStats();
      if (currentView === 'bans') {
        fetchBans().catch(() => { });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '批量操作失败';
      showToast(message, 'error');
    }
  };

  const openBulkReportModal = () => {
    if (selectedReports.size === 0) {
      showToast('请先选择举报', 'warning');
      return;
    }
    setBulkReportModal({ isOpen: true, reason: '' });
  };

  const confirmBulkReportAction = async () => {
    const ids = Array.from(selectedReports);
    try {
      await api.batchAdminReports('resolve', ids, bulkReportModal.reason);
      showToast('已标记处理', 'success');
      setSelectedReports(new Set());
      setBulkReportModal({ isOpen: false, reason: '' });
      await loadReports();
      setReportsLoaded(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : '批量处理失败';
      showToast(message, 'error');
    }
  };

  const openEditModal = (post: AdminPost) => {
    setEditModal({ isOpen: true, postId: post.id, content: post.content, preview: false, reason: '' });
  };

  const confirmEdit = async () => {
    const { postId, content, reason } = editModal;
    const trimmed = content.trim();
    if (!trimmed) {
      showToast('内容不能为空哦！', 'warning');
      return;
    }
    if (trimmed.length > composeMaxLength) {
      showToast('内容超过字数限制！', 'error');
      return;
    }
    try {
      await api.updateAdminPost(postId, trimmed, reason);
      showToast('帖子已更新', 'success');
      setEditModal({ isOpen: false, postId: '', content: '', preview: false, reason: '' });
      await fetchAdminPosts();
    } catch (error) {
      const message = error instanceof Error ? error.message : '编辑失败，请稍后重试';
      showToast(message, 'error');
    }
  };

  const handleUnban = async (type: 'ip' | 'fingerprint' | 'identity', value: string, reason = '') => {
    await api.handleAdminBan('unban', type, value, reason);
    showToast('已解除封禁', 'success');
    await fetchBans();
    await loadStats();
  };

  const getBanTargetLabel = (type: 'ip' | 'fingerprint' | 'identity') => {
    if (type === 'ip') {
      return 'IP';
    }
    if (type === 'fingerprint') {
      return '指纹';
    }
    return '身份';
  };

  const openBanRecordDrawer = (item: { type: 'ip' | 'fingerprint' | 'identity'; value: string; reason?: string | null; permissions?: string[]; expiresAt?: number | null; identityKey?: string | null; identityHashes?: string[]; fingerprint?: string | null; }) => {
    const { defaultDuration, defaultCustomUntil } = resolveDurationDefaults(item.expiresAt);
    openModerationDrawer({
      title: '封禁详情',
      description: '可直接调整权限、时长，或在抽屉内执行解封。',
      identity: item.type === 'ip' ? undefined : {
        identityKey: item.identityKey || null,
        identityHashes: item.identityHashes || [],
        fingerprint: item.fingerprint || null,
      },
      target: { type: item.type, value: item.value, editable: false },
      defaultReason: item.reason || '',
      defaultPermissions: item.permissions?.length ? item.permissions : DEFAULT_BAN_PERMISSIONS,
      defaultDuration,
      defaultCustomUntil,
      quickPresets: DEFAULT_BAN_PRESETS,
      submitLabel: '更新封禁',
      secondaryActionLabel: '解除封禁',
      onSubmit: async (payload) => {
        await api.handleAdminBan('ban', item.type, item.value, payload.reason.trim(), buildBanOptionsFromPayload(payload));
        showToast('封禁已更新', 'success');
        await fetchBans();
        await loadStats();
      },
      onSecondaryAction: async (payload) => {
        await handleUnban(item.type, item.value, payload.reason.trim());
      },
    });
  };

  const handleFeedbackRead = async (feedbackId: string) => {
    try {
      await api.handleAdminFeedback(feedbackId, 'read');
      showToast('已标记已读', 'success');
      await fetchFeedback();
      await fetchFeedbackUnreadCount();
    } catch (error) {
      const message = error instanceof Error ? error.message : '标记失败';
      showToast(message, 'error');
    }
  };

  const openFeedbackActionModal = (message: FeedbackMessage, action: 'delete' | 'ban') => {
    if (action === 'ban') {
      openModerationDrawer({
        title: '留言用户封禁',
        description: '沿用留言封禁接口，可直接设置权限与时长。',
        summary: message.content,
        identity: message,
        defaultPermissions: DEFAULT_BAN_PERMISSIONS,
        defaultDuration: '7d',
        quickPresets: DEFAULT_BAN_PRESETS,
        submitLabel: '确认封禁',
        onSubmit: async (payload) => {
          await api.handleAdminFeedback(message.id, 'ban', payload.reason.trim(), buildBanOptionsFromPayload(payload));
          showToast('已封禁该用户', 'success');
          await fetchFeedback();
          await fetchFeedbackUnreadCount();
          fetchBans().catch(() => { });
          loadStats().catch(() => { });
        },
      });
      return;
    }
    setFeedbackActionModal({
      isOpen: true,
      feedbackId: message.id,
      action,
      content: message.content,
      reason: '',
    });
  };

  const confirmFeedbackAction = async () => {
    const { feedbackId, action, reason } = feedbackActionModal;
    try {
      await api.handleAdminFeedback(feedbackId, action, reason);
      showToast('留言已删除', 'success');
      setFeedbackActionModal({ isOpen: false, feedbackId: '', action: 'delete', content: '', reason: '' });
      await fetchFeedback();
      await fetchFeedbackUnreadCount();
    } catch (error) {
      const message = error instanceof Error ? error.message : '操作失败';
      showToast(message, 'error');
    }
  };

  const handleComposeSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = composeText.trim();
    if (!trimmed) {
      showToast('内容不能为空哦！', 'warning');
      return;
    }
    if (trimmed.length > composeMaxLength) {
      showToast('内容超过字数限制！', 'error');
      return;
    }
    setComposeSubmitting(true);
    try {
      await api.createAdminPost(trimmed, [], { includeDeveloper: composeIncludeDeveloper });
      showToast('投稿成功！', 'success');
      setComposeText('');
      loadStats().catch(() => { });
    } catch (error) {
      const message = error instanceof Error ? error.message : '投稿失败，请稍后重试';
      showToast(message, 'error');
    } finally {
      setComposeSubmitting(false);
    }
  };

  const handleAnnouncementSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = announcementText.trim();
    if (!trimmed) {
      showToast('公告内容不能为空', 'warning');
      return;
    }
    if (trimmed.length > 5000) {
      showToast('公告内容过长', 'error');
      return;
    }
    setAnnouncementSubmitting(true);
    try {
      const data = await api.updateAdminAnnouncement(trimmed);
      setAnnouncementUpdatedAt(typeof data?.updatedAt === 'number' ? data.updatedAt : Date.now());
      showToast('公告已更新', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '公告发布失败';
      showToast(message, 'error');
    } finally {
      setAnnouncementSubmitting(false);
    }
  };

  const handleUpdateAnnouncementSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = updateAnnouncementText.trim();
    if (!trimmed) {
      showToast('更新公告内容不能为空', 'warning');
      return;
    }
    if (trimmed.length > 5000) {
      showToast('更新公告内容过长', 'error');
      return;
    }
    setUpdateAnnouncementSubmitting(true);
    try {
      await api.createAdminUpdateAnnouncement(trimmed);
      showToast('更新公告已发布', 'success');
      setUpdateAnnouncementText('');
      await fetchUpdateAnnouncements();
    } catch (error) {
      const message = error instanceof Error ? error.message : '更新公告发布失败';
      showToast(message, 'error');
    } finally {
      setUpdateAnnouncementSubmitting(false);
    }
  };

  const handleAnnouncementClear = async () => {
    setAnnouncementSubmitting(true);
    try {
      await api.clearAdminAnnouncement();
      setAnnouncementText('');
      setAnnouncementUpdatedAt(null);
      showToast('公告已清空', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '公告清空失败';
      showToast(message, 'error');
    } finally {
      setAnnouncementSubmitting(false);
    }
  };

  const handleUpdateAnnouncementDelete = async (id: string) => {
    setUpdateAnnouncementSubmitting(true);
    try {
      await api.deleteAdminUpdateAnnouncement(id);
      setUpdateAnnouncements((prev) => prev.filter((item) => item.id !== id));
      showToast('更新公告已删除', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '更新公告删除失败';
      showToast(message, 'error');
    } finally {
      setUpdateAnnouncementSubmitting(false);
    }
  };

  const handleSettingsSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const rawDefaultTags = defaultPostTagsInput.trim();
    const defaultPostTags = parseDefaultPostTagsInput(defaultPostTagsInput);
    const normalizedRateLimits = normalizeRateLimits(rateLimits);
    const normalizedAutoHideReportThreshold = normalizeAutoHideReportThreshold(autoHideReportThreshold);
    const trimmedWecomWebhookUrl = wecomWebhookUrlInput.trim();
    if (rawDefaultTags && defaultPostTags.length === 0) {
      showToast(`默认标签格式无效，请用逗号或换行分隔，并确保每个标签不超过${MAX_TAG_LENGTH}字`, 'warning');
      return;
    }
    if (wecomWebhookEnabled && !trimmedWecomWebhookUrl && (!wecomWebhookConfigured || wecomWebhookClearUrl)) {
      showToast('启用企业微信提醒前，请先填写机器人 Webhook 地址', 'warning');
      return;
    }
    for (const item of RATE_LIMIT_FIELDS) {
      const config = rateLimits[item.key];
      const windowSeconds = Math.round(config.windowMs / 1000);
      if (!Number.isInteger(config.limit) || config.limit < 1) {
        showToast(`${item.label}的次数至少为 1`, 'warning');
        return;
      }
      if (!Number.isInteger(windowSeconds) || windowSeconds < 1) {
        showToast(`${item.label}的时间窗口至少为 1 秒`, 'warning');
        return;
      }
    }
    setSettingsSubmitting(true);
    try {
      const data = await api.updateAdminSettings({
        turnstileEnabled,
        cnyThemeEnabled,
        defaultPostTags,
        rateLimits: normalizedRateLimits,
        autoHideReportThreshold: normalizedAutoHideReportThreshold,
        wecomWebhook: {
          enabled: wecomWebhookEnabled,
          ...(trimmedWecomWebhookUrl ? { url: trimmedWecomWebhookUrl } : {}),
          ...(wecomWebhookClearUrl ? { clearUrl: true } : {}),
        },
      });
      setTurnstileEnabled(Boolean(data?.turnstileEnabled));
      setCnyThemeEnabled(Boolean(data?.cnyThemeEnabled));
      setCnyThemeAutoActive(Boolean(data?.cnyThemeAutoActive));
      setCnyThemeActive(Boolean(data?.cnyThemeActive));
      setDefaultPostTagsInput(formatDefaultPostTagsInput(data?.defaultPostTags));
      setRateLimits(normalizeRateLimits(data?.rateLimits));
      setAutoHideReportThreshold(normalizeAutoHideReportThreshold(data?.autoHideReportThreshold));
      setWecomWebhookEnabled(Boolean(data?.wecomWebhook?.enabled));
      setWecomWebhookConfigured(Boolean(data?.wecomWebhook?.configured));
      setWecomWebhookMaskedUrl(String(data?.wecomWebhook?.maskedUrl || ''));
      setWecomWebhookUrlInput('');
      setWecomWebhookClearUrl(false);
      loadSettings().catch(() => { });
      showToast('设置已更新', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '设置保存失败';
      showToast(message, 'error');
    } finally {
      setSettingsSubmitting(false);
    }
  };

  const handleWecomWebhookTest = async () => {
    const trimmedWecomWebhookUrl = wecomWebhookUrlInput.trim();
    if (!trimmedWecomWebhookUrl && !wecomWebhookConfigured) {
      showToast('请先填写企业微信机器人 Webhook 地址', 'warning');
      return;
    }
    setWecomWebhookTesting(true);
    try {
      await api.testAdminWecomWebhook(trimmedWecomWebhookUrl ? { url: trimmedWecomWebhookUrl } : {});
      showToast('测试消息已发送', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '测试推送失败';
      showToast(message, 'error');
    } finally {
      setWecomWebhookTesting(false);
    }
  };

  const handleVocabularyAdd = async (event: React.FormEvent) => {
    event.preventDefault();
    const word = vocabularyNewWord.trim();
    if (!word) {
      showToast('请输入违禁词', 'warning');
      return;
    }
    setVocabularySubmitting(true);
    try {
      await api.addAdminVocabulary(word);
      setVocabularyNewWord('');
      setVocabularyPage(1);
      await fetchVocabulary({ page: 1 });
      showToast('已添加违禁词', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '违禁词添加失败';
      showToast(message, 'error');
    } finally {
      setVocabularySubmitting(false);
    }
  };

  const handleVocabularyToggle = async (id: number, enabled: boolean) => {
    setVocabularySubmitting(true);
    try {
      await api.toggleAdminVocabulary(id, enabled);
      await fetchVocabulary();
      showToast(enabled ? '已启用' : '已停用', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '更新失败';
      showToast(message, 'error');
    } finally {
      setVocabularySubmitting(false);
    }
  };

  const handleVocabularyDelete = async (id: number) => {
    if (!window.confirm('确认删除该词？')) {
      return;
    }
    setVocabularySubmitting(true);
    try {
      await api.deleteAdminVocabulary(id);
      await fetchVocabulary();
      showToast('已删除', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '删除失败';
      showToast(message, 'error');
    } finally {
      setVocabularySubmitting(false);
    }
  };

  const handleVocabularyImport = async () => {
    setVocabularySubmitting(true);
    try {
      const data = await api.importAdminVocabulary();
      await fetchVocabulary();
      showToast(`已导入 ${Number(data?.added || 0)} / ${Number(data?.total || 0)} 条`, 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '导入失败';
      showToast(message, 'error');
    } finally {
      setVocabularySubmitting(false);
    }
  };

  const handleVocabularyExport = async () => {
    setVocabularySubmitting(true);
    try {
      const data = await api.exportAdminVocabulary();
      const content = String(data?.content || '');
      if (!content) {
        showToast('暂无可导出词', 'warning');
        return;
      }
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(content);
        showToast('已复制到剪贴板', 'success');
      } else {
        showToast('浏览器不支持剪贴板', 'warning');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '导出失败';
      showToast(message, 'error');
    } finally {
      setVocabularySubmitting(false);
    }
  };

  const formatAnnouncementTime = (value: number | null) => {
    if (!value) {
      return '';
    }
    return new Date(value).toLocaleString('zh-CN');
  };

  const NavItem: React.FC<{ view: AdminView; icon: React.ReactNode; label: string; badge?: number; onSelect?: () => void }> = ({ view, icon, label, badge, onSelect }) => (
    <button
      onClick={() => {
        setCurrentView(view);
        if (onSelect) {
          onSelect();
        }
      }}
      className={`flex items-center gap-3 px-4 py-3 rounded-lg border-2 transition-all w-full text-left ${currentView === view
        ? 'border-ink bg-highlight shadow-sketch-sm'
        : 'border-transparent hover:border-ink hover:bg-white'
        }`}
    >
      {icon}
      <span>{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="ml-auto rounded-full bg-red-500 px-2 py-0.5 text-xs text-white shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">{badge}</span>
      )}
    </button>
  );

  const totalPostPages = Math.max(Math.ceil(postTotal / POST_PAGE_SIZE), 1);
  const totalHiddenPages = Math.max(Math.ceil(hiddenTotal / HIDDEN_PAGE_SIZE), 1);
  const isReportView = currentView === 'reports' || currentView === 'processed';
  const isPostView = currentView === 'posts';
  const isHiddenView = currentView === 'hidden';
  const isBanView = currentView === 'bans';
  const isAuditView = currentView === 'audit';
  const isFeedbackView = currentView === 'feedback';
  const totalAuditPages = Math.max(Math.ceil(auditTotal / AUDIT_PAGE_SIZE), 1);
  const totalFeedbackPages = Math.max(Math.ceil(feedbackTotal / FEEDBACK_PAGE_SIZE), 1);

  return (
    <div className="admin-font flex min-h-screen-safe bg-paper overflow-hidden overflow-x-hidden">
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 flex flex-col border-r-2 border-ink bg-paper z-20 hidden md:flex">
        <div className="p-6">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-full bg-ink border-2 border-ink flex items-center justify-center text-white">
              <LayoutDashboard size={20} />
            </div>
            <div>
              <h1 className="font-display text-xl leading-none">衙门</h1>
              <span className="text-xs text-pencil font-sans">管理员后台</span>
            </div>
          </div>

          <nav className="flex flex-col gap-3 font-sans font-bold text-sm">
            <NavItem view="overview" icon={<LayoutDashboard size={18} />} label="概览" />
            <NavItem view="posts" icon={<FileText size={18} />} label="帖子管理" />
            <NavItem view="hidden" icon={<EyeOff size={18} />} label="隐藏内容" />
            <NavItem view="announcement" icon={<Bell size={18} />} label="发布中心" />
            <NavItem view="settings" icon={<Settings size={18} />} label="系统设置" />
            <NavItem view="wiki" icon={<BookOpen size={18} />} label="瓜条审核" badge={wikiPendingCount} />
            <NavItem view="rumors" icon={<AlertTriangle size={18} />} label="谣言审核" badge={rumorPendingCount} />
            <NavItem view="feedback" icon={<MessageSquare size={18} />} label="留言管理" badge={feedbackUnreadCount} />
            <NavItem view="chat" icon={<MessageSquare size={18} />} label="聊天室管理" />
            <NavItem view="reports" icon={<Flag size={18} />} label="待处理举报" badge={pendingReportCount} />
            <NavItem view="processed" icon={<Gavel size={18} />} label="已处理" />
            <NavItem view="bans" icon={<Shield size={18} />} label="封禁管理" />
            <NavItem view="audit" icon={<ClipboardList size={18} />} label="操作审计" />
          </nav>
        </div>
        <div className="mt-auto p-6 border-t-2 border-ink/10">
          <button
            onClick={() => {
              logoutAdmin().catch(() => { });
            }}
            className="flex items-center gap-2 text-pencil hover:text-red-500 font-bold text-sm transition-colors"
          >
            <LogOut size={16} /> 退出登录
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Header */}
        <header className="min-h-[72px] sm:h-20 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 md:px-8 border-b-2 border-ink bg-paper/90 backdrop-blur-sm z-10 py-3 sm:py-0">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="md:hidden p-2 border-2 border-ink rounded-full bg-white shadow-sketch-sm"
              aria-label="打开菜单"
            >
              <Menu size={18} />
            </button>
            <h2 className="text-xl sm:text-2xl font-display flex items-center gap-2 flex-wrap">
              {currentView === 'overview' && <><LayoutDashboard /> 概览</>}
              {currentView === 'posts' && <><FileText /> 帖子管理</>}
              {currentView === 'hidden' && <><EyeOff /> 隐藏内容</>}
              {currentView === 'announcement' && <><Bell /> 公告发布</>}
              {currentView === 'settings' && <><Settings /> 系统设置</>}
              {currentView === 'wiki' && <><BookOpen /> 瓜条审核</>}
              {currentView === 'rumors' && <><AlertTriangle /> 谣言审核</>}
              {currentView === 'feedback' && <><MessageSquare /> 留言管理</>}
              {currentView === 'chat' && <><MessageSquare /> 聊天室管理</>}
              {currentView === 'reports' && <><Flag /> 待处理举报</>}
              {currentView === 'processed' && <><Gavel /> 已处理</>}
              {currentView === 'bans' && <><Shield /> 封禁管理</>}
              {currentView === 'audit' && <><ClipboardList /> 操作审计</>}
            </h2>
          </div>
          <div className="flex flex-wrap sm:flex-nowrap items-center gap-3 w-full sm:w-auto">
            {(isReportView || isPostView || isHiddenView || isAuditView || isFeedbackView) && (
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-pencil w-4 h-4" />
                <input
                  type="text"
                  value={isPostView ? postSearch : isHiddenView ? hiddenSearch : isAuditView ? auditSearch : isFeedbackView ? feedbackSearch : searchQuery}
                  onChange={(e) => {
                    if (isPostView) {
                      setPostSearch(e.target.value);
                      setPostPage(1);
                    } else if (isHiddenView) {
                      setHiddenSearch(e.target.value);
                      setHiddenPage(1);
                    } else if (isAuditView) {
                      setAuditSearch(e.target.value);
                      setAuditPage(1);
                    } else if (isFeedbackView) {
                      setFeedbackSearch(e.target.value);
                      setFeedbackPage(1);
                    } else {
                      setSearchQuery(e.target.value);
                    }
                  }}
                  placeholder={isPostView ? '搜索帖子或评论内容/ID/IP/身份...' : isHiddenView ? '搜索隐藏帖子或评论/ID/IP/身份...' : isAuditView ? '搜索操作/目标/管理员...' : isFeedbackView ? '搜索内容或联系方式/IP/身份...' : '搜索 ID/内容/IP/身份...'}
                  className="pl-9 pr-4 py-2 rounded-full border-2 border-ink bg-white text-sm focus:shadow-sketch-sm outline-none transition-all w-full font-sans"
                />
              </div>
            )}
            <button className="relative p-2 border-2 border-transparent hover:border-ink rounded-full hover:bg-highlight transition-all">
              <Bell size={20} />
              {pendingReportCount > 0 && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full border border-ink"></span>
              )}
            </button>
          </div>
        </header>

        {mobileNavOpen && (
          <div className="fixed inset-0 z-40 md:hidden">
            <button
              type="button"
              className="absolute inset-0 bg-black/40"
              aria-label="关闭菜单"
              onClick={() => setMobileNavOpen(false)}
            />
            <div className="absolute left-0 top-0 h-full w-72 bg-paper border-r-2 border-ink p-6 flex flex-col">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-full bg-ink border-2 border-ink flex items-center justify-center text-white">
                    <LayoutDashboard size={18} />
                  </div>
                  <div>
                    <h1 className="font-display text-lg leading-none">衙门</h1>
                    <span className="text-xs text-pencil font-sans">管理员后台</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileNavOpen(false)}
                  className="p-2 border-2 border-ink rounded-full bg-white shadow-sketch-sm"
                  aria-label="关闭菜单"
                >
                  <X size={16} />
                </button>
              </div>
              <nav className="flex flex-col gap-3 font-sans font-bold text-sm">
                <NavItem view="overview" icon={<LayoutDashboard size={18} />} label="概览" onSelect={() => setMobileNavOpen(false)} />
                <NavItem view="posts" icon={<FileText size={18} />} label="帖子管理" onSelect={() => setMobileNavOpen(false)} />
                <NavItem view="hidden" icon={<EyeOff size={18} />} label="隐藏内容" onSelect={() => setMobileNavOpen(false)} />
                <NavItem view="announcement" icon={<Bell size={18} />} label="公告发布" onSelect={() => setMobileNavOpen(false)} />
                <NavItem view="settings" icon={<Settings size={18} />} label="系统设置" onSelect={() => setMobileNavOpen(false)} />
                <NavItem view="wiki" icon={<BookOpen size={18} />} label="瓜条审核" badge={wikiPendingCount} onSelect={() => setMobileNavOpen(false)} />
                <NavItem view="rumors" icon={<AlertTriangle size={18} />} label="谣言审核" badge={rumorPendingCount} onSelect={() => setMobileNavOpen(false)} />
                <NavItem view="feedback" icon={<MessageSquare size={18} />} label="留言管理" badge={feedbackUnreadCount} onSelect={() => setMobileNavOpen(false)} />
                <NavItem view="chat" icon={<MessageSquare size={18} />} label="聊天室管理" onSelect={() => setMobileNavOpen(false)} />
                <NavItem view="reports" icon={<Flag size={18} />} label="待处理举报" badge={pendingReportCount} onSelect={() => setMobileNavOpen(false)} />
                <NavItem view="processed" icon={<Gavel size={18} />} label="已处理" onSelect={() => setMobileNavOpen(false)} />
                <NavItem view="bans" icon={<Shield size={18} />} label="封禁管理" onSelect={() => setMobileNavOpen(false)} />
                <NavItem view="audit" icon={<ClipboardList size={18} />} label="操作审计" onSelect={() => setMobileNavOpen(false)} />
              </nav>
              <div className="mt-auto pt-6 border-t-2 border-ink/10">
                <button
                  onClick={() => {
                    setMobileNavOpen(false);
                    logoutAdmin().catch(() => { });
                  }}
                  className="flex items-center gap-2 text-pencil hover:text-red-500 font-bold text-sm transition-colors"
                >
                  <LogOut size={16} /> 退出登录
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8">
          <div className="max-w-6xl mx-auto flex flex-col gap-8">

            {/* Overview View */}
            {currentView === 'overview' && (
              <AdminOverviewView
                todayReports={state.stats.todayReports}
                pendingReportCount={pendingReportCount}
                bannedUsers={state.stats.bannedUsers}
                totalPosts={state.stats.totalPosts}
                totalVisits={state.stats.totalVisits}
                onlineCount={state.stats.onlineCount}
                totalWeeklyVisits={totalWeeklyVisits}
                appVersionLabel={appVersionLabel}
                postVolumeData={postVolumeData}
                visitData={visitData}
                visiblePendingReports={visiblePendingReports}
                onOpenReports={() => setCurrentView('reports')}
                onReportAction={handleAction}
                onReportDetail={(item) => setReportDetail({ isOpen: true, report: item })}
                renderIdentity={renderIdentity}
              />
            )}

            {/* Posts View */}
            {currentView === 'posts' && (
              <section>
                <div className="flex flex-col gap-3 mb-6">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-xs text-pencil font-sans">状态</span>
                    {(['all', 'active', 'hidden', 'deleted'] as PostStatusFilter[]).map((status) => (
                      <button
                        key={status}
                        onClick={() => {
                          setPostStatus(status);
                          setPostPage(1);
                        }}
                        className={`px-3 py-1 text-xs font-bold rounded-full border-2 transition-all ${postStatus === status ? 'border-ink bg-highlight' : 'border-transparent bg-white hover:border-ink'
                          }`}
                      >
                        {status === 'all' ? '全部' : status === 'active' ? '正常' : status === 'hidden' ? '已隐藏' : '已删除'}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-xs text-pencil font-sans">排序</span>
                    {(['time', 'hot', 'reports'] as PostSort[]).map((sort) => (
                      <button
                        key={sort}
                        onClick={() => {
                          setPostSort(sort);
                          setPostPage(1);
                        }}
                        className={`px-3 py-1 text-xs font-bold rounded-full border-2 transition-all ${postSort === sort ? 'border-ink bg-highlight' : 'border-transparent bg-white hover:border-ink'
                          }`}
                      >
                        {sort === 'time' ? '时间' : sort === 'hot' ? '热度' : '举报数'}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center justify-between text-xs text-pencil font-sans">
                    <span>共 {postTotal} 条</span>
                    <span>第 {postPage} / {totalPostPages} 页</span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-sans">
                    <label className="flex items-center gap-2 text-pencil">
                      <input
                        type="checkbox"
                        className="accent-black"
                        checked={postItems.length > 0 && postItems.every((post) => selectedPosts.has(post.id))}
                        onChange={toggleAllPosts}
                      />
                      本页全选
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-pencil">已选 {selectedPosts.size} 条</span>
                      <SketchButton
                        variant="danger"
                        className="h-8 px-3 text-xs"
                        disabled={selectedPosts.size === 0}
                        onClick={() => openBulkPostModal('delete')}
                      >
                        批量删除
                      </SketchButton>
                      <SketchButton
                        variant="secondary"
                        className="h-8 px-3 text-xs"
                        disabled={selectedPosts.size === 0}
                        onClick={() => openBulkPostModal('restore')}
                      >
                        批量恢复
                      </SketchButton>
                      <SketchButton
                        variant="secondary"
                        className="h-8 px-3 text-xs"
                        disabled={selectedPosts.size === 0}
                        onClick={() => openBulkPostModal('ban')}
                      >
                        批量封禁
                      </SketchButton>
                      <SketchButton
                        variant="secondary"
                        className="h-8 px-3 text-xs"
                        disabled={selectedPosts.size === 0}
                        onClick={() => openBulkPostModal('unban')}
                      >
                        批量解封
                      </SketchButton>
                    </div>
                  </div>
                </div>

                {postLoading ? (
                  <div className="text-center py-16 bg-white border-2 border-ink rounded-lg">
                    <span className="text-6xl mb-4 block">⏳</span>
                    <h3 className="font-display text-2xl text-ink mb-2">正在加载帖子</h3>
                    <p className="font-hand text-lg text-pencil">请稍等片刻</p>
                  </div>
                ) : postItems.length === 0 ? (
                  <div className="text-center py-16 bg-white border-2 border-ink rounded-lg">
                    <span className="text-6xl mb-4 block">🗂️</span>
                    <h3 className="font-display text-2xl text-ink mb-2">暂无帖子</h3>
                    <p className="font-hand text-lg text-pencil">调整筛选条件试试</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-4">
                    {postItems.map((post) => (
                      <div key={post.id} className="bg-white p-5 rounded-lg border-2 border-ink shadow-sketch-sm hover:shadow-sketch transition-all">
                        <div className="flex flex-col md:flex-row gap-6 justify-between items-start">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-3 flex-wrap">
                              <input
                                type="checkbox"
                                className="accent-black"
                                checked={selectedPosts.has(post.id)}
                                onChange={() => togglePostSelection(post.id)}
                              />
                              <span className="bg-gray-100 border border-ink text-ink text-[10px] font-bold px-2 py-0.5 rounded font-sans">ID: #{post.id}</span>
                              <span className="text-pencil text-xs font-bold font-sans">{post.timestamp}</span>
                              <Badge color={post.deleted ? 'bg-gray-200' : post.hidden ? 'bg-yellow-100' : 'bg-highlight'}>
                                {post.deleted ? '已删除' : post.hidden ? '已隐藏' : '正常'}
                              </Badge>
                              <span className="text-ink text-xs flex items-center gap-1 border border-ink px-2 py-0.5 rounded font-bold font-sans">
                                举报 {post.reports}
                              </span>
                              {(post.pendingReportCount || 0) > 0 && (
                                <span className="text-ink text-xs flex items-center gap-1 border border-ink px-2 py-0.5 rounded font-bold font-sans bg-yellow-50">
                                  待处理 {post.pendingReportCount}
                                </span>
                              )}
                            </div>
                            <p className="text-ink text-base leading-relaxed font-sans font-semibold line-clamp-2">
                              "{postSearch.trim() ? getHighlightedText(post.content, postSearch.trim()) : post.content}"
                            </p>
                            {postSearch.trim() && (post.matchedCommentCount || 0) > 0 && (
                              <div className="mt-3 rounded-lg border border-dashed border-ink/40 bg-highlight/10 p-3">
                                <div className="text-xs font-sans text-pencil mb-2">
                                  评论命中 {post.matchedCommentCount} 条，已展开前 3 条：
                                </div>
                                <div className="flex flex-col gap-3">
                                  {(post.matchedComments || []).map((comment) => (
                                    <div key={comment.id} className="border-l-2 border-ink/40 pl-3">
                                      <div className="text-[11px] text-pencil font-sans mb-1">
                                        <span className="bg-gray-100 border border-ink text-ink text-[10px] font-bold px-2 py-0.5 rounded font-sans">#{comment.id}</span>
                                        <span className="ml-2">{comment.timestamp}</span>
                                        {comment.deleted && <span className="ml-2 text-xs text-pencil">已删除</span>}
                                        {!comment.deleted && comment.hidden && <span className="ml-2 text-xs text-pencil">已隐藏</span>}
                                      </div>
                                      <p className="text-sm font-sans text-ink">
                                        {getHighlightedText(comment.content || '（无内容）', postSearch.trim())}
                                      </p>
                                    </div>
                                  ))}
                                  <button
                                    type="button"
                                    className="text-xs font-bold text-ink hover:underline w-fit"
                                    onClick={() => openPostComments(post)}
                                  >
                                    展开全部评论
                                  </button>
                                </div>
                              </div>
                            )}
                            <div className="flex flex-wrap items-center gap-4 text-xs text-pencil font-sans mt-3">
                              <span>点赞 {post.likes}</span>
                              <span>评论 {post.comments}</span>
                              <span>举报 {post.reports}</span>
                              {(post.pendingReportCount || 0) > 0 && <span>待处理举报 {post.pendingReportCount}</span>}
                              {renderIdentity(post)}
                            </div>
                          </div>
                          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 min-w-fit mt-2 md:mt-0 font-sans">
                            <SketchButton
                              variant="secondary"
                              className="h-10 px-3 text-xs flex items-center gap-1"
                              onClick={() => openPostComments(post)}
                            >
                              <MessageSquare size={14} /> 评论
                            </SketchButton>
                            <SketchButton
                              variant="secondary"
                              className="h-10 px-3 text-xs flex items-center gap-1"
                              onClick={() => openEditModal(post)}
                            >
                              <Pencil size={14} /> 编辑
                            </SketchButton>
                            <SketchButton
                              variant="primary"
                              className="h-10 px-3 text-xs flex items-center gap-1 text-white"
                              onClick={() => openPostBanDrawer(post)}
                            >
                              <Ban size={14} /> 封禁
                            </SketchButton>
                            {post.deleted ? (
                              <SketchButton
                                variant="secondary"
                                className="h-10 px-3 text-xs flex items-center gap-1"
                                onClick={() => handlePostAction(post.id, 'restore', post.content)}
                              >
                                <RotateCcw size={14} /> 恢复
                              </SketchButton>
                            ) : (
                              <SketchButton
                                variant="danger"
                                className="h-10 px-3 text-xs flex items-center gap-1"
                                onClick={() => handlePostAction(post.id, 'delete', post.content)}
                              >
                                <Trash2 size={14} /> 删除
                              </SketchButton>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {postItems.length > 0 && (
                  <div className="flex items-center justify-center gap-4 mt-6">
                    <SketchButton
                      variant="secondary"
                      className="px-4 py-2 text-sm"
                      disabled={postPage <= 1}
                      onClick={() => setPostPage((prev) => Math.max(prev - 1, 1))}
                    >
                      上一页
                    </SketchButton>
                    <span className="text-xs text-pencil font-sans">第 {postPage} / {totalPostPages} 页</span>
                    <SketchButton
                      variant="secondary"
                      className="px-4 py-2 text-sm"
                      disabled={postPage >= totalPostPages}
                      onClick={() => setPostPage((prev) => Math.min(prev + 1, totalPostPages))}
                    >
                      下一页
                    </SketchButton>
                  </div>
                )}
              </section>
            )}

            {/* Hidden Content View */}
            {currentView === 'hidden' && (
              <section>
                <div className="flex flex-col gap-3 mb-6">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-xs text-pencil font-sans">类型</span>
                    {(['all', 'post', 'comment'] as HiddenTypeFilter[]).map((type) => (
                      <button
                        key={type}
                        onClick={() => {
                          setHiddenType(type);
                          setHiddenPage(1);
                        }}
                        className={`px-3 py-1 text-xs font-bold rounded-full border-2 transition-all ${hiddenType === type ? 'border-ink bg-highlight' : 'border-transparent bg-white hover:border-ink'
                          }`}
                      >
                        {type === 'all' ? '全部' : type === 'post' ? '帖子' : '评论'}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-xs text-pencil font-sans">审核</span>
                    {(['pending', 'kept', 'all'] as HiddenReviewFilter[]).map((review) => (
                      <button
                        key={review}
                        onClick={() => {
                          setHiddenReview(review);
                          setHiddenPage(1);
                        }}
                        className={`px-3 py-1 text-xs font-bold rounded-full border-2 transition-all ${hiddenReview === review ? 'border-ink bg-highlight' : 'border-transparent bg-white hover:border-ink'
                          }`}
                      >
                        {review === 'pending' ? '待处理' : review === 'kept' ? '已保持隐藏' : '全部'}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center justify-between text-xs text-pencil font-sans">
                    <span>共 {hiddenTotal} 条</span>
                    <span>第 {hiddenPage} / {totalHiddenPages} 页</span>
                  </div>
                </div>

                {hiddenLoading ? (
                  <div className="text-center py-16 bg-white border-2 border-ink rounded-lg">
                    <span className="text-6xl mb-4 block">🙈</span>
                    <h3 className="font-display text-2xl text-ink mb-2">正在加载隐藏内容</h3>
                    <p className="font-hand text-lg text-pencil">请稍等片刻</p>
                  </div>
                ) : hiddenItems.length === 0 ? (
                  <div className="text-center py-16 bg-white border-2 border-ink rounded-lg">
                    <span className="text-6xl mb-4 block">🧹</span>
                    <h3 className="font-display text-2xl text-ink mb-2">暂无隐藏内容</h3>
                    <p className="font-hand text-lg text-pencil">当前筛选条件下没有需要处理的内容</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-4">
                    {hiddenItems.map((item) => (
                      <div key={`${item.type}-${item.id}`} className="bg-white p-5 rounded-lg border-2 border-ink shadow-sketch-sm hover:shadow-sketch transition-all">
                        <div className="flex flex-col md:flex-row gap-6 justify-between items-start">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-3 flex-wrap">
                              <span className={`text-xs flex items-center gap-1 border border-ink px-2 py-0.5 rounded font-bold font-sans ${item.type === 'post' ? 'bg-blue-50 text-blue-700' : 'bg-orange-50 text-orange-700'}`}>
                                {item.type === 'post' ? '隐藏帖子' : '隐藏评论'}
                              </span>
                              <span className="bg-gray-100 border border-ink text-ink text-[10px] font-bold px-2 py-0.5 rounded font-sans">ID: #{item.id}</span>
                              <span className="text-pencil text-xs font-bold font-sans">{item.timestamp}</span>
                              <Badge color={item.hiddenReviewStatus === 'kept' ? 'bg-yellow-100' : 'bg-highlight'}>
                                {item.hiddenReviewStatus === 'kept' ? '已保持隐藏' : '待处理'}
                              </Badge>
                              <span className="text-ink text-xs flex items-center gap-1 border border-ink px-2 py-0.5 rounded font-bold font-sans">
                                待处理举报 {item.pendingReportCount || 0}
                              </span>
                            </div>

                            {item.type === 'comment' && (
                              <div className="mb-3 rounded-lg border border-dashed border-ink/40 bg-gray-50 p-3">
                                <div className="text-[11px] text-pencil font-sans mb-1">
                                  <span>所属帖子 #{item.postId || '-'}</span>
                                  {item.parentId && <span className="ml-3">父评论 #{item.parentId}</span>}
                                  {item.replyToId && <span className="ml-3">回复 #{item.replyToId}</span>}
                                </div>
                                <p className="text-sm font-sans text-pencil line-clamp-2">
                                  {hiddenSearch.trim()
                                    ? getHighlightedText(item.postContent || '（无帖子内容）', hiddenSearch.trim())
                                    : (item.postContent || '（无帖子内容）')}
                                </p>
                              </div>
                            )}

                            <p className="text-ink text-base leading-relaxed font-sans font-semibold whitespace-pre-wrap break-words">
                              "{hiddenSearch.trim() ? getHighlightedText(item.content || '（无内容）', hiddenSearch.trim()) : (item.content || '（无内容）')}"
                            </p>

                            <div className="flex flex-wrap items-center gap-4 text-xs text-pencil font-sans mt-3">
                              <span>隐藏时间 {formatTimestamp(item.hiddenAt || null)}</span>
                              {item.type === 'post' && <span>内容类型 帖子</span>}
                              {item.type === 'comment' && <span>内容类型 评论</span>}
                              {renderIdentity(item)}
                            </div>
                          </div>

                          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 min-w-fit mt-2 md:mt-0 font-sans">
                            <SketchButton
                              variant="secondary"
                              className="h-10 px-3 text-xs flex items-center gap-1"
                              onClick={() => openHiddenActionModal(item, 'keep')}
                            >
                              <EyeOff size={14} /> 保持隐藏
                            </SketchButton>
                            <SketchButton
                              variant="primary"
                              className="h-10 px-3 text-xs flex items-center gap-1 text-white"
                              onClick={() => openHiddenActionModal(item, 'restore')}
                            >
                              <RotateCcw size={14} /> 恢复
                            </SketchButton>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {hiddenItems.length > 0 && (
                  <div className="flex items-center justify-center gap-4 mt-6">
                    <SketchButton
                      variant="secondary"
                      className="px-4 py-2 text-sm"
                      disabled={hiddenPage <= 1}
                      onClick={() => setHiddenPage((prev) => Math.max(prev - 1, 1))}
                    >
                      上一页
                    </SketchButton>
                    <span className="text-xs text-pencil font-sans">第 {hiddenPage} / {totalHiddenPages} 页</span>
                    <SketchButton
                      variant="secondary"
                      className="px-4 py-2 text-sm"
                      disabled={hiddenPage >= totalHiddenPages}
                      onClick={() => setHiddenPage((prev) => Math.min(prev + 1, totalHiddenPages))}
                    >
                      下一页
                    </SketchButton>
                  </div>
                )}
              </section>
            )}

            {/* Publish Center */}
            {currentView === 'announcement' && (
              <section className="space-y-6">
                <form
                  onSubmit={handleComposeSubmit}
                  className="bg-white p-6 border-2 border-ink rounded-lg shadow-sketch-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                    <div>
                      <h3 className="font-display text-xl">后台投稿</h3>
                      <p className="text-xs text-pencil font-sans">与前台投稿保持一致的 Markdown 发布方案</p>
                    </div>
                  </div>

                  <MarkdownComposeEditor
                    value={composeText}
                    onChange={setComposeText}
                    placeholder="在后台发布内容... 支持 Markdown、图片和表情包"
                    maxLength={composeMaxLength}
                    minHeight="280px"
                    ariaLabel="后台投稿 Markdown 编辑器"
                    showToast={showToast}
                  />

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
                    <label className="flex items-center gap-2 text-sm font-sans text-pencil select-none">
                      <input
                        type="checkbox"
                        className="w-4 h-4"
                        checked={composeIncludeDeveloper}
                        onChange={(e) => setComposeIncludeDeveloper(e.target.checked)}
                      />
                      <span>附带开发者信息（显示 admin 名片）</span>
                    </label>
                    <SketchButton
                      type="submit"
                      className="h-10 px-6 text-sm"
                      disabled={composeSubmitting || !composeText.trim() || composeText.length > composeMaxLength}
                    >
                      {composeSubmitting ? '发布中...' : '发布'}
                    </SketchButton>
                  </div>
                </form>

                <form
                  onSubmit={handleAnnouncementSubmit}
                  className="bg-white p-6 border-2 border-ink rounded-lg shadow-sketch-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                    <div>
                      <h3 className="font-display text-xl">站点公告</h3>
                      <p className="text-xs text-pencil font-sans">仅保留当前一条公告</p>
                    </div>
                    {announcementUpdatedAt && (
                      <span className="text-xs text-pencil font-sans">更新时间：{formatAnnouncementTime(announcementUpdatedAt)}</span>
                    )}
                  </div>

                  <MarkdownComposeEditor
                    value={announcementText}
                    onChange={setAnnouncementText}
                    placeholder="发布公告内容... 支持 Markdown、图片和表情包"
                    maxLength={5000}
                    minHeight="240px"
                    ariaLabel="站点公告 Markdown 编辑器"
                    showToast={showToast}
                  />

                  <div className="mt-4 flex items-center justify-end gap-2">
                    <SketchButton
                      type="button"
                      variant="secondary"
                      className="h-10 px-4 text-sm"
                      onClick={handleAnnouncementClear}
                      disabled={announcementSubmitting || announcementLoading || !announcementText.trim()}
                    >
                      清空公告
                    </SketchButton>
                    <SketchButton
                      type="submit"
                      className="h-10 px-6 text-sm"
                      disabled={announcementSubmitting || announcementLoading || !announcementText.trim() || announcementText.length > 5000}
                    >
                      {announcementSubmitting ? '发布中...' : '发布公告'}
                    </SketchButton>
                  </div>
                </form>

                <div className="bg-white p-6 border-2 border-ink rounded-lg shadow-sketch-sm space-y-6">
                  <form onSubmit={handleUpdateAnnouncementSubmit}>
                    <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                      <div>
                        <h3 className="font-display text-xl">更新公告</h3>
                        <p className="text-xs text-pencil font-sans">保留历史多条，仅记录更新时间与更新内容</p>
                      </div>
                    </div>

                    <MarkdownComposeEditor
                      value={updateAnnouncementText}
                      onChange={setUpdateAnnouncementText}
                      placeholder="发布更新公告内容... 支持 Markdown、图片和表情包"
                      maxLength={5000}
                      minHeight="240px"
                      ariaLabel="更新公告 Markdown 编辑器"
                      showToast={showToast}
                    />

                    <div className="mt-4 flex items-center justify-end">
                      <SketchButton
                        type="submit"
                        className="h-10 px-6 text-sm"
                        disabled={updateAnnouncementSubmitting || !updateAnnouncementText.trim() || updateAnnouncementText.length > 5000}
                      >
                        {updateAnnouncementSubmitting ? '发布中...' : '发布更新公告'}
                      </SketchButton>
                    </div>
                  </form>

                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <h4 className="font-display text-lg">历史更新</h4>
                      <span className="text-xs text-pencil font-sans">{updateAnnouncements.length} 条</span>
                    </div>

                    {updateAnnouncementLoading ? (
                      <div className="text-center py-10 bg-gray-50 border-2 border-dashed border-gray-200 rounded-lg text-pencil font-hand">
                        正在加载更新公告...
                      </div>
                    ) : updateAnnouncements.length === 0 ? (
                      <div className="text-center py-10 bg-gray-50 border-2 border-dashed border-gray-200 rounded-lg text-pencil font-hand">
                        暂无更新公告
                      </div>
                    ) : (
                      <div className="flex flex-col gap-4">
                        {updateAnnouncements.map((item) => (
                          <div key={item.id} className="rounded-lg border-2 border-ink/10 bg-gray-50 p-4">
                            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                              <span className="text-xs text-pencil font-sans">更新时间：{formatAnnouncementTime(item.updatedAt)}</span>
                              <SketchButton
                                type="button"
                                variant="danger"
                                className="h-9 px-3 text-xs"
                                onClick={() => handleUpdateAnnouncementDelete(item.id)}
                                disabled={updateAnnouncementSubmitting}
                              >
                                删除
                              </SketchButton>
                            </div>
                            <MarkdownRenderer content={item.content} className="font-sans text-base text-ink" />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </section>
            )}

            {/* Settings View */}
            {currentView === 'settings' && (
              <section className="space-y-6">
                <form
                  onSubmit={handleSettingsSubmit}
                  className="bg-white p-6 border-2 border-ink rounded-lg shadow-sketch-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                    <div>
                      <h3 className="font-display text-xl">站点开关</h3>
                      <p className="text-xs text-pencil font-sans">保存后立即生效，无需重启服务</p>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <label className="flex items-center gap-3 text-sm font-sans">
                      <input
                        type="checkbox"
                        className="w-4 h-4"
                        checked={turnstileEnabled}
                        onChange={(e) => setTurnstileEnabled(e.target.checked)}
                        disabled={settingsLoading || settingsSubmitting}
                      />
                      <span>启用 Turnstile 验证</span>
                    </label>
                    <label className="flex items-center gap-3 text-sm font-sans">
                      <input
                        type="checkbox"
                        className="w-4 h-4"
                        checked={cnyThemeEnabled}
                        onChange={(e) => setCnyThemeEnabled(e.target.checked)}
                        disabled={settingsLoading || settingsSubmitting}
                      />
                      <span>启用春节皮肤（仅前台）</span>
                    </label>
                    <div className="space-y-2">
                      <label className="text-sm font-sans font-bold text-ink block">默认帖子标签</label>
                      <textarea
                        value={defaultPostTagsInput}
                        onChange={(e) => setDefaultPostTagsInput(e.target.value)}
                        placeholder={`每行一个标签，或用逗号/分号分隔；每个标签最多${MAX_TAG_LENGTH}字`}
                        rows={4}
                        className="w-full bg-transparent border-2 border-gray-200 rounded-lg outline-none font-sans text-sm text-ink placeholder:text-pencil/40 px-3 py-2 focus:border-ink transition-colors resize-y"
                        disabled={settingsLoading || settingsSubmitting}
                      />
                      <div className="text-xs text-pencil font-sans space-y-1">
                        <p>投稿页会展示这些默认标签，用户仍可自行创建新标签。</p>
                        <p>当前有效：{parsedDefaultPostTags.length}/{MAX_DEFAULT_POST_TAGS}，超长标签与重复标签会自动过滤。</p>
                      </div>
                    </div>
                    <div className="space-y-3 rounded-lg border border-gray-200 bg-paper/60 p-3">
                      <div className="space-y-1">
                        <label className="text-sm font-sans font-bold text-ink block">举报自动隐藏阈值</label>
                        <p className="text-xs text-pencil font-sans">
                          同一帖子或评论在最近 24 小时内达到该数量的待处理举报后，会自动暂时隐藏。
                        </p>
                      </div>
                      <div className="max-w-xs">
                        <input
                          type="number"
                          min={1}
                          max={AUTO_HIDE_REPORT_THRESHOLD_MAX}
                          step={1}
                          value={autoHideReportThreshold}
                          onChange={(e) => setAutoHideReportThreshold(normalizeAutoHideReportThreshold(e.target.value))}
                          className="w-full bg-white border-2 border-gray-200 rounded-lg outline-none font-sans text-sm text-ink px-3 py-2 focus:border-ink transition-colors"
                          disabled={settingsLoading || settingsSubmitting}
                        />
                      </div>
                      <p className="text-xs text-pencil font-sans">
                        当前规则：24 小时内达到 {autoHideReportThreshold} 条待处理举报后自动隐藏。
                      </p>
                    </div>
                    <div className="space-y-3 border-t border-gray-200 pt-4">
                      <div>
                        <label className="text-sm font-sans font-bold text-ink block">企业微信机器人提醒</label>
                        <p className="text-xs text-pencil font-sans mt-1">
                          新留言、自动隐藏待审核内容、瓜条待审和新谣言待审都会推送到企业微信群；推送失败不会影响提交或审核。
                        </p>
                      </div>
                      <label className="flex items-center gap-3 text-sm font-sans">
                        <input
                          type="checkbox"
                          className="w-4 h-4"
                          checked={wecomWebhookEnabled}
                          onChange={(e) => setWecomWebhookEnabled(e.target.checked)}
                          disabled={settingsLoading || settingsSubmitting}
                        />
                        <span>启用企业微信机器人提醒</span>
                      </label>
                      <div className="rounded-lg border border-gray-200 bg-paper/60 p-3 space-y-3">
                        <p className="text-xs text-pencil font-sans">
                          当前状态：{wecomWebhookConfigured ? `已配置 ${wecomWebhookMaskedUrl}` : '未配置'}
                        </p>
                        <input
                          type="url"
                          value={wecomWebhookUrlInput}
                          onChange={(e) => {
                            setWecomWebhookUrlInput(e.target.value);
                            if (e.target.value.trim()) {
                              setWecomWebhookClearUrl(false);
                            }
                          }}
                          placeholder={wecomWebhookConfigured ? '留空则保留当前 Webhook 地址' : 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...'}
                          className="w-full bg-white border-2 border-gray-200 rounded-lg outline-none font-sans text-sm text-ink placeholder:text-pencil/40 px-3 py-2 focus:border-ink transition-colors"
                          disabled={settingsLoading || settingsSubmitting}
                        />
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <label className="flex items-center gap-2 text-xs font-sans text-pencil">
                            <input
                              type="checkbox"
                              className="w-4 h-4"
                              checked={wecomWebhookClearUrl}
                              onChange={(e) => setWecomWebhookClearUrl(e.target.checked)}
                              disabled={settingsLoading || settingsSubmitting || !wecomWebhookConfigured}
                            />
                            <span>清空已保存的 Webhook 地址</span>
                          </label>
                          <SketchButton
                            type="button"
                            variant="secondary"
                            className="h-9 px-4 text-xs"
                            disabled={settingsLoading || settingsSubmitting || wecomWebhookTesting || (!wecomWebhookConfigured && !wecomWebhookUrlInput.trim()) || (wecomWebhookClearUrl && !wecomWebhookUrlInput.trim())}
                            onClick={handleWecomWebhookTest}
                          >
                            {wecomWebhookTesting ? '发送中...' : '发送测试消息'}
                          </SketchButton>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <label className="text-sm font-sans font-bold text-ink block">限流配置</label>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        {RATE_LIMIT_FIELDS.map((item) => {
                          const config = rateLimits[item.key];
                          const windowSeconds = Math.max(1, Math.round(config.windowMs / 1000));
                          return (
                            <div
                              key={item.key}
                              className="rounded-lg border border-gray-200 bg-paper/60 p-3 space-y-3"
                            >
                              <div className="space-y-1">
                                <p className="text-sm font-sans font-bold text-ink">{item.label}</p>
                                <p className="text-xs text-pencil font-sans">{item.hint}</p>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <label className="space-y-1">
                                  <span className="text-xs text-pencil font-sans">次数</span>
                                  <input
                                    type="number"
                                    min={1}
                                    max={RATE_LIMIT_MAX_COUNT}
                                    step={1}
                                    value={config.limit}
                                    onChange={(e) => updateRateLimitCount(item.key, e.target.value)}
                                    className="w-full bg-white border-2 border-gray-200 rounded-lg outline-none font-sans text-sm text-ink px-3 py-2 focus:border-ink transition-colors"
                                    disabled={settingsLoading || settingsSubmitting}
                                  />
                                </label>
                                <label className="space-y-1">
                                  <span className="text-xs text-pencil font-sans">窗口（秒）</span>
                                  <input
                                    type="number"
                                    min={1}
                                    max={RATE_LIMIT_MAX_WINDOW_SECONDS}
                                    step={1}
                                    value={windowSeconds}
                                    onChange={(e) => updateRateLimitWindowSeconds(item.key, e.target.value)}
                                    className="w-full bg-white border-2 border-gray-200 rounded-lg outline-none font-sans text-sm text-ink px-3 py-2 focus:border-ink transition-colors"
                                    disabled={settingsLoading || settingsSubmitting}
                                  />
                                </label>
                              </div>
                              <p className="text-xs text-pencil font-sans">
                                当前规则：{formatRateLimitWindow(config.windowMs)} 内最多 {config.limit} 次
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <div className="rounded-lg border border-dashed border-ink/40 bg-paper px-3 py-2 text-xs text-pencil font-sans space-y-1">
                      <p>自动时段：农历腊月十六 00:00 至 正月十五 23:59（中国时区）</p>
                      <p>当前处于春节时段：{cnyThemeAutoActive ? '是' : '否'}</p>
                      <p>当前前台生效状态：{cnyThemeActive ? '是' : '否'}</p>
                      <p>本次保存后预计生效：{cnyThemePreviewActive ? '是' : '否'}</p>
                    </div>
                  </div>
                  <div className="flex justify-end mt-4">
                    <SketchButton
                      type="submit"
                      className="h-10 px-6 text-sm"
                      disabled={settingsSubmitting || settingsLoading}
                    >
                      {settingsSubmitting ? '保存中...' : '保存设置'}
                    </SketchButton>
                  </div>
                </form>

                <div className="bg-white p-6 border-2 border-ink rounded-lg shadow-sketch-sm">
                  <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                    <div>
                      <h3 className="font-display text-xl">违禁词库</h3>
                      <p className="text-xs text-pencil font-sans">保存后立即生效，无需重启服务</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <SketchButton
                        type="button"
                        variant="secondary"
                        className="h-9 px-4 text-sm"
                        onClick={handleVocabularyImport}
                        disabled={vocabularySubmitting || vocabularyLoading}
                      >
                        从TXT导入
                      </SketchButton>
                      <SketchButton
                        type="button"
                        variant="secondary"
                        className="h-9 px-4 text-sm"
                        onClick={handleVocabularyExport}
                        disabled={vocabularySubmitting || vocabularyLoading}
                      >
                        导出到剪贴板
                      </SketchButton>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 mb-4">
                    <input
                      value={vocabularySearch}
                      onChange={(e) => {
                        setVocabularySearch(e.target.value);
                        setVocabularyPage(1);
                      }}
                      placeholder="搜索违禁词..."
                      className="flex-1 min-w-[180px] bg-transparent border-2 border-gray-200 rounded-lg outline-none font-sans text-sm text-ink placeholder:text-pencil/40 px-3 py-2 focus:border-ink transition-colors"
                      disabled={vocabularyLoading || vocabularySubmitting}
                    />
                    <form onSubmit={handleVocabularyAdd} className="flex items-center gap-2">
                      <input
                        value={vocabularyNewWord}
                        onChange={(e) => setVocabularyNewWord(e.target.value)}
                        placeholder="新增违禁词"
                        className="min-w-[160px] bg-transparent border-2 border-gray-200 rounded-lg outline-none font-sans text-sm text-ink placeholder:text-pencil/40 px-3 py-2 focus:border-ink transition-colors"
                        disabled={vocabularyLoading || vocabularySubmitting}
                      />
                      <SketchButton
                        type="submit"
                        className="h-9 px-4 text-sm"
                        disabled={vocabularySubmitting || vocabularyLoading}
                      >
                        添加
                      </SketchButton>
                    </form>
                  </div>

                  <div className="flex items-center justify-between text-xs text-pencil font-sans mb-3">
                    <span>共 {vocabularyTotal} 条</span>
                    <span>第 {vocabularyPage} / {totalVocabularyPages} 页</span>
                  </div>

                  {vocabularyLoading ? (
                    <div className="text-center py-10 bg-gray-50 border-2 border-dashed border-gray-200 rounded-lg text-pencil font-hand">
                      正在加载违禁词...
                    </div>
                  ) : vocabularyItems.length === 0 ? (
                    <div className="text-center py-10 bg-gray-50 border-2 border-dashed border-gray-200 rounded-lg text-pencil font-hand">
                      暂无匹配的违禁词
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {vocabularyItems.map((item) => (
                        <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 border-2 border-ink/10 rounded-lg px-4 py-3">
                          <div className="flex items-center gap-3">
                            <span className="font-sans text-ink text-sm font-semibold">{item.word}</span>
                            <Badge color={item.enabled ? 'bg-highlight' : 'bg-gray-200'}>
                              {item.enabled ? '启用' : '停用'}
                            </Badge>
                            <span className="text-xs text-pencil font-sans">更新：{formatAnnouncementTime(item.updatedAt)}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <SketchButton
                              type="button"
                              variant="secondary"
                              className="h-8 px-3 text-xs"
                              onClick={() => handleVocabularyToggle(item.id, !item.enabled)}
                              disabled={vocabularySubmitting}
                            >
                              {item.enabled ? '停用' : '启用'}
                            </SketchButton>
                            <SketchButton
                              type="button"
                              variant="danger"
                              className="h-8 px-3 text-xs"
                              onClick={() => handleVocabularyDelete(item.id)}
                              disabled={vocabularySubmitting}
                            >
                              删除
                            </SketchButton>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center justify-between mt-4 text-xs text-pencil font-sans">
                    <SketchButton
                      type="button"
                      variant="secondary"
                      className="h-8 px-3 text-xs"
                      disabled={vocabularyPage <= 1 || vocabularyLoading}
                      onClick={() => setVocabularyPage((prev) => Math.max(prev - 1, 1))}
                    >
                      上一页
                    </SketchButton>
                    <SketchButton
                      type="button"
                      variant="secondary"
                      className="h-8 px-3 text-xs"
                      disabled={vocabularyPage >= totalVocabularyPages || vocabularyLoading}
                      onClick={() => setVocabularyPage((prev) => Math.min(prev + 1, totalVocabularyPages))}
                    >
                      下一页
                    </SketchButton>
                  </div>
                </div>
              </section>
            )}

            {/* 瓜条审核视图 */}
            {currentView === 'wiki' && (
              <AdminWikiPanel showToast={showToast} onPendingCountChange={fetchWikiPendingCount} />
            )}

            {currentView === 'rumors' && (
              <AdminRumorPanel showToast={showToast} onPendingCountChange={fetchRumorPendingCount} />
            )}

            {/* Feedback View */}
            {currentView === 'feedback' && (
              <AdminFeedbackView
                feedbackStatus={feedbackStatus}
                feedbackTotal={feedbackTotal}
                feedbackPage={feedbackPage}
                totalFeedbackPages={totalFeedbackPages}
                feedbackLoading={feedbackLoading}
                feedbackItems={feedbackItems}
                formatTimestamp={formatTimestamp}
                renderIdentity={renderIdentity}
                onFeedbackStatusChange={(status) => {
                  setFeedbackStatus(status);
                  setFeedbackPage(1);
                }}
                onFeedbackPageChange={setFeedbackPage}
                onFeedbackRead={handleFeedbackRead}
                onOpenFeedbackAction={openFeedbackActionModal}
              />
            )}

            {/* Chat View */}
            {/* Chat View */}
            {currentView === 'chat' && (
              <AdminChatPanel
                showToast={showToast}
                onPrepareBan={prepareManualBan}
                onOpenModeration={openModerationDrawer}
              />
            )}

            {/* Bans View */}
            {currentView === 'bans' && (
              <AdminBansView
                mergedBans={mergedBans}
                banLoading={banLoading}
                banSearch={banSearch}
                formatTimestamp={formatTimestamp}
                formatBanPermissions={formatBanPermissions}
                renderIdentity={renderIdentity}
                onBanSearchChange={setBanSearch}
                onOpenManualBan={openManualBanDrawer}
                onEditBan={openBanRecordDrawer}
              />
            )}

            {/* Audit View */}
            {currentView === 'audit' && (
              <AdminAuditView
                auditTotal={auditTotal}
                auditPage={auditPage}
                totalAuditPages={totalAuditPages}
                auditLoading={auditLoading}
                auditLogs={auditLogs}
                formatTimestamp={formatTimestamp}
                onOpenAuditDetail={(log) => setAuditDetail({ isOpen: true, log })}
                onAuditPageChange={setAuditPage}
              />
            )}

            {/* Reports View */}
            {(currentView === 'reports' || currentView === 'processed') && (
              <AdminReportsView
                showProcessed={currentView === 'processed'}
                reportsLoading={reportsLoading}
                searchQuery={searchQuery}
                filteredReports={filteredReports}
                selectedReports={selectedReports}
                onReportAction={handleAction}
                onReportDetail={(item) => setReportDetail({ isOpen: true, report: item })}
                renderIdentity={renderIdentity}
                onToggleAllReports={toggleAllReports}
                onOpenBulkReportModal={openBulkReportModal}
                onToggleReportSelection={toggleReportSelection}
              />
            )}
          </div>
        </div>
      </main>

      {/* Confirm Modal */}
      <Modal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal({ ...EMPTY_REPORT_CONFIRM_MODAL })}
        title="确认操作"
      >
        <div className="flex flex-col gap-4">
          <p className="font-hand text-lg text-ink">
            确定要 <strong className="text-red-600">{getActionLabel(confirmModal.action, confirmModal.targetType, confirmModal.deleteComment, confirmModal.deleteChatMessage)}</strong> 吗？
          </p>
          <div className="p-3 bg-gray-50 border border-dashed border-ink rounded-lg">
            <p className="text-sm text-pencil font-sans line-clamp-2">"{confirmModal.content}"</p>
          </div>
          <div>
            <label className="text-xs text-pencil font-sans">处理理由（可选）</label>
            <textarea
              value={confirmModal.reason}
              onChange={(e) => setConfirmModal((prev) => ({ ...prev, reason: e.target.value }))}
              className="w-full mt-2 h-20 resize-none border-2 border-gray-200 rounded-lg p-2 text-sm font-sans focus:border-ink outline-none"
              placeholder="填写理由便于审计追溯"
            />
          </div>
          {confirmModal.action === 'ban' && (confirmModal.targetType === 'comment' || confirmModal.targetType === 'chat') && (
            <label className="flex items-center gap-2 text-sm font-sans text-pencil">
              <input
                type="checkbox"
                className="accent-black"
                checked={confirmModal.targetType === 'comment' ? confirmModal.deleteComment : confirmModal.deleteChatMessage}
                onChange={(e) => setConfirmModal((prev) => (
                  prev.targetType === 'comment'
                    ? { ...prev, deleteComment: e.target.checked }
                    : { ...prev, deleteChatMessage: e.target.checked }
                ))}
              />
              <span>{confirmModal.targetType === 'comment' ? '同时删除被举报评论' : '同时删除被举报发言'}</span>
            </label>
          )}
          <div className="flex flex-col sm:flex-row gap-3 mt-2">
            <SketchButton
              variant="secondary"
              className="flex-1"
              onClick={() => setConfirmModal({ ...EMPTY_REPORT_CONFIRM_MODAL })}
            >
              取消
            </SketchButton>
            <SketchButton
              variant={confirmModal.action === 'ignore' ? 'secondary' : confirmModal.action === 'mute' ? 'primary' : 'danger'}
              className="flex-1"
              onClick={confirmAction}
            >
              确认{confirmModal.action === 'ban' ? '封禁' : confirmModal.action === 'delete' ? '删除' : confirmModal.action === 'mute' ? '禁言' : '忽略'}
            </SketchButton>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={postConfirmModal.isOpen}
        onClose={() => setPostConfirmModal({ isOpen: false, postId: '', action: 'delete', content: '', reason: '' })}
        title="确认操作"
      >
        <div className="flex flex-col gap-4">
          <p className="font-hand text-lg text-ink">
            确定要 <strong className="text-red-600">{getPostActionLabel(postConfirmModal.action)}</strong> 吗？
          </p>
          <div className="p-3 bg-gray-50 border border-dashed border-ink rounded-lg">
            <p className="text-sm text-pencil font-sans line-clamp-2">"{postConfirmModal.content}"</p>
          </div>
          <div>
            <label className="text-xs text-pencil font-sans">处理理由（可选）</label>
            <textarea
              value={postConfirmModal.reason}
              onChange={(e) => setPostConfirmModal((prev) => ({ ...prev, reason: e.target.value }))}
              className="w-full mt-2 h-20 resize-none border-2 border-gray-200 rounded-lg p-2 text-sm font-sans focus:border-ink outline-none"
              placeholder="填写理由便于审计追溯"
            />
          </div>
          <div className="flex flex-col sm:flex-row gap-3 mt-2">
            <SketchButton
              variant="secondary"
              className="flex-1"
              onClick={() => setPostConfirmModal({ isOpen: false, postId: '', action: 'delete', content: '', reason: '' })}
            >
              取消
            </SketchButton>
            <SketchButton
              variant={postConfirmModal.action === 'delete' ? 'danger' : 'secondary'}
              className="flex-1"
              onClick={confirmPostAction}
            >
              确认{postConfirmModal.action === 'delete' ? '删除' : '恢复'}
            </SketchButton>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={postCommentsModal.isOpen}
        onClose={() => {
          setPostCommentsModal({ isOpen: false, postId: '', content: '' });
          setPostComments([]);
        }}
        title="帖子评论"
      >
        <div className="flex flex-col gap-4">
          <div className="p-3 bg-gray-50 border border-dashed border-ink rounded-lg">
            <p className="text-sm text-pencil font-sans line-clamp-3">"{postCommentsModal.content}"</p>
          </div>
          {postCommentsLoading ? (
            <div className="text-center py-8 text-pencil font-hand">加载中...</div>
          ) : postComments.length === 0 ? (
            <div className="text-center py-8 text-pencil font-hand">暂无评论</div>
          ) : (
            <div className="flex flex-col gap-3 max-h-[60vh] overflow-y-auto">
              {buildAdminCommentTree(postComments).map((item) => renderAdminCommentItem(item))}
            </div>
          )}
        </div>
      </Modal>

      <Modal
        isOpen={hiddenActionModal.isOpen}
        onClose={() => setHiddenActionModal({ isOpen: false, item: null, action: 'keep', reason: '' })}
        title="隐藏内容处理"
      >
        <div className="flex flex-col gap-4">
          <p className="font-hand text-lg text-ink">
            确定要 <strong className="text-red-600">{getHiddenActionLabel(hiddenActionModal.action)}</strong> 吗？
          </p>
          {hiddenActionModal.item && (
            <div className="p-3 bg-gray-50 border border-dashed border-ink rounded-lg">
              <p className="text-xs text-pencil font-sans mb-2">
                {hiddenActionModal.item.type === 'post' ? '帖子' : '评论'} #{hiddenActionModal.item.id}
              </p>
              <p className="text-sm text-pencil font-sans line-clamp-3">
                "{hiddenActionModal.item.content || '（无内容）'}"
              </p>
            </div>
          )}
          <div>
            <label className="text-xs text-pencil font-sans">处理理由（可选）</label>
            <textarea
              value={hiddenActionModal.reason}
              onChange={(e) => setHiddenActionModal((prev) => ({ ...prev, reason: e.target.value }))}
              className="w-full mt-2 h-20 resize-none border-2 border-gray-200 rounded-lg p-2 text-sm font-sans focus:border-ink outline-none"
              placeholder="填写理由便于审计追踪"
            />
          </div>
          <div className="flex flex-col sm:flex-row gap-3 mt-2">
            <SketchButton
              variant="secondary"
              className="flex-1"
              onClick={() => setHiddenActionModal({ isOpen: false, item: null, action: 'keep', reason: '' })}
            >
              取消
            </SketchButton>
            <SketchButton
              variant={hiddenActionModal.action === 'restore' ? 'primary' : 'secondary'}
              className={`flex-1 ${hiddenActionModal.action === 'restore' ? 'text-white' : ''}`}
              onClick={confirmHiddenAction}
            >
              确认{hiddenActionModal.action === 'keep' ? '保持隐藏' : '恢复'}
            </SketchButton>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={bulkPostModal.isOpen}
        onClose={() => setBulkPostModal({ isOpen: false, action: 'delete', reason: '' })}
        title="批量操作确认"
      >
        <div className="flex flex-col gap-4">
          <p className="font-hand text-lg text-ink">
            确定要对 <strong className="text-red-600">{selectedPosts.size}</strong> 条帖子执行
            <strong className="text-red-600"> {getBulkActionLabel(bulkPostModal.action)} </strong> 吗？
          </p>
          <div>
            <label className="text-xs text-pencil font-sans">处理理由（可选）</label>
            <textarea
              value={bulkPostModal.reason}
              onChange={(e) => setBulkPostModal((prev) => ({ ...prev, reason: e.target.value }))}
              className="w-full mt-2 h-20 resize-none border-2 border-gray-200 rounded-lg p-2 text-sm font-sans focus:border-ink outline-none"
              placeholder="填写理由便于审计追溯"
            />
          </div>
          <div className="flex flex-col sm:flex-row gap-3 mt-2">
            <SketchButton
              variant="secondary"
              className="flex-1"
              onClick={() => setBulkPostModal({ isOpen: false, action: 'delete', reason: '' })}
            >
              取消
            </SketchButton>
            <SketchButton
              variant={bulkPostModal.action === 'delete' ? 'danger' : 'secondary'}
              className="flex-1"
              onClick={confirmBulkPostAction}
            >
              确认执行
            </SketchButton>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={bulkReportModal.isOpen}
        onClose={() => setBulkReportModal({ isOpen: false, reason: '' })}
        title="批量标记处理"
      >
        <div className="flex flex-col gap-4">
          <p className="font-hand text-lg text-ink">
            确定要标记 <strong className="text-red-600">{selectedReports.size}</strong> 条举报为已处理吗？
          </p>
          <div>
            <label className="text-xs text-pencil font-sans">处理理由（可选）</label>
            <textarea
              value={bulkReportModal.reason}
              onChange={(e) => setBulkReportModal((prev) => ({ ...prev, reason: e.target.value }))}
              className="w-full mt-2 h-20 resize-none border-2 border-gray-200 rounded-lg p-2 text-sm font-sans focus:border-ink outline-none"
              placeholder="填写理由便于审计追溯"
            />
          </div>
          <div className="flex flex-col sm:flex-row gap-3 mt-2">
            <SketchButton
              variant="secondary"
              className="flex-1"
              onClick={() => setBulkReportModal({ isOpen: false, reason: '' })}
            >
              取消
            </SketchButton>
            <SketchButton
              variant="secondary"
              className="flex-1"
              onClick={confirmBulkReportAction}
            >
              确认标记
            </SketchButton>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={feedbackActionModal.isOpen}
        onClose={() => setFeedbackActionModal({ isOpen: false, feedbackId: '', action: 'delete', content: '', reason: '' })}
        title="确认操作"
      >
        <div className="flex flex-col gap-4">
          <p className="font-hand text-lg text-ink">
            确定要 <strong className="text-red-600">{feedbackActionModal.action === 'delete' ? '删除留言' : '封禁用户'}</strong> 吗？
          </p>
          <div className="p-3 bg-gray-50 border border-dashed border-ink rounded-lg">
            <p className="text-sm text-pencil font-sans line-clamp-2">"{feedbackActionModal.content}"</p>
          </div>
          <div>
            <label className="text-xs text-pencil font-sans">处理理由（可选）</label>
            <textarea
              value={feedbackActionModal.reason}
              onChange={(e) => setFeedbackActionModal((prev) => ({ ...prev, reason: e.target.value }))}
              className="w-full mt-2 h-20 resize-none border-2 border-gray-200 rounded-lg p-2 text-sm font-sans focus:border-ink outline-none"
              placeholder="填写理由便于审计追溯"
            />
          </div>
          <div className="flex flex-col sm:flex-row gap-3 mt-2">
            <SketchButton
              variant="secondary"
              className="flex-1"
              onClick={() => setFeedbackActionModal({ isOpen: false, feedbackId: '', action: 'delete', content: '', reason: '' })}
            >
              取消
            </SketchButton>
            <SketchButton
              variant={feedbackActionModal.action === 'delete' ? 'danger' : 'secondary'}
              className="flex-1"
              onClick={confirmFeedbackAction}
            >
              确认{feedbackActionModal.action === 'delete' ? '删除' : '封禁'}
            </SketchButton>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={editModal.isOpen}
        onClose={() => setEditModal({ isOpen: false, postId: '', content: '', preview: false, reason: '' })}
        title="编辑帖子"
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-pencil font-sans">支持 Markdown</span>
            <button
              type="button"
              onClick={() => setEditModal((prev) => ({ ...prev, preview: !prev.preview }))}
              className="flex items-center gap-1 px-3 py-1 text-sm font-hand font-bold text-pencil hover:text-ink border-2 border-gray-200 hover:border-ink rounded-full transition-all"
            >
              {editModal.preview ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              {editModal.preview ? '编辑' : '预览'}
            </button>
          </div>
          {editModal.preview ? (
            <div className="w-full min-h-[220px] p-4 border-2 border-dashed border-gray-300 rounded-lg bg-gray-50 overflow-auto">
              {editModal.content.trim() ? (
                <MarkdownRenderer content={editModal.content} className="font-sans text-lg text-ink" />
              ) : (
                <p className="text-pencil/50 font-hand text-xl">预览区域（请先输入内容）</p>
              )}
            </div>
          ) : (
            <textarea
              value={editModal.content}
              onChange={(e) => setEditModal((prev) => ({ ...prev, content: e.target.value }))}
              className="w-full min-h-[220px] resize-none border-2 border-gray-200 rounded-lg p-3 text-sm font-sans focus:border-ink outline-none"
              placeholder="修改帖子内容..."
              maxLength={composeMaxLength + 100}
            />
          )}
          <div>
            <label className="text-xs text-pencil font-sans">编辑理由（可选）</label>
            <textarea
              value={editModal.reason}
              onChange={(e) => setEditModal((prev) => ({ ...prev, reason: e.target.value }))}
              className="w-full mt-2 h-20 resize-none border-2 border-gray-200 rounded-lg p-2 text-sm font-sans focus:border-ink outline-none"
              placeholder="填写理由便于审计追溯"
            />
          </div>
          <div className="flex gap-3">
            <SketchButton
              variant="secondary"
              className="flex-1"
              onClick={() => setEditModal({ isOpen: false, postId: '', content: '', preview: false, reason: '' })}
            >
              取消
            </SketchButton>
            <SketchButton
              variant="primary"
              className="flex-1"
              onClick={confirmEdit}
            >
              保存修改
            </SketchButton>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={auditDetail.isOpen}
        onClose={() => setAuditDetail({ isOpen: false, log: null })}
        title="操作详情"
      >
        <div className="flex flex-col gap-4">
          <div className="text-xs text-pencil font-sans">
            <p>操作：{auditDetail.log?.action}</p>
            <p>目标：{auditDetail.log?.targetType} · {auditDetail.log?.targetId}</p>
            <p>操作者：{auditDetail.log?.adminUsername || '未知'}</p>
            <p>时间：{formatTimestamp(auditDetail.log?.createdAt)}</p>
            {auditDetail.log?.reason && <p>理由：{auditDetail.log.reason}</p>}
          </div>
          <div>
            <p className="text-xs text-pencil font-sans mb-2">变更前</p>
            <pre className="bg-gray-50 border-2 border-dashed border-gray-200 rounded-lg p-3 text-xs overflow-auto whitespace-pre-wrap">
              {formatAuditJson(auditDetail.log?.before)}
            </pre>
          </div>
          <div>
            <p className="text-xs text-pencil font-sans mb-2">变更后</p>
            <pre className="bg-gray-50 border-2 border-dashed border-gray-200 rounded-lg p-3 text-xs overflow-auto whitespace-pre-wrap">
              {formatAuditJson(auditDetail.log?.after)}
            </pre>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={reportDetail.isOpen}
        onClose={() => setReportDetail({ isOpen: false, report: null })}
        title="举报详情"
        panelClassName="max-w-2xl"
      >
        <div className="flex flex-col gap-4">
          <div className="text-xs text-pencil font-sans">
            <p>举报 ID：{reportDetail.report?.id}</p>
            <p>类型：{reportDetail.report?.targetType === 'comment' ? '评论举报' : reportDetail.report?.targetType === 'chat' ? '聊天室发言举报' : '帖子举报'}</p>
            <p>原因：{reportDetail.report?.reason}</p>
            <div className="break-words">{renderIdentity({
              ip: reportDetail.report?.targetIp,
              sessionId: reportDetail.report?.targetSessionId,
              fingerprint: reportDetail.report?.targetFingerprint,
              identityKey: reportDetail.report?.targetIdentityKey,
              identityHashes: reportDetail.report?.targetIdentityHashes,
            })}</div>
          </div>
          <div>
            <p className="text-xs text-pencil font-sans mb-2">举报者信息</p>
            <div className="bg-gray-50 border-2 border-dashed border-gray-200 rounded-lg p-3 text-xs text-pencil font-sans">
              <div className="break-words">
                {renderIdentity({
                  ip: reportDetail.report?.reporterIp,
                  fingerprint: reportDetail.report?.reporterFingerprint,
                  identityKey: reportDetail.report?.reporterIdentityKey,
                  identityHashes: reportDetail.report?.reporterIdentityHashes,
                }, { label: '举报者标识' })}
              </div>
              <p>举报时间：{reportDetail.report?.timestamp || '-'}</p>
              <p>举报次数：{reportDetail.report?.reporterCount ?? 0}</p>
            </div>
          </div>
          <div>
            <p className="text-xs text-pencil font-sans mb-2">被举报帖子内容</p>
            <div className="bg-gray-50 border-2 border-dashed border-gray-200 rounded-lg p-3 text-sm overflow-auto">
              {reportDetail.report?.postContent
                ? <MarkdownRenderer content={reportDetail.report.postContent} className="font-sans text-base text-ink" />
                : <span className="text-pencil">（暂无内容）</span>}
            </div>
          </div>
          {reportDetail.report?.targetType === 'comment' && (
            <div>
              <p className="text-xs text-pencil font-sans mb-2">被举报评论内容</p>
              <div className="bg-gray-50 border-2 border-dashed border-gray-200 rounded-lg p-3 text-sm overflow-auto">
                {reportDetail.report?.commentContent
                  ? <MarkdownRenderer content={reportDetail.report.commentContent} className="font-sans text-base text-ink" />
                  : <span className="text-pencil">（暂无内容）</span>}
              </div>
            </div>
          )}
        </div>
      </Modal>

      <AdminModerationDrawer
        isOpen={Boolean(moderationDrawer)}
        config={moderationDrawer}
        submitting={moderationSubmitting}
        onClose={closeModerationDrawer}
        onSubmit={(payload) => runModerationHandler(moderationDrawer?.onSubmit, payload)}
        onSecondaryAction={moderationSecondaryAction}
      />
    </div>
  );
};

export default AdminDashboard;


