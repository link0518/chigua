import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Bell,
  ChevronRight,
  Coins,
  Frame,
  ShieldOff,
  Settings2,
  Star,
  Store,
  X,
} from 'lucide-react';

import { api } from '../api';
import { ViewType } from '../types';
import type { UpdateAnnouncementItem } from '../types';
import { useApp } from '../store/AppContext';
import {
  HIDDEN_POST_KEYWORDS_LIMIT,
  normalizeHiddenPostKeyword,
  normalizeHiddenPostTag,
  normalizeHiddenPostTagList,
} from '../store/hiddenPostTags';
import MarkdownRenderer from './MarkdownRenderer';
import Modal from './Modal';
import ColorfulName from './ColorfulName';
import { AnonymousAuthorPreview } from './NicknameFrameCard';
import { mergeNameStyleRegistry } from './nameStyles';
import {
  RARITY_BADGE_CLASS,
  RARITY_LABEL,
  mergeFrameRegistry,
  type FrameRenderPayload,
  type NicknameFrameRarity,
} from './nicknameFrames';
import ShopPriceTiers, { ShopPriceSummary, type ShopPriceTier } from './ShopPriceTiers';
import { SketchButton } from './SketchUI';

// 后续扩展：在 MePanelId 追加 id，在 menu 配置加菜单，在 panel switch 注册渲染
type MePanelId = 'home' | 'settings' | 'updateAnnouncements' | 'shop';

type MeMenuAction =
  | { type: 'panel'; panel: Exclude<MePanelId, 'home'> }
  | { type: 'navigate'; view: ViewType }
  | { type: 'callback'; key: string };

interface MeMenuItem {
  id: string;
  label: string;
  description?: string;
  icon: React.ReactNode;
  action: MeMenuAction;
  showDot?: boolean;
  accent?: string;
}

interface MeMenuSection {
  id: string;
  title: string;
  items: MeMenuItem[];
}

interface UserMeModalProps {
  isOpen: boolean;
  onClose: () => void;
  updateAnnouncementsUnread?: boolean;
  onUpdateAnnouncementsSeen?: (updatedAt: number) => void;
  onNavigate?: (view: ViewType) => void;
  onMenuCallback?: (key: string) => void;
}

const PANEL_TITLES: Record<MePanelId, string> = {
  home: '我的',
  settings: '设置',
  updateAnnouncements: '更新公告',
  shop: '商城',
};

interface ShopCatalogItem {
  id: string;
  name: string;
  price: number;
  rarity: NicknameFrameRarity | string;
  durationDays?: number;
  priceTiers?: ShopPriceTier[];
  owned: boolean;
  expiresAt?: number | null;
  equipped: boolean;
  render?: FrameRenderPayload | null;
}

interface NameStyleItem {
  id: string;
  name: string;
  price: number;
  rarity: string;
  description?: string;
  durationDays?: number;
  priceTiers?: ShopPriceTier[];
  styleKey?: string;
  color?: { r: number; g: number; b: number };
  colorCss?: string;
  colorHex?: string;
  owned: boolean;
  expiresAt?: number | null;
  equipped: boolean;
}

const resolveTiers = (item: {
  price: number;
  durationDays?: number;
  priceTiers?: ShopPriceTier[];
}): ShopPriceTier[] => {
  if (Array.isArray(item.priceTiers) && item.priceTiers.length > 0) {
    return item.priceTiers;
  }
  const days = Number(item.durationDays || 0);
  return [{
    id: 'default',
    price: item.price,
    durationDays: days,
    label: days > 0 ? `${days} 天` : '永久',
  }];
};

const formatExpires = (expiresAt?: number | null) => {
  if (expiresAt == null) return '';
  const left = Number(expiresAt) - Date.now();
  if (left <= 0) return '已过期';
  const hours = Math.ceil(left / (60 * 60 * 1000));
  if (hours < 48) return `剩约 ${hours} 小时`;
  const days = Math.ceil(left / (24 * 60 * 60 * 1000));
  return `剩约 ${days} 天`;
};

interface ShopState {
  coins: number;
  ownedFrameIds: string[];
  equippedFrameId: string | null;
  ownedNameStyleIds: string[];
  equippedNameStyleId: string | null;
  canClaimDaily: boolean;
  dailyClaimCoins: number;
  catalog: ShopCatalogItem[];
  nameStyles: NameStyleItem[];
}

const formatAnnouncementTime = (value: number) => new Date(value).toLocaleString('zh-CN');

// ---------------------------------------------------------------------------
// 共享 UI 片段
// ---------------------------------------------------------------------------

