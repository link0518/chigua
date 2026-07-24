import { getBrowserFingerprint } from './fingerprint';
import type {
  NotificationItem,
  RecruitmentContactExchange,
  RecruitmentContactValue,
  RecruitmentMessage,
  RecruitmentPost,
  RecruitmentStatus,
  RecruitmentThread,
  RecruitmentThreadStatus,
  RecruitmentXinfaOption,
} from './types';

const toQuery = (params: Record<string, unknown>) => {
  const entries = Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (entries.length === 0) return '';
  const query = entries
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
  return `?${query}`;
};

let csrfToken = '';

const needsAdminCsrf = (path: string) => path.startsWith('/admin') || path.startsWith('/reports');

const shouldAttachFingerprint = (path: string, options: RequestInit) => {
  const cleanPath = String(path || '').split('?')[0];

  if (cleanPath === '/online/heartbeat') {
    return false;
  }

  if (cleanPath === '/access') {
    return true;
  }

  if (cleanPath.startsWith('/notifications')) {
    return true;
  }

  if (cleanPath.startsWith('/easter-eggs/')) {
    return true;
  }

  if (cleanPath.startsWith('/feedback')) {
    return true;
  }

  if (cleanPath.startsWith('/wiki')) {
    return true;
  }

  if (cleanPath.startsWith('/reports')) {
    return true;
  }

  if (cleanPath.startsWith('/recruitment')) {
    return true;
  }

  if (cleanPath.startsWith('/uploads')) {
    return true;
  }

  if (cleanPath.startsWith('/admin')) {
    return true;
  }

  if (cleanPath.startsWith('/posts')) {
    return true;
  }

  if (cleanPath.startsWith('/favorites')) {
    return true;
  }

  if (cleanPath.startsWith('/comments')) {
    return true;
  }

  // 个人中心 / 商城等本机身份接口
  if (cleanPath.startsWith('/me')) {
    return true;
  }

  return false;
};

const normalizeHeaders = (headers?: HeadersInit) => {
  if (!headers) {
    return {};
  }
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return headers;
};

const apiFetch = async <T = any>(path: string, options: RequestInit = {}): Promise<T> => {
  const fingerprint = shouldAttachFingerprint(path, options)
    ? await getBrowserFingerprint().catch(() => '')
    : '';
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(csrfToken && needsAdminCsrf(path) ? { 'X-CSRF-Token': csrfToken } : {}),
      ...(fingerprint ? { 'X-Client-Fingerprint': fingerprint } : {}),
      ...normalizeHeaders(options.headers),
    },
  });

  if (response.status === 204) {
    return null as T;
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data?.error || '请求失败';
    throw new Error(message);
  }

  return data as T;
};

