import type { AdminAuditLog } from '@/types';

export type AuditCategory =
  | 'content'
  | 'content_review'
  | 'user_safety'
  | 'feedback'
  | 'wiki'
  | 'publish'
  | 'settings'
  | 'vocabulary'
  | 'admin_users'
  | 'other';

export type AuditRiskLevel = 'normal' | 'high';
export type AuditCategoryFilter = 'all' | AuditCategory;
export type AuditRiskFilter = 'all' | 'high';
export type AuditTargetTypeFilter =
  | 'all'
  | 'post'
  | 'comment'
  | 'report'
  | 'wiki_entry'
  | 'wiki_revision'
  | 'settings'
  | 'admin_user'
  | 'ip'
  | 'identity'
  | 'fingerprint'
  | 'feedback'
  | 'post_delete_request'
  | 'announcement'
  | 'update_announcement'
  | 'vocabulary';
export type AuditTimeFilter = 'all' | 'today' | '7d' | '30d';
export type AuditReasonFilter = 'all' | 'with' | 'without';

export interface AuditFilterState {
  category: AuditCategoryFilter;
  riskLevel: AuditRiskFilter;
  targetType: AuditTargetTypeFilter;
  timeRange: AuditTimeFilter;
  reason: AuditReasonFilter;
  adminUsername: string;
}

export interface AuditDiffItem {
  field: string;
  label: string;
  before: string;
  after: string;
}

export const DEFAULT_AUDIT_FILTERS: AuditFilterState = {
  category: 'all',
  riskLevel: 'all',
  targetType: 'all',
  timeRange: 'all',
  reason: 'all',
  adminUsername: '',
};

export const AUDIT_CATEGORY_OPTIONS: Array<{ value: AuditCategoryFilter; label: string }> = [
  { value: 'all', label: '全部类型' },
  { value: 'content', label: '内容管理' },
  { value: 'content_review', label: '内容审核' },
  { value: 'user_safety', label: '用户安全' },
  { value: 'feedback', label: '留言' },
  { value: 'wiki', label: 'Wiki' },
  { value: 'publish', label: '公告发布' },
  { value: 'settings', label: '系统设置' },
  { value: 'vocabulary', label: '敏感词' },
  { value: 'admin_users', label: '管理员' },
];

export const AUDIT_RISK_OPTIONS: Array<{ value: AuditRiskFilter; label: string }> = [
  { value: 'all', label: '全部风险' },
  { value: 'high', label: '高风险' },
];

export const AUDIT_TARGET_TYPE_OPTIONS: Array<{ value: AuditTargetTypeFilter; label: string }> = [
  { value: 'all', label: '全部目标' },
  { value: 'post', label: '帖子' },
  { value: 'comment', label: '评论' },
  { value: 'report', label: '举报' },
  { value: 'wiki_entry', label: 'Wiki 条目' },
  { value: 'wiki_revision', label: 'Wiki 审核' },
  { value: 'settings', label: '系统设置' },
  { value: 'admin_user', label: '管理员账号' },
  { value: 'ip', label: 'IP' },
  { value: 'identity', label: '身份' },
  { value: 'fingerprint', label: '指纹' },
  { value: 'feedback', label: '留言' },
  { value: 'post_delete_request', label: '删除申请' },
  { value: 'announcement', label: '站点公告' },
  { value: 'update_announcement', label: '更新公告' },
  { value: 'vocabulary', label: '敏感词' },
];

export const AUDIT_TIME_OPTIONS: Array<{ value: AuditTimeFilter; label: string }> = [
  { value: 'all', label: '全部时间' },
  { value: 'today', label: '今天' },
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' },
];

export const AUDIT_REASON_OPTIONS: Array<{ value: AuditReasonFilter; label: string }> = [
  { value: 'all', label: '全部理由' },
  { value: 'with', label: '有理由' },
  { value: 'without', label: '无理由' },
];

const CATEGORY_LABELS: Record<AuditCategory, string> = {
  content: '内容管理',
  content_review: '内容审核',
  user_safety: '用户安全',
  feedback: '留言',
  wiki: 'Wiki',
  publish: '公告发布',
  settings: '系统设置',
  vocabulary: '敏感词',
  admin_users: '管理员',
  other: '其他',
};

const TARGET_LABELS: Record<string, string> = {
  admin_user: '管理员账号',
  announcement: '站点公告',
  comment: '评论',
  feedback: '留言',
  fingerprint: '指纹',
  identity: '身份',
  ip: 'IP',
  post: '帖子',
  post_batch: '帖子批量',
  post_delete_request: '删除申请',
  report: '举报',
  settings: '系统设置',
  update_announcement: '更新公告',
  vocabulary: '敏感词',
  wiki_entry: 'Wiki 条目',
  wiki_revision: 'Wiki 审核',
};