const SectionCard: React.FC<{
  children: React.ReactNode;
  className?: string;
  title?: string;
  action?: React.ReactNode;
}> = ({ children, className = '', title, action }) => (
  <section className={`overflow-hidden rounded-2xl border-2 border-ink/10 bg-white shadow-[0_8px_24px_-16px_rgba(15,23,42,0.35)] ${className}`}>
    {(title || action) && (
      <div className="flex items-center justify-between gap-3 border-b border-ink/8 bg-[#fbfaf6] px-4 py-3 sm:px-5">
        {title ? <h3 className="font-sans text-sm font-bold text-ink">{title}</h3> : <span />}
        {action}
      </div>
    )}
    {children}
  </section>
);

const StatPill: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  onClick?: () => void;
}> = ({ icon, label, value, onClick }) => {
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`flex min-w-0 flex-1 flex-col items-center gap-1 rounded-2xl border-2 border-white/40 bg-white/75 px-2 py-3 text-center shadow-sm backdrop-blur-sm transition-all ${
        onClick ? 'hover:-translate-y-0.5 hover:bg-white active:translate-y-0' : ''
      }`}
    >
      <span className="inline-flex items-center justify-center text-ink/70">{icon}</span>
      <span className="font-sans text-lg font-black tabular-nums text-ink sm:text-xl">{value}</span>
      <span className="text-[11px] font-medium text-pencil">{label}</span>
    </Comp>
  );
};

// ---------------------------------------------------------------------------
// SettingsPanel
// ---------------------------------------------------------------------------

