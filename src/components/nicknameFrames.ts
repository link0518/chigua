/** 昵称框类型与公开目录缓存（数据来自 /api/frames 与 shop catalog） */

import { useSyncExternalStore } from 'react';

export type NicknameFrameRarity = 'common' | 'rare' | 'epic';

export type NicknameFrameId = string;

export interface FrameRenderPayload {
  engine?: string;
  html?: string;
  css?: string;
  assets?: Record<string, string>;
  lottie?: { slot?: string; data?: string } | null;
}

export interface NicknameFrameDef {
  id: string;
  name: string;
  price: number;
  rarity: NicknameFrameRarity;
  description?: string;
  status?: string;
  render?: FrameRenderPayload | null;
  packageRevision?: number;
}

export const RARITY_LABEL: Record<NicknameFrameRarity, string> = {
  common: '普通',
  rare: '稀有',
  epic: '史诗',
};

export const RARITY_BADGE_CLASS: Record<NicknameFrameRarity, string> = {
  common: 'bg-marker-green/40 text-ink border-ink/30',
  rare: 'bg-marker-blue/50 text-ink border-ink/40',
  epic: 'bg-gradient-to-r from-amber-200 to-yellow-100 text-amber-900 border-amber-400',
};

/** 运行时框目录缓存（id → def） */
let frameRegistry: Record<string, NicknameFrameDef> = {};
/** 版本号：供 React 订阅，目录更新后强制相关视图重渲染 */
let frameRegistryVersion = 0;
const frameRegistryListeners = new Set<() => void>();

const emitFrameRegistryChange = () => {
  frameRegistryVersion += 1;
  frameRegistryListeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // ignore subscriber errors
    }
  });
};

const subscribeFrameRegistry = (listener: () => void) => {
  frameRegistryListeners.add(listener);
  return () => {
    frameRegistryListeners.delete(listener);
  };
};

const getFrameRegistryVersion = () => frameRegistryVersion;

export const setFrameRegistry = (items: NicknameFrameDef[]) => {
  const next: Record<string, NicknameFrameDef> = {};
  (items || []).forEach((item) => {
    if (item?.id) {
      next[item.id] = item;
    }
  });
  frameRegistry = next;
  emitFrameRegistryChange();
};

export const mergeFrameRegistry = (items: NicknameFrameDef[]) => {
  const next = { ...frameRegistry };
  (items || []).forEach((item) => {
    if (item?.id) {
      next[item.id] = { ...next[item.id], ...item };
    }
  });
  frameRegistry = next;
  emitFrameRegistryChange();
};

export const getFrameDef = (id?: string | null): NicknameFrameDef | null => {
  const key = String(id || '').trim();
  if (!key) return null;
  return frameRegistry[key] || null;
};

export const isNicknameFrameId = (value: unknown): value is string => {
  const key = String(value || '').trim();
  if (!key) return false;
  // 有注册渲染数据才视为可用框
  return Boolean(frameRegistry[key]?.render?.css);
};

export const listRegisteredFrames = () => Object.values(frameRegistry);

/**
 * 订阅框目录版本。Feed/Home 等在 frames 异步加载完成后必须用此 hook 触发重渲染。
 */
export const useFrameRegistryVersion = () => useSyncExternalStore(
  subscribeFrameRegistry,
  getFrameRegistryVersion,
  () => 0
);
