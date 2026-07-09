import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';

import { api } from '@/api';
import ColorfulName from '@/components/ColorfulName';
import { mergeNameStyleRegistry } from '@/components/nameStyles';
import PriceTiersEditor, {
  draftsToPayload,
  emptyTierDraft,
  tiersFromItem,
  type PriceTierDraft,
} from '@/features/admin/components/PriceTiersEditor';

interface AdminNameStyleItem {
  id: string;
  name: string;
  price: number;
  rarity: string;
  status: string;
  sort?: number;
  description?: string;
  durationDays?: number;
  priceTiers?: Array<{ price: number; durationDays: number; label?: string }>;
  color?: { r: number; g: number; b: number };
  colorCss?: string;
  colorHex?: string;
}

const STATUS_OPTIONS = [
  { value: 'on_sale', label: '在售' },
  { value: 'off_sale', label: '下架' },
  { value: 'hidden', label: '隐藏' },
];

interface AdminNameStylesViewProps {
  showToast: (message: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
  canManage: boolean;
}

const AdminNameStylesView: React.FC<AdminNameStylesViewProps> = ({ showToast, canManage }) => {
  const [items, setItems] = useState<AdminNameStyleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    id: '',
    name: '',
    rarity: 'common',
    status: 'on_sale',
    sort: '100',
    tiers: [
      emptyTierDraft({ price: '10', durationDays: '1' }),
      emptyTierDraft({ price: '70', durationDays: '7' }),
    ] as PriceTierDraft[],
    r: '207',
    g: '19',
    b: '34',
  });
  const [editing, setEditing] = useState<Record<string, {
    name: string;
    status: string;
    sort: string;
    tiers: PriceTierDraft[];
    r: string;
    g: string;
    b: string;
  }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getAdminNameStyles();
      const list: AdminNameStyleItem[] = Array.isArray(data?.items) ? data.items : [];
      setItems(list);
      mergeNameStyleRegistry(list);
      const next: typeof editing = {};
      list.forEach((item) => {
        next[item.id] = {
          name: item.name,
          status: item.status,
          sort: String(item.sort ?? 100),
          tiers: tiersFromItem(item),
          r: String(item.color?.r ?? 0),
          g: String(item.color?.g ?? 0),
          b: String(item.color?.b ?? 0),
        };
      });
      setEditing(next);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '加载失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const previewColor = useMemo(() => ({
    r: Math.min(255, Math.max(0, Number(form.r) || 0)),
    g: Math.min(255, Math.max(0, Number(form.g) || 0)),
    b: Math.min(255, Math.max(0, Number(form.b) || 0)),
  }), [form.r, form.g, form.b]);

  const hexFromRgb = (r: number, g: number, b: number) => (
    `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`
  );

  const handleHexChange = (hex: string) => {
    const m = String(hex || '').trim().replace(/^#/, '').match(/^([0-9a-fA-F]{6})$/);
    if (!m) return;
    const h = m[1];
    setForm((prev) => ({
      ...prev,
      r: String(parseInt(h.slice(0, 2), 16)),
      g: String(parseInt(h.slice(2, 4), 16)),
      b: String(parseInt(h.slice(4, 6), 16)),
    }));
  };

  const handleCreate = async () => {
    if (!canManage) {
      showToast('当前账号无处理权限', 'warning');
      return;
    }
    setSubmitting(true);
    try {
      const priceTiers = draftsToPayload(form.tiers);
      if (!priceTiers) {
        showToast('请检查阶梯定价：瓜子与时长须为有效数字', 'warning');
        setSubmitting(false);
        return;
      }
      await api.createAdminNameStyle({
        id: form.id.trim(),
        name: form.name.trim(),
        price: priceTiers[0].price,
        rarity: form.rarity,
        status: form.status,
        sort: Number(form.sort),
        durationDays: priceTiers[0].durationDays,
        priceTiers,
        color: {
          r: Number(form.r),
          g: Number(form.g),
          b: Number(form.b),
        },
      });
      showToast('已添加', 'success');
      setForm((prev) => ({ ...prev, id: '', name: '' }));
      await load();
    } catch (error) {
      showToast(error instanceof Error ? error.message : '添加失败', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePatch = async (id: string) => {
    if (!canManage) {
      showToast('当前账号无处理权限', 'warning');
      return;
    }
    const draft = editing[id];
    if (!draft) return;
    try {
      const priceTiers = draftsToPayload(draft.tiers);
      if (!priceTiers) {
        showToast('请检查阶梯定价：瓜子与时长须为有效数字', 'warning');
        return;
      }
      await api.patchAdminNameStyle(id, {
        name: draft.name,
        status: draft.status,
        sort: Number(draft.sort),
        priceTiers,
        color: {
          r: Number(draft.r),
          g: Number(draft.g),
          b: Number(draft.b),
        },
      });
      showToast('已保存', 'success');
      await load();
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存失败', 'error');
    }
  };

  const sorted = useMemo(
    () => [...items].sort((a, b) => (a.sort || 0) - (b.sort || 0) || a.id.localeCompare(b.id)),
    [items]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-xl text-ink">炫彩昵称</h3>
          <p className="mt-1 text-sm text-pencil">用 RGB 直接添加；发帖与回复快照生效</p>
        </div>
        <button
          type="button"
          onClick={() => load()}
          className="inline-flex items-center gap-2 rounded-full border-2 border-ink bg-white px-4 py-2 text-sm font-bold shadow-sketch"
        >
          <RefreshCw className="h-4 w-4" />
          刷新
        </button>
      </div>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border-2 border-ink bg-white p-4 shadow-sketch">
          <h4 className="mb-3 font-bold text-ink">添加炫彩昵称</h4>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs col-span-2 sm:col-span-1">
              <span className="text-pencil">id（英文）</span>
              <input
                value={form.id}
                onChange={(e) => setForm((p) => ({ ...p, id: e.target.value }))}
                placeholder="blue-neon"
                className="mt-1 w-full rounded-lg border border-ink/20 px-2 py-1.5 font-mono text-sm"
                disabled={!canManage}
              />
            </label>
            <label className="text-xs col-span-2 sm:col-span-1">
              <span className="text-pencil">名称</span>
              <input
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="蓝色昵称"
                className="mt-1 w-full rounded-lg border border-ink/20 px-2 py-1.5 text-sm font-bold"
                disabled={!canManage}
              />
            </label>
            <label className="text-xs">
              <span className="text-pencil">排序</span>
              <input
                value={form.sort}
                onChange={(e) => setForm((p) => ({ ...p, sort: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-ink/20 px-2 py-1.5 text-sm font-bold"
                disabled={!canManage}
              />
            </label>
            <div className="col-span-2">
              <PriceTiersEditor
                value={form.tiers}
                disabled={!canManage}
                onChange={(tiers) => setForm((p) => ({ ...p, tiers }))}
              />
            </div>
            <label className="text-xs">
              <span className="text-pencil">R</span>
              <input
                type="number"
                min={0}
                max={255}
                value={form.r}
                onChange={(e) => setForm((p) => ({ ...p, r: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-ink/20 px-2 py-1.5 text-sm font-bold"
                disabled={!canManage}
              />
            </label>
            <label className="text-xs">
              <span className="text-pencil">G</span>
              <input
                type="number"
                min={0}
                max={255}
                value={form.g}
                onChange={(e) => setForm((p) => ({ ...p, g: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-ink/20 px-2 py-1.5 text-sm font-bold"
                disabled={!canManage}
              />
            </label>
            <label className="text-xs">
              <span className="text-pencil">B</span>
              <input
                type="number"
                min={0}
                max={255}
                value={form.b}
                onChange={(e) => setForm((p) => ({ ...p, b: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-ink/20 px-2 py-1.5 text-sm font-bold"
                disabled={!canManage}
              />
            </label>
            <label className="text-xs">
              <span className="text-pencil">取色</span>
              <input
                type="color"
                value={hexFromRgb(previewColor.r, previewColor.g, previewColor.b)}
                onChange={(e) => handleHexChange(e.target.value)}
                className="mt-1 h-9 w-full cursor-pointer rounded-lg border border-ink/20 bg-white"
                disabled={!canManage}
              />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="rounded-full border border-ink/15 px-3 py-1 font-mono text-xs">
              rgb({previewColor.r}, {previewColor.g}, {previewColor.b})
            </span>
            <button
              type="button"
              disabled={!canManage || submitting}
              onClick={handleCreate}
              className="inline-flex items-center gap-1 rounded-full border-2 border-ink bg-ink px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              {submitting ? '添加中...' : '添加'}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border-2 border-ink bg-white p-4 shadow-sketch">
          <h4 className="mb-3 font-bold text-ink">预览</h4>
          <div className="rounded-xl border-2 border-black bg-[#f9f7f1] p-6 text-center">
            <ColorfulName color={previewColor} className="font-hand text-2xl">
              匿名用户
            </ColorfulName>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border-2 border-ink bg-white shadow-sketch">
        <div className="border-b border-ink/10 px-4 py-3 font-bold">
          列表 {loading ? '加载中…' : `(${sorted.length})`}
        </div>
        <div className="divide-y divide-ink/10">
          {sorted.map((item) => {
            const draft = editing[item.id] || {
              name: item.name,
              status: item.status,
              sort: String(item.sort ?? 100),
              tiers: tiersFromItem(item),
              r: String(item.color?.r ?? 0),
              g: String(item.color?.g ?? 0),
              b: String(item.color?.b ?? 0),
            };
            const draftColor = {
              r: Number(draft.r) || 0,
              g: Number(draft.g) || 0,
              b: Number(draft.b) || 0,
            };
            return (
              <div key={item.id} className="flex flex-col gap-3 p-4 lg:flex-row lg:items-start">
                <div className="min-w-[160px] rounded-xl border border-ink/10 bg-[#fcfbf7] p-3 text-center">
                  <ColorfulName color={draftColor} className="font-hand text-lg">
                    匿名用户
                  </ColorfulName>
                  <div className="mt-1 font-mono text-[10px] text-pencil">
                    rgb({draft.r},{draft.g},{draft.b})
                  </div>
                </div>
                <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                  <label className="text-xs sm:col-span-2">
                    <span className="text-pencil">名称</span>
                    <input
                      value={draft.name}
                      onChange={(e) => setEditing((prev) => ({ ...prev, [item.id]: { ...draft, name: e.target.value } }))}
                      className="mt-1 w-full rounded-lg border border-ink/20 px-2 py-1 text-sm font-bold"
                      disabled={!canManage}
                    />
                  </label>
                  <label className="text-xs">
                    <span className="text-pencil">状态</span>
                    <select
                      value={draft.status}
                      onChange={(e) => setEditing((prev) => ({ ...prev, [item.id]: { ...draft, status: e.target.value } }))}
                      className="mt-1 w-full rounded-lg border border-ink/20 px-2 py-1 text-sm font-bold"
                      disabled={!canManage}
                    >
                      {STATUS_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs">
                    <span className="text-pencil">排序</span>
                    <input
                      value={draft.sort}
                      onChange={(e) => setEditing((prev) => ({ ...prev, [item.id]: { ...draft, sort: e.target.value } }))}
                      className="mt-1 w-full rounded-lg border border-ink/20 px-2 py-1 text-sm font-bold"
                      disabled={!canManage}
                    />
                  </label>
                  <div className="col-span-2 sm:col-span-4 lg:col-span-6">
                    <PriceTiersEditor
                      compact
                      value={draft.tiers}
                      disabled={!canManage}
                      onChange={(tiers) => setEditing((prev) => ({ ...prev, [item.id]: { ...draft, tiers } }))}
                    />
                  </div>
                  <label className="text-xs">
                    <span className="text-pencil">R</span>
                    <input
                      value={draft.r}
                      onChange={(e) => setEditing((prev) => ({ ...prev, [item.id]: { ...draft, r: e.target.value } }))}
                      className="mt-1 w-full rounded-lg border border-ink/20 px-2 py-1 text-sm font-bold"
                      disabled={!canManage}
                    />
                  </label>
                  <label className="text-xs">
                    <span className="text-pencil">G</span>
                    <input
                      value={draft.g}
                      onChange={(e) => setEditing((prev) => ({ ...prev, [item.id]: { ...draft, g: e.target.value } }))}
                      className="mt-1 w-full rounded-lg border border-ink/20 px-2 py-1 text-sm font-bold"
                      disabled={!canManage}
                    />
                  </label>
                  <label className="text-xs">
                    <span className="text-pencil">B</span>
                    <input
                      value={draft.b}
                      onChange={(e) => setEditing((prev) => ({ ...prev, [item.id]: { ...draft, b: e.target.value } }))}
                      className="mt-1 w-full rounded-lg border border-ink/20 px-2 py-1 text-sm font-bold"
                      disabled={!canManage}
                    />
                  </label>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-gray-100 px-2 py-1 font-mono text-[10px]">{item.id}</span>
                  <input
                    type="color"
                    value={hexFromRgb(draftColor.r, draftColor.g, draftColor.b)}
                    onChange={(e) => {
                      const m = e.target.value.replace('#', '');
                      setEditing((prev) => ({
                        ...prev,
                        [item.id]: {
                          ...draft,
                          r: String(parseInt(m.slice(0, 2), 16)),
                          g: String(parseInt(m.slice(2, 4), 16)),
                          b: String(parseInt(m.slice(4, 6), 16)),
                        },
                      }));
                    }}
                    className="h-9 w-12 cursor-pointer rounded border border-ink/20"
                    disabled={!canManage}
                  />
                  <button
                    type="button"
                    disabled={!canManage}
                    onClick={() => handlePatch(item.id)}
                    className="rounded-full border-2 border-ink bg-ink px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                  >
                    保存
                  </button>
                </div>
              </div>
            );
          })}
          {!loading && sorted.length === 0 && (
            <div className="p-8 text-center text-sm text-pencil">暂无，请先添加</div>
          )}
        </div>
      </section>
    </div>
  );
};

export default AdminNameStylesView;