const ACTION_META: Record<string, { title: string; category: AuditCategory; riskLevel?: AuditRiskLevel }> = {
  admin_user_create: { title: '创建了管理员账号', category: 'admin_users', riskLevel: 'high' },
  admin_user_disable: { title: '停用了管理员账号', category: 'admin_users', riskLevel: 'high' },
  admin_user_enable: { title: '启用了管理员账号', category: 'admin_users', riskLevel: 'high' },
  admin_user_password_reset: { title: '重置了管理员密码', category: 'admin_users', riskLevel: 'high' },
  admin_user_permissions_update: { title: '修改了管理员权限', category: 'admin_users', riskLevel: 'high' },
  announcement_clear: { title: '清空了站点公告', category: 'publish', riskLevel: 'high' },
  announcement_update: { title: '更新了站点公告', category: 'publish' },
  ban_fingerprint: { title: '封禁了指纹', category: 'user_safety', riskLevel: 'high' },
  ban_identity: { title: '封禁了身份', category: 'user_safety', riskLevel: 'high' },
  ban_ip: { title: '封禁了 IP', category: 'user_safety', riskLevel: 'high' },
  comment_ban: { title: '删除评论并封禁用户', category: 'content', riskLevel: 'high' },
  comment_delete: { title: '删除了评论', category: 'content', riskLevel: 'high' },
  comment_hidden_keep: { title: '保留评论隐藏状态', category: 'content' },
  comment_hidden_restore: { title: '恢复了隐藏评论', category: 'content' },
  feedback_ban: { title: '封禁了留言用户', category: 'user_safety', riskLevel: 'high' },
  feedback_delete: { title: '删除了留言', category: 'feedback', riskLevel: 'high' },
  feedback_read: { title: '标记留言已读', category: 'feedback' },
  feedback_reply: { title: '回复了留言', category: 'feedback' },
  post_batch_ban: { title: '批量封禁发帖者', category: 'user_safety', riskLevel: 'high' },
  post_batch_unban: { title: '批量解除封禁', category: 'user_safety', riskLevel: 'high' },
  post_create: { title: '发布了后台帖子', category: 'content' },
  post_delete: { title: '删除了帖子', category: 'content', riskLevel: 'high' },
  post_delete_request_approve: { title: '通过了删除申请', category: 'content_review', riskLevel: 'high' },
  post_delete_request_reject: { title: '驳回了删除申请', category: 'content_review' },
  post_edit: { title: '编辑了帖子', category: 'content' },
  post_hidden_keep: { title: '保留帖子隐藏状态', category: 'content' },
  post_hidden_restore: { title: '恢复了隐藏帖子', category: 'content' },
  post_restore: { title: '恢复了帖子', category: 'content' },
  report_ban: { title: '处理举报并封禁用户', category: 'content_review', riskLevel: 'high' },
  report_delete: { title: '处理举报并删除内容', category: 'content_review', riskLevel: 'high' },
  report_ignore: { title: '忽略了举报', category: 'content_review' },
  report_resolve: { title: '处理了举报', category: 'content_review' },
  rumor_clear: { title: '清除了谣言标记', category: 'content_review' },
  rumor_ignore: { title: '忽略了谣言举报', category: 'content_review' },
  rumor_mark: { title: '标记为谣言', category: 'content_review' },
  rumor_reject: { title: '驳回了谣言标记', category: 'content_review' },
  settings_update: { title: '修改了系统设置', category: 'settings', riskLevel: 'high' },
  unban_fingerprint: { title: '解封了指纹', category: 'user_safety', riskLevel: 'high' },
  unban_identity: { title: '解封了身份', category: 'user_safety', riskLevel: 'high' },
  unban_ip: { title: '解封了 IP', category: 'user_safety', riskLevel: 'high' },
  update_announcement_create: { title: '发布了更新公告', category: 'publish' },
  update_announcement_delete: { title: '删除了更新公告', category: 'publish', riskLevel: 'high' },
  vocabulary_add: { title: '新增了敏感词', category: 'vocabulary' },
  vocabulary_delete: { title: '删除了敏感词', category: 'vocabulary', riskLevel: 'high' },
  vocabulary_import: { title: '导入了敏感词库', category: 'vocabulary' },
  vocabulary_toggle: { title: '启用或停用了敏感词', category: 'vocabulary' },
  vocabulary_update: { title: '更新了敏感词', category: 'vocabulary' },
  wiki_entry_create: { title: '创建了 Wiki 条目', category: 'wiki' },
  wiki_entry_delete: { title: '删除了 Wiki 条目', category: 'wiki', riskLevel: 'high' },
  wiki_entry_edit: { title: '编辑了 Wiki 条目', category: 'wiki' },
  wiki_entry_restore: { title: '恢复了 Wiki 条目', category: 'wiki' },
  wiki_revision_approve: { title: '通过了 Wiki 审核', category: 'wiki' },
  wiki_revision_reject: { title: '拒绝了 Wiki 审核', category: 'wiki' },
};

