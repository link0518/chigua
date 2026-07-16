import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Flag, Gavel, BarChart2, Bell, Search, Trash2, Ban, Eye, EyeOff, LayoutDashboard, LogOut, CheckCircle, XCircle, FileText, Pencil, RotateCcw, Shield, ClipboardList, MessageSquare, Menu, X, Settings, BookOpen, AlertTriangle, UserCog, Store, Star } from 'lucide-react';
import { SketchButton, Badge } from './SketchUI';
import { AdminAuditLog, AdminComment, AdminHiddenItem, AdminPermissionDefinitions, AdminPermissions, AdminUserAccount, AdminPost, FeedbackMessage, PostDeleteRequest, Report, UpdateAnnouncementItem } from '../types';
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
import MarkdownRenderer from './MarkdownRenderer';
import AdminWikiPanel from './AdminWikiPanel';
import AdminRumorPanel from './AdminRumorPanel';
import AdminFeaturedPanel from './AdminFeaturedPanel';
import { copyTextToClipboard } from './clipboard';
import AdminOverviewView from '@/features/admin/views/AdminOverviewView';
import AdminFeedbackView from '@/features/admin/views/AdminFeedbackView';
import AdminPostDeleteRequestsView from '@/features/admin/views/AdminPostDeleteRequestsView';
import AdminBansView from '@/features/admin/views/AdminBansView';
import AdminAuditView from '@/features/admin/views/AdminAuditView';
import AdminReportsView from '@/features/admin/views/AdminReportsView';
import AdminPublishCenterView from '@/features/admin/views/AdminPublishCenterView';
import AdminSystemSettingsView from '@/features/admin/views/AdminSystemSettingsView';
import AdminUsersView from '@/features/admin/views/AdminUsersView';
import AdminShopView from '@/features/admin/views/AdminShopView';
import { hasPermission } from '@/features/admin/permissions';
import type { AdminPostDeleteRequestAction, AdminPostDeleteRequestStatus, ReportAction } from '@/features/admin/types';
import AdminAuditDetailModal from '@/features/admin/components/AdminAuditDetailModal';
import {
  DEFAULT_AUDIT_FILTERS,
  getAuditTimeRangeParams,
  type AuditFilterState,
} from '@/features/admin/audit/auditPresentation';
import {
  AUTO_HIDE_REPORT_THRESHOLD_DEFAULT,
  RATE_LIMIT_DEFAULTS,
  RATE_LIMIT_FIELDS,
  RATE_LIMIT_MAX_COUNT,
  RATE_LIMIT_MAX_WINDOW_SECONDS,
  normalizeAutoHideReportThreshold,
  normalizeRateLimitNumber,
  normalizeRateLimits,
  type RateLimitAction,
  type RateLimitSettings,
} from '@/features/admin/domains/system/rateLimitSettings';
import AdminModerationDrawer, {
  type AdminModerationDrawerRequest,
  type AdminModerationQuickPreset,
  type AdminModerationSubmitPayload,
} from '@/features/admin/components/AdminModerationDrawer';
import AdminActionDrawer from '@/features/admin/components/AdminActionDrawer';

type AdminView = 'overview' | 'reports' | 'processed' | 'posts' | 'hidden' | 'deleteRequests' | 'bans' | 'audit' | 'feedback' | 'announcement' | 'settings' | 'shop' | 'wiki' | 'rumors' | 'features' | 'adminUsers';
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
};

const WEEK_DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const POST_PAGE_SIZE = 10;
const HIDDEN_PAGE_SIZE = 10;
const DELETE_REQUEST_PAGE_SIZE = 10;
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
};

const DEFAULT_BAN_PERMISSIONS = Object.keys(BAN_PERMISSION_LABELS);
const DEFAULT_BAN_PRESETS: AdminModerationQuickPreset[] = [
  { id: 'post-comment-7d', label: '发帖+评论 7 天', description: '保留站点查看权限', permissions: ['post', 'comment'], duration: '7d' },
  { id: 'site-7d', label: '全站 7 天', description: '使用全部权限集', permissions: DEFAULT_BAN_PERMISSIONS, duration: '7d' },
  { id: 'site-forever', label: '永久封禁', description: '全站长期生效', permissions: DEFAULT_BAN_PERMISSIONS, duration: 'forever' },
];
const REPORT_BATCH_CHUNK_SIZE = 200;
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
};

type ModerationDrawerState = AdminModerationDrawerRequest | null;
type AdminMergedBanSearchItem = ReturnType<typeof buildMergedBanItems>[number] & {
  searchText: string;
};

const SEARCH_DEBOUNCE_MS = 350;

const useDebouncedValue = <T,>(value: T, delayMs = SEARCH_DEBOUNCE_MS) => {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);

  return debouncedValue;
};

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

const normalizeAdminSearchText = (values: Array<string | number | null | undefined>) => (
  values
    .filter((value) => value !== null && value !== undefined && String(value).trim())
    .map((value) => String(value).toLowerCase())
    .join('\n')
);

const buildReportSearchText = (report: Report) => normalizeAdminSearchText([
  report.id,
  report.contentSnippet,
  report.reason,
  report.postId,
  report.targetId,
  report.postContent,
  report.commentContent,
  report.targetContent,
  ...getAdminIdentitySearchValues({
    ip: report.targetIp,
    sessionId: report.targetSessionId,
    fingerprint: report.targetFingerprint,
    identityKey: report.targetIdentityKey,
    identityHashes: report.targetIdentityHashes,
  }),
  ...getAdminIdentitySearchValues({
    ip: report.reporterIp,
    fingerprint: report.reporterFingerprint,
    identityKey: report.reporterIdentityKey,
    identityHashes: report.reporterIdentityHashes,
  }),
]);

const buildMergedBanItems = (
  bannedIps: Array<{ ip: string; bannedAt: number; expiresAt?: number | null; permissions?: string[]; reason?: string | null }>,
  bannedFingerprints: Array<{ type?: 'fingerprint' | 'identity'; fingerprint: string; identityKey?: string | null; identityHashes?: string[]; bannedAt: number; expiresAt?: number | null; permissions?: string[]; reason?: string | null }>
) => [
    ...bannedIps.map((item) => ({ ...item, type: 'ip' as const, value: item.ip })),
    ...bannedFingerprints.map((item) => ({
      ...item,
      type: item.type || (item.identityKey ? 'identity' as const : 'fingerprint' as const),
      value: item.identityKey || item.fingerprint,
      identityHashes: Array.from(new Set([...(item.identityHashes || []), item.fingerprint].filter(Boolean))),
    })),
  ];

const buildBanSearchText = (item: ReturnType<typeof buildMergedBanItems>[number]) => {
  const identityFields = item.type === 'ip'
    ? getAdminIdentitySearchValues({
      ip: item.value,
    })
    : getAdminIdentitySearchValues({
      identityKey: item.identityKey || null,
      fingerprint: item.fingerprint || null,
      identityHashes: item.identityHashes || [],
    });
  return normalizeAdminSearchText([
    item.value,
    item.reason || '',
    (item.permissions || []).join(' '),
    item.type,
    ...identityFields,
  ]);
};

