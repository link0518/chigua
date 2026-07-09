import React, { useCallback, useEffect, useState } from 'react';
import { Frame, Palette, Store } from 'lucide-react';

import { api } from '@/api';
import AdminNameStylesView from '@/features/admin/views/AdminNameStylesView';
import AdminNicknameFramesView from '@/features/admin/views/AdminNicknameFramesView';

type ShopSection = 'frames' | 'names';

interface AdminShopViewProps {
  showToast: (message: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
  canManage: boolean;
}

/**
 * 商城管理：总开关 + 头像框 + 炫彩昵称
 */
const AdminShopView: React.FC<AdminShopViewProps> = ({ showToast, canManage }) => {
  const [section, setSection] = useState<ShopSection>('frames');
  const [shopEnabled, setShopEnabled] = useState(false);
  const [loadingSwitch, setLoadingSwitch] = useState(true);
  const [savingSwitch, setSavingSwitch] = useState(false);

  const loadSwitch = useCallback(async () => {
    setLoadingSwitch(true);
    try {
      const data = await api.getAdminSettings();
      setShopEnabled(Boolean(data?.shopEnabled));
    } catch (error) {
      showToast(error instanceof Error ? error.message : '加载商城开关失败', 'error');
    } finally {
      setLoadingSwitch(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadSwitch();
  }, [loadSwitch]);

  const handleToggleShop = async () => {
    if (!canManage) {
      showToast('当前账号无处理权限', 'warning');
      return;
    }
    const next = !shopEnabled;
    setSavingSwitch(true);
    try {
      const data = await api.updateAdminSettings({ shopEnabled: next });
      setShopEnabled(Boolean(data?.shopEnabled));
      showToast(next ? '商城已开启，前台将显示入口' : '商城已关闭，前台入口已隐藏', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '切换失败', 'error');
    } finally {
      setSavingSwitch(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-display text-2xl text-ink">
            <Store className="h-6 w-6" />
            商城管理
          </h2>
          <p className="mt-1 text-sm text-pencil">
            前台入口、商品与阶梯定价
          </p>
        </div>
      </div>

      {/* 商城总开关 */}
      <section
        className={`overflow-hidden rounded-2xl border-2 shadow-sketch transition-colors ${
          shopEnabled
            ? 'border-emerald-700/40 bg-gradient-to-br from-emerald-50 via-white to-[#fcfbf7]'
            : 'border-ink/15 bg-gradient-to-br from-slate-50 via-white to-[#fcfbf7]'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-display text-lg text-ink">前台商城</span>
              <span
                className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${
                  loadingSwitch
                    ? 'border-ink/10 bg-white text-pencil'
                    : shopEnabled
                      ? 'border-emerald-700/30 bg-emerald-100 text-emerald-900'
                      : 'border-ink/15 bg-white text-pencil'
                }`}
              >
                {loadingSwitch ? '加载中…' : shopEnabled ? '已开启' : '已关闭'}
              </span>
            </div>
            <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-pencil">
              {shopEnabled
                ? '用户可在「我的 → 商城」兑换头像框与炫彩昵称、领取瓜子。'
                : '关闭后前台不显示商城入口，兑换接口亦不可用。默认关闭。'}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span className={`hidden text-xs font-bold sm:inline ${shopEnabled ? 'text-emerald-800' : 'text-pencil'}`}>
              {shopEnabled ? '对用户可见' : '对用户隐藏'}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={shopEnabled}
              aria-label={shopEnabled ? '关闭商城' : '开启商城'}
              disabled={!canManage || loadingSwitch || savingSwitch}
              onClick={handleToggleShop}
              className={`relative h-10 w-[4.25rem] shrink-0 rounded-full border-2 border-ink transition-all disabled:opacity-50 ${
                shopEnabled ? 'bg-emerald-400 shadow-[2px_2px_0_#0f172a]' : 'bg-gray-200'
              }`}
            >
              <span
                className={`absolute top-0.5 flex h-8 w-8 items-center justify-center rounded-full border-2 border-ink bg-white text-[10px] font-black shadow-sm transition-transform ${
                  shopEnabled ? 'translate-x-7' : 'translate-x-0.5'
                }`}
              >
                {savingSwitch ? '…' : shopEnabled ? '开' : '关'}
              </span>
            </button>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap gap-2 border-b-2 border-ink/10 pb-3">
        <button
          type="button"
          onClick={() => setSection('frames')}
          className={`inline-flex items-center gap-2 rounded-full border-2 px-4 py-2 text-sm font-bold transition-colors ${
            section === 'frames'
              ? 'border-ink bg-ink text-white'
              : 'border-ink/20 bg-white text-ink hover:bg-highlight/40'
          }`}
        >
          <Frame className="h-4 w-4" />
          头像框
        </button>
        <button
          type="button"
          onClick={() => setSection('names')}
          className={`inline-flex items-center gap-2 rounded-full border-2 px-4 py-2 text-sm font-bold transition-colors ${
            section === 'names'
              ? 'border-ink bg-ink text-white'
              : 'border-ink/20 bg-white text-ink hover:bg-highlight/40'
          }`}
        >
          <Palette className="h-4 w-4" />
          炫彩昵称
        </button>
      </div>

      {section === 'frames' && (
        <AdminNicknameFramesView showToast={showToast} canManage={canManage} embedded />
      )}
      {section === 'names' && (
        <AdminNameStylesView showToast={showToast} canManage={canManage} />
      )}
    </div>
  );
};

export default AdminShopView;
