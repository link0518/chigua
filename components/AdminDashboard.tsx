import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, LabelList,
  LineChart, Line
} from 'recharts';
import { Flag, Gavel, BarChart2, Bell, Search, Trash2, Ban, Eye, EyeOff, LayoutDashboard, LogOut, CheckCircle, XCircle, FileText, PenSquare, Pencil, RotateCcw, Shield, ClipboardList, MessageSquare, Menu, X } from 'lucide-react';
import { SketchButton, Badge, roughBorderClassSm } from './SketchUI';
import { AdminAuditLog, AdminComment, AdminPost, FeedbackMessage, Report } from '../types';
import { useApp } from '../store/AppContext';
import Modal from './Modal';
import { api } from '../api';
import MarkdownRenderer from './MarkdownRenderer';

type AdminView = 'overview' | 'reports' | 'processed' | 'posts' | 'compose' | 'bans' | 'audit' | 'feedback' | 'announcement';
type PostStatusFilter = 'all' | 'active' | 'deleted';
type PostSort = 'time' | 'hot' | 'reports';

const WEEK_DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const POST_PAGE_SIZE = 10;
const AUDIT_PAGE_SIZE = 12;
const FEEDBACK_PAGE_SIZE = 8;
const BAN_PERMISSION_LABELS: Record<string, string> = {
  post: '发帖',
  comment: '回帖',
  like: '点赞',
  view: '查看',
  site: '禁止进入网站',
};
const BAN_DURATION_OPTIONS = [
  { id: '1h', label: '1 小时', ms: 60 * 60 * 1000 },
  { id: '1d', label: '1 天', ms: 24 * 60 * 60 * 1000 },
  { id: '7d', label: '7 天', ms: 7 * 24 * 60 * 60 * 1000 },
  { id: 'forever', label: '永久', ms: null },
  { id: 'custom', label: '自定义日期', ms: null },
];

const StatCard: React.FC<{ title: string; value: string; trend: string; trendUp: boolean; icon: React.ReactNode; color?: string; valueClassName?: string }> = ({ title, value, trend, trendUp, icon, color = 'bg-white', valueClassName = '' }) => (
  <div className={`${color} p-6 border-2 border-ink shadow-sketch relative overflow-hidden group hover:-translate-y-1 transition-transform duration-200 sticky-curl ${roughBorderClassSm}`}>
    <div className="absolute -right-4 -top-4 text-ink/10 rotate-12 group-hover:rotate-0 transition-transform scale-150 opacity-100">
      {icon}
    </div>
    <p className="text-pencil text-sm font-bold mb-2 uppercase tracking-wider font-sans">{title}</p>
    <div className="flex items-end gap-3 relative z-10 flex-wrap">
      <span className={`text-5xl font-display text-ink ${valueClassName}`} title={value}>{value}</span>
      <span className={`text-xs font-bold border border-ink px-2 py-1 rounded-sm shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] ${trendUp ? 'bg-alert' : 'bg-gray-200'}`}>
        {trend}
      </span>
    </div>
  </div>
);

