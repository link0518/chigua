import React from 'react';

export interface ShopPriceTier {
  id: string;
  price: number;
  durationDays: number;
  label?: string;
}

const formatDuration = (days: number, label?: string) => {
  if (label && label.trim()) return label.trim();
  if (days <= 0) return '永久';
  if (days === 1) return '1 天';
  if (days === 7) return '7 天';
  if (days === 30) return '30 天';
  return `${days} 天`;
};

/** 选中档的完整文案，用于主价位展示 */
export const formatSelectedPrice = (tier: ShopPriceTier) => {
  const duration = formatDuration(tier.durationDays, tier.label);
  if (tier.price <= 0) return { priceText: '免费', durationText: duration };
  return { priceText: `${tier.price}`, durationText: duration };
};

interface ShopPriceTiersProps {
  tiers: ShopPriceTier[];
  selectedId: string;
  onSelect: (tierId: string) => void;
  disabled?: boolean;
  /** 仅一档时不显示切换器 */
  hideWhenSingle?: boolean;
}

/**
 * 前台商城档位选择：分段控件样式，时长 + 瓜子分层展示
 */
const ShopPriceTiers: React.FC<ShopPriceTiersProps> = ({
  tiers,
  selectedId,
  onSelect,
  disabled = false,
  hideWhenSingle = true,
}) => {
  if (!tiers.length) return null;
  if (hideWhenSingle && tiers.length === 1) return null;

  // 2 档横排；3 档横排；4 档 2×2；更多时最多 3 列
  const cols = tiers.length === 4 ? 2 : Math.min(Math.max(tiers.length, 1), 3);

  return (
    <div
      role="radiogroup"
      aria-label="选择价格档位"
      className="grid gap-1.5"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {tiers.map((tier) => {
        const active = tier.id === selectedId;
        const duration = formatDuration(tier.durationDays, tier.label);
        const priceLabel = tier.price <= 0 ? '免费' : `${tier.price}`;
        return (
          <button
            key={tier.id}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onSelect(tier.id)}
            className={`relative flex flex-col items-center justify-center rounded-xl border-2 px-1.5 py-2 transition-all disabled:opacity-45 ${
              active
                ? 'border-ink bg-ink text-white shadow-sketch'
                : 'border-ink/12 bg-[#faf8f3] text-ink hover:border-ink/30 hover:bg-highlight/30'
            }`}
          >
            <span className={`text-[11px] font-bold leading-none ${active ? 'text-white/75' : 'text-pencil'}`}>
              {duration}
            </span>
            <span className="mt-1 flex items-baseline gap-0.5 leading-none">
              <span className="font-display text-lg tabular-nums tracking-tight">{priceLabel}</span>
              {tier.price > 0 && (
                <span className={`text-[10px] font-bold ${active ? 'text-white/70' : 'text-pencil'}`}>
                  瓜子
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
};

/** 主价位条：当前选中档 */
export const ShopPriceSummary: React.FC<{
  tier: ShopPriceTier;
  expiresLabel?: string;
}> = ({ tier, expiresLabel }) => {
  const { priceText, durationText } = formatSelectedPrice(tier);
  return (
    <div className="flex items-end justify-between gap-2">
      <div className="min-w-0">
        <div className="flex items-baseline gap-1.5">
          {priceText === '免费' ? (
            <span className="font-display text-2xl text-ink">免费</span>
          ) : (
            <>
              <span className="font-display text-2xl tabular-nums tracking-tight text-ink">{priceText}</span>
              <span className="text-xs font-bold text-pencil">瓜子</span>
            </>
          )}
        </div>
        <div className="mt-0.5 text-[11px] font-bold text-pencil">
          {durationText}
          {expiresLabel ? ` · ${expiresLabel}` : ''}
        </div>
      </div>
    </div>
  );
};

export default ShopPriceTiers;