const SettingsPanel: React.FC = () => {
  const {
    state,
    toggleHiddenPostTag,
    toggleHiddenPostKeyword,
    clearHiddenPostTags,
    clearHiddenPostKeywords,
  } = useApp();
  const [loadingTags, setLoadingTags] = useState(false);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [keywordInput, setKeywordInput] = useState('');

  useEffect(() => {
    let active = true;
    setLoadingTags(true);
    api.getPostTags(60)
      .then((data) => {
        if (!active) return;
        const items = Array.isArray(data?.items) ? data.items : [];
        setAvailableTags(
          normalizeHiddenPostTagList(
            items.map((item: any) => normalizeHiddenPostTag(String(item?.name || '')))
          )
        );
      })
      .catch(() => {
        if (active) setAvailableTags([]);
      })
      .finally(() => {
        if (active) setLoadingTags(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const hiddenTagKeys = useMemo(
    () => new Set(state.hiddenPostTags.map((tag) => tag.toLowerCase())),
    [state.hiddenPostTags]
  );

  const selectableTags = useMemo(() => {
    const merged = [...availableTags];
    state.hiddenPostTags.forEach((tag) => {
      if (!merged.some((item) => item.toLowerCase() === tag.toLowerCase())) {
        merged.push(tag);
      }
    });
    return normalizeHiddenPostTagList(merged);
  }, [availableTags, state.hiddenPostTags]);

  const addHiddenPostKeyword = () => {
    const normalized = normalizeHiddenPostKeyword(keywordInput);
    if (!normalized) return;
    if (state.hiddenPostKeywords.some((keyword) => keyword.toLowerCase() === normalized.toLowerCase())) {
      setKeywordInput('');
      return;
    }
    toggleHiddenPostKeyword(normalized);
    setKeywordInput('');
  };

  const clearHiddenPostFilters = () => {
    clearHiddenPostTags();
    clearHiddenPostKeywords();
    setKeywordInput('');
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      <SectionCard title={`已屏蔽标签 · ${state.hiddenPostTags.length}`}>
        <div className="p-4 sm:p-5">
          {state.hiddenPostTags.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {state.hiddenPostTags.map((tag) => (
                <button
                  key={`hidden-${tag}`}
                  type="button"
                  onClick={() => toggleHiddenPostTag(tag)}
                  className="rounded-full border border-ink bg-highlight px-3 py-1.5 text-xs font-bold text-ink transition-opacity hover:opacity-80"
                >
                  #{tag} ×
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-pencil">无</p>
          )}
        </div>
      </SectionCard>

      <SectionCard
        title={`已屏蔽关键词 · ${state.hiddenPostKeywords.length}/${HIDDEN_POST_KEYWORDS_LIMIT}`}
      >
        <div className="space-y-3 p-4 sm:p-5">
          {state.hiddenPostKeywords.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {state.hiddenPostKeywords.map((keyword) => (
                <button
                  key={`hidden-keyword-${keyword}`}
                  type="button"
                  onClick={() => toggleHiddenPostKeyword(keyword)}
                  className="rounded-full border border-ink bg-highlight px-3 py-1.5 text-xs font-bold text-ink transition-opacity hover:opacity-80"
                >
                  {keyword} ×
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              value={keywordInput}
              onChange={(event) => setKeywordInput(event.target.value)}
              aria-label="屏蔽关键词"
              placeholder="关键词"
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addHiddenPostKeyword();
                }
              }}
              className="min-w-0 flex-1 rounded-full border-2 border-ink bg-white px-4 py-2.5 text-sm font-sans outline-none focus:shadow-sketch-sm"
              disabled={state.hiddenPostKeywords.length >= HIDDEN_POST_KEYWORDS_LIMIT}
            />
            <SketchButton
              type="button"
              variant="secondary"
              className="px-5 text-base sm:shrink-0"
              onClick={addHiddenPostKeyword}
              disabled={state.hiddenPostKeywords.length >= HIDDEN_POST_KEYWORDS_LIMIT}
            >
              添加
            </SketchButton>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="可选标签">
        <div className="p-4 sm:p-5">
          {loadingTags ? (
            <p className="text-sm text-pencil">加载中...</p>
          ) : selectableTags.length > 0 ? (
            <div className="flex max-h-52 flex-wrap gap-2 overflow-y-auto pr-1 sm:max-h-64">
              {selectableTags.map((tag) => {
                const active = hiddenTagKeys.has(tag.toLowerCase());
                return (
                  <button
                    key={`selectable-${tag}`}
                    type="button"
                    onClick={() => toggleHiddenPostTag(tag)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${
                      active
                        ? 'border-ink bg-highlight text-ink'
                        : 'border-gray-300 bg-white text-pencil hover:border-ink hover:text-ink'
                    }`}
                  >
                    #{tag}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-pencil">无</p>
          )}
        </div>
      </SectionCard>

      <SketchButton
        type="button"
        variant="secondary"
        className="w-full text-base"
        onClick={clearHiddenPostFilters}
        disabled={state.hiddenPostTags.length === 0 && state.hiddenPostKeywords.length === 0}
      >
        清空屏蔽
      </SketchButton>
    </div>
  );
};

// ---------------------------------------------------------------------------
// UpdateAnnouncementsPanel
// ---------------------------------------------------------------------------

const UpdateAnnouncementsPanel: React.FC<{
  items: UpdateAnnouncementItem[];
  loading: boolean;
}> = ({ items, loading }) => {
  if (loading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="animate-pulse rounded-2xl border-2 border-ink/10 bg-white p-5">
            <div className="mb-3 h-3 w-32 rounded bg-gray-200" />
            <div className="mb-2 h-3 w-full rounded bg-gray-100" />
            <div className="h-3 w-4/5 rounded bg-gray-100" />
          </div>
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-ink/15 bg-[#fcfbf7] px-6 py-16 text-center">
        <Bell className="mx-auto mb-3 h-8 w-8 text-pencil/50" />
        <p className="font-hand text-lg text-pencil">暂无更新公告</p>
      </div>
    );
  }

  return (
    <div className="relative space-y-0">
      <div className="absolute bottom-4 left-[1.15rem] top-4 w-px bg-ink/10 sm:left-[1.35rem]" />
      {items.map((item, index) => (
        <article key={item.id} className="relative flex gap-3 pb-4 last:pb-0 sm:gap-4">
          <div className="relative z-[1] mt-5 flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-highlight shadow-sm sm:size-6">
            <span className="text-[10px] font-bold text-ink">{items.length - index}</span>
          </div>
          <div className="min-w-0 flex-1 rounded-2xl border-2 border-ink/10 bg-white p-4 shadow-[0_6px_18px_-14px_rgba(15,23,42,0.4)] sm:p-5">
            <div className="mb-3 text-xs font-medium text-pencil">
              更新时间 · {formatAnnouncementTime(item.updatedAt)}
            </div>
            <MarkdownRenderer content={item.content} className="text-sm text-ink" />
          </div>
        </article>
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------
// ShopPanel
// ---------------------------------------------------------------------------

const ShopPanel: React.FC<{
  shop: ShopState | null;
  loading: boolean;
  busy: boolean;
  onClaimDaily: () => void;
  onRedeem: (frameId: string, tierId?: string) => void;
  onEquip: (frameId: string | null) => void;
  onRedeemNameStyle: (styleId: string, tierId?: string) => void;
  onEquipNameStyle: (styleId: string | null) => void;
}> = ({
  shop,
  loading,
  busy,
  onClaimDaily,
  onRedeem,
  onEquip,
  onRedeemNameStyle,
  onEquipNameStyle,
}) => {
  const [tab, setTab] = useState<'frames' | 'names'>('frames');
  /** 每个商品当前选中的阶梯 id */
  const [selectedTiers, setSelectedTiers] = useState<Record<string, string>>({});
  const catalog = useMemo(() => (shop?.catalog || []) as ShopCatalogItem[], [shop]);
  const nameStyles = useMemo(() => (shop?.nameStyles || []) as NameStyleItem[], [shop]);

  const pickTier = (itemId: string, tiers: ShopPriceTier[]) => {
    const preferred = selectedTiers[itemId];
    if (preferred && tiers.some((t) => t.id === preferred)) {
      return tiers.find((t) => t.id === preferred)!;
    }
    return tiers[0];
  };

  useEffect(() => {
    if (!catalog.length) return;
    mergeFrameRegistry(
      catalog.map((item) => ({
        id: item.id,
        name: item.name,
        price: item.price,
        rarity: (item.rarity as NicknameFrameRarity) || 'common',
        render: item.render || null,
      }))
    );
  }, [catalog]);

  useEffect(() => {
    if (!nameStyles.length) return;
    mergeNameStyleRegistry(
      nameStyles.map((item) => ({
        id: item.id,
        name: item.name,
        price: item.price,
        rarity: item.rarity,
        color: item.color,
        colorCss: item.colorCss,
        colorHex: item.colorHex,
        styleKey: item.styleKey,
      }))
    );
  }, [nameStyles]);

  const previewId = shop?.equippedFrameId || null;
  const previewRender = catalog.find((item) => item.id === previewId)?.render || null;
  const previewNameStyle = shop?.equippedNameStyleId || null;

  if (loading && !shop) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-40 animate-pulse rounded-2xl border-2 border-ink/10 bg-gray-100" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* 钱包 + 预览 */}
      <div className="overflow-hidden rounded-2xl border-2 border-ink bg-gradient-to-br from-[#1a1a1a] via-[#2c2418] to-[#1f2a22] p-4 text-white shadow-sketch-lg sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-white/70">
              <Coins className="h-4 w-4" />
              <span className="text-xs font-bold tracking-wide">我的瓜子</span>
            </div>
            <div className="mt-1 font-display text-4xl tabular-nums tracking-tight">{shop?.coins ?? 0}</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy || !shop?.canClaimDaily}
                onClick={onClaimDaily}
                className="rounded-full border border-white/30 bg-white/10 px-4 py-2 text-sm font-bold backdrop-blur-sm transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {shop?.canClaimDaily ? `领取 +${shop?.dailyClaimCoins ?? 10}` : '今日已领取'}
              </button>
              {shop?.equippedFrameId && tab === 'frames' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onEquip(null)}
                  className="rounded-full border border-white/20 px-4 py-2 text-sm font-bold text-white/80 transition-colors hover:bg-white/10 disabled:opacity-45"
                >
                  卸下头像框
                </button>
              )}
              {shop?.equippedNameStyleId && tab === 'names' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onEquipNameStyle(null)}
                  className="rounded-full border border-white/20 px-4 py-2 text-sm font-bold text-white/80 transition-colors hover:bg-white/10 disabled:opacity-45"
                >
                  卸下
                </button>
              )}
            </div>
          </div>
          <div className="rounded-2xl border border-white/15 bg-white/95 p-3 text-ink shadow-lg sm:min-w-[240px]">
            <div className="mb-2 text-[11px] font-bold text-pencil">当前装备预览</div>
            <div className="rounded-lg border-2 border-black bg-white p-3">
              <AnonymousAuthorPreview
                frameId={previewId}
                nameStyleId={previewNameStyle}
                size="md"
                timestamp="刚刚"
                render={previewRender}
              />
            </div>
          </div>
        </div>
      </div>

      {/* 栏目 Tab */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setTab('frames')}
          className={`rounded-full border-2 px-4 py-2 text-sm font-bold ${
            tab === 'frames' ? 'border-ink bg-ink text-white' : 'border-ink/20 bg-white text-ink'
          }`}
        >
          头像框
        </button>
        <button
          type="button"
          onClick={() => setTab('names')}
          className={`rounded-full border-2 px-4 py-2 text-sm font-bold ${
            tab === 'names' ? 'border-ink bg-ink text-white' : 'border-ink/20 bg-white text-ink'
          }`}
        >
          炫彩昵称
        </button>
      </div>

      {tab === 'frames' && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
          {catalog.map((frame) => {
            const tiers = resolveTiers(frame);
            const tier = pickTier(frame.id, tiers);
            // 永久拥有不可再购；限时拥有可续期或升永久
            const isPermanentOwned = frame.owned && frame.expiresAt == null;
            const unaffordable = (shop?.coins ?? 0) < tier.price;
            const canBuy = !isPermanentOwned;
            return (
              <div
                key={frame.id}
                className={`group relative flex flex-col overflow-hidden rounded-2xl border-2 bg-white p-3.5 transition-all sm:p-4 ${
                  frame.equipped
                    ? 'border-ink shadow-sketch'
                    : 'border-ink/12 shadow-[0_8px_20px_-16px_rgba(15,23,42,0.45)] hover:-translate-y-0.5 hover:border-ink/30'
                }`}
              >
                {frame.equipped && (
                  <div className="absolute right-3 top-3 rounded-full bg-ink px-2 py-0.5 text-[10px] font-bold text-white">
                    使用中
                  </div>
                )}
                <div className="mb-3 flex justify-center rounded-xl border-2 border-black/5 bg-white px-2 py-4">
                  <AnonymousAuthorPreview
                    frameId={frame.id}
                    nameStyleId={previewNameStyle}
                    size="md"
                    timestamp="刚刚"
                    render={frame.render}
                  />
                </div>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="font-sans text-sm font-bold text-ink">{frame.name}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${RARITY_BADGE_CLASS[(frame.rarity as NicknameFrameRarity) || 'common'] || RARITY_BADGE_CLASS.common}`}>
                    {RARITY_LABEL[(frame.rarity as NicknameFrameRarity) || 'common'] || frame.rarity}
                  </span>
                </div>
                <div className="mt-auto space-y-3 border-t border-dashed border-ink/10 pt-3">
                  <ShopPriceSummary
                    tier={tier}
                    expiresLabel={frame.owned && frame.expiresAt != null ? formatExpires(frame.expiresAt) : undefined}
                  />
                  <ShopPriceTiers
                    tiers={tiers}
                    selectedId={tier.id}
                    disabled={busy}
                    onSelect={(tierId) => setSelectedTiers((prev) => ({ ...prev, [frame.id]: tierId }))}
                  />
                  <div className="flex justify-end gap-2">
                    {frame.owned && canBuy && (
                      <button
                        type="button"
                        disabled={busy || unaffordable}
                        onClick={() => onRedeem(frame.id, tier.id)}
                        className="rounded-full border border-ink/30 px-3 py-1.5 text-xs font-bold disabled:opacity-45"
                      >
                        {unaffordable ? '瓜子不足' : '续期'}
                      </button>
                    )}
                    {frame.owned ? (
                      <button
                        type="button"
                        disabled={busy || frame.equipped}
                        onClick={() => onEquip(frame.id)}
                        className={`rounded-full px-4 py-1.5 text-xs font-bold transition-all disabled:opacity-50 ${
                          frame.equipped
                            ? 'border border-ink/20 bg-gray-100 text-pencil'
                            : 'border-2 border-ink bg-ink text-white hover:bg-ink/90'
                        }`}
                      >
                        {frame.equipped ? '已装备' : '装备'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy || unaffordable}
                        onClick={() => onRedeem(frame.id, tier.id)}
                        className="rounded-full border-2 border-ink bg-highlight px-4 py-1.5 text-xs font-bold text-ink transition-all hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        {unaffordable ? '瓜子不足' : '兑换'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'names' && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
          {nameStyles.map((style) => {
            const tiers = resolveTiers(style);
            const tier = pickTier(style.id, tiers);
            const isPermanentOwned = style.owned && style.expiresAt == null;
            const unaffordable = (shop?.coins ?? 0) < tier.price;
            const canBuy = !isPermanentOwned;
            return (
              <div
                key={style.id}
                className={`relative flex flex-col overflow-hidden rounded-2xl border-2 bg-white p-4 ${
                  style.equipped ? 'border-ink shadow-sketch' : 'border-ink/12'
                }`}
              >
                {style.equipped && (
                  <div className="absolute right-3 top-3 rounded-full bg-ink px-2 py-0.5 text-[10px] font-bold text-white">
                    使用中
                  </div>
                )}
                <div className="mb-3 rounded-xl border-2 border-black/5 bg-[#fcfbf7] px-4 py-5 text-center">
                  <ColorfulName styleId={style.id} color={style.color} className="font-hand text-2xl">
                    匿名用户
                  </ColorfulName>
                </div>
                <div className="mb-3 font-sans text-sm font-bold text-ink">{style.name}</div>
                <div className="mt-auto space-y-3 border-t border-dashed border-ink/10 pt-3">
                  <ShopPriceSummary
                    tier={tier}
                    expiresLabel={style.owned && style.expiresAt != null ? formatExpires(style.expiresAt) : undefined}
                  />
                  <ShopPriceTiers
                    tiers={tiers}
                    selectedId={tier.id}
                    disabled={busy}
                    onSelect={(tierId) => setSelectedTiers((prev) => ({ ...prev, [style.id]: tierId }))}
                  />
                  <div className="flex justify-end gap-2">
                    {style.owned && canBuy && (
                      <button
                        type="button"
                        disabled={busy || unaffordable}
                        onClick={() => onRedeemNameStyle(style.id, tier.id)}
                        className="rounded-full border border-ink/30 px-3 py-1.5 text-xs font-bold disabled:opacity-45"
                      >
                        {unaffordable ? '瓜子不足' : '续期'}
                      </button>
                    )}
                    {style.owned ? (
                      <button
                        type="button"
                        disabled={busy || style.equipped}
                        onClick={() => onEquipNameStyle(style.id)}
                        className={`rounded-full px-4 py-1.5 text-xs font-bold transition-all disabled:opacity-50 ${
                          style.equipped
                            ? 'border border-ink/20 bg-gray-100 text-pencil'
                            : 'border-2 border-ink bg-ink text-white hover:bg-ink/90'
                        }`}
                      >
                        {style.equipped ? '已装备' : '装备'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy || unaffordable}
                        onClick={() => onRedeemNameStyle(style.id, tier.id)}
                        className="rounded-full border-2 border-ink bg-highlight px-4 py-1.5 text-xs font-bold text-ink disabled:opacity-45"
                      >
                        {unaffordable ? '瓜子不足' : '兑换'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {nameStyles.length === 0 && (
            <div className="col-span-full rounded-2xl border-2 border-dashed border-ink/15 p-8 text-center text-sm text-pencil">
              暂无
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// HomePanel — 成熟个人中心首页
// ---------------------------------------------------------------------------

const HomePanel: React.FC<{
  equippedFrameId: string | null;
  equippedNameStyleId: string | null;
  shop: ShopState | null;
  hiddenCount: number;
  sections: MeMenuSection[];
  onMenuClick: (item: MeMenuItem) => void;
  onClaimDaily: () => void;
  shopBusy: boolean;
}> = ({ equippedFrameId, equippedNameStyleId, shop, hiddenCount, sections, onMenuClick, onClaimDaily, shopBusy }) => (
  <div className="space-y-4 sm:space-y-5">
    {/* 当前装扮预览 */}
    <section className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="inline-flex max-w-full self-start rounded-2xl border-2 border-ink bg-white p-3 shadow-sketch">
        <AnonymousAuthorPreview
          frameId={equippedFrameId}
          nameStyleId={equippedNameStyleId}
          size="md"
          timestamp="刚刚"
        />
      </div>
      {shop?.canClaimDaily && (
        <button
          type="button"
          disabled={shopBusy}
          onClick={onClaimDaily}
          className="inline-flex items-center justify-center gap-2 self-start rounded-full border-2 border-ink bg-highlight px-4 py-2.5 text-sm font-bold text-ink shadow-sketch transition-all hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 sm:self-auto"
        >
          <Coins className="h-4 w-4" />
          领取 +{shop.dailyClaimCoins}
        </button>
      )}
    </section>

    {/* 数据条：商城开启时展示瓜子/装扮 */}
    <div className={`grid gap-2 sm:gap-3 ${shop ? 'grid-cols-3' : 'grid-cols-1'}`}>
      {shop && (
        <>
          <StatPill
            icon={<Coins className="h-4 w-4" />}
            label="瓜子"
            value={shop.coins}
          />
          <StatPill
            icon={<Frame className="h-4 w-4" />}
            label="昵称框"
            value={shop.ownedFrameIds.length}
          />
        </>
      )}
      <StatPill
        icon={<ShieldOff className="h-4 w-4" />}
        label="已屏蔽"
        value={hiddenCount}
      />
    </div>

    {/* 菜单 */}
    <SectionCard>
      <div className="divide-y divide-ink/8">
        {sections.flatMap((section) => section.items).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onMenuClick(item)}
            className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-[#faf7ef] active:bg-[#f3efe4] sm:gap-4 sm:px-5 sm:py-4"
          >
            <span
              className={`relative inline-flex size-11 shrink-0 items-center justify-center rounded-2xl border-2 border-ink/10 text-ink shadow-sm sm:size-12 ${
                item.accent || 'bg-gradient-to-br from-white to-[#f3efe4]'
              }`}
            >
              {item.icon}
              {item.showDot && (
                <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border border-ink bg-red-500" />
              )}
            </span>
            <span className="min-w-0 flex-1 font-sans text-[15px] font-bold text-ink sm:text-base">
              {item.label}
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-pencil/70" />
          </button>
        ))}
      </div>
    </SectionCard>
  </div>
);

// ---------------------------------------------------------------------------
// UserMeModal shell
// ---------------------------------------------------------------------------

const UserMeModal: React.FC<UserMeModalProps> = ({
  isOpen,
  onClose,
  updateAnnouncementsUnread = false,
  onUpdateAnnouncementsSeen,
  onNavigate,
  onMenuCallback,
}) => {
  const { showToast, state } = useApp();
  const [panel, setPanel] = useState<MePanelId>('home');
  const [loadingAnnouncements, setLoadingAnnouncements] = useState(false);
  const [updateAnnouncements, setUpdateAnnouncements] = useState<UpdateAnnouncementItem[]>([]);
  const [shop, setShop] = useState<ShopState | null>(null);
  const [shopLoading, setShopLoading] = useState(false);
  const [shopBusy, setShopBusy] = useState(false);

  const shopEnabled = Boolean(state.settings?.shopEnabled);

  const menuSections: MeMenuSection[] = useMemo(
    () => {
      const items: MeMenuItem[] = [];
      if (shopEnabled) {
        items.push({
          id: 'shop',
          label: '商城',
          icon: <Store className="h-5 w-5" />,
          action: { type: 'panel', panel: 'shop' },
          accent: 'bg-gradient-to-br from-amber-50 to-lime-100',
        });
      }
      items.push(
        {
          id: 'favorites',
          label: '收藏',
          icon: <Star className="h-5 w-5" />,
          action: { type: 'navigate', view: ViewType.FAVORITES },
          accent: 'bg-gradient-to-br from-yellow-50 to-orange-50',
        },
        {
          id: 'settings',
          label: '设置',
          icon: <Settings2 className="h-5 w-5" />,
          action: { type: 'panel', panel: 'settings' },
          accent: 'bg-gradient-to-br from-slate-50 to-sky-50',
        },
        {
          id: 'updateAnnouncements',
          label: '更新公告',
          icon: <Bell className="h-5 w-5" />,
          action: { type: 'panel', panel: 'updateAnnouncements' },
          showDot: updateAnnouncementsUnread,
          accent: 'bg-gradient-to-br from-violet-50 to-fuchsia-50',
        },
      );
      return [{ id: 'main', title: '', items }];
    },
    [shopEnabled, updateAnnouncementsUnread]
  );

  const loadShop = useCallback(async () => {
    setShopLoading(true);
    try {
      const data = await api.getMeShop();
      setShop({
        coins: Number(data?.coins || 0),
        ownedFrameIds: Array.isArray(data?.ownedFrameIds) ? data.ownedFrameIds : [],
        equippedFrameId: data?.equippedFrameId || null,
        ownedNameStyleIds: Array.isArray(data?.ownedNameStyleIds) ? data.ownedNameStyleIds : [],
        equippedNameStyleId: data?.equippedNameStyleId || null,
        canClaimDaily: Boolean(data?.canClaimDaily),
        dailyClaimCoins: Number(data?.dailyClaimCoins || 10),
        catalog: Array.isArray(data?.catalog) ? data.catalog : [],
        nameStyles: Array.isArray(data?.nameStyles) ? data.nameStyles : [],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '商城加载失败';
      showToast(message, 'error');
    } finally {
      setShopLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (!isOpen) return;

    setPanel('home');

    let active = true;
    setLoadingAnnouncements(true);
    api.getUpdateAnnouncements()
      .then((data) => {
        if (!active) return;
        setUpdateAnnouncements(Array.isArray(data?.items) ? data.items : []);
      })
      .catch(() => {
        if (active) setUpdateAnnouncements([]);
      })
      .finally(() => {
        if (active) setLoadingAnnouncements(false);
      });

    if (shopEnabled) {
      loadShop();
    } else {
      setShop(null);
    }

    return () => {
      active = false;
    };
  }, [isOpen, loadShop, shopEnabled]);

  useEffect(() => {
    if (!shopEnabled && panel === 'shop') {
      setPanel('home');
    }
  }, [shopEnabled, panel]);

  useEffect(() => {
    if (!isOpen || panel !== 'updateAnnouncements' || updateAnnouncements.length === 0) {
      return;
    }
    const latestUpdatedAt = updateAnnouncements.reduce(
      (latest, item) => Math.max(latest, Number(item.updatedAt || 0)),
      0
    );
    if (latestUpdatedAt > 0) {
      onUpdateAnnouncementsSeen?.(latestUpdatedAt);
    }
  }, [isOpen, onUpdateAnnouncementsSeen, panel, updateAnnouncements]);

  const applyShopPayload = (data: any) => {
    setShop({
      coins: Number(data?.coins || 0),
      ownedFrameIds: Array.isArray(data?.ownedFrameIds) ? data.ownedFrameIds : [],
      equippedFrameId: data?.equippedFrameId || null,
      ownedNameStyleIds: Array.isArray(data?.ownedNameStyleIds) ? data.ownedNameStyleIds : [],
      equippedNameStyleId: data?.equippedNameStyleId || null,
      canClaimDaily: Boolean(data?.canClaimDaily),
      dailyClaimCoins: Number(data?.dailyClaimCoins || 10),
      catalog: Array.isArray(data?.catalog) ? data.catalog : [],
      nameStyles: Array.isArray(data?.nameStyles) ? data.nameStyles : [],
    });
  };

  const handleClaimDaily = async () => {
    setShopBusy(true);
    try {
      const data = await api.claimMeShopDaily();
      applyShopPayload(data);
      showToast(`已领取 ${data?.claimed || 10} 瓜子`, 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '领取失败';
      showToast(message, 'error');
    } finally {
      setShopBusy(false);
    }
  };

  const handleRedeem = async (frameId: string, tierId?: string) => {
    setShopBusy(true);
    try {
      const data = await api.redeemMeShopFrame(frameId, tierId);
      applyShopPayload(data);
      showToast('兑换成功', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '兑换失败';
      showToast(message, 'error');
    } finally {
      setShopBusy(false);
    }
  };

  const handleEquip = async (frameId: string | null) => {
    setShopBusy(true);
    try {
      const data = await api.equipMeShopFrame(frameId);
      applyShopPayload(data);
      showToast(frameId ? '已装备昵称框' : '已卸下昵称框', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '操作失败';
      showToast(message, 'error');
    } finally {
      setShopBusy(false);
    }
  };

  const handleRedeemNameStyle = async (styleId: string, tierId?: string) => {
    setShopBusy(true);
    try {
      const data = await api.redeemMeShopNameStyle(styleId, tierId);
      applyShopPayload(data);
      showToast('兑换成功', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '兑换失败';
      showToast(message, 'error');
    } finally {
      setShopBusy(false);
    }
  };

  const handleEquipNameStyle = async (styleId: string | null) => {
    setShopBusy(true);
    try {
      const data = await api.equipMeShopNameStyle(styleId);
      applyShopPayload(data);
      showToast(styleId ? '已装备' : '已卸下', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '操作失败';
      showToast(message, 'error');
    } finally {
      setShopBusy(false);
    }
  };

  const handleMenuClick = (item: MeMenuItem) => {
    const { action } = item;
    if (action.type === 'panel') {
      setPanel(action.panel);
      return;
    }
    if (action.type === 'navigate') {
      onClose();
      onNavigate?.(action.view);
      return;
    }
    if (action.type === 'callback') {
      onMenuCallback?.(action.key);
    }
  };

  const goHome = () => setPanel('home');

  const equippedFrameId = shop?.equippedFrameId || null;
  const equippedNameStyleId = shop?.equippedNameStyleId || null;

  const hiddenCount = state.hiddenPostTags.length + state.hiddenPostKeywords.length;

  const renderPanel = () => {
    switch (panel) {
      case 'shop':
        return (
          <ShopPanel
            shop={shop}
            loading={shopLoading}
            busy={shopBusy}
            onClaimDaily={handleClaimDaily}
            onRedeem={handleRedeem}
            onEquip={handleEquip}
            onRedeemNameStyle={handleRedeemNameStyle}
            onEquipNameStyle={handleEquipNameStyle}
          />
        );
      case 'settings':
        return <SettingsPanel />;
      case 'updateAnnouncements':
        return (
          <UpdateAnnouncementsPanel
            items={updateAnnouncements}
            loading={loadingAnnouncements}
          />
        );
      case 'home':
      default:
        return (
          <HomePanel
            equippedFrameId={equippedFrameId}
            equippedNameStyleId={equippedNameStyleId}
            shop={shop}
            hiddenCount={hiddenCount}
            sections={menuSections}
            onMenuClick={handleMenuClick}
            onClaimDaily={handleClaimDaily}
            shopBusy={shopBusy}
          />
        );
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      showCloseButton={false}
      title={undefined}
      overlayClassName="!items-stretch !justify-stretch !p-0 sm:!items-center sm:!justify-center sm:!p-4 md:!p-6"
      panelClassName="!max-w-none sm:!max-w-2xl lg:!max-w-3xl !w-full !h-[100dvh] sm:!h-auto sm:!max-h-[min(92vh,880px)] !rounded-none sm:!rounded-[28px] !border-0 sm:!border-2 !p-0 !shadow-none sm:!shadow-sketch-lg overflow-hidden flex flex-col bg-[#f6f3ea]"
    >
      {/* 顶栏：移动端像 App 页，桌面像面板头 */}
      <header className="sticky top-0 z-20 flex shrink-0 items-center gap-2 border-b-2 border-ink/10 bg-[#f6f3ea]/95 px-3 py-3 backdrop-blur-md sm:px-5 sm:py-3.5"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top, 0px))' }}
      >
        {panel !== 'home' ? (
          <button
            type="button"
            onClick={goHome}
            className="inline-flex size-10 items-center justify-center rounded-full border-2 border-ink/15 bg-white text-ink transition-all hover:bg-highlight active:scale-95"
            aria-label="返回我的"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        ) : (
          <div className="size-10" aria-hidden />
        )}

        <div className="min-w-0 flex-1 text-center">
          <h2 className="font-display text-xl leading-none text-ink sm:text-2xl">
            {PANEL_TITLES[panel]}
          </h2>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="inline-flex size-10 items-center justify-center rounded-full border-2 border-ink/15 bg-white text-ink transition-all hover:bg-highlight active:scale-95"
          aria-label="关闭"
        >
          <X className="h-5 w-5" />
        </button>
      </header>

      {/* 可滚动内容区 */}
      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-5 sm:py-5"
        style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom, 0px))' }}
      >
        {renderPanel()}
      </div>
    </Modal>
  );
};

export default UserMeModal;
