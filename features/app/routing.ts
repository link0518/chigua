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
  if (normalized === '/search') {
    return ViewType.SEARCH;
  }
  if (normalized === '/favorites') {
    return ViewType.FAVORITES;
  }
  if (normalized === '/chat') {
    return ViewType.CHAT;
  }
  if (normalized === '/wiki' || /^\/wiki\/[^/]+$/.test(normalized)) {
    return ViewType.WIKI;
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
  if (view === ViewType.SEARCH) {
    return '/search';
  }
  if (view === ViewType.FAVORITES) {
    return '/favorites';
  }
  if (view === ViewType.CHAT) {
    return '/chat';
  }
  if (view === ViewType.WIKI) {
    return '/wiki';
  }
  return '/';
};
