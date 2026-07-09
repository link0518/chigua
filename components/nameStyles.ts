/** 炫彩昵称运行时目录（RGB 由 /api/name-styles 与商城接口下发） */

import { useSyncExternalStore, type CSSProperties } from 'react';

export interface NameStyleColor {
  r: number;
  g: number;
  b: number;
}

export interface NameStyleDef {
  id: string;
  name: string;
  price?: number;
  rarity?: string;
  color?: NameStyleColor;
  colorCss?: string;
  colorHex?: string;
  styleKey?: string;
  description?: string;
}

let nameStyleRegistry: Record<string, NameStyleDef> = {};
let nameStyleVersion = 0;
const listeners = new Set<() => void>();

const emit = () => {
  nameStyleVersion += 1;
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // ignore
    }
  });
};

export const setNameStyleRegistry = (items: NameStyleDef[]) => {
  const next: Record<string, NameStyleDef> = {};
  (items || []).forEach((item) => {
    if (item?.id) next[item.id] = item;
  });
  nameStyleRegistry = next;
  emit();
};

export const mergeNameStyleRegistry = (items: NameStyleDef[]) => {
  const next = { ...nameStyleRegistry };
  (items || []).forEach((item) => {
    if (item?.id) next[item.id] = { ...next[item.id], ...item };
  });
  nameStyleRegistry = next;
  emit();
};

export const getNameStyleDef = (id?: string | null): NameStyleDef | null => {
  const key = String(id || '').trim();
  if (!key) return null;
  return nameStyleRegistry[key] || null;
};

export const useNameStyleRegistryVersion = () => useSyncExternalStore(
  (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  () => nameStyleVersion,
  () => 0
);

/** 由 RGB 生成纯色文字样式 */
export const buildNameStyleInlineStyle = (color?: NameStyleColor | null): CSSProperties | undefined => {
  if (!color) return undefined;
  const { r, g, b } = color;
  return {
    color: `rgb(${r}, ${g}, ${b})`,
    fontWeight: 800,
  };
};

export const colorToCss = (color?: NameStyleColor | null) => {
  if (!color) return '';
  return `rgb(${color.r}, ${color.g}, ${color.b})`;
};