const FIELD_LABELS: Record<string, string> = {
  action: '处理动作',
  added: '新增数量',
  autoHideReportThreshold: '自动隐藏阈值',
  banned: '封禁状态',
  comment: '评论',
  content: '内容',
  createdAt: '创建时间',
  deleted: '删除状态',
  enabled: '启用状态',
  expiresAt: '到期时间',
  hidden: '隐藏状态',
  hiddenAt: '隐藏时间',
  hiddenReviewStatus: '隐藏复核状态',
  ips: 'IP 数量',
  name: '名称',
  permissions: '权限',
  post: '发帖',
  posts: '帖子数量',
  rateLimits: '限流',
  readAt: '已读时间',
  removed: '移除数量',
  resolvedCount: '处理数量',
  resolvedReports: '处理举报数',
  rumorStatus: '谣言状态',
  slug: '短链',
  status: '状态',
  total: '总数',
  updatedAt: '更新时间',
  versionNumber: '版本号',
  windowMs: '时间窗口',
  word: '词条',
};

const VALUE_LABELS: Record<string, string> = {
  approved: '已通过',
  ban: '封禁',
  clear: '清除',
  delete: '删除',
  hidden_keep: '保留隐藏',
  hidden_restore: '恢复显示',
  ignore: '忽略',
  ignored: '已忽略',
  kept: '保留',
  mark: '标记',
  pending: '待处理',
  read: '只读',
  rejected: '已拒绝',
  resolve: '处理',
  resolved: '已处理',
  restore: '恢复',
  reviewed: '已复核',
  manage: '可管理',
};

const SESSION_FIELD_NAMES = new Set(['sessionId', 'session_id']);
const TIMESTAMP_FIELD_PATTERN = /(At|Time|Until)$/i;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const isAuditCategory = (value: string): value is AuditCategory => (
  Object.prototype.hasOwnProperty.call(CATEGORY_LABELS, value)
);

const truncateText = (value: string, maxLength = 120) => (
  value.length > maxLength ? `${value.slice(0, maxLength)}...` : value
);

export const stripAuditSessionFields = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(stripAuditSessionFields);
  }
  if (isRecord(value)) {
    const next: Record<string, unknown> = {};
    Object.entries(value).forEach(([key, item]) => {
      if (!SESSION_FIELD_NAMES.has(key)) {
        next[key] = stripAuditSessionFields(item);
      }
    });
    return next;
  }
  return value;
};

export const parseAuditJson = (value?: string | null): unknown => {
  if (!value) {
    return null;
  }
  try {
    return stripAuditSessionFields(JSON.parse(value));
  } catch {
    return value;
  }
};

export const formatAuditRawJson = (value?: string | null) => {
  if (!value) {
    return '—';
  }
  try {
    return JSON.stringify(stripAuditSessionFields(JSON.parse(value)), null, 2);
  } catch {
    return value;
  }
};

