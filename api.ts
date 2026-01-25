import { getBrowserFingerprint } from './fingerprint';

const toQuery = (params) => {
  const entries = Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (entries.length === 0) return '';
  const query = entries
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
  return `?${query}`;
};

let csrfToken = '';

const needsAdminCsrf = (path: string) => path.startsWith('/admin') || path.startsWith('/reports');

const apiFetch = async (path, options = {}) => {
  const fingerprint = await getBrowserFingerprint().catch(() => '');
  const response = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(csrfToken && needsAdminCsrf(path) ? { 'X-CSRF-Token': csrfToken } : {}),
      ...(fingerprint ? { 'X-Client-Fingerprint': fingerprint } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });

  if (response.status === 204) {
    return null;
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data?.error || '请求失败';
    throw new Error(message);
  }

  return data;
};

export const api = {
  setCsrfToken: (token) => {
    csrfToken = token || '';
  },
  getHomePosts: (limit, offset = 0) => apiFetch(`/posts/home${toQuery({ limit, offset })}`),
  getPostById: (postId) => apiFetch(`/posts/${postId}`),
  getFeedPosts: (filter, search) => apiFetch(`/posts/feed${toQuery({ filter, search })}`),
  searchPosts: (q, page = 1, limit = 20) => apiFetch(`/posts/search${toQuery({ q, page, limit })}`),
  createPost: (content, tags = [], turnstileToken) => apiFetch('/posts', {
    method: 'POST',
    body: JSON.stringify({ content, tags, turnstileToken }),
  }),
  likePost: (postId) => apiFetch(`/posts/${postId}/like`, { method: 'POST' }),
  dislikePost: (postId) => apiFetch(`/posts/${postId}/dislike`, { method: 'POST' }),
  viewPost: (postId) => apiFetch(`/posts/${postId}/view`, { method: 'POST' }),
  getComments: (postId, offset = 0, limit = 10) => apiFetch(`/posts/${postId}/comments${toQuery({ offset, limit })}`),
  getCommentThread: (postId, commentId) => apiFetch(`/posts/${postId}/comment-thread${toQuery({ commentId })}`),
  addComment: (postId, content, turnstileToken, parentId, replyToId) => apiFetch(`/posts/${postId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ content, turnstileToken, parentId, replyToId }),
  }),
  reportPost: (postId, reason) => apiFetch('/reports', {
    method: 'POST',
    body: JSON.stringify({ postId, reason }),
  }),
  reportComment: (commentId, reason) => apiFetch('/reports', {
    method: 'POST',
    body: JSON.stringify({ commentId, reason }),
  }),
  getNotifications: (params = {}) => apiFetch(`/notifications${toQuery(params)}`),
  readNotifications: () => apiFetch('/notifications/read', { method: 'POST' }),
  createFeedback: (content, email, wechat = '', qq = '', turnstileToken) => apiFetch('/feedback', {
    method: 'POST',
    body: JSON.stringify({ content, email, wechat, qq, turnstileToken }),
  }),
  getReports: (status?: string, search?: string) => apiFetch(`/reports${toQuery({ status, search })}`),
  handleReport: (reportId, action, reason = '', options = {}) => apiFetch(`/reports/${reportId}/action`, {
    method: 'POST',
    body: JSON.stringify({ action, reason, ...options }),
  }),
  getAdminPosts: (params = {}) => apiFetch(`/admin/posts${toQuery(params)}`),
  createAdminPost: (content, tags = [], options = {}) => apiFetch('/admin/posts', {
    method: 'POST',
    body: JSON.stringify({ content, tags, ...options }),
  }),
  updateAdminPost: (postId, content, reason = '') => apiFetch(`/admin/posts/${postId}/edit`, {
    method: 'POST',
    body: JSON.stringify({ content, reason }),
  }),
  getAdminPostComments: (postId, page = 1, limit = 100) => apiFetch(`/admin/posts/${postId}/comments${toQuery({ page, limit })}`),
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
  getAdminFeedback: (params = {}) => apiFetch(`/admin/feedback${toQuery(params)}`),
  handleAdminFeedback: (feedbackId, action, reason = '', options = {}) => apiFetch(`/admin/feedback/${feedbackId}/action`, {
    method: 'POST',
    body: JSON.stringify({ action, reason, ...options }),
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
  getAdminAnnouncement: () => apiFetch('/admin/announcement'),
  updateAdminAnnouncement: (content) => apiFetch('/admin/announcement', {
    method: 'POST',
    body: JSON.stringify({ content }),
  }),
  clearAdminAnnouncement: () => apiFetch('/admin/announcement/clear', {
    method: 'POST',
  }),
  getAdminSettings: () => apiFetch('/admin/settings'),
  updateAdminSettings: (turnstileEnabled) => apiFetch('/admin/settings', {
    method: 'POST',
    body: JSON.stringify({ turnstileEnabled }),
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
  getAdminSession: () => apiFetch('/admin/session'),
  adminLogin: (username, password) => apiFetch('/admin/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  }),
  adminLogout: () => apiFetch('/admin/logout', { method: 'POST' }),
  getStats: () => apiFetch('/admin/stats'),
};
