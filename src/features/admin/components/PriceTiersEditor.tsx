import React, { useMemo } from 'react';
import { Plus, Trash2 } from 'lucide-react';

export interface PriceTierDraft {
  price: string;
  durationDays: string;
}

export interface PriceTierPayload {
  price: number;
  durationDays: number;
}

const DURATION_PRESETS = [
  { value: '1', label: '1 天' },
  { value: '7', label: '7 天' },
  { value: '30', label: '30 天' },
  { value: '0', label: '永久' },
] as const;

const MAX_TIERS = 6;

export const emptyTierDraft = (seed?: Partial<PriceTierDraft>): PriceTierDraft => ({
  price: seed?.price ?? '10',
  durationDays: seed?.durationDays ?? '1',
});

export const tiersFromItem = (item: {
  price?: number;
  durationDays?: number;
  priceTiers?: Array<{ price: number; durationDays: number }>;
}): PriceTierDraft[] => {
  if (Array.isArray(item.priceTiers) && item.priceTiers.length > 0) {
    return item.priceTiers.map((t) => ({
      price: String(t.price ?? 0),
      durationDays: String(t.durationDays ?? 0),
    }));
  }
  return [emptyTierDraft({
    price: String(item.price ?? 0),
    durationDays: String(item.durationDays ?? 0),
  })];
};

export const draftsToPayload = (drafts: PriceTierDraft[]): PriceTierPayload[] | null => {
  const out: PriceTierPayload[] = [];
  for (const row of drafts) {
    const price = Math.trunc(Number(row.price));
    const durationDays = Math.trunc(Number(row.durationDays));
    if (!Number.isFinite(price) || price < 0 || price > 999999) return null;
    if (!Number.isFinite(durationDays) || durationDays < 0 || durationDays > 3650) return null;
    out.push({ price, durationDays });
  }
  if (!out.length) return null;
  // 去重：同一天数只保留一条（后者覆盖）
  const byDays = new Map<number, PriceTierPayload>();
  out.forEach((t) => byDays.set(t.durationDays, t));
  return Array.from(byDays.values()).sort((a, b) => {
    const da = a.durationDays <= 0 ? 99999 : a.durationDays;
    const db = b.durationDays <= 0 ? 99999 : b.durationDays;
    return da - db || a.price - b.price;
  });
};

const formatDuration = (days: number) => {
  if (days <= 0) return '永久';
  if (days === 7) return '7 天';
  if (days === 30) return '30 天';
  return `${days} 天`;
};

const formatPreview = (price: number, days: number) => {
  if (price <= 0) return `免费 · ${formatDuration(days)}`;
  return `${price} 瓜子 / ${formatDuration(days)}`;
};

interface PriceTiersEditorProps {
  value: PriceTierDraft[];
  onChange: (next: PriceTierDraft[]) => void;
  disabled?: boolean;
  /** 紧凑模式：列表行内编辑 */
  compact?: boolean;
}

/**
 * 阶梯定价可视化编辑：每行「瓜子 + 时长」，支持预设与增删
 */
const PriceTiersEditor: React.FC<PriceTiersEditorProps> = ({
  value,
  onChange,
  disabled = false,
  compact = false,
}) => {
  const rows = value.length > 0 ? value : [emptyTierDraft()];

  const preview = useMemo(() => {
    const payload = draftsToPayload(rows);
    if (!payload) return [];
    return payload.map((t) => formatPreview(t.price, t.durationDays));
  }, [rows]);

  const updateRow = (index: number, patch: Partial<PriceTierDraft>) => {
    const next = rows.map((row, i) => (i === index ? { ...row, ...patch } : row));
    onChange(next);
  };

  const addRow = () => {
    if (rows.length >= MAX_TIERS || disabled) return;
    const used = new Set(rows.map((r) => String(r.durationDays)));
    const preset = DURATION_PRESETS.find((p) => !used.has(p.value));
    onChange([
      ...rows,
      emptyTierDraft({
        price: rows[rows.length - 1]?.price || '10',
        durationDays: preset?.value ?? '0',
      }),
    ]);
  };

  const removeRow = (index: number) => {
    if (rows.length <= 1 || disabled) return;
    onChange(rows.filter((_, i) => i !== index));
  };

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-pencil">阶梯定价</span>
        <button
          type="button"
          disabled={disabled || rows.length >= MAX_TIERS}
          onClick={addRow}
          className="inline-flex items-center gap-1 rounded-full border border-ink/20 bg-white px-2.5 py-1 text-[11px] font-bold text-ink transition-colors hover:bg-highlight/50 disabled:opacity-40"
        >
          <Plus className="h-3 w-3" />
          加一档
        </button>
      </div>

      <div className="space-y-2">
        {rows.map((row, index) => {
          const daysNum = Number(row.durationDays);
          const isCustom = !DURATION_PRESETS.some((p) => p.value === String(row.durationDays));
          return (
            <div
              key={`tier-${index}`}
              className="flex flex-wrap items-end gap-2 rounded-xl border border-ink/10 bg-[#fcfbf7] p-2.5 sm:flex-nowrap"
            >
              <label className="min-w-[88px] flex-1 text-[11px]">
                <span className="text-pencil">瓜子</span>
                <input
                  type="number"
                  min={0}
                  max={999999}
                  value={row.price}
                  disabled={disabled}
                  onChange={(e) => updateRow(index, { price: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-ink/15 bg-white px-2 py-1.5 text-sm font-bold tabular-nums outline-none focus:border-ink/40"
                />
              </label>

              <div className="min-w-0 flex-[2]">
                <div className="text-[11px] text-pencil">时长</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {DURATION_PRESETS.map((p) => {
                    const active = String(row.durationDays) === p.value;
                    return (
                      <button
                        key={p.value}
                        type="button"
                        disabled={disabled}
                        onClick={() => updateRow(index, { durationDays: p.value })}
                        className={`rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors disabled:opacity-40 ${
                          active
                            ? 'border-ink bg-ink text-white'
                            : 'border-ink/15 bg-white text-ink hover:bg-highlight/40'
                        }`}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      if (!isCustom) updateRow(index, { durationDays: '14' });
                    }}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors disabled:opacity-40 ${
                      isCustom
                        ? 'border-ink bg-ink text-white'
                        : 'border-ink/15 bg-white text-ink hover:bg-highlight/40'
                    }`}
                  >
                    自定义
                  </button>
                </div>
                {isCustom && (
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <input
                      type="number"
                      min={0}
                      max={3650}
                      value={row.durationDays}
                      disabled={disabled}
                      onChange={(e) => updateRow(index, { durationDays: e.target.value })}
                      className="w-20 rounded-lg border border-ink/15 bg-white px-2 py-1 text-sm font-bold tabular-nums outline-none focus:border-ink/40"
                    />
                    <span className="text-[11px] text-pencil">天（0 = 永久）</span>
                  </div>
                )}
              </div>

              <button
                type="button"
                disabled={disabled || rows.length <= 1}
                onClick={() => removeRow(index)}
                title="删除此档"
                className="mb-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-ink/10 text-pencil transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>

              {!Number.isFinite(daysNum) ? null : (
                <div className="basis-full text-[11px] font-medium text-ink/70 sm:hidden">
                  {formatPreview(Number(row.price) || 0, daysNum)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {preview.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wide text-pencil/70">预览</span>
          {preview.map((text) => (
            <span
              key={text}
              className="rounded-full border border-ink/10 bg-white px-2.5 py-0.5 text-[11px] font-bold text-ink shadow-sm"
            >
              {text}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

export default PriceTiersEditor;