const AdminDashboard: React.FC = () => {
  const { state, handleReport, showToast, getPendingReports, loadReports, loadStats, logoutAdmin } = useApp();
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
  const [selectedPosts, setSelectedPosts] = useState<Set<string>>(new Set());
  const [selectedReports, setSelectedReports] = useState<Set<string>>(new Set());
  const [composeText, setComposeText] = useState('');
  const [composePreview, setComposePreview] = useState(false);
  const [composeSubmitting, setComposeSubmitting] = useState(false);
  const [announcementText, setAnnouncementText] = useState('');
  const [announcementPreview, setAnnouncementPreview] = useState(false);
  const [announcementLoading, setAnnouncementLoading] = useState(false);
  const [announcementSubmitting, setAnnouncementSubmitting] = useState(false);
  const [announcementUpdatedAt, setAnnouncementUpdatedAt] = useState<number | null>(null);
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
  const [bannedFingerprints, setBannedFingerprints] = useState<Array<{ fingerprint: string; bannedAt: number; expiresAt?: number | null; permissions?: string[]; reason?: string | null }>>([]);
  const [banLoading, setBanLoading] = useState(false);
  const [banDuration, setBanDuration] = useState<'1h' | '1d' | '7d' | 'forever' | 'custom'>('7d');
  const [banCustomUntil, setBanCustomUntil] = useState('');
  const [banPermissions, setBanPermissions] = useState<string[]>(['post', 'comment', 'like', 'view', 'site']);
  const [banSearch, setBanSearch] = useState('');
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
  const [feedbackUnreadCount, setFeedbackUnreadCount] = useState(0);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackActionModal, setFeedbackActionModal] = useState<{
    isOpen: boolean;
    feedbackId: string;
    action: 'delete' | 'ban';
    content: string;
    reason: string;
  }>({ isOpen: false, feedbackId: '', action: 'delete', content: '', reason: '' });
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    reportId: string;
    action: 'ignore' | 'delete' | 'ban';
    content: string;
    reason: string;
  }>({ isOpen: false, reportId: '', action: 'ignore', content: '', reason: '' });
  const [postConfirmModal, setPostConfirmModal] = useState<{
    isOpen: boolean;
    postId: string;
    action: 'delete' | 'restore';
    content: string;
    reason: string;
  }>({ isOpen: false, postId: '', action: 'delete', content: '', reason: '' });
  const [postBanModal, setPostBanModal] = useState<{
    isOpen: boolean;
    postId: string;
    content: string;
    reason: string;
  }>({ isOpen: false, postId: '', content: '', reason: '' });
  const [postCommentsModal, setPostCommentsModal] = useState<{
    isOpen: boolean;
    postId: string;
    content: string;
  }>({ isOpen: false, postId: '', content: '' });
  const [postComments, setPostComments] = useState<AdminComment[]>([]);
  const [postCommentsLoading, setPostCommentsLoading] = useState(false);
  const [reportDetail, setReportDetail] = useState<{ isOpen: boolean; report: Report | null }>({ isOpen: false, report: null });
  const composeMaxLength = 2000;
  const appVersion = import.meta.env.VITE_APP_VERSION || '0.0.0';
  const appVersionLabel = appVersion.startsWith('v') ? appVersion : `v${appVersion}`;

  useEffect(() => {
    loadReports().catch(() => { });
    loadStats().catch(() => { });
  }, [loadReports, loadStats]);

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

  const pendingReports = getPendingReports();
  const processedReports = state.reports.filter(r => r.status !== 'pending');

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
        r.targetIp || '',
        r.targetFingerprint || '',
      ].filter(Boolean) as string[];
      return values.some((value) => value.toLowerCase().includes(query));
    });
  }, [currentView, pendingReports, processedReports, searchQuery]);

  const mergedBans = useMemo(() => {
    const items = [
      ...bannedIps.map((item) => ({ ...item, type: 'ip' as const, value: item.ip })),
      ...bannedFingerprints.map((item) => ({ ...item, type: 'fingerprint' as const, value: item.fingerprint })),
    ];
    const query = banSearch.trim().toLowerCase();
    if (!query) {
      return items;
    }
    return items.filter((item) => {
      const fields = [
        item.value,
        item.reason || '',
        (item.permissions || []).join(' '),
        item.type,
      ];
      return fields.some((field) => field.toLowerCase().includes(query));
    });
  }, [bannedFingerprints, bannedIps, banSearch]);

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

  const fetchPostComments = useCallback(async (postId: string) => {
    setPostCommentsLoading(true);
    try {
      const data = await api.getAdminPostComments(postId);
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
  }, [currentView, fetchFeedbackUnreadCount]);

  useEffect(() => {
    if (currentView !== 'announcement') {
      return;
    }
    const timer = setTimeout(() => {
      fetchAnnouncement().catch(() => { });
    }, 300);
    return () => clearTimeout(timer);
  }, [currentView, fetchAnnouncement]);

  useEffect(() => {
    setSelectedPosts(new Set());
  }, [postItems]);

  useEffect(() => {
    setSelectedReports(new Set());
  }, [currentView, searchQuery, state.reports]);

  const handleAction = (reportId: string, action: 'ignore' | 'delete' | 'ban', content: string) => {
    setConfirmModal({ isOpen: true, reportId, action, content, reason: '' });
  };

  const confirmAction = async () => {
    const { reportId, action, reason } = confirmModal;
    try {
      await handleReport(reportId, action, reason, action === 'ban' ? buildBanOptions() : undefined);
      const messages = {
        ignore: '已忽略该举报',
        delete: '已删除该内容',
        ban: '已封禁用户并删除内容',
      };
      showToast(messages[action], action === 'ignore' ? 'info' : 'success');
      setConfirmModal({ isOpen: false, reportId: '', action: 'ignore', content: '', reason: '' });
    } catch (error) {
      const message = error instanceof Error ? error.message : '处理失败，请稍后重试';
      showToast(message, 'error');
    }
  };

  const getActionLabel = (action: 'ignore' | 'delete' | 'ban') => {
    switch (action) {
      case 'ignore': return '忽略该举报';
      case 'delete': return '删除该内容';
      case 'ban': return '封禁用户并删除';
    }
  };

  const handlePostAction = (postId: string, action: 'delete' | 'restore', content: string) => {
    setPostConfirmModal({ isOpen: true, postId, action, content, reason: '' });
  };

  const openPostBanModal = (post: AdminPost) => {
    setPostBanModal({ isOpen: true, postId: post.id, content: post.content, reason: '' });
  };

  const openPostComments = (post: AdminPost) => {
    setPostCommentsModal({ isOpen: true, postId: post.id, content: post.content });
    fetchPostComments(post.id).catch(() => { });
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

  const confirmPostBan = async () => {
    const { postId, reason } = postBanModal;
    try {
      await api.batchAdminPosts('ban', [postId], reason, buildBanOptions());
      showToast('已封禁该用户', 'success');
      setPostBanModal({ isOpen: false, postId: '', content: '', reason: '' });
      await fetchAdminPosts();
      await loadStats();
      await fetchBans();
    } catch (error) {
      const message = error instanceof Error ? error.message : '封禁失败，请稍后重试';
      showToast(message, 'error');
    }
  };

  const handleAdminCommentAction = async (commentId: string, action: 'delete' | 'ban') => {
    if (!postCommentsModal.postId) {
      return;
    }
    try {
      await api.handleAdminComment(commentId, action, '', action === 'ban' ? buildBanOptions() : undefined);
      showToast(action === 'ban' ? '已封禁并删除评论' : '评论已删除', 'success');
      await fetchPostComments(postCommentsModal.postId);
      await fetchAdminPosts();
      await loadStats();
      if (action === 'ban') {
        await fetchBans();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '操作失败，请稍后重试';
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

  const formatIdentity = (ip?: string | null, fingerprint?: string | null) => {
    if (!ip && !fingerprint) {
      return '-';
    }
    const parts = [];
    if (ip) {
      parts.push(`IP: ${ip}`);
    }
    if (fingerprint) {
      parts.push(`指纹: ${fingerprint}`);
    }
    return parts.join(' / ');
  };

  const getBanExpiresAt = () => {
    const now = Date.now();
    if (banDuration === 'forever') {
      return null;
    }
    if (banDuration === 'custom') {
      if (!banCustomUntil) {
        return null;
      }
      const time = new Date(banCustomUntil).getTime();
      return Number.isFinite(time) && time > now ? time : null;
    }
    const option = BAN_DURATION_OPTIONS.find((item) => item.id === banDuration);
    if (!option || !option.ms) {
      return null;
    }
    return now + option.ms;
  };

  const toggleBanPermission = (permission: string) => {
    setBanPermissions((prev) => {
      if (prev.includes(permission)) {
        return prev.filter((item) => item !== permission);
      }
      return [...prev, permission];
    });
  };

  const buildBanOptions = () => ({
    permissions: banPermissions,
    expiresAt: getBanExpiresAt(),
  });

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
    const contentClass = item.deleted ? 'text-pencil line-through' : 'text-ink';
    return (
      <div key={item.id} style={{ marginLeft: indent }} className="border-l border-dashed border-gray-200 pl-3 py-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-pencil font-sans mb-1">
          <span className="bg-gray-100 border border-ink text-ink text-[10px] font-bold px-2 py-0.5 rounded font-sans">#{item.id}</span>
          <span>{item.timestamp}</span>
          {item.deleted && <Badge color="bg-gray-200">已删除</Badge>}
          <span>标识：{formatIdentity(item.ip, item.fingerprint)}</span>
        </div>
        <p className={`text-sm font-sans leading-6 ${contentClass}`}>{item.content || '（无内容）'}</p>
        <div className="flex items-center gap-2 mt-2">
          <SketchButton
            variant="danger"
            className="h-8 px-3 text-xs"
            disabled={item.deleted}
            onClick={() => handleAdminCommentAction(item.id, 'delete')}
          >
            删除
          </SketchButton>
          <SketchButton
            variant="secondary"
            className="h-8 px-3 text-xs"
            onClick={() => handleAdminCommentAction(item.id, 'ban')}
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

  const renderBanOptions = () => (
    <div className="flex flex-col gap-3 border-2 border-dashed border-gray-200 rounded-lg p-3">
      <div>
        <p className="text-xs text-pencil font-sans mb-2">封禁权限</p>
        <div className="flex flex-wrap gap-2">
          {Object.keys(BAN_PERMISSION_LABELS).map((permission) => (
            <label key={permission} className="flex items-center gap-2 text-xs font-sans text-pencil">
              <input
                type="checkbox"
                className="accent-black"
                checked={banPermissions.includes(permission)}
                onChange={() => toggleBanPermission(permission)}
              />
              <span>{BAN_PERMISSION_LABELS[permission]}</span>
            </label>
          ))}
        </div>
      </div>
      <div>
        <p className="text-xs text-pencil font-sans mb-2">封禁时间</p>
        <div className="flex flex-col gap-2">
          <select
            value={banDuration}
            onChange={(e) => setBanDuration(e.target.value as typeof banDuration)}
            className="w-full h-9 border-2 border-gray-200 rounded-lg px-2 text-xs font-sans focus:border-ink outline-none"
          >
            {BAN_DURATION_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
          {banDuration === 'custom' && (
            <input
              type="datetime-local"
              value={banCustomUntil}
              onChange={(e) => setBanCustomUntil(e.target.value)}
              className="w-full h-9 border-2 border-gray-200 rounded-lg px-2 text-xs font-sans focus:border-ink outline-none"
            />
          )}
        </div>
      </div>
    </div>
  );

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
    setBulkPostModal({ isOpen: true, action, reason: '' });
  };

  const confirmBulkPostAction = async () => {
    const { action, reason } = bulkPostModal;
    const ids = Array.from(selectedPosts);
    try {
      await api.batchAdminPosts(action, ids, reason, action === 'ban' ? buildBanOptions() : undefined);
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

  const handleUnban = async (type: 'ip' | 'fingerprint', value: string) => {
    try {
      await api.handleAdminBan('unban', type, value);
      showToast('已解除封禁', 'success');
      await fetchBans();
      await loadStats();
    } catch (error) {
      const message = error instanceof Error ? error.message : '解封失败';
      showToast(message, 'error');
    }
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
      await api.handleAdminFeedback(feedbackId, action, reason, action === 'ban' ? buildBanOptions() : undefined);
      showToast(action === 'delete' ? '留言已删除' : '已封禁该用户', 'success');
      setFeedbackActionModal({ isOpen: false, feedbackId: '', action: 'delete', content: '', reason: '' });
      await fetchFeedback();
      await fetchFeedbackUnreadCount();
      if (action === 'ban') {
        fetchBans().catch(() => { });
        loadStats().catch(() => { });
      }
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
      await api.createAdminPost(trimmed, []);
      showToast('投稿成功！', 'success');
      setComposeText('');
      setComposePreview(false);
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
        <span className="ml-auto bg-ink text-white text-xs px-2 py-0.5 rounded-full">{badge}</span>
      )}
    </button>
  );

  const totalPostPages = Math.max(Math.ceil(postTotal / POST_PAGE_SIZE), 1);
  const isReportView = currentView === 'reports' || currentView === 'processed';
  const isPostView = currentView === 'posts';
  const isBanView = currentView === 'bans';
  const isAuditView = currentView === 'audit';
  const isFeedbackView = currentView === 'feedback';
  const totalAuditPages = Math.max(Math.ceil(auditTotal / AUDIT_PAGE_SIZE), 1);
  const totalFeedbackPages = Math.max(Math.ceil(feedbackTotal / FEEDBACK_PAGE_SIZE), 1);

  return (
    <div className="admin-font flex min-h-screen bg-paper overflow-hidden overflow-x-hidden">
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
            <NavItem view="compose" icon={<PenSquare size={18} />} label="后台投稿" />
            <NavItem view="announcement" icon={<Bell size={18} />} label="公告发布" />
            <NavItem view="feedback" icon={<MessageSquare size={18} />} label="留言管理" badge={feedbackUnreadCount} />
            <NavItem view="reports" icon={<Flag size={18} />} label="待处理举报" badge={pendingReports.length} />
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
              {currentView === 'compose' && <><PenSquare /> 后台投稿</>}
              {currentView === 'announcement' && <><Bell /> 公告发布</>}
              {currentView === 'feedback' && <><MessageSquare /> 留言管理</>}
              {currentView === 'reports' && <><Flag /> 待处理举报</>}
              {currentView === 'processed' && <><Gavel /> 已处理</>}
              {currentView === 'bans' && <><Shield /> 封禁管理</>}
              {currentView === 'audit' && <><ClipboardList /> 操作审计</>}
            </h2>
          </div>
          <div className="flex flex-wrap sm:flex-nowrap items-center gap-3 w-full sm:w-auto">
            {(isReportView || isPostView || isAuditView || isFeedbackView) && (
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-pencil w-4 h-4" />
                <input
                  type="text"
                  value={isPostView ? postSearch : isAuditView ? auditSearch : isFeedbackView ? feedbackSearch : searchQuery}
                  onChange={(e) => {
                    if (isPostView) {
                      setPostSearch(e.target.value);
                      setPostPage(1);
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
                  placeholder={isPostView ? '搜索 ID/内容/IP/指纹...' : isAuditView ? '搜索操作/目标/管理员...' : isFeedbackView ? '搜索内容或联系方式/IP/指纹...' : '搜索 ID/内容/IP/指纹...'}
                  className="pl-9 pr-4 py-2 rounded-full border-2 border-ink bg-white text-sm focus:shadow-sketch-sm outline-none transition-all w-full font-sans"
                />
              </div>
            )}
            <button className="relative p-2 border-2 border-transparent hover:border-ink rounded-full hover:bg-highlight transition-all">
              <Bell size={20} />
              {pendingReports.length > 0 && (
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
                <NavItem view="compose" icon={<PenSquare size={18} />} label="后台投稿" onSelect={() => setMobileNavOpen(false)} />
                <NavItem view="announcement" icon={<Bell size={18} />} label="公告发布" onSelect={() => setMobileNavOpen(false)} />
                <NavItem view="feedback" icon={<MessageSquare size={18} />} label="留言管理" badge={feedbackUnreadCount} onSelect={() => setMobileNavOpen(false)} />
                <NavItem view="reports" icon={<Flag size={18} />} label="待处理举报" badge={pendingReports.length} onSelect={() => setMobileNavOpen(false)} />
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
              <>
                {/* Stats Row */}
                <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                  <StatCard
                    title="今日举报"
                    value={state.stats.todayReports.toString()}
                    trend={state.stats.todayReports > 10 ? '+15%' : '-5%'}
                    trendUp={state.stats.todayReports > 10}
                    icon={<Flag size={80} />}
                    color="bg-marker-orange"
                  />
                  <StatCard
                    title="待处理"
                    value={pendingReports.length.toString()}
                    trend={pendingReports.length > 0 ? '需处理' : '已清空'}
                    trendUp={pendingReports.length > 0}
                    icon={<Gavel size={80} />}
                    color="bg-highlight"
                  />
                  <StatCard
                    title="封禁用户"
                    value={state.stats.bannedUsers.toString()}
                    trend="+1"
                    trendUp={false}
                    icon={<Ban size={80} />}
                    color="bg-marker-blue"
                  />
                  <StatCard
                    title="总帖子数"
                    value={state.stats.totalPosts.toString()}
                    trend="活跃"
                    trendUp={true}
                    icon={<BarChart2 size={80} />}
                    color="bg-marker-green"
                  />
                  <StatCard
                    title="版本号"
                    value={appVersionLabel}
                    trend="自动更新"
                    trendUp={true}
                    icon={<CheckCircle size={80} />}
                    color="bg-white"
                    valueClassName="text-3xl md:text-4xl leading-tight break-all"
                  />
                </section>

                {/* Charts Row */}
                <section className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <div className={`bg-white p-6 border-2 border-ink shadow-sketch ${roughBorderClassSm}`}>
                    <div className="flex justify-between items-start mb-6">
                      <div>
                        <h3 className="font-display text-lg">每日发帖量</h3>
                        <p className="text-pencil text-xs font-sans">近7天数据</p>
                      </div>
                      <p className="font-display text-2xl">{postVolumeData.reduce((a, b) => a + b.value, 0)}</p>
                    </div>
                    <div className="h-48 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={postVolumeData} margin={{ top: 24, right: 12, left: 12, bottom: 6 }}>
                        <Line type="monotone" dataKey="value" stroke="#2c2c2c" strokeWidth={3} strokeDasharray="5 5" dot={{ r: 4, fill: '#2c2c2c' }}>
                          <LabelList dataKey="value" position="top" offset={12} fill="#2c2c2c" fontSize={11} />
                        </Line>
                          <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#555' }} dy={10} interval={0} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className={`bg-white p-6 border-2 border-ink shadow-sketch ${roughBorderClassSm}`}>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="font-display text-lg">访问统计</h3>
                        <p className="text-pencil text-xs font-sans">本周独立访客 · {totalWeeklyVisits}</p>
                        <p className="text-xs text-pencil font-sans mt-2">当前在线</p>
                        <p className="font-display text-2xl">{state.stats.onlineCount}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-pencil font-sans">总访问量</p>
                        <p className="font-display text-2xl">{totalWeeklyVisits}</p>
                      </div>
                    </div>
                    <div className="h-48 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={visitData} margin={{ top: 28, right: 12, left: 12, bottom: 6 }}>
                          <Bar dataKey="value" fill="white" stroke="#2c2c2c" strokeWidth={2} radius={[4, 4, 0, 0]}>
                            <LabelList dataKey="value" position="top" offset={12} fill="#2c2c2c" fontSize={12} />
                          </Bar>
                          <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#555' }} dy={10} interval={0} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </section>

                {/* Recent Reports Preview */}
                {pendingReports.length > 0 && (
                  <section>
                    <div className="flex items-center justify-between mb-6">
                      <h2 className="text-xl font-display flex items-center gap-2">
                        <Flag size={20} /> 最新待处理举报
                      </h2>
                      <button
                        onClick={() => setCurrentView('reports')}
                        className="font-hand text-ink hover:underline"
                      >
                        查看全部 →
                      </button>
                    </div>
                    <div className="flex flex-col gap-4">
                      {pendingReports.slice(0, 2).map(report => (
                        <ReportCard
                          key={report.id}
                          report={report}
                          onAction={handleAction}
                          onDetail={(item) => setReportDetail({ isOpen: true, report: item })}
                          showStatus={false}
                          selectable={false}
                        />
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}

            {/* Posts View */}
            {currentView === 'posts' && (
              <section>
                <div className="flex flex-col gap-3 mb-6">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-xs text-pencil font-sans">状态</span>
                    {(['all', 'active', 'deleted'] as PostStatusFilter[]).map((status) => (
                      <button
                        key={status}
                        onClick={() => {
                          setPostStatus(status);
                          setPostPage(1);
                        }}
                        className={`px-3 py-1 text-xs font-bold rounded-full border-2 transition-all ${postStatus === status ? 'border-ink bg-highlight' : 'border-transparent bg-white hover:border-ink'
                          }`}
                      >
                        {status === 'all' ? '全部' : status === 'active' ? '未删除' : '已删除'}
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
                              <Badge color={post.deleted ? 'bg-gray-200' : 'bg-highlight'}>
                                {post.deleted ? '已删除' : '正常'}
                              </Badge>
                              <span className="text-ink text-xs flex items-center gap-1 border border-ink px-2 py-0.5 rounded font-bold font-sans">
                                举报 {post.reports}
                              </span>
                            </div>
                            <p className="text-ink text-base leading-relaxed font-sans font-semibold line-clamp-2">
                              "{post.content}"
                            </p>
                            <div className="flex flex-wrap items-center gap-4 text-xs text-pencil font-sans mt-3">
                              <span>点赞 {post.likes}</span>
                              <span>评论 {post.comments}</span>
                              <span>举报 {post.reports}</span>
                              <span>标识 {formatIdentity(post.ip, post.fingerprint)}</span>
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
                              onClick={() => openPostBanModal(post)}
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

            {/* Compose View */}
            {currentView === 'compose' && (
              <section>
                <form
                  onSubmit={handleComposeSubmit}
                  className="bg-white p-6 border-2 border-ink rounded-lg shadow-sketch-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                    <div>
                      <h3 className="font-display text-xl">后台投稿</h3>
                      <p className="text-xs text-pencil font-sans">支持 Markdown，内容仅管理员可投递</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setComposePreview(!composePreview)}
                      className="flex items-center gap-1 px-3 py-1 text-sm font-hand font-bold text-pencil hover:text-ink border-2 border-gray-200 hover:border-ink rounded-full transition-all"
                    >
                      {composePreview ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      {composePreview ? '编辑' : '预览'}
                    </button>
                  </div>

                  <div className="min-h-[280px] mb-4">
                    {composePreview ? (
                      <div className="w-full h-full min-h-[280px] p-4 border-2 border-dashed border-gray-300 rounded-lg bg-gray-50 overflow-auto">
                        {composeText.trim() ? (
                          <MarkdownRenderer content={composeText} className="font-sans text-lg text-ink" />
                        ) : (
                          <p className="text-pencil/50 font-hand text-xl">预览区域（请先输入内容）</p>
                        )}
                      </div>
                    ) : (
                      <textarea
                        value={composeText}
                        onChange={(e) => setComposeText(e.target.value)}
                        placeholder="在后台发布内容... 支持 Markdown"
                        maxLength={composeMaxLength + 100}
                        className="w-full min-h-[280px] resize-none bg-transparent border-2 border-gray-200 rounded-lg outline-none font-sans text-lg leading-8 text-ink placeholder:text-pencil/40 p-4 focus:border-ink transition-colors"
                      />
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <span className={`font-hand text-lg ${composeText.length > composeMaxLength ? 'text-red-500 font-bold' : composeText.length > composeMaxLength * 0.9 ? 'text-yellow-600' : 'text-pencil'}`}>
                        {composeText.length} / {composeMaxLength}
                      </span>
                      {composeText.length > composeMaxLength && (
                        <span className="text-red-500 text-sm font-hand">超出限制！</span>
                      )}
                    </div>
                    <SketchButton
                      type="submit"
                      className="h-10 px-6 text-sm"
                      disabled={composeSubmitting || !composeText.trim() || composeText.length > composeMaxLength}
                    >
                      {composeSubmitting ? '发布中...' : '发布'}
                    </SketchButton>
                  </div>
                </form>
              </section>
            )}

            {/* Announcement View */}
            {currentView === 'announcement' && (
              <section>
                <form
                  onSubmit={handleAnnouncementSubmit}
                  className="bg-white p-6 border-2 border-ink rounded-lg shadow-sketch-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                    <div>
                      <h3 className="font-display text-xl">公告发布</h3>
                      <p className="text-xs text-pencil font-sans">支持 Markdown，仅保留当前公告</p>
                    </div>
                    {announcementUpdatedAt && (
                      <span className="text-xs text-pencil font-sans">更新时间：{formatAnnouncementTime(announcementUpdatedAt)}</span>
                    )}
                    <button
                      type="button"
                      onClick={() => setAnnouncementPreview(!announcementPreview)}
                      className="flex items-center gap-1 px-3 py-1 text-sm font-hand font-bold text-pencil hover:text-ink border-2 border-gray-200 hover:border-ink rounded-full transition-all"
                    >
                      {announcementPreview ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      {announcementPreview ? '编辑' : '预览'}
                    </button>
                  </div>

                  <div className="min-h-[240px] mb-4">
                    {announcementPreview ? (
                      <div className="w-full h-full min-h-[240px] p-4 border-2 border-dashed border-gray-300 rounded-lg bg-gray-50 overflow-auto">
                        {announcementText.trim() ? (
                          <MarkdownRenderer content={announcementText} className="font-sans text-lg text-ink" />
                        ) : (
                          <p className="text-pencil/50 font-hand text-xl">预览区域（请先输入内容）</p>
                        )}
                      </div>
                    ) : (
                      <textarea
                        value={announcementText}
                        onChange={(e) => setAnnouncementText(e.target.value)}
                        placeholder="发布公告内容... 支持 Markdown"
                        maxLength={5200}
                        className="w-full min-h-[240px] resize-none bg-transparent border-2 border-gray-200 rounded-lg outline-none font-sans text-lg leading-8 text-ink placeholder:text-pencil/40 p-4 focus:border-ink transition-colors"
                      />
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <span className={`font-hand text-lg ${announcementText.length > 5000 ? 'text-red-500 font-bold' : announcementText.length > 4500 ? 'text-yellow-600' : 'text-pencil'}`}>
                        {announcementText.length} / 5000
                      </span>
                      {announcementText.length > 5000 && (
                        <span className="text-red-500 text-sm font-hand">超出限制！</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
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
                  </div>
                </form>
              </section>
            )}

            {/* Feedback View */}
            {currentView === 'feedback' && (
              <section>
                <div className="flex flex-col gap-3 mb-6">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-xs text-pencil font-sans">状态</span>
                    {(['unread', 'read', 'all'] as const).map((status) => (
                      <button
                        key={status}
                        onClick={() => {
                          setFeedbackStatus(status);
                          setFeedbackPage(1);
                        }}
                        className={`px-3 py-1 text-xs font-bold rounded-full border-2 transition-all ${feedbackStatus === status ? 'border-ink bg-highlight' : 'border-transparent bg-white hover:border-ink'
                          }`}
                      >
                        {status === 'unread' ? '未读' : status === 'read' ? '已读' : '全部'}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center justify-between text-xs text-pencil font-sans">
                    <span>共 {feedbackTotal} 条</span>
                    <span>第 {feedbackPage} / {totalFeedbackPages} 页</span>
                  </div>
                </div>

                {feedbackLoading ? (
                  <div className="text-center py-16 bg-white border-2 border-ink rounded-lg">
                    <span className="text-6xl mb-4 block">💬</span>
                    <h3 className="font-display text-2xl text-ink mb-2">正在加载留言</h3>
                    <p className="font-hand text-lg text-pencil">请稍等片刻</p>
                  </div>
                ) : feedbackItems.length === 0 ? (
                  <div className="text-center py-16 bg-white border-2 border-ink rounded-lg">
                    <span className="text-6xl mb-4 block">📭</span>
                    <h3 className="font-display text-2xl text-ink mb-2">暂无留言</h3>
                    <p className="font-hand text-lg text-pencil">试试调整筛选条件</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-4">
                    {feedbackItems.map((message) => (
                      <div key={message.id} className="bg-white p-5 rounded-lg border-2 border-ink shadow-sketch-sm">
                        <div className="flex flex-col md:flex-row gap-6 justify-between items-start">
                          <div className="flex-1">
                            <div className="flex flex-wrap items-center gap-3 text-xs font-sans text-pencil mb-2">
                              <span className="bg-gray-100 border border-ink text-ink text-[10px] font-bold px-2 py-0.5 rounded font-sans">ID: #{message.id}</span>
                              <span>{formatTimestamp(message.createdAt)}</span>
                              <Badge color={message.readAt ? 'bg-gray-200' : 'bg-highlight'}>
                                {message.readAt ? '已读' : '未读'}
                              </Badge>
                            </div>
                            <p className="text-ink text-base leading-relaxed font-sans font-semibold">"{message.content}"</p>
                            <div className="flex flex-wrap items-center gap-4 text-xs text-pencil font-sans mt-3">
                              <span>邮箱：{message.email}</span>
                              {message.wechat && <span>微信：{message.wechat}</span>}
                              {message.qq && <span>QQ：{message.qq}</span>}
                              <span>标识：{formatIdentity(message.ip, message.fingerprint)}</span>
                            </div>
                          </div>
                          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 min-w-fit mt-2 md:mt-0 font-sans">
                            {!message.readAt && (
                              <SketchButton
                                variant="secondary"
                                className="h-10 px-3 text-xs flex items-center gap-1"
                                onClick={() => handleFeedbackRead(message.id)}
                              >
                                标记已读
                              </SketchButton>
                            )}
                            <SketchButton
                              variant="secondary"
                              className="h-10 px-3 text-xs flex items-center gap-1"
                              onClick={() => openFeedbackActionModal(message, 'ban')}
                            >
                              封禁
                            </SketchButton>
                            <SketchButton
                              variant="danger"
                              className="h-10 px-3 text-xs flex items-center gap-1"
                              onClick={() => openFeedbackActionModal(message, 'delete')}
                            >
                              删除
                            </SketchButton>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {feedbackItems.length > 0 && (
                  <div className="flex items-center justify-center gap-4 mt-6">
                    <SketchButton
                      variant="secondary"
                      className="px-4 py-2 text-sm"
                      disabled={feedbackPage <= 1}
                      onClick={() => setFeedbackPage((prev) => Math.max(prev - 1, 1))}
                    >
                      上一页
                    </SketchButton>
                    <span className="text-xs text-pencil font-sans">第 {feedbackPage} / {totalFeedbackPages} 页</span>
                    <SketchButton
                      variant="secondary"
                      className="px-4 py-2 text-sm"
                      disabled={feedbackPage >= totalFeedbackPages}
                      onClick={() => setFeedbackPage((prev) => Math.min(prev + 1, totalFeedbackPages))}
                    >
                      下一页
                    </SketchButton>
                  </div>
                )}
              </section>
            )}

            {/* Bans View */}
            {currentView === 'bans' && (
              <section>
                <div className="flex flex-col gap-3 mb-4">
                  <div className="flex items-center justify-between text-xs text-pencil font-sans">
                    <span>共 {mergedBans.length} 条</span>
                    <span>{banLoading ? '加载中...' : '已更新'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      value={banSearch}
                      onChange={(e) => setBanSearch(e.target.value)}
                      placeholder="搜索 IP/指纹/理由/权限..."
                      className="w-full h-9 border-2 border-gray-200 rounded-lg px-3 text-xs font-sans focus:border-ink outline-none"
                    />
                  </div>
                </div>

                {banLoading ? (
                  <div className="text-center py-16 bg-white border-2 border-ink rounded-lg">
                    <span className="text-6xl mb-4 block">⏳</span>
                    <h3 className="font-display text-2xl text-ink mb-2">正在加载封禁列表</h3>
                    <p className="font-hand text-lg text-pencil">请稍等片刻</p>
                  </div>
                ) : mergedBans.length === 0 ? (
                  <div className="text-center py-16 bg-white border-2 border-ink rounded-lg">
                    <span className="text-6xl mb-4 block">🛡️</span>
                    <h3 className="font-display text-2xl text-ink mb-2">暂无封禁</h3>
                    <p className="font-hand text-lg text-pencil">试试调整搜索条件</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-4">
                    {mergedBans.map((item) => (
                      <div key={`${item.type}-${item.value}`} className="bg-white p-5 rounded-lg border-2 border-ink shadow-sketch-sm">
                        <div className="flex flex-col md:flex-row gap-4 justify-between">
                          <div className="flex-1">
                            <div className="flex flex-wrap items-center gap-3 text-xs font-sans text-pencil mb-2">
                              <Badge color="bg-gray-200">
                                {item.type === 'ip' ? 'IP' : '指纹'}
                              </Badge>
                              <span className="text-xs font-bold text-ink break-all">{item.value}</span>
                              <span>{formatTimestamp(item.bannedAt)}</span>
                            </div>
                            <div className="text-xs text-pencil font-sans space-y-1">
                              <p>权限：{formatBanPermissions(item.permissions)}</p>
                              <p>到期：{item.expiresAt ? formatTimestamp(item.expiresAt) : '永久'}</p>
                              {item.reason && <p>理由：{item.reason}</p>}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <SketchButton
                              variant="secondary"
                              className="h-8 px-3 text-xs"
                              onClick={() => handleUnban(item.type, item.value)}
                            >
                              解封
                            </SketchButton>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* Audit View */}
            {currentView === 'audit' && (
              <section>
                <div className="flex items-center justify-between text-xs text-pencil font-sans mb-4">
                  <span>共 {auditTotal} 条</span>
                  <span>第 {auditPage} / {totalAuditPages} 页</span>
                </div>

                {auditLoading ? (
                  <div className="text-center py-16 bg-white border-2 border-ink rounded-lg">
                    <span className="text-6xl mb-4 block">📜</span>
                    <h3 className="font-display text-2xl text-ink mb-2">加载审计日志</h3>
                    <p className="font-hand text-lg text-pencil">请稍等片刻</p>
                  </div>
                ) : auditLogs.length === 0 ? (
                  <div className="text-center py-16 bg-white border-2 border-ink rounded-lg">
                    <span className="text-6xl mb-4 block">🧾</span>
                    <h3 className="font-display text-2xl text-ink mb-2">暂无记录</h3>
                    <p className="font-hand text-lg text-pencil">试试调整搜索条件</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-4">
                    {auditLogs.map((log) => (
                      <div key={log.id} className="bg-white p-5 rounded-lg border-2 border-ink shadow-sketch-sm">
                        <div className="flex flex-col md:flex-row gap-4 justify-between">
                          <div className="flex-1">
                            <div className="flex flex-wrap items-center gap-3 text-xs font-sans text-pencil mb-2">
                              <span className="bg-gray-100 border border-ink text-ink text-[10px] font-bold px-2 py-0.5 rounded font-sans">
                                #{log.id}
                              </span>
                              <span>{formatTimestamp(log.createdAt)}</span>
                              <span>操作者：{log.adminUsername || '未知'}</span>
                              <span>IP：{log.ip || '-'}</span>
                            </div>
                            <p className="font-sans text-sm text-ink">
                              <span className="font-bold">{log.action}</span> · {log.targetType} · {log.targetId}
                            </p>
                            {log.reason && (
                              <p className="text-xs text-pencil font-sans mt-1">理由：{log.reason}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <SketchButton
                              variant="secondary"
                              className="h-8 px-3 text-xs"
                              onClick={() => setAuditDetail({ isOpen: true, log })}
                            >
                              查看详情
                            </SketchButton>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {auditLogs.length > 0 && (
                  <div className="flex items-center justify-center gap-4 mt-6">
                    <SketchButton
                      variant="secondary"
                      className="px-4 py-2 text-sm"
                      disabled={auditPage <= 1}
                      onClick={() => setAuditPage((prev) => Math.max(prev - 1, 1))}
                    >
                      上一页
                    </SketchButton>
                    <span className="text-xs text-pencil font-sans">第 {auditPage} / {totalAuditPages} 页</span>
                    <SketchButton
                      variant="secondary"
                      className="px-4 py-2 text-sm"
                      disabled={auditPage >= totalAuditPages}
                      onClick={() => setAuditPage((prev) => Math.min(prev + 1, totalAuditPages))}
                    >
                      下一页
                    </SketchButton>
                  </div>
                )}
              </section>
            )}

            {/* Reports View */}
            {(currentView === 'reports' || currentView === 'processed') && (
              <section>
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-display flex items-center gap-2">
                    {currentView === 'reports' ? (
                      <><Flag size={20} /> 待处理举报</>
                    ) : (
                      <><Gavel size={20} /> 已处理</>
                    )}
                    <span className="bg-ink text-white text-xs px-2 py-1 rounded-full font-sans">
                      {filteredReports.length}
                    </span>
                  </h2>
                </div>
                {currentView === 'reports' && (
                  <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-sans mb-4">
                    <label className="flex items-center gap-2 text-pencil">
                      <input
                        type="checkbox"
                        className="accent-black"
                        checked={filteredReports.length > 0 && filteredReports.every((report) => selectedReports.has(report.id))}
                        onChange={() => toggleAllReports(filteredReports.map((report) => report.id))}
                      />
                      本页全选
                    </label>
                    <div className="flex items-center gap-2">
                      <span className="text-pencil">已选 {selectedReports.size} 条</span>
                      <SketchButton
                        variant="secondary"
                        className="h-8 px-3 text-xs"
                        disabled={selectedReports.size === 0}
                        onClick={openBulkReportModal}
                      >
                        标记处理
                      </SketchButton>
                    </div>
                  </div>
                )}

                {filteredReports.length === 0 ? (
                  <div className="text-center py-16 bg-white border-2 border-ink rounded-lg">
                    <span className="text-6xl mb-4 block">
                      {searchQuery ? '🔍' : '✅'}
                    </span>
                    <h3 className="font-display text-2xl text-ink mb-2">
                      {searchQuery ? '没有找到匹配的结果' : '暂无待处理举报'}
                    </h3>
                    <p className="font-hand text-lg text-pencil">
                      {searchQuery ? '尝试其他关键词' : '做得好！保持关注～'}
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-4">
                    {filteredReports.map(report => (
                      <ReportCard
                        key={report.id}
                        report={report}
                        onAction={handleAction}
                        onDetail={(item) => setReportDetail({ isOpen: true, report: item })}
                        showStatus={currentView === 'processed'}
                        selectable={currentView === 'reports'}
                        selected={selectedReports.has(report.id)}
                        onSelect={() => toggleReportSelection(report.id)}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}

          </div>
        </div>
      </main>

      {/* Confirm Modal */}
      <Modal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal({ isOpen: false, reportId: '', action: 'ignore', content: '', reason: '' })}
        title="确认操作"
      >
        <div className="flex flex-col gap-4">
          <p className="font-hand text-lg text-ink">
            确定要 <strong className="text-red-600">{getActionLabel(confirmModal.action)}</strong> 吗？
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
          {confirmModal.action === 'ban' && renderBanOptions()}
          <div className="flex flex-col sm:flex-row gap-3 mt-2">
            <SketchButton
              variant="secondary"
              className="flex-1"
              onClick={() => setConfirmModal({ isOpen: false, reportId: '', action: 'ignore', content: '', reason: '' })}
            >
              取消
            </SketchButton>
            <SketchButton
              variant={confirmModal.action === 'ignore' ? 'secondary' : 'danger'}
              className="flex-1"
              onClick={confirmAction}
            >
              确认{confirmModal.action === 'ban' ? '封禁' : confirmModal.action === 'delete' ? '删除' : '忽略'}
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
        isOpen={postBanModal.isOpen}
        onClose={() => setPostBanModal({ isOpen: false, postId: '', content: '', reason: '' })}
        title="封禁用户"
      >
        <div className="flex flex-col gap-4">
          <p className="font-hand text-lg text-ink">
            确定要 <strong className="text-red-600">封禁该用户</strong> 吗？
          </p>
          <div className="p-3 bg-gray-50 border border-dashed border-ink rounded-lg">
            <p className="text-sm text-pencil font-sans line-clamp-2">"{postBanModal.content}"</p>
          </div>
          <div>
            <label className="text-xs text-pencil font-sans">处理理由（可选）</label>
            <textarea
              value={postBanModal.reason}
              onChange={(e) => setPostBanModal((prev) => ({ ...prev, reason: e.target.value }))}
              className="w-full mt-2 h-20 resize-none border-2 border-gray-200 rounded-lg p-2 text-sm font-sans focus:border-ink outline-none"
              placeholder="填写理由便于审计追溯"
            />
          </div>
          {renderBanOptions()}
          <div className="flex flex-col sm:flex-row gap-3 mt-2">
            <SketchButton
              variant="secondary"
              className="flex-1"
              onClick={() => setPostBanModal({ isOpen: false, postId: '', content: '', reason: '' })}
            >
              取消
            </SketchButton>
            <SketchButton
              variant="danger"
              className="flex-1"
              onClick={confirmPostBan}
            >
              确认封禁
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
          {bulkPostModal.action === 'ban' && renderBanOptions()}
          <div className="flex flex-col sm:flex-row gap-3 mt-2">
            <SketchButton
              variant="secondary"
              className="flex-1"
              onClick={() => setBulkPostModal({ isOpen: false, action: 'delete', reason: '' })}
            >
              取消
            </SketchButton>
            <SketchButton
              variant={bulkPostModal.action === 'delete' || bulkPostModal.action === 'ban' ? 'danger' : 'secondary'}
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
          {feedbackActionModal.action === 'ban' && renderBanOptions()}
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
      >
        <div className="flex flex-col gap-4">
          <div className="text-xs text-pencil font-sans">
            <p>举报 ID：{reportDetail.report?.id}</p>
            <p>类型：{reportDetail.report?.targetType === 'comment' ? '评论举报' : '帖子举报'}</p>
            <p>原因：{reportDetail.report?.reason}</p>
            <p>标识：{formatIdentity(reportDetail.report?.targetIp, reportDetail.report?.targetFingerprint)}</p>
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
    </div>
  );
};

// Separate ReportCard component
const ReportCard: React.FC<{
  report: Report;
  onAction: (id: string, action: 'ignore' | 'delete' | 'ban', content: string) => void;
  onDetail?: (report: Report) => void;
  showStatus?: boolean;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: () => void;
}> = ({ report, onAction, onDetail, showStatus = false, selectable = true, selected = false, onSelect }) => {
  const getRiskBg = (level: string) => {
    switch (level) {
      case 'high': return 'bg-highlight';
      case 'medium': return 'bg-alert';
      default: return 'bg-gray-200';
    }
  };
  const formatIdentity = (ip?: string | null, fingerprint?: string | null) => {
    if (!ip && !fingerprint) {
      return '-';
    }
    const parts = [];
    if (ip) {
      parts.push(`IP: ${ip}`);
    }
    if (fingerprint) {
      parts.push(`指纹: ${fingerprint}`);
    }
    return parts.join(' / ');
  };

  return (
    <div className="bg-white p-5 rounded-lg border-2 border-ink shadow-sketch-sm hover:shadow-sketch transition-all group">
      <div className="flex flex-col md:flex-row gap-6 justify-between items-start">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            {selectable && (
              <input
                type="checkbox"
                className="accent-black"
                checked={selected}
                onChange={onSelect}
              />
            )}
            <span className="bg-gray-100 border border-ink text-ink text-[10px] font-bold px-2 py-0.5 rounded font-sans">ID: #{report.id}</span>
            <span className="text-pencil text-xs font-bold font-sans">{report.timestamp}</span>
            <span className={`text-ink text-xs flex items-center gap-1 border border-ink px-2 py-0.5 rounded font-bold font-sans ${getRiskBg(report.riskLevel)}`}>
              {report.reason}
            </span>
            {report.targetType === 'comment' && (
              <span className="text-xs flex items-center gap-1 border border-ink px-2 py-0.5 rounded font-bold font-sans bg-blue-50 text-blue-700">
                评论举报
              </span>
            )}
            {showStatus && (
              <span className={`text-xs flex items-center gap-1 border border-ink px-2 py-0.5 rounded font-bold font-sans ${report.status === 'resolved' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                }`}>
                {report.status === 'resolved' ? <CheckCircle size={12} /> : <XCircle size={12} />}
                {report.status === 'resolved' ? '已处理' : '已忽略'}
              </span>
            )}
          </div>
          <p className="text-ink text-base leading-relaxed font-sans font-semibold">
            "{report.contentSnippet}"
          </p>
          <div className="flex flex-wrap items-center gap-3 text-xs text-pencil font-sans mt-3">
            <span>标识 {formatIdentity(report.targetIp, report.targetFingerprint)}</span>
            <button
              type="button"
              onClick={() => onDetail?.(report)}
              className="text-xs font-bold text-ink hover:underline"
            >
              查看详情
            </button>
          </div>
        </div>

        {!showStatus && (
          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 min-w-fit mt-2 md:mt-0 font-sans">
            <SketchButton
              variant="secondary"
              className="h-10 px-3 text-xs flex items-center gap-1"
              onClick={() => onAction(report.id, 'ignore', report.contentSnippet)}
            >
              <EyeOff size={14} /> 忽略
            </SketchButton>
            <SketchButton
              variant="danger"
              className="h-10 px-3 text-xs flex items-center gap-1"
              onClick={() => onAction(report.id, 'delete', report.contentSnippet)}
            >
              <Trash2 size={14} /> 删除
            </SketchButton>
            <SketchButton
              variant="primary"
              className="h-10 px-3 text-xs flex items-center gap-1 text-white"
              onClick={() => onAction(report.id, 'ban', report.contentSnippet)}
            >
              <Ban size={14} /> 封禁
            </SketchButton>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminDashboard;
