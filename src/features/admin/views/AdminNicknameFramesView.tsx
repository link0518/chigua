import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, RefreshCw, Upload } from 'lucide-react';

import { api } from '@/api';
import { AnonymousAuthorPreview } from '@/components/NicknameFrameCard';
import { mergeFrameRegistry, type FrameRenderPayload } from '@/components/nicknameFrames';
import PriceTiersEditor, {
  draftsToPayload,
  tiersFromItem,
  type PriceTierDraft,
} from '@/features/admin/components/PriceTiersEditor';

interface AdminFrameItem {
  id: string;
  name: string;
  price: number;
  rarity: string;
  status: string;
  sort?: number;
  grantOnRegister?: boolean;
  packageRevision?: number;
  durationDays?: number;
  priceTiers?: Array<{ price: number; durationDays: number; label?: string }>;
  render?: FrameRenderPayload | null;
}

const STATUS_OPTIONS = [
  { value: 'on_sale', label: '在售' },
  { value: 'off_sale', label: '下架' },
  { value: 'hidden', label: '隐藏' },
];

const SAMPLE_PACKAGE = `{
  "schemaVersion": 2,
  "frame": {
    "id": "demo-spark",
    "name": "星屑示例",
    "price": 30,
    "rarity": "common",
    "status": "on_sale",
    "sort": 50,
    "grantOnRegister": false
  },
  "render": {
    "engine": "css-slots-v1",
    "html": "default-v1",
    "css": ".fg-root{display:inline-flex;align-items:center;gap:10px;padding:8px 12px;position:relative}.fg-shell{position:absolute;inset:0;border-radius:16px;border:2px solid #0f172a;background:linear-gradient(120deg,#fef9c3,#fce7f3,#e0e7ff);box-shadow:3px 3px 0 #0f172a;animation:pulse 2s ease-in-out infinite}.fg-avatar{position:relative;z-index:1;width:var(--fg-avatar,40px);height:var(--fg-avatar,40px);border-radius:12px;border:2px solid #0f172a;background:#fff;display:flex;align-items:center;justify-content:center}.fg-glyph{font-weight:900;color:#0f172a;font-size:calc(var(--fg-avatar,40px)*.38)}.fg-meta{position:relative;z-index:1;display:flex;flex-direction:column;min-width:0}.fg-name{font-weight:700;color:#0f172a;font-size:var(--fg-name-size,16px)}.fg-time{color:#6b7280;font-size:11px;margin-top:2px}@keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.02)}}"
  },
  "preview": { "username": "匿名用户", "timestamp": "刚刚" }
}`;

interface AdminNicknameFramesViewProps {
  showToast: (message: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
  canManage: boolean;
  /** 嵌在「商城管理」下时隐藏顶层大标题 */
  embedded?: boolean;
}

const AdminNicknameFramesView: React.FC<AdminNicknameFramesViewProps> = ({
  showToast,
  canManage,
  embedded = false,
}) => {
  const [items, setItems] = useState<AdminFrameItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [packageText, setPackageText] = useState(SAMPLE_PACKAGE);
  const [importMode, setImportMode] = useState<'create' | 'upsert'>('create');
  const [validating, setValidating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [previewRender, setPreviewRender] = useState<FrameRenderPayload | null>(null);
  const [previewId, setPreviewId] = useState('demo-spark');
  const [validateError, setValidateError] = useState('');
  const [editing, setEditing] = useState<Record<string, {
    status: string;
    name: string;
    sort: string;
    tiers: PriceTierDraft[];
  }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getAdminNicknameFrames();
      const list: AdminFrameItem[] = Array.isArray(data?.items) ? data.items : [];
      setItems(list);
      mergeFrameRegistry(
        list.map((item) => ({
          id: item.id,
          name: item.name,
          price: item.price,
          rarity: (item.rarity as any) || 'common',
          render: item.render || null,
        }))
      );
      const nextEdit: typeof editing = {};
      list.forEach((item) => {
        nextEdit[item.id] = {
          status: item.status,
          name: item.name,
          sort: String(item.sort ?? 100),
          tiers: tiersFromItem(item),
        };
      });
      setEditing(nextEdit);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '加载失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleValidate = async () => {
    setValidating(true);
    setValidateError('');
    try {
      const data = await api.validateAdminNicknameFramePackage(packageText);
      const pkg = data?.package;
      const css = pkg?.render?.css || '';
      setPreviewId(pkg?.frame?.id || 'preview');
      setPreviewRender({
        engine: 'css-slots-v1',
        html: 'default-v1',
        css,
        assets: pkg?.render?.assets || {},
        lottie: pkg?.render?.lottie || null,
      });
      showToast('校验通过', 'success');
    } catch (error) {
      setPreviewRender(null);
      const message = error instanceof Error ? error.message : '校验失败';
      setValidateError(message);
      showToast(message, 'error');
    } finally {
      setValidating(false);
    }
  };

  const handleImport = async () => {
    if (!canManage) {
      showToast('当前账号无处理权限', 'warning');
      return;
    }
    setImporting(true);
    try {
      await api.importAdminNicknameFramePackage(packageText, importMode);
      showToast(importMode === 'create' ? '导入成功' : '已更新', 'success');
      await load();
    } catch (error) {
      showToast(error instanceof Error ? error.message : '导入失败', 'error');
    } finally {
      setImporting(false);
    }
  };

  const handleFile = async (file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      setPackageText(text);
      showToast(`已读取 ${file.name}`, 'success');
    } catch {
      showToast('读取文件失败', 'error');
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
      await api.patchAdminNicknameFrame(id, {
        name: draft.name,
        status: draft.status,
        sort: Number(draft.sort),
        priceTiers,
      });
      showToast('已保存', 'success');
      await load();
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存失败', 'error');
    }
  };