export const api = {
  setCsrfToken: (token) => {
    csrfToken = token || '';
  },
  getHomePosts: (limit, offset = 0) => apiFetch(`/posts/home${toQuery({ limit, offset })}`),
  getPostById: (postId) => apiFetch(`/posts/${postId}`),
  getFeedPosts: (filter, search, limit = 30, offset = 0, rankingUpdatedAt) => apiFetch(`/posts/feed${toQuery({
    filter,
    search,
    limit,
    offset,
    rankingUpdatedAt,
  })}`),
  getFeaturedPosts: (limit = 20, offset = 0) => apiFetch(`/posts/featured${toQuery({ limit, offset })}`),
  getPostTags: (limit = 50) => apiFetch(`/posts/tags${toQuery({ limit })}`),
  searchPosts: (
    q,
    page = 1,
    limit = 20,
    options: {
      tag?: string;
      startDate?: string;
      endDate?: string;
      signal?: AbortSignal;
    } = {}
  ) => apiFetch(
    `/posts/search${toQuery({
      q,
      page,
      limit,
      tag: options.tag,
      startDate: options.startDate,
      endDate: options.endDate,
    })}`,
    { signal: options.signal }
  ),
  createPost: (content, tags = [], turnstileToken) => apiFetch('/posts', {
    method: 'POST',
    body: JSON.stringify({ content, tags, turnstileToken }),
  }),
  createPostDeleteRequest: (postId, reason) => apiFetch(`/posts/${encodeURIComponent(String(postId || ''))}/delete-requests`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  }),
  likePost: (postId) => apiFetch(`/posts/${postId}/like`, { method: 'POST' }),
  dislikePost: (postId) => apiFetch(`/posts/${postId}/dislike`, { method: 'POST' }),
  toggleFavoritePost: (postId) => apiFetch(`/posts/${postId}/favorite`, { method: 'POST' }),
  requestPostFeature: (postId) => apiFetch(`/posts/${encodeURIComponent(String(postId || ''))}/feature-requests`, {
    method: 'POST',
  }),
  viewPost: (postId) => apiFetch(`/posts/${postId}/view`, { method: 'POST' }),
  getComments: (postId, offset = 0, limit = 10) => apiFetch(`/posts/${postId}/comments${toQuery({ offset, limit })}`),
  getCommentThread: (postId, commentId) => apiFetch(`/posts/${postId}/comment-thread${toQuery({ commentId })}`),
  addComment: (postId, content, turnstileToken, parentId, replyToId) => apiFetch(`/posts/${postId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ content, turnstileToken, parentId, replyToId }),
  }),
  toggleCommentLike: (commentId) => apiFetch(`/comments/${commentId}/like`, { method: 'POST' }),
  getFavorites: (limit = 20, offset = 0) => apiFetch(`/favorites${toQuery({ limit, offset })}`),
  getRecruitmentXinfa: () => apiFetch<{
    items: RecruitmentXinfaOption[];
    optionCount?: number;
    sourceRecordCount?: number;
  }>('/recruitment/catalog'),
  getRecruitmentPosts: (params: {
    limit?: number;
    page?: number;
    xinfaId?: string;
    status?: RecruitmentStatus;
    mine?: boolean;
  } = {}) => apiFetch<{
    items: RecruitmentPost[];
    total: number;
    page: number;
    limit: number;
  }>(`/recruitment/posts${toQuery({
    ...params,
    mine: params.mine ? '1' : undefined,
  })}`),
  getRecruitmentPost: (postId: string) => apiFetch<{ post: RecruitmentPost }>(
    `/recruitment/posts/${encodeURIComponent(String(postId || ''))}`
  ),
  createRecruitmentPost: (payload: { xinfaId: string; content: string; turnstileToken?: string }) => apiFetch<{ post: RecruitmentPost }>(
    '/recruitment/posts',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  ),
  closeRecruitmentPost: (postId: string) => apiFetch<{ post: RecruitmentPost }>(
    `/recruitment/posts/${encodeURIComponent(String(postId || ''))}/close`,
    { method: 'POST' }
  ),
  applyRecruitmentPost: (postId: string, xinfaId: string) => apiFetch<{ thread: RecruitmentThread } | RecruitmentThread>(
    `/recruitment/posts/${encodeURIComponent(String(postId || ''))}/applications`,
    {
      method: 'POST',
      body: JSON.stringify({ xinfaId }),
    }
  ),
  getRecruitmentThreads: (params: { limit?: number; page?: number; status?: RecruitmentThreadStatus } = {}) => apiFetch<{
    items: RecruitmentThread[];
    total: number;
    page: number;
    limit: number;
    unreadCount: number;
  }>(`/recruitment/threads${toQuery({
    ...params,
  })}`),
  getRecruitmentThread: (threadId: string) => apiFetch<{ thread: RecruitmentThread }>(
    `/recruitment/threads/${encodeURIComponent(String(threadId || ''))}`
  ),
  closeRecruitmentThread: (threadId: string) => apiFetch<{ thread: RecruitmentThread }>(
    `/recruitment/threads/${encodeURIComponent(String(threadId || ''))}/close`,
    { method: 'POST' }
  ),
  getRecruitmentMessages: (
    threadId: string,
    params: {
      afterSeq?: number;
      beforeSeq?: number;
      afterModerationSeq?: number;
      includeContactExchanges?: boolean;
      limit?: number;
    } = {}
  ) => apiFetch<{
    items: RecruitmentMessage[];
    moderationItems?: RecruitmentMessage[];
    contactExchanges?: RecruitmentContactExchange[];
    thread?: RecruitmentThread;
    hasMore?: boolean;
    nextAfterSeq?: number;
    oldestSeq?: number | null;
    moderationCursor?: number;
    moderationHasMore?: boolean;
  }>(`/recruitment/threads/${encodeURIComponent(String(threadId || ''))}/messages${toQuery(params)}`),
  sendRecruitmentMessage: (threadId: string, payload: { content: string; clientMsgId: string }) => apiFetch<{ message: RecruitmentMessage; created: boolean }>(
    `/recruitment/threads/${encodeURIComponent(String(threadId || ''))}/messages`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  ),
  markRecruitmentThreadRead: (threadId: string, lastMessageSeq?: number) => apiFetch<{ threadId: string; lastReadSeq: number }>(
    `/recruitment/threads/${encodeURIComponent(String(threadId || ''))}/read`,
    {
      method: 'POST',
      body: JSON.stringify({ lastMessageSeq }),
    }
  ),
  getRecruitmentContactExchanges: (threadId: string) => apiFetch<{ items: RecruitmentContactExchange[] }>(
    `/recruitment/threads/${encodeURIComponent(String(threadId || ''))}/contact-exchanges`
  ),
  createRecruitmentContactExchange: (threadId: string, contact: RecruitmentContactValue) => apiFetch<{
    items: RecruitmentContactExchange[];
    exchange?: RecruitmentContactExchange | null;
  }>(
    `/recruitment/threads/${encodeURIComponent(String(threadId || ''))}/contact-exchanges`,
    {
      method: 'POST',
      body: JSON.stringify({ contact }),
    }
  ),
  consentRecruitmentContactExchange: (exchangeId: string, contact: RecruitmentContactValue) => apiFetch<{
    items: RecruitmentContactExchange[];
    changed: boolean;
  }>(
    `/recruitment/contact-exchanges/${encodeURIComponent(String(exchangeId || ''))}/consent`,
    {
      method: 'POST',
      body: JSON.stringify({ contact }),
    }
  ),
  getRecruitmentNotifications: (params: { limit?: number; page?: number; afterSeq?: number } = {}) => apiFetch<{
    items: Array<{
      seq: number;
      id: string;
      type: 'recruitment_application' | 'recruitment_message' | 'recruitment_contact_proposed' | 'recruitment_contact_unlocked';
      threadId?: string | null;
      postId?: string | null;
      exchangeId?: string | null;
      createdAt: number;
      readAt?: number | null;
    }>;
    hasMore?: boolean;
    unreadCount: number;
    page?: number;
    limit?: number;
    nextAfterSeq?: number;
  }>(`/recruitment/notifications${toQuery(params)}`),
  readRecruitmentNotifications: (payload: { notificationIds?: string[]; upToSeq?: number } = {}) => apiFetch<{ updated: number }>('/recruitment/notifications/read', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  reportRecruitment: (payload: {
    targetType: 'post' | 'thread' | 'message' | 'contact_exchange';
    targetId: string;
    reasonCode: 'spam' | 'harassment' | 'privacy' | 'scam' | 'other';
    detail?: string;
    evidenceMessageIds?: string[];
    turnstileToken?: string;
  }) => apiFetch<{ report: { id: string } }>('/recruitment/reports', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  reportPost: (postId, payload) => apiFetch('/reports', {
    method: 'POST',
    body: JSON.stringify({ postId, ...(payload || {}) }),
  }),
  reportComment: (commentId, payload) => apiFetch('/reports', {
    method: 'POST',
    body: JSON.stringify({ commentId, ...(payload || {}) }),
  }),
  getNotifications: (params: {
    status?: 'all' | 'read' | 'unread';
    limit?: number;
    offset?: number;
    includeRecruitment?: boolean | number;
  } = {}) => apiFetch<{
    items: NotificationItem[];
    unreadCount: number;
    total: number;
    recruitment?: {
      items: NotificationItem[];
      unreadCount: number;
      hasMore?: boolean;
      nextAfterSeq?: number;
    } | null;
  }>(`/notifications${toQuery(params)}`),
  readNotifications: () => apiFetch('/notifications/read', { method: 'POST' }),
  getStreak7Status: () => apiFetch('/easter-eggs/streak7'),
  markStreak7Seen: () => apiFetch('/easter-eggs/streak7/seen', { method: 'POST' }),
  getMeShop: () => apiFetch('/me/shop'),
  claimMeShopDaily: () => apiFetch('/me/shop/claim-daily', { method: 'POST' }),
  redeemMeShopFrame: (frameId: string, tierId?: string) => apiFetch('/me/shop/redeem', {
    method: 'POST',
    body: JSON.stringify({ frameId, ...(tierId ? { tierId } : {}) }),
  }),
  equipMeShopFrame: (frameId: string | null) => apiFetch('/me/shop/equip', {
    method: 'POST',
    body: JSON.stringify({ frameId }),
  }),
  redeemMeShopNameStyle: (styleId: string, tierId?: string) => apiFetch('/me/shop/name-styles/redeem', {
    method: 'POST',
    body: JSON.stringify({ styleId, ...(tierId ? { tierId } : {}) }),
  }),
  equipMeShopNameStyle: (styleId: string | null) => apiFetch('/me/shop/name-styles/equip', {
    method: 'POST',
    body: JSON.stringify({ styleId }),
  }),
  getNameStyles: () => apiFetch('/name-styles'),
  getAdminNameStyles: () => apiFetch('/admin/name-styles'),
  createAdminNameStyle: (payload: Record<string, unknown>) => apiFetch('/admin/name-styles', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  }),
  patchAdminNameStyle: (id: string, patch: Record<string, unknown>) => apiFetch(`/admin/name-styles/${encodeURIComponent(String(id || ''))}`, {
    method: 'PATCH',
    body: JSON.stringify(patch || {}),
  }),
  getFrames: () => apiFetch('/frames'),
  getFrame: (id: string) => apiFetch(`/frames/${encodeURIComponent(String(id || ''))}`),
  getAdminNicknameFrames: () => apiFetch('/admin/nickname-frames'),
  validateAdminNicknameFramePackage: (payload: unknown) => apiFetch('/admin/nickname-frames/validate', {
    method: 'POST',
    body: JSON.stringify(typeof payload === 'string' ? { package: payload } : { package: payload }),
  }),
  importAdminNicknameFramePackage: (payload: unknown, mode: 'create' | 'upsert' = 'create') => apiFetch('/admin/nickname-frames/import', {
    method: 'POST',
    body: JSON.stringify({
      mode,
      ...(typeof payload === 'string' ? { fileText: payload } : { package: payload }),
    }),
  }),
  patchAdminNicknameFrame: (id: string, patch: Record<string, unknown>) => apiFetch(`/admin/nickname-frames/${encodeURIComponent(String(id || ''))}`, {
    method: 'PATCH',
    body: JSON.stringify(patch || {}),
  }),
  exportAdminNicknameFrame: (id: string) => apiFetch(`/admin/nickname-frames/${encodeURIComponent(String(id || ''))}/export`),
  createFeedback: (content, email, wechat = '', qq = '', turnstileToken) => apiFetch('/feedback', {
    method: 'POST',
    body: JSON.stringify({ content, email, wechat, qq, turnstileToken }),
  }),
  getWikiEntries: (params = {}) => apiFetch(`/wiki/entries${toQuery(params)}`),
  getWikiEntry: (slug) => apiFetch(`/wiki/entries/${encodeURIComponent(String(slug || ''))}`),
  createWikiSubmission: (payload) => apiFetch('/wiki/submissions', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  }),
  createWikiEdit: (slug, payload) => apiFetch(`/wiki/entries/${encodeURIComponent(String(slug || ''))}/edits`, {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  }),
  getReports: (params = {}) => apiFetch(`/reports${toQuery(params)}`),
  handleReport: (reportId, action, reason = '', options = {}) => apiFetch(`/reports/${reportId}/action`, {
    method: 'POST',
    body: JSON.stringify({ action: String(action || '').trim().toLowerCase(), reason, ...options }),
  }),
  getAdminPosts: (params = {}) => apiFetch(`/admin/posts${toQuery(params)}`),
  getAdminPostFeatures: (params = {}) => apiFetch(`/admin/post-features${toQuery(params)}`),
  handleAdminPostFeature: (postId, action, reason = '') => apiFetch(`/admin/post-features/${encodeURIComponent(String(postId || ''))}/action`, {
    method: 'POST',
    body: JSON.stringify({ action, reason }),
  }),
  createAdminPost: (content, tags = [], options = {}) => apiFetch('/admin/posts', {
    method: 'POST',
    body: JSON.stringify({ content, tags, ...options }),
  }),
  updateAdminPost: (postId, content, reason = '') => apiFetch(`/admin/posts/${postId}/edit`, {
    method: 'POST',
    body: JSON.stringify({ content, reason }),
  }),
  getAdminPostComments: (postId, page = 1, limit = 100, search = '') => apiFetch(`/admin/posts/${postId}/comments${toQuery({ page, limit, search })}`),
  getAdminHiddenContent: (params = {}) => apiFetch(`/admin/hidden-content${toQuery(params)}`),
  getAdminPostDeleteRequests: (params = {}) => apiFetch(`/admin/post-delete-requests${toQuery(params)}`),
  handleAdminPostDeleteRequest: (requestId, action, reason = '') => apiFetch(`/admin/post-delete-requests/${encodeURIComponent(String(requestId || ''))}/action`, {
    method: 'POST',
    body: JSON.stringify({ action, reason }),
  }),
  handleAdminHiddenContent: (type, id, action, reason = '') => apiFetch(`/admin/hidden-content/${encodeURIComponent(type)}/${encodeURIComponent(id)}/action`, {
    method: 'POST',
    body: JSON.stringify({ action, reason }),
  }),
  handleAdminComment: (commentId, action, reason = '', options = {}) => apiFetch(`/admin/comments/${commentId}/action`, {
    method: 'POST',
    body: JSON.stringify({ action, reason, ...options }),
  }),
  batchAdminPosts: (action, postIds, reason = '', options = {}) => apiFetch('/admin/posts/batch', {
    method: 'POST',
    body: JSON.stringify({ action, postIds, reason, ...options }),
  }),
  handleAdminPost: (postId, action, reason = '') => apiFetch(`/admin/posts/${postId}/action`, {
    method: 'POST',
    body: JSON.stringify({ action, reason }),
  }),
  batchAdminReports: (action, reportIds, reason = '') => apiFetch(`/admin/reports/batch`, {
    method: 'POST',
    body: JSON.stringify({ action, reportIds, reason }),
  }),
  getAdminRumors: (params = {}) => apiFetch(`/admin/rumors${toQuery(params)}`),
  handleAdminRumor: (targetType, targetId, action, reason = '') => apiFetch(`/admin/rumors/${encodeURIComponent(String(targetType || ''))}/${encodeURIComponent(String(targetId || ''))}/action`, {
    method: 'POST',
    body: JSON.stringify({ action, reason }),
  }),
  batchAdminRumors: (payload = {}) => apiFetch('/admin/rumors/batch', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  }),
  getAdminFeedback: (params = {}) => apiFetch(`/admin/feedback${toQuery(params)}`),
  getAdminRecruitmentReports: (params: {
    status?: 'pending' | 'reviewing' | 'resolved' | 'dismissed' | 'all';
    targetType?: 'post' | 'thread' | 'message' | 'contact_exchange' | 'all';
    page?: number;
    limit?: number;
  } = {}) => apiFetch(`/admin/recruitment/reports${toQuery(params)}`),
  getAdminRecruitmentEvidence: (reportId: string, reason: string) => apiFetch(
    `/admin/recruitment/reports/${encodeURIComponent(String(reportId || ''))}/evidence`,
    {
      method: 'POST',
      body: JSON.stringify({ reason, reportId }),
    }
  ),
  handleAdminRecruitmentReport: (
    reportId: string,
    action: 'ignore' | 'dismiss' | 'resolve' | 'handle' | 'ban',
    reason = '',
    options: Record<string, unknown> = {}
  ) => apiFetch(`/admin/recruitment/reports/${encodeURIComponent(String(reportId || ''))}/action`, {
    method: 'POST',
    body: JSON.stringify({ action, reason, ...options, reportId }),
  }),
  handleAdminRecruitmentPost: (postId: string, action: 'remove' | 'delete' | 'restore', reason: string, reportId: string) => apiFetch(
    `/admin/recruitment/posts/${encodeURIComponent(String(postId || ''))}/action`,
    { method: 'POST', body: JSON.stringify({ action, reason, reportId }) }
  ),
  handleAdminRecruitmentThread: (threadId: string, action: 'lock' | 'unlock', reason: string, reportId: string) => apiFetch(
    `/admin/recruitment/threads/${encodeURIComponent(String(threadId || ''))}/action`,
    { method: 'POST', body: JSON.stringify({ action, reason, reportId }) }
  ),
  handleAdminRecruitmentMessage: (messageId: string, action: 'remove' | 'delete' | 'restore', reason: string, reportId: string) => apiFetch(
    `/admin/recruitment/messages/${encodeURIComponent(String(messageId || ''))}/action`,
    { method: 'POST', body: JSON.stringify({ action, reason, reportId }) }
  ),
  handleAdminRecruitmentContactExchange: (exchangeId: string, action: 'remove' | 'delete' | 'restore', reason: string, reportId: string) => apiFetch(
    `/admin/recruitment/contact-exchanges/${encodeURIComponent(String(exchangeId || ''))}/action`,
    { method: 'POST', body: JSON.stringify({ action, reason, reportId }) }
  ),
  getAdminWikiRevisions: (params = {}) => apiFetch(`/admin/wiki/revisions${toQuery(params)}`),
  getAdminWikiEntries: (params = {}) => apiFetch(`/admin/wiki/entries${toQuery(params)}`),
  createAdminWikiEntry: (payload = {}) => apiFetch('/admin/wiki/entries', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  }),
  handleAdminWikiRevision: (revisionId, action, reason = '') => apiFetch(`/admin/wiki/revisions/${encodeURIComponent(String(revisionId || ''))}/action`, {
    method: 'POST',
    body: JSON.stringify({ action, reason }),
  }),
  updateAdminWikiRevision: (revisionId, payload = {}) => apiFetch(`/admin/wiki/revisions/${encodeURIComponent(String(revisionId || ''))}/edit`, {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  }),
  updateAdminWikiEntry: (entryId, payload = {}) => apiFetch(`/admin/wiki/entries/${encodeURIComponent(String(entryId || ''))}/edit`, {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  }),
  handleAdminWikiEntry: (entryId, action, reason = '') => apiFetch(`/admin/wiki/entries/${encodeURIComponent(String(entryId || ''))}/action`, {
    method: 'POST',
    body: JSON.stringify({ action, reason }),
  }),
  handleAdminFeedback: (feedbackId, action, reason = '', options = {}) => apiFetch(`/admin/feedback/${feedbackId}/action`, {
    method: 'POST',
    body: JSON.stringify({ action, reason, ...options }),
  }),
  replyAdminFeedback: (feedbackId, content) => apiFetch(`/admin/feedback/${encodeURIComponent(String(feedbackId || ''))}/replies`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  }),
  getAdminBans: () => apiFetch('/admin/bans'),
  handleAdminBan: (action, type, value, reason = '', options = {}) => apiFetch('/admin/bans/action', {
    method: 'POST',
    body: JSON.stringify({ action, type, value, reason, ...options }),
  }),
  sendHeartbeat: () => apiFetch('/online/heartbeat', { method: 'POST' }),
  getAccessStatus: () => apiFetch('/access'),
  getPublicSettings: () => apiFetch('/settings'),
  getAdminAuditLogs: (params = {}) => apiFetch(`/admin/audit-logs${toQuery(params)}`),
  getAnnouncement: () => apiFetch('/announcement'),
  getUpdateAnnouncements: () => apiFetch('/update-announcements'),
  getLatestUpdateAnnouncement: () => apiFetch('/update-announcements/latest'),
  getAdminAnnouncement: () => apiFetch('/admin/announcement'),
  updateAdminAnnouncement: (content) => apiFetch('/admin/announcement', {
    method: 'POST',
    body: JSON.stringify({ content }),
  }),
  clearAdminAnnouncement: () => apiFetch('/admin/announcement/clear', {
    method: 'POST',
  }),
  getAdminUpdateAnnouncements: () => apiFetch('/admin/update-announcements'),
  createAdminUpdateAnnouncement: (content) => apiFetch('/admin/update-announcements', {
    method: 'POST',
    body: JSON.stringify({ content }),
  }),
  deleteAdminUpdateAnnouncement: (id) => apiFetch(`/admin/update-announcements/${encodeURIComponent(String(id || ''))}/delete`, {
    method: 'POST',
  }),
  getAdminSettings: () => apiFetch('/admin/settings'),
  updateAdminSettings: (settings: {
    turnstileEnabled?: boolean;
    cnyThemeEnabled?: boolean;
    shopEnabled?: boolean;
    shopDailyClaimCoins?: number;
    defaultPostTags?: string[];
    rateLimits?: Partial<Record<
      | 'post'
      | 'comment'
      | 'report'
      | 'feature'
      | 'feedback'
      | 'wiki'
      | 'upload'
      | 'recruitment_publish'
      | 'recruitment_apply'
      | 'recruitment_message'
      | 'recruitment_contact'
      | 'recruitment_report',
      { limit?: number; windowMs?: number }
    >>;
    autoHideReportThreshold?: number;
    wecomWebhook?: { enabled?: boolean; url?: string; clearUrl?: boolean };
  }) => apiFetch('/admin/settings', {
    method: 'POST',
    body: JSON.stringify(settings || {}),
  }),
  getAdminShopUser: (fingerprint: string) => apiFetch(`/admin/shop/users${toQuery({ fingerprint })}`),
  adjustAdminShopUserCoins: (payload: {
    fingerprint: string;
    delta?: number;
    coins?: number;
  }) => apiFetch('/admin/shop/users/coins', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  }),
  testAdminWecomWebhook: (options: { url?: string } = {}) => apiFetch('/admin/settings/wecom-webhook/test', {
    method: 'POST',
    body: JSON.stringify(options || {}),
  }),
  getAdminVocabulary: (params = {}) => apiFetch(`/admin/vocabulary${toQuery(params)}`),
  addAdminVocabulary: (word) => apiFetch('/admin/vocabulary', {
    method: 'POST',
    body: JSON.stringify({ word }),
  }),
  toggleAdminVocabulary: (id, enabled) => apiFetch(`/admin/vocabulary/${id}/toggle`, {
    method: 'POST',
    body: JSON.stringify({ enabled }),
  }),
  deleteAdminVocabulary: (id) => apiFetch(`/admin/vocabulary/${id}/delete`, {
    method: 'POST',
  }),
  importAdminVocabulary: () => apiFetch('/admin/vocabulary/import', {
    method: 'POST',
  }),
  exportAdminVocabulary: () => apiFetch('/admin/vocabulary/export'),
  getAdminUsers: () => apiFetch('/admin/admin-users'),
  getAdminPermissionDefinitions: () => apiFetch('/admin/admin-users/permission-definitions'),
  createAdminUser: (payload = {}) => apiFetch('/admin/admin-users', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  }),
  updateAdminUserPermissions: (id, permissions = {}) => apiFetch(`/admin/admin-users/${encodeURIComponent(String(id || ''))}/permissions`, {
    method: 'POST',
    body: JSON.stringify({ permissions }),
  }),
  updateAdminUserStatus: (id, disabled) => apiFetch(`/admin/admin-users/${encodeURIComponent(String(id || ''))}/status`, {
    method: 'POST',
    body: JSON.stringify({ disabled }),
  }),
  resetAdminUserPassword: (id, password) => apiFetch(`/admin/admin-users/${encodeURIComponent(String(id || ''))}/password`, {
    method: 'POST',
    body: JSON.stringify({ password }),
  }),
  getAdminSession: () => apiFetch('/admin/session'),
  adminLogin: (username, password) => apiFetch('/admin/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  }),
  adminLogout: () => apiFetch('/admin/logout', { method: 'POST' }),
  getStats: () => apiFetch('/admin/stats'),
  uploadImage: async (
    file: File,
    options: {
      uploadChannel?: string;
      channelName?: string;
      serverCompress?: boolean;
      autoRetry?: boolean;
      uploadNameType?: 'default' | 'index' | 'origin' | 'short';
      returnFormat?: 'default' | 'full';
      uploadFolder?: string;
      usage?: 'post' | 'comment' | 'wiki';
    } = {}
  ): Promise<{ src: string; url: string }> => {
    return apiFetch(`/uploads/image${toQuery({
      uploadChannel: options.uploadChannel,
      channelName: options.channelName,
      serverCompress: options.serverCompress ?? true,
      autoRetry: options.autoRetry ?? true,
      uploadNameType: options.uploadNameType ?? 'default',
      returnFormat: options.returnFormat ?? 'default',
      uploadFolder: options.uploadFolder,
      usage: options.usage,
    })}`, {
      method: 'POST',
      headers: {
        'Content-Type': file.type,
      },
      body: file,
    });
  },
};
