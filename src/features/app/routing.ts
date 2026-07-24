import { ViewType } from '@/types';

export const normalizePath = (path: string) => {
  if (!path || path === '/') {
    return '/';
  }
  return path.endsWith('/') ? path.slice(0, -1) : path;
};

export const resolveViewFromPath = (path: string) => {
  const normalized = normalizePath(path);
  if (normalized === '/tiancai') {
    return ViewType.ADMIN;
  }
  if (normalized === '/submit') {
    return ViewType.SUBMISSION;
  }
  if (normalized === '/search') {
    return ViewType.SEARCH;
  }
  if (normalized === '/favorites') {
    return ViewType.FAVORITES;
  }
  if (normalized === '/featured') {
    return ViewType.FEATURED;
  }
  if (normalized === '/feed') {
    return ViewType.FEED;
  }
  if (normalized === '/wiki' || /^\/wiki\/[^/]+$/.test(normalized)) {
    return ViewType.WIKI;
  }
  if (/^\/recruitment\/chat\/[^/]+$/.test(normalized)) {
    // 密聊深链仍保留，但统一由招募页在“密聊”标签内嵌展示。
    return ViewType.RECRUITMENT;
  }
  if (normalized === '/recruitment') {
    return ViewType.RECRUITMENT;
  }
  if (normalized === '/' || /^\/post\/[^/]+$/.test(normalized)) {
    return ViewType.HOME;
  }
  return ViewType.NOT_FOUND;
};

export const getPathForView = (view: ViewType) => {
  if (view === ViewType.ADMIN) {
    return '/tiancai';
  }
  if (view === ViewType.SUBMISSION) {
    return '/submit';
  }
  if (view === ViewType.SEARCH) {
    return '/search';
  }
  if (view === ViewType.FAVORITES) {
    return '/favorites';
  }
  if (view === ViewType.FEATURED) {
    return '/featured';
  }
  if (view === ViewType.FEED) {
    return '/feed';
  }
  if (view === ViewType.WIKI) {
    return '/wiki';
  }
  if (view === ViewType.RECRUITMENT || view === ViewType.RECRUITMENT_CHAT) {
    return '/recruitment';
  }
  return '/';
};

export const buildRecruitmentChatPath = (threadId: string) => (
  `/recruitment/chat/${encodeURIComponent(String(threadId || ''))}`
);

export const getRecruitmentThreadIdFromPath = (path: string) => {
  const match = normalizePath(path).match(/^\/recruitment\/chat\/([^/]+)$/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
};
