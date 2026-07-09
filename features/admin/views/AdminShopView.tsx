import React, { useCallback, useEffect, useState } from 'react';
import { Coins, Frame, Minus, Palette, Plus, Search, Store, UserRound } from 'lucide-react';

import { api } from '@/api';
import AdminNameStylesView from '@/features/admin/views/AdminNameStylesView';
import AdminNicknameFramesView from '@/features/admin/views/AdminNicknameFramesView';

type ShopSection = 'frames' | 'names';

interface ShopUserProfile {
  identityKey: string;
  exists: boolean;
  coins: number;
  ownedFrameIds: string[];
  ownedNameStyleIds: string[];
  equippedFrameId: string | null;
  equippedNameStyleId: string | null;
  lastDailyClaimDate: string | null;
  updatedAt: number;
}

interface AdminShopViewProps {
  showToast: (message: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
  canManage: boolean;
}

/**
 * 商城管理：总开关、签到份额、用户瓜子、头像框、炫彩昵称
 */
const AdminShopView: React.FC<AdminShopViewProps> = ({ showToast, canManage }) => {
  const [section, setSection] = useState<ShopSection>('frames');
  const [shopEnabled, setShopEnabled] = useState(false);
  const [dailyClaimCoins, setDailyClaimCoins] = useState('10');
  const [loadingSwitch, setLoadingSwitch] = useState(true);
  const [savingSwitch, setSavingSwitch] = useState(false);
  const [savingClaim, setSavingClaim] = useState(false);

  const [fingerprintQuery, setFingerprintQuery] = useState('');
  const [userLoading, setUserLoading] = useState(false);
  const [userBusy, setUserBusy] = useState(false);
  const [shopUser, setShopUser] = useState<ShopUserProfile | null>(null);
  const [adjustAmount, setAdjustAmount] = useState('10');

  const loadSettings = useCallback(async () => {
    setLoadingSwitch(true);
    try {
      const data = await api.getAdminSettings();
      setShopEnabled(Boolean(data?.shopEnabled));
      setDailyClaimCoins(String(data?.shopDailyClaimCoins ?? 10));
    } catch (error) {
      showToast(error instanceof Error ? error.message : '加载商城设置失败', 'error');
    } finally {
      setLoadingSwitch(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

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

  const handleSaveDailyClaim = async () => {
    if (!canManage) {
      showToast('当前账号无处理权限', 'warning');
      return;
    }
    const n = Math.trunc(Number(dailyClaimCoins));
    if (!Number.isFinite(n) || n < 0) {
      showToast('每日签到瓜子须为 ≥0 的整数', 'warning');
      return;
    }
    setSavingClaim(true);
    try {
      const data = await api.updateAdminSettings({ shopDailyClaimCoins: n });
      setDailyClaimCoins(String(data?.shopDailyClaimCoins ?? n));
      showToast(`每日签到已设为 ${data?.shopDailyClaimCoins ?? n} 瓜子`, 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存失败', 'error');
    } finally {
      setSavingClaim(false);
    }
  };

  const handleLookupUser = async () => {
    const fp = fingerprintQuery.trim();
    if (!fp) {
      showToast('请输入用户指纹', 'warning');
      return;
    }
    setUserLoading(true);
    try {
      const data = await api.getAdminShopUser(fp);
      setShopUser(data?.user || null);
      if (!data?.user) {
        showToast('未找到用户档案', 'warning');
      } else if (!data.user.exists) {
        showToast('该指纹尚无商城档案（瓜子为 0，可直接发放）', 'info');
      }
    } catch (error) {
      setShopUser(null);
      showToast(error instanceof Error ? error.message : '查询失败', 'error');
    } finally {
      setUserLoading(false);
    }
  };

  const handleAdjustCoins = async (sign: 1 | -1) => {
    if (!canManage) {
      showToast('当前账号无处理权限', 'warning');
      return;
    }
    const fp = (shopUser?.identityKey || fingerprintQuery).trim();
    if (!fp) {
      showToast('请先查询用户指纹', 'warning');
      return;
    }
    const amount = Math.trunc(Number(adjustAmount));
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast('增减数量须为正整数', 'warning');
      return;
    }
    setUserBusy(true);
    try {
      const data = await api.adjustAdminShopUserCoins({
        fingerprint: fp,
        delta: sign * amount,
      });
      setShopUser(data?.user || null);
      showToast(
        sign > 0
          ? `已增加 ${amount} 瓜子，当前 ${data?.afterCoins ?? 0}`
          : `已减少 ${amount} 瓜子，当前 ${data?.afterCoins ?? 0}`,
        'success'
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : '调整失败', 'error');
    } finally {
      setUserBusy(false);
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
            前台入口、签到份额、用户瓜子、商品与阶梯定价
          </p>
        </div>
      </div>

      {/* 商城总开关 + 签到份额 */}
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
                ? '用户可在「我的 → 商城」兑换装扮、领取签到瓜子。'
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

        <div className="border-t border-ink/10 px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-[160px] flex-1 text-xs sm:max-w-xs">
              <span className="flex items-center gap-1.5 font-bold text-ink">
                <Coins className="h-3.5 w-3.5" />
                每日签到瓜子
              </span>
              <input
                type="number"
                min={0}
                max={100000}
                value={dailyClaimCoins}
                disabled={!canManage || loadingSwitch}
                onChange={(e) => setDailyClaimCoins(e.target.value)}
                className="mt-1.5 w-full rounded-xl border-2 border-ink/15 bg-white px-3 py-2 text-sm font-bold tabular-nums outline-none focus:border-ink/40"
              />
              <span className="mt-1 block text-[11px] text-pencil">用户每日可领取的瓜子数量，默认 10</span>
            </label>
            <button
              type="button"
              disabled={!canManage || loadingSwitch || savingClaim}
              onClick={handleSaveDailyClaim}
              className="rounded-full border-2 border-ink bg-ink px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              {savingClaim ? '保存中…' : '保存份额'}
            </button>
          </div>
        </div>
      </section>

      {/* 按指纹查/改瓜子 */}
      <section className="rounded-2xl border-2 border-ink bg-white p-4 shadow-sketch sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <UserRound className="h-5 w-5 text-ink" />
          <h3 className="font-display text-lg text-ink">用户瓜子</h3>
        </div>
        <p className="mt-1 text-sm text-pencil">
          按访客指纹（identity / fingerprint）查询当前瓜子，并可增加或减少
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <input
            value={fingerprintQuery}
            onChange={(e) => setFingerprintQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleLookupUser();
            }}
            placeholder="粘贴用户指纹 identity_key"
            className="min-w-[220px] flex-1 rounded-xl border-2 border-ink/15 px-3 py-2 font-mono text-sm outline-none focus:border-ink/40"
          />
          <button
            type="button"
            disabled={userLoading}
            onClick={handleLookupUser}
            className="inline-flex items-center gap-1.5 rounded-full border-2 border-ink bg-white px-4 py-2 text-sm font-bold shadow-sketch disabled:opacity-50"
          >
            <Search className="h-4 w-4" />
            {userLoading ? '查询中…' : '查询'}
          </button>
        </div>

        {shopUser && (
          <div className="mt-4 space-y-3 rounded-xl border border-ink/10 bg-[#fcfbf7] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-wide text-pencil">指纹</div>
                <div className="mt-0.5 break-all font-mono text-xs text-ink">{shopUser.identityKey}</div>
                <div className="mt-2 text-[11px] text-pencil">
                  {shopUser.exists ? '已有商城档案' : '尚无档案（首次发放会自动创建）'}
                  {shopUser.lastDailyClaimDate ? ` · 上次签到 ${shopUser.lastDailyClaimDate}` : ''}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[11px] font-bold text-pencil">当前瓜子</div>
                <div className="font-display text-3xl tabular-nums text-ink">{shopUser.coins}</div>
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-2 border-t border-dashed border-ink/10 pt-3">
              <label className="text-xs">
                <span className="text-pencil">数量</span>
                <input
                  type="number"
                  min={1}
                  value={adjustAmount}
                  disabled={!canManage || userBusy}
                  onChange={(e) => setAdjustAmount(e.target.value)}
                  className="mt-1 w-28 rounded-lg border border-ink/20 px-2 py-1.5 text-sm font-bold tabular-nums"
                />
              </label>
              <button
                type="button"
                disabled={!canManage || userBusy}
                onClick={() => handleAdjustCoins(1)}
                className="inline-flex items-center gap-1 rounded-full border-2 border-ink bg-highlight px-3 py-1.5 text-xs font-bold disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" />
                增加
              </button>
              <button
                type="button"
                disabled={!canManage || userBusy}
                onClick={() => handleAdjustCoins(-1)}
                className="inline-flex items-center gap-1 rounded-full border-2 border-ink/30 bg-white px-3 py-1.5 text-xs font-bold disabled:opacity-50"
              >
                <Minus className="h-3.5 w-3.5" />
                减少
              </button>
              <span className="text-[11px] text-pencil">
                拥有框 {shopUser.ownedFrameIds?.length || 0} · 炫彩 {shopUser.ownedNameStyleIds?.length || 0}
              </span>
            </div>
          </div>
        )}
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