const stableStringify = (value: unknown) => {
  if (value === undefined) {
    return 'undefined';
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const flattenAuditValue = (
  value: unknown,
  prefix: string,
  result: Map<string, unknown>,
  depth = 0
) => {
  if (isRecord(value) && depth < 3) {
    const entries = Object.entries(value).filter(([key]) => !SESSION_FIELD_NAMES.has(key));
    if (entries.length) {
      entries.forEach(([key, item]) => {
        flattenAuditValue(item, prefix ? `${prefix}.${key}` : key, result, depth + 1);
      });
      return;
    }
  }
  result.set(prefix || 'value', value);
};

const flattenAuditRoot = (value: unknown) => {
  const result = new Map<string, unknown>();
  if (value === null || value === undefined) {
    return result;
  }
  flattenAuditValue(value, '', result);
  return result;
};

const formatDateValue = (value: number) => new Date(value).toLocaleString('zh-CN');

const shouldFormatAsDate = (field: string, value: unknown) => (
  typeof value === 'number'
  && TIMESTAMP_FIELD_PATTERN.test(field)
  && value > 946684800000
  && value < 4102444800000
);

export const formatAuditValue = (value: unknown, field = ''): string => {
  if (value === null || value === undefined || value === '') {
    return '空';
  }
  if (typeof value === 'number' && shouldFormatAsDate(field, value)) {
    return formatDateValue(value);
  }
  if (typeof value === 'boolean') {
    return value ? '是' : '否';
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'string') {
    return truncateText(VALUE_LABELS[value] || value);
  }
  if (Array.isArray(value)) {
    if (!value.length) {
      return '空数组';
    }
    if (value.length <= 4) {
      return truncateText(value.map((item) => formatAuditValue(item, field)).join('、'));
    }
    return `${value.length} 项`;
  }
  if (isRecord(value)) {
    return truncateText(JSON.stringify(value));
  }
  return truncateText(String(value));
};

export const formatAuditFieldLabel = (field: string) => (
  field
    .split('.')
    .filter(Boolean)
    .map((part) => FIELD_LABELS[part] || part)
    .join(' / ') || '记录'
);

export const getAuditDiffItems = (log?: AdminAuditLog | null): AuditDiffItem[] => {
  if (!log) {
    return [];
  }
  const before = flattenAuditRoot(parseAuditJson(log.before));
  const after = flattenAuditRoot(parseAuditJson(log.after));
  const fields = Array.from(new Set([...before.keys(), ...after.keys()])).sort();

  return fields
    .filter((field) => stableStringify(before.get(field)) !== stableStringify(after.get(field)))
    .map((field) => ({
      field,
      label: formatAuditFieldLabel(field),
      before: before.has(field) ? formatAuditValue(before.get(field), field) : '空',
      after: after.has(field) ? formatAuditValue(after.get(field), field) : '空',
    }));
};

export const formatAuditDiffLine = (item: AuditDiffItem) => (
  `${item.label}：${item.before} -> ${item.after}`
);

export const getAuditSummaryLines = (log: AdminAuditLog, limit = 3) => {
  const diffItems = getAuditDiffItems(log).slice(0, limit);
  if (diffItems.length) {
    return diffItems.map(formatAuditDiffLine);
  }
  if (!log.before && log.after) {
    return ['新增了一条记录'];
  }
  if (log.before && !log.after) {
    return ['删除了一条记录'];
  }
  return ['未记录字段变化'];
};

export const getAuditCategory = (log: AdminAuditLog): AuditCategory => {
  const rawCategory = String(log.category || '');
  if (isAuditCategory(rawCategory)) {
    return rawCategory;
  }
  const meta = ACTION_META[log.action];
  if (meta) {
    return meta.category;
  }
  if (log.action.startsWith('ban_') || log.action.startsWith('unban_')) {
    return 'user_safety';
  }
  if (log.action.startsWith('wiki_')) {
    return 'wiki';
  }
  if (log.action.startsWith('admin_user_')) {
    return 'admin_users';
  }
  if (log.action.startsWith('vocabulary_')) {
    return 'vocabulary';
  }
  if (log.action.startsWith('feedback_')) {
    return 'feedback';
  }
  if (log.action.startsWith('settings_')) {
    return 'settings';
  }
  if (log.action.startsWith('announcement_') || log.action.startsWith('update_announcement_')) {
    return 'publish';
  }
  if (log.action.startsWith('report_') || log.action.startsWith('rumor_')) {
    return 'content_review';
  }
  if (log.action.startsWith('post_delete_request_')) {
    return 'content_review';
  }
  return ['post', 'comment'].includes(log.targetType) ? 'content' : 'other';
};

export const getAuditRiskLevel = (log: AdminAuditLog): AuditRiskLevel => {
  if (log.riskLevel === 'high' || log.riskLevel === 'normal') {
    return log.riskLevel;
  }
  const meta = ACTION_META[log.action];
  if (meta?.riskLevel) {
    return meta.riskLevel;
  }
  return log.action.startsWith('ban_') || log.action.startsWith('unban_') || log.action.endsWith('_delete')
    ? 'high'
    : 'normal';
};

export const getAuditCategoryLabel = (category: AuditCategory) => CATEGORY_LABELS[category] || CATEGORY_LABELS.other;

export const getAuditRiskLabel = (riskLevel: AuditRiskLevel) => (
  riskLevel === 'high' ? '高风险' : '普通'
);

export const getAuditActionTitle = (log: AdminAuditLog) => {
  const meta = ACTION_META[log.action];
  if (meta) {
    return meta.title;
  }
  if (log.action.startsWith('ban_')) {
    return '执行了封禁';
  }
  if (log.action.startsWith('unban_')) {
    return '执行了解封';
  }
  if (log.action.startsWith('report_')) {
    return '处理了举报';
  }
  if (log.action.startsWith('wiki_')) {
    return '处理了 Wiki';
  }
  return log.action;
};

export const getAuditTargetLabel = (targetType?: string | null) => {
  const type = String(targetType || '').trim();
  return TARGET_LABELS[type] || type || '目标';
};

export const getAuditTimeRangeParams = (timeRange: AuditTimeFilter, now = Date.now()) => {
  if (timeRange === 'today') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { from: start.getTime(), to: now };
  }
  if (timeRange === '7d') {
    return { from: now - 7 * 24 * 60 * 60 * 1000, to: now };
  }
  if (timeRange === '30d') {
    return { from: now - 30 * 24 * 60 * 60 * 1000, to: now };
  }
  return { from: undefined, to: undefined };
};