  const handleExport = async (id: string) => {
    try {
      const data = await api.exportAdminNicknameFrame(id);
      const blob = new Blob([JSON.stringify(data?.package || {}, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${id}.frame.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '导出失败', 'error');
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
          {embedded ? (
            <>
              <h3 className="font-display text-xl text-ink">头像框商品</h3>
              <p className="mt-1 text-sm text-pencil">
                商城初期商品线：粘贴 Frame Package JSON 或导入 .json；支持 CSS 动效（无 JS）
              </p>
            </>
          ) : (
            <>
              <h2 className="font-display text-2xl text-ink">头像框管理</h2>
              <p className="mt-1 text-sm text-pencil">粘贴 Frame Package JSON 或导入 .json 文件；支持复杂 CSS 动效（无 JS）</p>
            </>
          )}
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
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-bold text-ink">导入框包</h3>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-ink/30 px-3 py-1 text-xs font-bold">
                <Upload className="h-3.5 w-3.5" />
                选择文件
                <input
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(e) => handleFile(e.target.files?.[0] || null)}
                />
              </label>
              <select
                value={importMode}
                onChange={(e) => setImportMode(e.target.value === 'upsert' ? 'upsert' : 'create')}
                className="rounded-full border border-ink/30 px-2 py-1 text-xs font-bold"
              >
                <option value="create">新建</option>
                <option value="upsert">覆盖更新</option>
              </select>
            </div>
          </div>
          <textarea
            value={packageText}
            onChange={(e) => setPackageText(e.target.value)}
            rows={16}
            spellCheck={false}
            className="w-full rounded-xl border-2 border-ink/15 bg-[#fcfbf7] p-3 font-mono text-xs leading-5 outline-none focus:border-ink"
            placeholder="粘贴 schemaVersion:2 的 Frame Package JSON"
          />
          {validateError && (
            <p className="mt-2 text-xs font-bold text-red-600">{validateError}</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={validating}
              onClick={handleValidate}
              className="rounded-full border-2 border-ink bg-white px-4 py-2 text-sm font-bold"
            >
              {validating ? '校验中...' : '校验并预览'}
            </button>
            <button
              type="button"
              disabled={importing || !canManage}
              onClick={handleImport}
              className="rounded-full border-2 border-ink bg-ink px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              {importing ? '导入中...' : '确认导入'}
            </button>
            <button
              type="button"
              onClick={() => setPackageText(SAMPLE_PACKAGE)}
              className="rounded-full border border-ink/30 px-3 py-2 text-xs font-bold"
            >
              填入示例
            </button>
          </div>
        </div>

        <div className="rounded-2xl border-2 border-ink bg-white p-4 shadow-sketch">
          <h3 className="mb-3 font-bold text-ink">预览（匿名用户 · 刚刚）</h3>
          <div className="rounded-xl border-2 border-black bg-[#f9f7f1] p-6">
            <AnonymousAuthorPreview
              frameId={previewId}
              size="md"
              timestamp="刚刚"
              render={previewRender}
            />
          </div>
          <p className="mt-3 text-xs text-pencil">
            与前台帖子作者区同一 FrameRuntime；仅允许受控 CSS 动效，禁止 JS。
          </p>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border-2 border-ink bg-white shadow-sketch">
        <div className="border-b border-ink/10 px-4 py-3 font-bold">框列表 {loading ? '加载中…' : `(${sorted.length})`}</div>
        <div className="divide-y divide-ink/10">
          {sorted.map((item) => {
            const draft = editing[item.id] || {
              status: item.status,
              name: item.name,
              sort: String(item.sort ?? 100),
              tiers: tiersFromItem(item),
            };
            return (
              <div key={item.id} className="flex flex-col gap-3 p-4 lg:flex-row lg:items-start">
                <div className="min-w-[200px] rounded-xl border border-ink/10 bg-[#fcfbf7] p-3">
                  <AnonymousAuthorPreview
                    frameId={item.id}
                    size="sm"
                    timestamp="刚刚"
                    render={item.render}
                  />
                </div>
                <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
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
                  <div className="col-span-2 sm:col-span-4">
                    <PriceTiersEditor
                      compact
                      value={draft.tiers}
                      disabled={!canManage}
                      onChange={(tiers) => setEditing((prev) => ({ ...prev, [item.id]: { ...draft, tiers } }))}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full bg-gray-100 px-2 py-1 font-mono text-[10px]">{item.id}</span>
                  <button
                    type="button"
                    disabled={!canManage}
                    onClick={() => handlePatch(item.id)}
                    className="rounded-full border-2 border-ink bg-ink px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                  >
                    保存
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExport(item.id)}
                    className="inline-flex items-center gap-1 rounded-full border border-ink/30 px-3 py-1.5 text-xs font-bold"
                  >
                    <Download className="h-3.5 w-3.5" />
                    导出
                  </button>
                </div>
              </div>
            );
          })}
          {!loading && sorted.length === 0 && (
            <div className="p-8 text-center text-sm text-pencil">暂无头像框，请先导入</div>
          )}
        </div>
      </section>
    </div>
  );
};

export default AdminNicknameFramesView;
