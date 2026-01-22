const toQuery = (params) => {
  const entries = Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (entries.length === 0) return '';
  const query = entries
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
  return `?${query}`;
};

const apiFetch = async (path, options = {}) => {
  const response = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
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
  getHomePosts: (limit) => apiFetch(`/posts/home${toQuery({ limit })}`),
  getPostById: (postId) => apiFetch(`/posts/${postId}`),
  getFeedPosts: (filter, search) => apiFetch(`/posts/feed${toQuery({ filter, search })}`),
  createPost: (content, tags = []) => apiFetch('/posts', {
    method: 'POST',
    body: JSON.stringify({ content, tags }),
  }),
  likePost: (postId) => apiFetch(`/posts/${postId}/like`, { method: 'POST' }),
  dislikePost: (postId) => apiFetch(`/posts/${postId}/dislike`, { method: 'POST' }),
  viewPost: (postId) => apiFetch(`/posts/${postId}/view`, { method: 'POST' }),
  getComments: (postId) => apiFetch(`/posts/${postId}/comments`),
  addComment: (postId, content) => apiFetch(`/posts/${postId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  }),
  reportPost: (postId, reason) => apiFetch('/reports', {
    method: 'POST',
    body: JSON.stringify({ postId, reason }),
  }),
  getReports: (status?: string, search?: string) => apiFetch(`/reports${toQuery({ status, search })}`),
  handleReport: (reportId, action, reason = '') => apiFetch(`/reports/${reportId}/action`, {
    method: 'POST',
    body: JSON.stringify({ action, reason }),
  }),
  getAdminPosts: (params = {}) => apiFetch(`/admin/posts${toQuery(params)}`),
  createAdminPost: (content, tags = []) => apiFetch('/admin/posts', {
    method: 'POST',
    body: JSON.stringify({ content, tags }),
  }),
  updateAdminPost: (postId, content, reason = '') => apiFetch(`/admin/posts/${postId}/edit`, {
    method: 'POST',
    body: JSON.stringify({ content, reason }),
  }),
  batchAdminPosts: (action, postIds, reason = '') => apiFetch('/admin/posts/batch', {
    method: 'POST',
    body: JSON.stringify({ action, postIds, reason }),
  }),
  handleAdminPost: (postId, action, reason = '') => apiFetch(`/admin/posts/${postId}/action`, {
    method: 'POST',
    body: JSON.stringify({ action, reason }),
  }),
  batchAdminReports: (action, reportIds, reason = '') => apiFetch('/admin/reports/batch', {
    method: 'POST',
    body: JSON.stringify({ action, reportIds, reason }),
  }),
  getAdminBans: () => apiFetch('/admin/bans'),
  handleAdminBan: (action, type, value, reason = '') => apiFetch('/admin/bans/action', {
    method: 'POST',
    body: JSON.stringify({ action, type, value, reason }),
  }),
  getAdminAuditLogs: (params = {}) => apiFetch(`/admin/audit-logs${toQuery(params)}`),
  getAdminSession: () => apiFetch('/admin/session'),
  adminLogin: (username, password) => apiFetch('/admin/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  }),
  adminLogout: () => apiFetch('/admin/logout', { method: 'POST' }),
  getStats: () => apiFetch('/admin/stats'),
};