const AdminDashboard: React.FC = () => {
  const { state, handleReport, showToast, getPendingReports, loadReports, loadStats, loadSettings, logoutAdmin } = useApp();
  const [currentView, setCurrentView] = useState<AdminView>('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [postSearch, setPostSearch] = useState('');
  const [postSearchInput, setPostSearchInput] = useState('');
  const [postStatus, setPostStatus] = useState<PostStatusFilter>('active');
  const [postSort, setPostSort] = useState<PostSort>('time');
  const [postPage, setPostPage] = useState(1);
  const [postTotal, setPostTotal] = useState(0);
  const [postItems, setPostItems] = useState<AdminPost[]>([]);
  const [postLoading, setPostLoading] = useState(false);
  const [hiddenType, setHiddenType] = useState<HiddenTypeFilter>('all');
  const [hiddenReview, setHiddenReview] = useState<HiddenReviewFilter>('pending');
  const [hiddenSearch, setHiddenSearch] = useState('');
  const [hiddenSearchInput, setHiddenSearchInput] = useState('');
  const [hiddenPage, setHiddenPage] = useState(1);
  const [hiddenTotal, setHiddenTotal] = useState(0);
  const [hiddenPendingCount, setHiddenPendingCount] = useState(0);
  const [hiddenItems, setHiddenItems] = useState<AdminHiddenItem[]>([]);
  const [hiddenLoading, setHiddenLoading] = useState(false);
  const [deleteRequestStatus, setDeleteRequestStatus] = useState<AdminPostDeleteRequestStatus>('pending');
  const [deleteRequestPage, setDeleteRequestPage] = useState(1);
  const [deleteRequestTotal, setDeleteRequestTotal] = useState(0);
  const [deleteRequestPendingCount, setDeleteRequestPendingCount] = useState(0);
  const [deleteRequestItems, setDeleteRequestItems] = useState<PostDeleteRequest[]>([]);
  const [deleteRequestLoading, setDeleteRequestLoading] = useState(false);
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
    action: 'resolve' | 'ignore';
    reportIds: string[];
    reason: string;
  }>({ isOpen: false, action: 'resolve', reportIds: [], reason: '' });
  const [bulkReportSubmitting, setBulkReportSubmitting] = useState(false);
  const [bannedIps, setBannedIps] = useState<Array<{ ip: string; bannedAt: number; expiresAt?: number | null; permissions?: string[]; reason?: string | null }>>([]);
  const [bannedFingerprints, setBannedFingerprints] = useState<Array<{ type?: 'fingerprint' | 'identity'; fingerprint: string; identityKey?: string | null; identityHashes?: string[]; bannedAt: number; expiresAt?: number | null; permissions?: string[]; reason?: string | null }>>([]);
  const [banLoading, setBanLoading] = useState(false);
  const [banSearch, setBanSearch] = useState('');
  const [banSearchInput, setBanSearchInput] = useState('');
  const [moderationDrawer, setModerationDrawer] = useState<ModerationDrawerState>(null);
  const [moderationSubmitting, setModerationSubmitting] = useState(false);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([]);
  const [auditSearch, setAuditSearch] = useState('');
  const [auditSearchInput, setAuditSearchInput] = useState('');
  const [auditFilters, setAuditFilters] = useState<AuditFilterState>({ ...DEFAULT_AUDIT_FILTERS });
  const [auditPage, setAuditPage] = useState(1);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditDetail, setAuditDetail] = useState<{ isOpen: boolean; log: AdminAuditLog | null }>({ isOpen: false, log: null });
  const [feedbackItems, setFeedbackItems] = useState<FeedbackMessage[]>([]);
  const [feedbackStatus, setFeedbackStatus] = useState<'all' | 'unread' | 'read'>('unread');
  const [feedbackSearch, setFeedbackSearch] = useState('');
  const [feedbackSearchInput, setFeedbackSearchInput] = useState('');
  const [feedbackPage, setFeedbackPage] = useState(1);
  const [feedbackTotal, setFeedbackTotal] = useState(0);
  const [overviewPendingReports, setOverviewPendingReports] = useState<Report[]>([]);
  const [overviewPendingCount, setOverviewPendingCount] = useState(0);
  const [reportsLoaded, setReportsLoaded] = useState(false);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [feedbackUnreadCount, setFeedbackUnreadCount] = useState(0);
  const [wikiPendingCount, setWikiPendingCount] = useState(0);
  const [rumorPendingCount, setRumorPendingCount] = useState(0);
  const [featurePendingCount, setFeaturePendingCount] = useState(0);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [adminUsers, setAdminUsers] = useState<AdminUserAccount[]>([]);
  const [adminUsersLoading, setAdminUsersLoading] = useState(false);
  const [adminUsersSubmitting, setAdminUsersSubmitting] = useState(false);
  const [adminPermissionDefinitions, setAdminPermissionDefinitions] = useState<AdminPermissionDefinitions | null>(state.adminSession.permissionDefinitions || null);
  const [feedbackActionModal, setFeedbackActionModal] = useState<{
    isOpen: boolean;
    feedbackId: string;
    action: 'delete' | 'ban';
    content: string;
    reason: string;
  }>({ isOpen: false, feedbackId: '', action: 'delete', content: '', reason: '' });
  const [feedbackReplyModal, setFeedbackReplyModal] = useState<{
    isOpen: boolean;
    feedbackId: string;
    content: string;
    reply: string;
  }>({ isOpen: false, feedbackId: '', content: '', reply: '' });
  const [feedbackReplySubmitting, setFeedbackReplySubmitting] = useState(false);
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
  const [deleteRequestActionModal, setDeleteRequestActionModal] = useState<{
    isOpen: boolean;
    item: PostDeleteRequest | null;
    action: AdminPostDeleteRequestAction;
    reason: string;
  }>({ isOpen: false, item: null, action: 'approve', reason: '' });
  const [reportDetail, setReportDetail] = useState<{ isOpen: boolean; report: Report | null }>({ isOpen: false, report: null });
  const composeMaxLength = 2000;
  const appVersion = import.meta.env.VITE_APP_VERSION || '0.0.0';
  const appVersionLabel = appVersion.startsWith('v') ? appVersion : `v${appVersion}`;
  const debouncedSearchInput = useDebouncedValue(searchInput);
  const debouncedPostSearchInput = useDebouncedValue(postSearchInput);
  const debouncedHiddenSearchInput = useDebouncedValue(hiddenSearchInput);
  const debouncedBanSearchInput = useDebouncedValue(banSearchInput);
  const debouncedAuditSearchInput = useDebouncedValue(auditSearchInput);
  const debouncedFeedbackSearchInput = useDebouncedValue(feedbackSearchInput);

  useEffect(() => {
    setSearchQuery(debouncedSearchInput);
  }, [debouncedSearchInput]);

  useEffect(() => {
    setPostSearch(debouncedPostSearchInput);
    setPostPage(1);
  }, [debouncedPostSearchInput]);

  useEffect(() => {
    setHiddenSearch(debouncedHiddenSearchInput);
    setHiddenPage(1);
  }, [debouncedHiddenSearchInput]);

  useEffect(() => {
    setBanSearch(debouncedBanSearchInput);
  }, [debouncedBanSearchInput]);

  useEffect(() => {
    setAuditSearch(debouncedAuditSearchInput);
    setAuditPage(1);
  }, [debouncedAuditSearchInput]);

  useEffect(() => {
    setFeedbackSearch(debouncedFeedbackSearchInput);
    setFeedbackPage(1);
  }, [debouncedFeedbackSearchInput]);

  const adminSession = state.adminSession;
  const isSuperAdmin = Boolean(adminSession.isSuperAdmin);
  const canReadContentReview = hasPermission(adminSession, 'content_review', 'read');
  const canManageContentReview = hasPermission(adminSession, 'content_review', 'manage');
  const canReadPosts = hasPermission(adminSession, 'posts', 'read');
  const canManagePosts = hasPermission(adminSession, 'posts', 'manage');
  const canReadWiki = hasPermission(adminSession, 'wiki', 'read');
  const canManageWiki = hasPermission(adminSession, 'wiki', 'manage');
  const canReadFeedback = hasPermission(adminSession, 'feedback', 'read');
  const canManageFeedback = hasPermission(adminSession, 'feedback', 'manage');
  const canReadUserSafety = hasPermission(adminSession, 'user_safety', 'read');
  const canManageUserSafety = hasPermission(adminSession, 'user_safety', 'manage');
  const canReadPublish = hasPermission(adminSession, 'publish', 'read');
  const canManagePublish = hasPermission(adminSession, 'publish', 'manage');
  const canReadSettings = hasPermission(adminSession, 'settings', 'read');
  const canManageSettings = hasPermission(adminSession, 'settings', 'manage');
  const canReadStats = canReadContentReview || canReadPosts || canReadUserSafety || canReadSettings;

  useEffect(() => {
    if (!canReadStats) {
      return;
    }
    loadStats().catch(() => { });
  }, [canReadStats, loadStats]);

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
    if (!canReadStats) {
      return;
    }
    const timer = setInterval(() => {
      loadStats().catch(() => { });
    }, 60000);
    return () => clearInterval(timer);
  }, [canReadStats, loadStats]);

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


  const pendingReports = useMemo(() => getPendingReports(), [getPendingReports, state.reports]);
  const processedReports = useMemo(() => state.reports.filter(r => r.status !== 'pending'), [state.reports]);
  const pendingReportSearchItems = useMemo(
    () => pendingReports.map((report) => ({ report, searchText: buildReportSearchText(report) })),
    [pendingReports]
  );
  const processedReportSearchItems = useMemo(
    () => processedReports.map((report) => ({ report, searchText: buildReportSearchText(report) })),
    [processedReports]
  );
  const visiblePendingReports = canReadContentReview
    ? (reportsLoaded ? pendingReports : overviewPendingReports)
    : [];
  const pendingReportCount = canReadContentReview
    ? (reportsLoaded ? pendingReports.length : overviewPendingCount)
    : 0;
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
    const source = currentView === 'processed' ? processedReportSearchItems : pendingReportSearchItems;
    return source.filter((item) => item.searchText.includes(query)).map((item) => item.report);
  }, [currentView, pendingReportSearchItems, pendingReports, processedReportSearchItems, processedReports, searchQuery]);

  const mergedBanSearchItems = useMemo<AdminMergedBanSearchItem[]>(() => (
    buildMergedBanItems(bannedIps, bannedFingerprints)
      .map((item) => ({ ...item, searchText: buildBanSearchText(item) }))
  ), [bannedFingerprints, bannedIps]);

  const mergedBans = useMemo(() => {
    const query = banSearch.trim().toLowerCase();
    if (!query) {
      return mergedBanSearchItems;
    }
    return mergedBanSearchItems.filter((item) => item.searchText.includes(query));
  }, [banSearch, mergedBanSearchItems]);

  const fetchOverviewReports = useCallback(async () => {
    if (!canReadContentReview) {
      setOverviewPendingReports([]);
      setOverviewPendingCount(0);
      return;
    }
    try {
      const data = await api.getReports({ status: 'pending', limit: 2 });
      setOverviewPendingReports(Array.isArray(data?.items) ? data.items : []);
      setOverviewPendingCount(Number(data?.total || 0));
    } catch (error) {
      const message = error instanceof Error ? error.message : '举报概览加载失败，请稍后重试';
      showToast(message, 'error');
    }
  }, [canReadContentReview, showToast]);

  const fetchAllReports = useCallback(async () => {
    if (!canReadContentReview) {
      setReportsLoaded(true);
      return;
    }
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
  }, [canReadContentReview, loadReports, showToast]);


  const fetchAdminPosts = useCallback(async () => {
    if (!canReadPosts) {
      setPostItems([]);
      setPostTotal(0);
      return;
    }
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
  }, [canReadPosts, postPage, postSearch, postSort, postStatus, showToast]);

  const fetchHiddenItems = useCallback(async () => {
    if (!canReadContentReview) {
      setHiddenItems([]);
      setHiddenTotal(0);
      setHiddenPendingCount(0);
      return;
    }
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
      if (hiddenType === 'all' && hiddenReview === 'pending' && !hiddenSearch.trim()) {
        setHiddenPendingCount(data.total || 0);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '隐藏内容加载失败，请稍后重试';
      showToast(message, 'error');
    } finally {
      setHiddenLoading(false);
    }
  }, [canReadContentReview, hiddenPage, hiddenReview, hiddenSearch, hiddenType, showToast]);

  const fetchHiddenPendingCount = useCallback(async () => {
    if (!canReadContentReview) {
      setHiddenPendingCount(0);
      return;
    }
    try {
      const data = await api.getAdminHiddenContent({
        type: 'all',
        review: 'pending',
        page: 1,
        limit: 1,
      });
      setHiddenPendingCount(Number(data?.total || 0));
    } catch {
      setHiddenPendingCount(0);
    }
  }, [canReadContentReview]);

  const fetchDeleteRequests = useCallback(async () => {
    if (!canReadContentReview) {
      setDeleteRequestItems([]);
      setDeleteRequestTotal(0);
      setDeleteRequestPendingCount(0);
      return;
    }
    setDeleteRequestLoading(true);
    try {
      const data = await api.getAdminPostDeleteRequests({
        status: deleteRequestStatus,
        page: deleteRequestPage,
        limit: DELETE_REQUEST_PAGE_SIZE,
      });
      setDeleteRequestItems(Array.isArray(data?.items) ? data.items : []);
      setDeleteRequestTotal(Number(data?.total || 0));
      if (deleteRequestStatus === 'pending') {
        setDeleteRequestPendingCount(Number(data?.total || 0));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '删除申请加载失败，请稍后重试';
      showToast(message, 'error');
    } finally {
      setDeleteRequestLoading(false);
    }
  }, [canReadContentReview, deleteRequestPage, deleteRequestStatus, showToast]);

  const fetchDeleteRequestPendingCount = useCallback(async () => {
    if (!canReadContentReview) {
      setDeleteRequestPendingCount(0);
      return;
    }
    try {
      const data = await api.getAdminPostDeleteRequests({
        status: 'pending',
        page: 1,
        limit: 1,
      });
      setDeleteRequestPendingCount(Number(data?.total || 0));
    } catch {
      setDeleteRequestPendingCount(0);
    }
  }, [canReadContentReview]);

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
    if (!canReadUserSafety) {
      setBannedIps([]);
      setBannedFingerprints([]);
      return;
    }
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
  }, [canReadUserSafety, showToast]);

  const fetchAuditLogs = useCallback(async () => {
    if (!isSuperAdmin) {
      setAuditLogs([]);
      setAuditTotal(0);
      return;
    }
    setAuditLoading(true);
    try {
      const auditTimeParams = getAuditTimeRangeParams(auditFilters.timeRange);
      const data = await api.getAdminAuditLogs({
        search: auditSearch.trim(),
        category: auditFilters.category === 'all' ? undefined : auditFilters.category,
        riskLevel: auditFilters.riskLevel === 'all' ? undefined : auditFilters.riskLevel,
        targetType: auditFilters.targetType === 'all' ? undefined : auditFilters.targetType,
        adminUsername: auditFilters.adminUsername.trim() || undefined,
        hasReason: auditFilters.reason === 'with' ? 'true' : auditFilters.reason === 'without' ? 'false' : undefined,
        from: auditTimeParams.from,
        to: auditTimeParams.to,
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
  }, [auditFilters, auditPage, auditSearch, isSuperAdmin, showToast]);

  const handleAuditFiltersChange = useCallback((nextFilters: Partial<AuditFilterState>) => {
    setAuditFilters((current) => ({ ...current, ...nextFilters }));
    setAuditPage(1);
  }, []);

  const fetchFeedback = useCallback(async () => {
    if (!canReadFeedback) {
      setFeedbackItems([]);
      setFeedbackTotal(0);
      setFeedbackUnreadCount(0);
      return;
    }
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
  }, [canReadFeedback, feedbackPage, feedbackSearch, feedbackStatus, showToast]);

  const fetchFeedbackUnreadCount = useCallback(async () => {
    if (!canReadFeedback) {
      setFeedbackUnreadCount(0);
      return;
    }
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
  }, [canReadFeedback]);

  const fetchWikiPendingCount = useCallback(async () => {
    if (!canReadWiki) {
      setWikiPendingCount(0);
      return;
    }
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
  }, [canReadWiki]);

  const fetchRumorPendingCount = useCallback(async () => {
    if (!canReadContentReview) {
      setRumorPendingCount(0);
      return;
    }
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
  }, [canReadContentReview]);

  const fetchFeaturePendingCount = useCallback(async () => {
    if (!canReadContentReview) {
      setFeaturePendingCount(0);
      return;
    }
    try {
      const data = await api.getAdminPostFeatures({
        mode: 'pending',
        page: 1,
        limit: 1,
      });
      setFeaturePendingCount(Number(data?.total || 0));
    } catch {
      setFeaturePendingCount(0);
    }
  }, [canReadContentReview]);

  const fetchAnnouncement = useCallback(async () => {
    if (!canReadPublish) {
      setAnnouncementText('');
      setAnnouncementUpdatedAt(null);
      return;
    }
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
  }, [canReadPublish, showToast]);

  const fetchUpdateAnnouncements = useCallback(async () => {
    if (!canReadPublish) {
      setUpdateAnnouncements([]);
      return;
    }
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
  }, [canReadPublish, showToast]);

  const fetchSettings = useCallback(async () => {
    if (!canReadSettings) {
      return;
    }
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
  }, [canReadSettings, showToast]);

  const fetchVocabulary = useCallback(async (options?: { page?: number; search?: string }) => {
    if (!canReadSettings) {
      setVocabularyItems([]);
      setVocabularyTotal(0);
      return;
    }
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
  }, [canReadSettings, showToast, vocabularyPage, vocabularySearch]);

  const fetchAdminUsers = useCallback(async () => {
    if (!isSuperAdmin) {
      return;
    }
    setAdminUsersLoading(true);
    try {
      const data = await api.getAdminUsers();
      setAdminUsers(Array.isArray(data?.items) ? data.items : []);
      setAdminPermissionDefinitions(data?.permissionDefinitions || adminSession.permissionDefinitions || null);
    } catch (error) {
      const message = error instanceof Error ? error.message : '管理员账号加载失败';
      showToast(message, 'error');
    } finally {
      setAdminUsersLoading(false);
    }
  }, [adminSession.permissionDefinitions, isSuperAdmin, showToast]);

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
    if (currentView !== 'deleteRequests') {
      return;
    }
    const timer = setTimeout(() => {
      fetchDeleteRequests().catch(() => { });
    }, 300);
    return () => clearTimeout(timer);
  }, [currentView, fetchDeleteRequests]);

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
    fetchHiddenPendingCount().catch(() => { });
    fetchDeleteRequestPendingCount().catch(() => { });
    fetchWikiPendingCount().catch(() => { });
    fetchRumorPendingCount().catch(() => { });
    fetchFeaturePendingCount().catch(() => { });
  }, [currentView, fetchDeleteRequestPendingCount, fetchFeaturePendingCount, fetchFeedbackUnreadCount, fetchHiddenPendingCount, fetchRumorPendingCount, fetchWikiPendingCount]);

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
    if (currentView !== 'adminUsers') {
      return;
    }
    fetchAdminUsers().catch(() => { });
  }, [currentView, fetchAdminUsers]);

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
    if (!canManageContentReview) {
      showToast('当前账号只有查看权限，不能处理举报', 'warning');
      return;
    }
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
      ],
      submitLabel: '确认封禁',
      onSubmit: async (payload) => {
        await handleReport(reportId, 'ban', payload.reason.trim(), {
          ...buildBanOptionsFromPayload(payload),
          ...(targetType === 'comment' ? { deleteComment: Boolean(payload.extras.deleteComment) } : {}),
        }, { targetId, targetType });
        setReportsLoaded(true);
        const successMessage = targetType === 'comment'
          ? (payload.extras.deleteComment ? '已封禁用户并删除被举报评论' : '已封禁用户，保留被举报评论')
          : '已封禁用户';
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
    if (!canManageContentReview) {
      showToast('当前账号只有查看权限，不能处理举报', 'warning');
      return;
    }
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
        });
  };

  const confirmAction = async () => {
    if (!canManageContentReview) {
      showToast('当前账号只有查看权限，不能处理举报', 'warning');
      return;
    }
    const { reportId, targetId, action, reason, targetType } = confirmModal;
    try {
      await handleReport(reportId, action, reason, undefined, { targetId, targetType });
      setReportsLoaded(true);
      const messages = {
        ignore: '已忽略该举报',
        delete: '已删除该内容',
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
    deleteComment = false
  ) => {
    switch (action) {
      case 'ignore':
        return '忽略该举报';
      case 'delete':
        return '删除该内容';
      case 'ban':
        if (targetType === 'comment') {
          return deleteComment ? '封禁用户并删除被举报评论' : '封禁用户（保留被举报评论）';
        }
        return '封禁用户并删除内容';
    }
  };

  const handlePostAction = (postId: string, action: 'delete' | 'restore', content: string) => {
    if (!canManagePosts) {
      showToast('当前账号只有查看权限，不能处理帖子', 'warning');
      return;
    }
    setPostConfirmModal({ isOpen: true, postId, action, content, reason: '' });
  };

  const openPostBanDrawer = (post: AdminPost) => {
    if (!canManagePosts) {
      showToast('当前账号只有查看权限，不能封禁帖子作者', 'warning');
      return;
    }
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
    if (!canManagePosts) {
      showToast('当前账号只有查看权限，不能封禁评论作者', 'warning');
      return;
    }
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
    if (!canManagePosts) {
      showToast('当前账号只有查看权限，不能处理帖子', 'warning');
      return;
    }
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
    if (!canManagePosts) {
      showToast('当前账号只有查看权限，不能处理评论', 'warning');
      return;
    }
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
    if (!canManageContentReview) {
      showToast('当前账号只有查看权限，不能处理隐藏内容', 'warning');
      return;
    }
    setHiddenActionModal({
      isOpen: true,
      item,
      action,
      reason: '',
    });
  };

  const getHiddenActionLabel = (action: HiddenAction) => (action === 'keep' ? '保持隐藏' : '恢复内容');

  const confirmHiddenAction = async () => {
    if (!canManageContentReview) {
      showToast('当前账号只有查看权限，不能处理隐藏内容', 'warning');
      return;
    }
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
      await fetchHiddenPendingCount();
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

  const openDeleteRequestActionModal = (item: PostDeleteRequest, action: AdminPostDeleteRequestAction) => {
    if (!canManageContentReview) {
      showToast('当前账号只有查看权限，不能处理删除申请', 'warning');
      return;
    }
    setDeleteRequestActionModal({
      isOpen: true,
      item,
      action,
      reason: '',
    });
  };

  const getDeleteRequestActionLabel = (action: AdminPostDeleteRequestAction) => (
    action === 'approve' ? '通过删除申请' : '驳回删除申请'
  );

  const confirmDeleteRequestAction = async () => {
    if (!canManageContentReview) {
      showToast('当前账号只有查看权限，不能处理删除申请', 'warning');
      return;
    }
    const { item, action, reason } = deleteRequestActionModal;
    if (!item) {
      return;
    }
    try {
      await api.handleAdminPostDeleteRequest(item.id, action, reason);
      showToast(action === 'approve' ? '删除申请已通过，帖子已删除' : '删除申请已驳回', 'success');
      setDeleteRequestActionModal({ isOpen: false, item: null, action: 'approve', reason: '' });
      await fetchDeleteRequests();
      await fetchDeleteRequestPendingCount();
      if (action === 'approve') {
        await fetchAdminPosts();
        await loadStats();
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
      setPostSearchInput(nextValue);
      setPostSearch(nextValue);
      setPostPage(1);
      return;
    }
    if (currentView === 'hidden') {
      setHiddenSearchInput(nextValue);
      setHiddenSearch(nextValue);
      setHiddenPage(1);
      return;
    }
    if (currentView === 'audit') {
      setAuditSearchInput(nextValue);
      setAuditSearch(nextValue);
      setAuditPage(1);
      return;
    }
    if (currentView === 'feedback') {
      setFeedbackSearchInput(nextValue);
      setFeedbackSearch(nextValue);
      setFeedbackPage(1);
      return;
    }
    if (currentView === 'bans') {
      setBanSearchInput(nextValue);
      setBanSearch(nextValue);
      return;
    }
    setSearchInput(nextValue);
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
        onBan: options.enableBanActions === false || !canManageUserSafety ? undefined : handleIdentityBanPrepare,
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
            disabled={item.deleted || !canManagePosts}
            onClick={() => handleAdminCommentAction(item.id)}
          >
            删除
          </SketchButton>
          <SketchButton
            variant="secondary"
            className="h-8 px-3 text-xs"
            disabled={!canManagePosts}
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
    if (!canManagePosts) {
      showToast('当前账号只有查看权限，不能处理帖子', 'warning');
      return;
    }
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

  const openBulkReportModal = (action: 'resolve' | 'ignore' = 'resolve', reportIds?: string[]) => {
    if (!canManageContentReview) {
      showToast('当前账号只有查看权限，不能处理举报', 'warning');
      return;
    }
    const ids = reportIds ?? Array.from(selectedReports);
    if (ids.length === 0) {
      showToast(action === 'ignore' ? '暂无可忽略举报' : '请先选择举报', 'warning');
      return;
    }
    setBulkReportModal({ isOpen: true, action, reportIds: Array.from(new Set(ids)), reason: '' });
  };

  const confirmBulkReportAction = async () => {
    const { action, reportIds, reason } = bulkReportModal;
    const chunks: string[][] = [];
    for (let index = 0; index < reportIds.length; index += REPORT_BATCH_CHUNK_SIZE) {
      chunks.push(reportIds.slice(index, index + REPORT_BATCH_CHUNK_SIZE));
    }
    setBulkReportSubmitting(true);
    try {
      for (const chunk of chunks) {
        await api.batchAdminReports(action, chunk, reason);
      }
      const batchSuffix = chunks.length > 1 ? `，已自动分 ${chunks.length} 批完成` : '';
      showToast(`${action === 'ignore' ? '已忽略举报' : '已标记处理'}${batchSuffix}`, action === 'ignore' ? 'info' : 'success');
      setSelectedReports(new Set());
      setBulkReportModal({ isOpen: false, action: 'resolve', reportIds: [], reason: '' });
      await loadReports();
      setReportsLoaded(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : '批量处理失败';
      showToast(message, 'error');
    } finally {
      setBulkReportSubmitting(false);
    }
  };

  const openEditModal = (post: AdminPost) => {
    if (!canManagePosts) {
      showToast('当前账号只有查看权限，不能编辑帖子', 'warning');
      return;
    }
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
    if (!canManageUserSafety) {
      showToast('当前账号只有查看权限，不能处理封禁', 'warning');
      return;
    }
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

  const openFeedbackReplyModal = (message: FeedbackMessage) => {
    if (!canManageFeedback) {
      showToast('当前账号只有查看权限，不能回复留言', 'warning');
      return;
    }
    setFeedbackReplyModal({
      isOpen: true,
      feedbackId: message.id,
      content: message.content,
      reply: '',
    });
  };

  const handleFeedbackReplySubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManageFeedback) {
      showToast('当前账号只有查看权限，不能回复留言', 'warning');
      return;
    }
    const content = feedbackReplyModal.reply.trim();
    if (!content) {
      showToast('请输入回复内容', 'warning');
      return;
    }
    setFeedbackReplySubmitting(true);
    try {
      await api.replyAdminFeedback(feedbackReplyModal.feedbackId, content);
      showToast('回复已发送', 'success');
      setFeedbackReplyModal({ isOpen: false, feedbackId: '', content: '', reply: '' });
      await fetchFeedback();
    } catch (error) {
      const message = error instanceof Error ? error.message : '回复发送失败';
      showToast(message, 'error');
    } finally {
      setFeedbackReplySubmitting(false);
    }
  };

  const openFeedbackActionModal = (message: FeedbackMessage, action: 'delete' | 'ban') => {
    if (!canManageFeedback) {
      showToast('当前账号只有查看权限，不能处理留言', 'warning');
      return;
    }
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
    if (!canManagePublish) {
      showToast('当前账号只有查看权限，不能发布内容', 'warning');
      return;
    }
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
    if (!canManagePublish) {
      showToast('当前账号只有查看权限，不能发布公告', 'warning');
      return;
    }
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
    if (!canManagePublish) {
      showToast('当前账号只有查看权限，不能发布更新公告', 'warning');
      return;
    }
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
    if (!canManagePublish) {
      showToast('当前账号只有查看权限，不能清空公告', 'warning');
      return;
    }
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
    if (!canManagePublish) {
      showToast('当前账号只有查看权限，不能删除更新公告', 'warning');
      return;
    }
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
    if (!canManageSettings) {
      showToast('当前账号只有查看权限，不能保存系统设置', 'warning');
      return;
    }
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
    if (!canManageSettings) {
      showToast('当前账号只有查看权限，不能发送测试消息', 'warning');
      return;
    }
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
    if (!canManageSettings) {
      showToast('当前账号只有查看权限，不能添加违禁词', 'warning');
      return;
    }
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
    if (!canManageSettings) {
      showToast('当前账号只有查看权限，不能更新违禁词', 'warning');
      return;
    }
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
    if (!canManageSettings) {
      showToast('当前账号只有查看权限，不能删除违禁词', 'warning');
      return;
    }
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
    if (!canManageSettings) {
      showToast('当前账号只有查看权限，不能导入违禁词', 'warning');
      return;
    }
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
      await copyTextToClipboard(content);
      showToast('已复制到剪贴板', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '导出失败';
      showToast(message, 'error');
    } finally {
      setVocabularySubmitting(false);
    }
  };


  const handleAdminUserCreate = async (payload: { username: string; password: string; permissions: AdminPermissions }) => {
    setAdminUsersSubmitting(true);
    try {
      await api.createAdminUser(payload);
      await fetchAdminUsers();
      showToast('管理员账号已创建', 'success');
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : '管理员账号创建失败';
      showToast(message, 'error');
      return false;
    } finally {
      setAdminUsersSubmitting(false);
    }
  };

  const handleAdminUserPermissionsChange = async (id: number, permissions: AdminPermissions) => {
    setAdminUsersSubmitting(true);
    try {
      await api.updateAdminUserPermissions(id, permissions);
      await fetchAdminUsers();
      showToast('管理员权限已更新', 'success');
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : '管理员权限更新失败';
      showToast(message, 'error');
      return false;
    } finally {
      setAdminUsersSubmitting(false);
    }
  };

  const handleAdminUserStatusChange = async (id: number, disabled: boolean) => {
    setAdminUsersSubmitting(true);
    try {
      await api.updateAdminUserStatus(id, disabled);
      await fetchAdminUsers();
      showToast(disabled ? '管理员账号已禁用' : '管理员账号已启用', 'success');
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : '管理员状态更新失败';
      showToast(message, 'error');
      return false;
    } finally {
      setAdminUsersSubmitting(false);
    }
  };

  const handleAdminUserPasswordReset = async (id: number, password: string) => {
    setAdminUsersSubmitting(true);
    try {
      await api.resetAdminUserPassword(id, password);
      showToast('管理员密码已重置', 'success');
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : '管理员密码重置失败';
      showToast(message, 'error');
      return false;
    } finally {
      setAdminUsersSubmitting(false);
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

  type AdminNavGroup = {
    title: string;
    items: Array<{ view: AdminView; icon: React.ReactNode; label: string; badge?: number; visible?: boolean }>;
  };

  const adminNavGroups: AdminNavGroup[] = ([
      {
        title: '今日处理',
        items: [
          { view: 'overview', icon: <LayoutDashboard size={18} />, label: '待办工作台', visible: true },
          { view: 'reports', icon: <Flag size={18} />, label: '待处理举报', badge: pendingReportCount, visible: canReadContentReview },
          { view: 'rumors', icon: <AlertTriangle size={18} />, label: '谣言审核', badge: rumorPendingCount, visible: canReadContentReview },
          { view: 'features', icon: <Star size={18} />, label: '精华管理', badge: featurePendingCount, visible: canReadContentReview },
          { view: 'deleteRequests', icon: <Trash2 size={18} />, label: '删除申请', badge: deleteRequestPendingCount, visible: canReadContentReview },
          { view: 'wiki', icon: <BookOpen size={18} />, label: '瓜条审核', badge: wikiPendingCount, visible: canReadWiki },
          { view: 'feedback', icon: <MessageSquare size={18} />, label: '留言管理', badge: feedbackUnreadCount, visible: canReadFeedback },
        ],
      },
      {
        title: '内容管理',
        items: [
          { view: 'posts', icon: <FileText size={18} />, label: '帖子管理', visible: canReadPosts },
          { view: 'hidden', icon: <EyeOff size={18} />, label: '隐藏内容', badge: hiddenPendingCount, visible: canReadContentReview },
          { view: 'announcement', icon: <Bell size={18} />, label: '发布中心', visible: canReadPublish },
        ],
      },
      {
        title: '用户与安全',
        items: [
          { view: 'bans', icon: <Shield size={18} />, label: '封禁管理', visible: canReadUserSafety },
          { view: 'audit', icon: <ClipboardList size={18} />, label: '操作审计', visible: isSuperAdmin },
          { view: 'processed', icon: <Gavel size={18} />, label: '已处理举报', visible: canReadContentReview },
        ],
      },
      {
        title: '系统',
        items: [
          { view: 'settings', icon: <Settings size={18} />, label: '系统设置', visible: canReadSettings },
          { view: 'shop', icon: <Store size={18} />, label: '商城管理', visible: canReadSettings },
          { view: 'adminUsers', icon: <UserCog size={18} />, label: '管理员管理', visible: isSuperAdmin },
        ],
      },
    ] satisfies AdminNavGroup[])
      .map((group) => ({ ...group, items: group.items.filter((item) => item.visible !== false) }))
      .filter((group) => group.items.length > 0);

  const AdminNavGroups: React.FC<{ onSelect?: () => void }> = ({ onSelect }) => (
    <nav className="flex flex-col gap-5 font-sans text-sm">
      {adminNavGroups.map((group) => (
        <div key={group.title} className="flex flex-col gap-2">
          <p className="px-2 text-[11px] font-bold tracking-[0.22em] text-pencil">{group.title}</p>
          <div className="flex flex-col gap-1.5 font-bold">
            {group.items.map((item) => (
              <NavItem
                key={item.view}
                view={item.view}
                icon={item.icon}
                label={item.label}
                badge={item.badge}
                onSelect={onSelect}
              />
            ))}
          </div>
        </div>
      ))}
    </nav>
  );

  const firstAvailableView = adminNavGroups[0]?.items[0]?.view || 'overview';
  useEffect(() => {
    const exists = adminNavGroups.some((group) => group.items.some((item) => item.view === currentView));
    if (!exists) {
      setCurrentView(firstAvailableView);
    }
  }, [adminNavGroups, currentView, firstAvailableView]);

  const totalPostPages = Math.max(Math.ceil(postTotal / POST_PAGE_SIZE), 1);
  const totalHiddenPages = Math.max(Math.ceil(hiddenTotal / HIDDEN_PAGE_SIZE), 1);
  const totalDeleteRequestPages = Math.max(Math.ceil(deleteRequestTotal / DELETE_REQUEST_PAGE_SIZE), 1);
  const isReportView = currentView === 'reports' || currentView === 'processed';
  const isPostView = currentView === 'posts';
  const isHiddenView = currentView === 'hidden';
  const isBanView = currentView === 'bans';
  const isAuditView = currentView === 'audit';
  const isFeedbackView = currentView === 'feedback';
  const isAdminUsersView = currentView === 'adminUsers';
  const isSearchableView = isReportView || isPostView || isHiddenView || isBanView || isAuditView || isFeedbackView;
  const currentSearchValue = isPostView
    ? postSearchInput
    : isHiddenView
      ? hiddenSearchInput
      : isBanView
        ? banSearchInput
        : isAuditView
          ? auditSearchInput
          : isFeedbackView
            ? feedbackSearchInput
            : searchInput;
  const currentSearchPlaceholder = isPostView
    ? '搜索帖子或评论内容/ID/IP/身份...'
    : isHiddenView
      ? '搜索隐藏帖子或评论/ID/IP/身份...'
      : isBanView
        ? '搜索封禁对象/理由/权限/IP/身份...'
        : isAuditView
          ? '搜索操作/目标/管理员/IP/理由...'
          : isFeedbackView
            ? '搜索内容或联系方式/IP/身份...'
            : '搜索 ID/内容/IP/身份...';
  const handleCurrentSearchChange = (value: string) => {
    if (isPostView) {
      setPostSearchInput(value);
      return;
    }
    if (isHiddenView) {
      setHiddenSearchInput(value);
      return;
    }
    if (isBanView) {
      setBanSearchInput(value);
      return;
    }
    if (isAuditView) {
      setAuditSearchInput(value);
      return;
    }
    if (isFeedbackView) {
      setFeedbackSearchInput(value);
      return;
    }
    setSearchInput(value);
  };
  const totalAuditPages = Math.max(Math.ceil(auditTotal / AUDIT_PAGE_SIZE), 1);
  const totalFeedbackPages = Math.max(Math.ceil(feedbackTotal / FEEDBACK_PAGE_SIZE), 1);

  return (
    <div className="admin-font flex min-h-screen-safe bg-paper overflow-hidden overflow-x-hidden">
      {/* Sidebar */}
      <aside className="w-72 flex-shrink-0 flex flex-col border-r-2 border-ink bg-paper z-20 hidden md:flex">
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-full bg-ink border-2 border-ink flex items-center justify-center text-white">
              <LayoutDashboard size={20} />
            </div>
            <div>
              <h1 className="font-display text-xl leading-none">衙门</h1>
              <span className="text-xs text-pencil font-sans">管理员后台</span>
            </div>
          </div>

          <AdminNavGroups />
        </div>
        <div className="p-5 border-t-2 border-ink/10">
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
              {currentView === 'deleteRequests' && <><Trash2 /> 删除申请</>}
              {currentView === 'announcement' && <><Bell /> 公告发布</>}
              {currentView === 'settings' && <><Settings /> 系统设置</>}
              {currentView === 'shop' && <><Store /> 商城管理</>}
              {currentView === 'wiki' && <><BookOpen /> 瓜条审核</>}
              {currentView === 'rumors' && <><AlertTriangle /> 谣言审核</>}
              {currentView === 'features' && <><Star /> 精华管理</>}
              {currentView === 'feedback' && <><MessageSquare /> 留言管理</>}
              {currentView === 'reports' && <><Flag /> 待处理举报</>}
              {currentView === 'processed' && <><Gavel /> 已处理</>}
              {currentView === 'bans' && <><Shield /> 封禁管理</>}
              {currentView === 'audit' && <><ClipboardList /> 操作审计</>}
            </h2>
          </div>
          <div className="flex flex-wrap sm:flex-nowrap items-center gap-3 w-full sm:w-auto">
            {isSearchableView && (
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-pencil w-4 h-4" />
                <input
                  type="text"
                  value={currentSearchValue}
                  onChange={(e) => handleCurrentSearchChange(e.target.value)}
                  placeholder={currentSearchPlaceholder}
                  className="pl-9 pr-4 py-2 rounded-full border-2 border-ink bg-white text-sm focus:shadow-sketch-sm outline-none transition-all w-full font-sans"
                />
              </div>
            )}
            <button
              type="button"
              onClick={() => setCurrentView(pendingReportCount > 0 ? 'reports' : 'overview')}
              className="relative p-2 border-2 border-transparent hover:border-ink rounded-full hover:bg-highlight transition-all"
              aria-label="打开待办"
            >
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
            <div className="absolute left-0 top-0 h-full h-dvh w-72 bg-paper border-r-2 border-ink px-6 pt-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] flex min-h-0 flex-col">
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
              <div className="min-h-0 flex-1 overflow-y-auto pr-1 pb-4">
                <AdminNavGroups onSelect={() => setMobileNavOpen(false)} />
              </div>
              <div className="shrink-0 pt-6 border-t-2 border-ink/10">
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
                pendingReportCount={pendingReportCount}
                hiddenPendingCount={hiddenPendingCount}
                deleteRequestPendingCount={deleteRequestPendingCount}
                wikiPendingCount={wikiPendingCount}
                rumorPendingCount={rumorPendingCount}
                feedbackUnreadCount={feedbackUnreadCount}
                totalPosts={state.stats.totalPosts}
                totalVisits={state.stats.totalVisits}
                onlineCount={state.stats.onlineCount}
                totalWeeklyVisits={totalWeeklyVisits}
                appVersionLabel={appVersionLabel}
                postVolumeData={postVolumeData}
                visitData={visitData}
                visiblePendingReports={visiblePendingReports}
                onOpenReports={() => setCurrentView('reports')}
                onOpenHidden={() => setCurrentView('hidden')}
                onOpenDeleteRequests={() => setCurrentView('deleteRequests')}
                onOpenWiki={() => setCurrentView('wiki')}
                onOpenRumors={() => setCurrentView('rumors')}
                onOpenFeedback={() => setCurrentView('feedback')}
                onReportAction={handleAction}
                onReportDetail={(item) => setReportDetail({ isOpen: true, report: item })}
                renderIdentity={renderIdentity}
                canReadContentReview={canReadContentReview}
                canReadPosts={canReadPosts}
                canReadWiki={canReadWiki}
                canReadFeedback={canReadFeedback}
                canReadSettings={canReadSettings}
                canManageContentReview={canManageContentReview}
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
                    {canManagePosts ? (
                      <label className="flex items-center gap-2 text-pencil">
                        <input
                          type="checkbox"
                          className="accent-black"
                          checked={postItems.length > 0 && postItems.every((post) => selectedPosts.has(post.id))}
                          onChange={toggleAllPosts}
                        />
                        本页全选
                      </label>
                    ) : (
                      <span className="text-pencil">只读模式</span>
                    )}
                    {canManagePosts && (
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
                    )}
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
                              {canManagePosts && (
                                <input
                                  type="checkbox"
                                  className="accent-black"
                                  checked={selectedPosts.has(post.id)}
                                  onChange={() => togglePostSelection(post.id)}
                                />
                              )}
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
                              disabled={!canManagePosts}
                              onClick={() => openEditModal(post)}
                            >
                              <Pencil size={14} /> 编辑
                            </SketchButton>
                            <SketchButton
                              variant="primary"
                              className="h-10 px-3 text-xs flex items-center gap-1 text-white"
                              disabled={!canManagePosts}
                              onClick={() => openPostBanDrawer(post)}
                            >
                              <Ban size={14} /> 封禁
                            </SketchButton>
                            {post.deleted ? (
                              <SketchButton
                                variant="secondary"
                                className="h-10 px-3 text-xs flex items-center gap-1"
                                disabled={!canManagePosts}
                                onClick={() => handlePostAction(post.id, 'restore', post.content)}
                              >
                                <RotateCcw size={14} /> 恢复
                              </SketchButton>
                            ) : (
                              <SketchButton
                                variant="danger"
                                className="h-10 px-3 text-xs flex items-center gap-1"
                                disabled={!canManagePosts}
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
                              disabled={!canManageContentReview}
                              onClick={() => openHiddenActionModal(item, 'keep')}
                            >
                              <EyeOff size={14} /> 保持隐藏
                            </SketchButton>
                            <SketchButton
                              variant="primary"
                              className="h-10 px-3 text-xs flex items-center gap-1 text-white"
                              disabled={!canManageContentReview}
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

            {currentView === 'deleteRequests' && (
              <AdminPostDeleteRequestsView
                status={deleteRequestStatus}
                total={deleteRequestTotal}
                page={deleteRequestPage}
                totalPages={totalDeleteRequestPages}
                loading={deleteRequestLoading}
                items={deleteRequestItems}
                canManage={canManageContentReview}
                formatTimestamp={formatTimestamp}
                renderIdentity={renderIdentity}
                onStatusChange={(nextStatus) => {
                  setDeleteRequestStatus(nextStatus);
                  setDeleteRequestPage(1);
                }}
                onPageChange={setDeleteRequestPage}
                onOpenAction={openDeleteRequestActionModal}
              />
            )}

            {/* Publish Center */}
            {currentView === 'announcement' && (
              <AdminPublishCenterView
                composeText={composeText}
                composeMaxLength={composeMaxLength}
                composeSubmitting={composeSubmitting}
                composeIncludeDeveloper={composeIncludeDeveloper}
                announcementText={announcementText}
                announcementUpdatedAt={announcementUpdatedAt}
                announcementSubmitting={announcementSubmitting}
                announcementLoading={announcementLoading}
                updateAnnouncementText={updateAnnouncementText}
                updateAnnouncementSubmitting={updateAnnouncementSubmitting}
                updateAnnouncementLoading={updateAnnouncementLoading}
                updateAnnouncements={updateAnnouncements}
                canManage={canManagePublish}
                showToast={showToast}
                formatAnnouncementTime={formatAnnouncementTime}
                onComposeTextChange={setComposeText}
                onComposeIncludeDeveloperChange={setComposeIncludeDeveloper}
                onComposeSubmit={handleComposeSubmit}
                onAnnouncementTextChange={setAnnouncementText}
                onAnnouncementSubmit={handleAnnouncementSubmit}
                onAnnouncementClear={handleAnnouncementClear}
                onUpdateAnnouncementTextChange={setUpdateAnnouncementText}
                onUpdateAnnouncementSubmit={handleUpdateAnnouncementSubmit}
                onUpdateAnnouncementDelete={handleUpdateAnnouncementDelete}
              />
            )}

            {currentView === 'shop' && (
              <AdminShopView
                showToast={showToast}
                canManage={canManageSettings}
              />
            )}

            {/* Settings View */}
            {currentView === 'settings' && (
              <AdminSystemSettingsView
                settingsLoading={settingsLoading}
                settingsSubmitting={settingsSubmitting}
                turnstileEnabled={turnstileEnabled}
                cnyThemeEnabled={cnyThemeEnabled}
                cnyThemeAutoActive={cnyThemeAutoActive}
                cnyThemeActive={cnyThemeActive}
                cnyThemePreviewActive={cnyThemePreviewActive}
                defaultPostTagsInput={defaultPostTagsInput}
                defaultPostTagsValidCount={parsedDefaultPostTags.length}
                maxDefaultPostTags={MAX_DEFAULT_POST_TAGS}
                maxTagLength={MAX_TAG_LENGTH}
                autoHideReportThreshold={autoHideReportThreshold}
                wecomWebhookEnabled={wecomWebhookEnabled}
                wecomWebhookConfigured={wecomWebhookConfigured}
                wecomWebhookMaskedUrl={wecomWebhookMaskedUrl}
                wecomWebhookUrlInput={wecomWebhookUrlInput}
                wecomWebhookClearUrl={wecomWebhookClearUrl}
                wecomWebhookTesting={wecomWebhookTesting}
                rateLimits={rateLimits}
                vocabularyItems={vocabularyItems}
                vocabularySearch={vocabularySearch}
                vocabularyNewWord={vocabularyNewWord}
                vocabularyTotal={vocabularyTotal}
                vocabularyPage={vocabularyPage}
                totalVocabularyPages={totalVocabularyPages}
                vocabularyLoading={vocabularyLoading}
                vocabularySubmitting={vocabularySubmitting}
                canManage={canManageSettings}
                formatUpdatedAt={formatAnnouncementTime}
                onSubmit={handleSettingsSubmit}
                onTurnstileEnabledChange={setTurnstileEnabled}
                onCnyThemeEnabledChange={setCnyThemeEnabled}
                onDefaultPostTagsChange={setDefaultPostTagsInput}
                onAutoHideReportThresholdChange={(value) => setAutoHideReportThreshold(normalizeAutoHideReportThreshold(value))}
                onWecomWebhookEnabledChange={setWecomWebhookEnabled}
                onWecomWebhookUrlInputChange={(value) => {
                  setWecomWebhookUrlInput(value);
                  if (value.trim()) {
                    setWecomWebhookClearUrl(false);
                  }
                }}
                onWecomWebhookClearUrlChange={setWecomWebhookClearUrl}
                onWecomWebhookTest={handleWecomWebhookTest}
                onRateLimitCountChange={updateRateLimitCount}
                onRateLimitWindowSecondsChange={updateRateLimitWindowSeconds}
                onVocabularySearchChange={(value) => {
                  setVocabularySearch(value);
                  setVocabularyPage(1);
                }}
                onVocabularyNewWordChange={setVocabularyNewWord}
                onVocabularyAdd={handleVocabularyAdd}
                onVocabularyImport={handleVocabularyImport}
                onVocabularyExport={handleVocabularyExport}
                onVocabularyToggle={handleVocabularyToggle}
                onVocabularyDelete={handleVocabularyDelete}
                onVocabularyPageChange={setVocabularyPage}
              />
            )}
            {currentView === 'wiki' && (
              <AdminWikiPanel showToast={showToast} onPendingCountChange={fetchWikiPendingCount} canManage={canManageWiki} />
            )}

            {currentView === 'rumors' && (
              <AdminRumorPanel showToast={showToast} onPendingCountChange={fetchRumorPendingCount} canManage={canManageContentReview} />
            )}

            {currentView === 'features' && (
              <AdminFeaturedPanel showToast={showToast} onPendingCountChange={fetchFeaturePendingCount} canManage={canManageContentReview} />
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
                canManage={canManageFeedback}
                formatTimestamp={formatTimestamp}
                renderIdentity={renderIdentity}
                onFeedbackStatusChange={(status) => {
                  setFeedbackStatus(status);
                  setFeedbackPage(1);
                }}
                onFeedbackPageChange={setFeedbackPage}
                onFeedbackRead={handleFeedbackRead}
                onOpenFeedbackReply={openFeedbackReplyModal}
                onOpenFeedbackAction={openFeedbackActionModal}
              />
            )}

            {/* Bans View */}
            {currentView === 'bans' && (
              <AdminBansView
                mergedBans={mergedBans}
                banLoading={banLoading}
                banSearchInput={banSearchInput}
                canManage={canManageUserSafety}
                formatTimestamp={formatTimestamp}
                formatBanPermissions={formatBanPermissions}
                renderIdentity={renderIdentity}
                onBanSearchChange={setBanSearchInput}
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
                filters={auditFilters}
                formatTimestamp={formatTimestamp}
                onOpenAuditDetail={(log) => setAuditDetail({ isOpen: true, log })}
                onAuditPageChange={setAuditPage}
                onAuditFiltersChange={handleAuditFiltersChange}
              />
            )}

            {currentView === 'adminUsers' && (
              <AdminUsersView
                items={adminUsers}
                permissionDefinitions={adminPermissionDefinitions}
                loading={adminUsersLoading}
                submitting={adminUsersSubmitting}
                onRefresh={fetchAdminUsers}
                onCreate={handleAdminUserCreate}
                onPermissionsChange={handleAdminUserPermissionsChange}
                onStatusChange={handleAdminUserStatusChange}
                onPasswordReset={handleAdminUserPasswordReset}
                formatTimestamp={formatAnnouncementTime}
              />
            )}

            {/* Reports View */}
            {(currentView === 'reports' || currentView === 'processed') && (
              <AdminReportsView
                showProcessed={currentView === 'processed'}
                reportsLoading={reportsLoading}
                canManage={canManageContentReview}
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

      <AdminActionDrawer
        isOpen={confirmModal.isOpen}
        title={getActionLabel(confirmModal.action, confirmModal.targetType, confirmModal.deleteComment)}
        actionLabel={`确认${confirmModal.action === 'delete' ? '删除' : confirmModal.action === 'ban' ? '封禁' : '忽略'}`}
        actionVariant={confirmModal.action === 'ignore' ? 'secondary' : 'danger'}
        summary={confirmModal.content}
        meta={`举报目标：${confirmModal.targetType} · ${confirmModal.targetId || '-'}`}
        reason={confirmModal.reason}
        onReasonChange={(value) => setConfirmModal((prev) => ({ ...prev, reason: value }))}
        onClose={() => setConfirmModal({ ...EMPTY_REPORT_CONFIRM_MODAL })}
        onConfirm={confirmAction}
      />

      <AdminActionDrawer
        isOpen={postConfirmModal.isOpen}
        title={getPostActionLabel(postConfirmModal.action)}
        actionLabel={`确认${postConfirmModal.action === 'delete' ? '删除' : '恢复'}`}
        actionVariant={postConfirmModal.action === 'delete' ? 'danger' : 'primary'}
        summary={postConfirmModal.content}
        meta={`帖子 ID：${postConfirmModal.postId || '-'}`}
        reason={postConfirmModal.reason}
        onReasonChange={(value) => setPostConfirmModal((prev) => ({ ...prev, reason: value }))}
        onClose={() => setPostConfirmModal({ isOpen: false, postId: '', action: 'delete', content: '', reason: '' })}
        onConfirm={confirmPostAction}
      />

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

      <AdminActionDrawer
        isOpen={hiddenActionModal.isOpen}
        title={getHiddenActionLabel(hiddenActionModal.action)}
        actionLabel={`确认${hiddenActionModal.action === 'keep' ? '保持隐藏' : '恢复'}`}
        actionVariant={hiddenActionModal.action === 'restore' ? 'primary' : 'secondary'}
        summary={hiddenActionModal.item?.content || '（无内容）'}
        meta={hiddenActionModal.item ? `${hiddenActionModal.item.type === 'post' ? '帖子' : '评论'} #${hiddenActionModal.item.id}` : undefined}
        reason={hiddenActionModal.reason}
        reasonPlaceholder="填写理由便于审计追踪"
        onReasonChange={(value) => setHiddenActionModal((prev) => ({ ...prev, reason: value }))}
        onClose={() => setHiddenActionModal({ isOpen: false, item: null, action: 'keep', reason: '' })}
        onConfirm={confirmHiddenAction}
      />

      <AdminActionDrawer
        isOpen={deleteRequestActionModal.isOpen}
        title={getDeleteRequestActionLabel(deleteRequestActionModal.action)}
        actionLabel={deleteRequestActionModal.action === 'approve' ? '确认通过并删除' : '确认驳回'}
        actionVariant={deleteRequestActionModal.action === 'approve' ? 'danger' : 'secondary'}
        summary={deleteRequestActionModal.item?.reason || '（无申请原因）'}
        meta={deleteRequestActionModal.item ? `帖子 ID：${deleteRequestActionModal.item.postId}` : undefined}
        reason={deleteRequestActionModal.reason}
        reasonPlaceholder="处理说明（可选，留空会使用默认通知文案）"
        onReasonChange={(value) => setDeleteRequestActionModal((prev) => ({ ...prev, reason: value }))}
        onClose={() => setDeleteRequestActionModal({ isOpen: false, item: null, action: 'approve', reason: '' })}
        onConfirm={confirmDeleteRequestAction}
      />

      <AdminActionDrawer
        isOpen={bulkPostModal.isOpen}
        title={`批量${getBulkActionLabel(bulkPostModal.action)}`}
        actionLabel="确认执行"
        actionVariant={bulkPostModal.action === 'delete' ? 'danger' : 'secondary'}
        summary={`本次将处理 ${selectedPosts.size} 条帖子。`}
        reason={bulkPostModal.reason}
        onReasonChange={(value) => setBulkPostModal((prev) => ({ ...prev, reason: value }))}
        onClose={() => setBulkPostModal({ isOpen: false, action: 'delete', reason: '' })}
        onConfirm={confirmBulkPostAction}
      />

      <AdminActionDrawer
        isOpen={bulkReportModal.isOpen}
        title={bulkReportModal.action === 'ignore' ? '批量忽略举报' : '批量标记处理'}
        actionLabel={bulkReportModal.action === 'ignore' ? '确认忽略' : '确认标记'}
        actionVariant="secondary"
        summary={`本次将${bulkReportModal.action === 'ignore' ? '忽略' : '标记'} ${bulkReportModal.reportIds.length} 条举报。`}
        meta={bulkReportModal.reportIds.length > REPORT_BATCH_CHUNK_SIZE ? `单批最多处理 ${REPORT_BATCH_CHUNK_SIZE} 条，本次会自动分批提交。` : undefined}
        reason={bulkReportModal.reason}
        submitting={bulkReportSubmitting}
        onReasonChange={(value) => setBulkReportModal((prev) => ({ ...prev, reason: value }))}
        onClose={() => setBulkReportModal({ isOpen: false, action: 'resolve', reportIds: [], reason: '' })}
        onConfirm={confirmBulkReportAction}
      />

      <AdminActionDrawer
        isOpen={feedbackActionModal.isOpen}
        title={feedbackActionModal.action === 'delete' ? '删除留言' : '封禁用户'}
        actionLabel={`确认${feedbackActionModal.action === 'delete' ? '删除' : '封禁'}`}
        actionVariant={feedbackActionModal.action === 'delete' ? 'danger' : 'secondary'}
        summary={feedbackActionModal.content}
        meta={`留言 ID：${feedbackActionModal.feedbackId || '-'}`}
        reason={feedbackActionModal.reason}
        onReasonChange={(value) => setFeedbackActionModal((prev) => ({ ...prev, reason: value }))}
        onClose={() => setFeedbackActionModal({ isOpen: false, feedbackId: '', action: 'delete', content: '', reason: '' })}
        onConfirm={confirmFeedbackAction}
      />

      <Modal
        isOpen={feedbackReplyModal.isOpen}
        onClose={() => {
          if (!feedbackReplySubmitting) {
            setFeedbackReplyModal({ isOpen: false, feedbackId: '', content: '', reply: '' });
          }
        }}
        title="回复留言"
      >
        <form className="flex flex-col gap-4" onSubmit={handleFeedbackReplySubmit}>
          <div className="rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 p-3">
            <p className="line-clamp-4 whitespace-pre-wrap text-sm text-pencil">"{feedbackReplyModal.content}"</p>
          </div>
          <div>
            <label className="text-xs text-pencil font-sans">回复内容（必填）</label>
            <textarea
              value={feedbackReplyModal.reply}
              onChange={(event) => setFeedbackReplyModal((prev) => ({ ...prev, reply: event.target.value }))}
              className="mt-2 h-32 w-full resize-none rounded-lg border-2 border-gray-200 p-3 text-sm font-sans outline-none focus:border-ink"
              placeholder="输入要发送给用户的回复"
              maxLength={1000}
            />
          </div>
          <p className="text-xs text-pencil font-sans">提交后会写入回复历史，并在用户通知中直接展示完整回复。</p>
          <div className="flex gap-3">
            <SketchButton
              type="button"
              variant="secondary"
              className="flex-1"
              disabled={feedbackReplySubmitting}
              onClick={() => setFeedbackReplyModal({ isOpen: false, feedbackId: '', content: '', reply: '' })}
            >
              取消
            </SketchButton>
            <SketchButton
              type="submit"
              variant="primary"
              className="flex-1"
              disabled={feedbackReplySubmitting}
            >
              {feedbackReplySubmitting ? '发送中...' : '发送回复'}
            </SketchButton>
          </div>
        </form>
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

      <AdminAuditDetailModal
        isOpen={auditDetail.isOpen}
        log={auditDetail.log}
        formatTimestamp={formatTimestamp}
        onClose={() => setAuditDetail({ isOpen: false, log: null })}
      />

      <Modal
        isOpen={reportDetail.isOpen}
        onClose={() => setReportDetail({ isOpen: false, report: null })}
        title="举报详情"
        panelClassName="max-w-2xl"
      >
        <div className="flex flex-col gap-4">
          <div className="text-xs text-pencil font-sans">
            <p>举报 ID：{reportDetail.report?.id}</p>
            <p>类型：{reportDetail.report?.targetType === 'comment' ? '评论举报' : '帖子举报'}</p>
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


