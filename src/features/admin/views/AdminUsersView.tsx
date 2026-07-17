import React, { useMemo, useState } from 'react';
import { KeyRound, Pencil, Plus, RefreshCw, ShieldCheck, UserCog, X } from 'lucide-react';
import { Badge, SketchButton } from '@/components/SketchUI';
import type {
  AdminPermissionDefinitions,
  AdminPermissionLevel,
  AdminPermissionModuleKey,
  AdminPermissions,
  AdminUserAccount,
} from '@/types';

type AdminUserDialogMode = 'create' | 'edit';

type AdminUserDialogState = {
  mode: AdminUserDialogMode;
  user: AdminUserAccount | null;
};

type AdminUserForm = {
  username: string;
  password: string;
  permissions: AdminPermissions;
};

interface AdminUsersViewProps {
  items: AdminUserAccount[];
  permissionDefinitions: AdminPermissionDefinitions | null;
  loading: boolean;
  submitting: boolean;
  onRefresh: () => void;
  onCreate: (payload: { username: string; password: string; permissions: AdminPermissions }) => Promise<boolean>;
  onPermissionsChange: (id: number, permissions: AdminPermissions) => Promise<boolean>;
  onStatusChange: (id: number, disabled: boolean) => Promise<boolean>;
  onPasswordReset: (id: number, password: string) => Promise<boolean>;
  formatTimestamp: (timestamp?: number) => string;
}

const EMPTY_FORM: AdminUserForm = {
  username: '',
  password: '',
  permissions: {},
};

const PERMISSION_LEVEL_LABELS: Record<AdminPermissionLevel, string> = {
  read: '查看',
  manage: '管理',
};

const setPermissionLevel = (
  permissions: AdminPermissions,
  key: AdminPermissionModuleKey,
  level: AdminPermissionLevel | ''
): AdminPermissions => {
  const next = { ...permissions };
  if (!level) {
    delete next[key];
  } else {
    next[key] = level;
  }
  return next;
};

const getPermissionSummary = (permissions: AdminPermissions, definitions: AdminPermissionDefinitions) => {
  const enabled = definitions.modules
    .filter((module) => Boolean(permissions[module.key]))
    .map((module) => `${module.label} · ${PERMISSION_LEVEL_LABELS[permissions[module.key] as AdminPermissionLevel]}`);
  return enabled.length ? enabled.join(' / ') : '未配置权限';
};

const PermissionMatrix: React.FC<{
  permissions: AdminPermissions;
  definitions: AdminPermissionDefinitions;
  disabled?: boolean;
  onChange: (permissions: AdminPermissions) => void;
}> = ({ permissions, definitions, disabled = false, onChange }) => {
  if (definitions.modules.length === 0) {
    return (
      <div className="rounded-3xl border-2 border-dashed border-ink/20 bg-white/80 p-8 text-center">
        <UserCog className="mx-auto h-10 w-10 text-pencil" />
        <h4 className="mt-3 font-display text-xl text-ink">暂无可配置权限</h4>
        <p className="mt-2 font-sans text-sm text-pencil">权限定义加载完成后会显示在这里。</p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {definitions.modules.map((module) => {
        const value = permissions[module.key] || '';
        const statusText = value ? PERMISSION_LEVEL_LABELS[value] : '关闭';
        return (
          <div
            key={module.key}
            className="rounded-2xl border border-ink/10 bg-white/90 p-3 shadow-[0_14px_32px_rgba(31,27,22,0.06)] transition-colors hover:border-ink/30"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-sans text-sm font-black text-ink">{module.label}</p>
                {module.description && (
                  <p className="mt-1 line-clamp-2 font-sans text-xs leading-5 text-pencil">{module.description}</p>
                )}
              </div>
              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-black ${
                value === 'manage'
                  ? 'border-ink bg-highlight text-ink'
                  : value === 'read'
                    ? 'border-ink/20 bg-paper text-ink'
                    : 'border-gray-200 bg-gray-50 text-pencil'
              }`}>
                {statusText}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-1.5">
              <button
                type="button"
                aria-pressed={!value}
                disabled={disabled}
                onClick={() => onChange(setPermissionLevel(permissions, module.key, ''))}
                className={`rounded-xl border px-2 py-2 text-xs font-black transition-all ${
                  !value
                    ? 'border-ink bg-ink text-white'
                    : 'border-gray-200 bg-white text-pencil hover:border-ink'
                } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
              >
                关闭
              </button>
              {definitions.levels.map((level) => (
                <button
                  key={level.key}
                  type="button"
                  aria-pressed={value === level.key}
                  disabled={disabled}
                  onClick={() => onChange(setPermissionLevel(permissions, module.key, level.key))}
                  className={`rounded-xl border px-2 py-2 text-xs font-black transition-all ${
                    value === level.key
                      ? 'border-ink bg-highlight text-ink shadow-sketch-sm'
                      : 'border-gray-200 bg-white text-pencil hover:border-ink'
                  } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
                >
                  {level.label}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const AdminUserDialog: React.FC<{
  state: AdminUserDialogState | null;
  form: AdminUserForm;
  definitions: AdminPermissionDefinitions;
  submitting: boolean;
  onClose: () => void;
  onFormChange: (form: AdminUserForm) => void;
  onSubmit: () => void;
  onPasswordReset: () => void;
}> = ({ state, form, definitions, submitting, onClose, onFormChange, onSubmit, onPasswordReset }) => {
  if (!state) return null;

  const isCreate = state.mode === 'create';
  const isSuperAdmin = Boolean(state.user?.isSuperAdmin);
  const canSubmit = isCreate
    ? Boolean(form.username.trim()) && form.password.length >= 8
    : !isSuperAdmin;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center px-3 py-6">
      <button type="button" aria-label="关闭弹窗" className="absolute inset-0 bg-ink/45 backdrop-blur-sm" onClick={onClose} />
      <section className="relative flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-[2rem] border-2 border-ink bg-[#fbf6e8] shadow-[10px_10px_0_rgba(31,27,22,0.35)]">
        <header className="border-b-2 border-ink bg-white px-5 py-4 sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-sans text-[11px] font-black tracking-[0.24em] text-pencil">ACCESS CONTROL</p>
              <h3 className="mt-1 font-display text-2xl text-ink">
                {isCreate ? '新建管理员' : `修改 ${state.user?.username || ''}`}
              </h3>
              <p className="mt-1 font-sans text-sm text-pencil">
                {isCreate ? '填写账号、初始密码，并配置可访问模块。' : '调整权限，或为该管理员重置密码。'}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border-2 border-ink bg-paper p-2 shadow-sketch-sm transition-transform hover:-translate-y-0.5"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
          {isCreate && (
            <div className="mb-5 grid gap-4 md:grid-cols-2">
              <label className="space-y-1.5">
                <span className="font-sans text-sm font-black text-ink">账号</span>
                <input
                  value={form.username}
                  onChange={(event) => onFormChange({ ...form, username: event.target.value })}
                  className="w-full rounded-2xl border-2 border-gray-200 bg-white px-4 py-3 font-sans text-sm outline-none transition-colors focus:border-ink"
                  placeholder="admin_editor"
                  autoComplete="username"
                />
              </label>
              <label className="space-y-1.5">
                <span className="font-sans text-sm font-black text-ink">初始密码</span>
                <input
                  type="password"
                  value={form.password}
                  onChange={(event) => onFormChange({ ...form, password: event.target.value })}
                  className="w-full rounded-2xl border-2 border-gray-200 bg-white px-4 py-3 font-sans text-sm outline-none transition-colors focus:border-ink"
                  placeholder="至少 8 位"
                  autoComplete="new-password"
                />
              </label>
            </div>
          )}

          {isSuperAdmin ? (
            <div className="rounded-3xl border-2 border-dashed border-ink/20 bg-white p-8 text-center">
              <ShieldCheck className="mx-auto h-10 w-10 text-ink" />
              <h4 className="mt-3 font-display text-xl text-ink">超级管理员受保护</h4>
              <p className="mt-2 font-sans text-sm text-pencil">不能在后台降权、禁用或重置超级管理员密码。</p>
            </div>
          ) : (
            <PermissionMatrix
              permissions={form.permissions}
              definitions={definitions}
              disabled={submitting}
              onChange={(permissions) => onFormChange({ ...form, permissions })}
            />
          )}

          {!isCreate && !isSuperAdmin && (
            <div className="mt-5 rounded-3xl border-2 border-ink/10 bg-white/85 p-4">
              <div className="mb-3 flex items-center gap-2">
                <span className="rounded-full border border-ink/10 bg-paper p-2 text-ink">
                  <KeyRound size={16} />
                </span>
                <div>
                  <p className="font-sans text-sm font-black text-ink">重置密码</p>
                  <p className="font-sans text-xs text-pencil">留空则只保存权限；输入新密码后可单独重置。</p>
                </div>
              </div>
              <input
                type="password"
                value={form.password}
                onChange={(event) => onFormChange({ ...form, password: event.target.value })}
                className="w-full rounded-2xl border-2 border-gray-200 bg-white px-4 py-3 font-sans text-sm outline-none transition-colors focus:border-ink"
                placeholder="新密码至少 8 位"
                autoComplete="new-password"
              />
            </div>
          )}
        </div>

        <footer className="flex flex-col gap-2 border-t-2 border-ink bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-6">
          <SketchButton type="button" variant="secondary" className="inline-flex h-10 items-center justify-center px-4 text-sm" onClick={onClose} disabled={submitting}>
            取消
          </SketchButton>
          {!isCreate && !isSuperAdmin && (
            <SketchButton
              type="button"
              variant="secondary"
              className="inline-flex h-10 items-center justify-center gap-2 px-4 text-sm"
              onClick={onPasswordReset}
              disabled={submitting || form.password.length < 8}
            >
              <KeyRound size={15} />
              重置密码
            </SketchButton>
          )}
          {!isSuperAdmin && (
            <SketchButton type="button" className="inline-flex h-10 items-center justify-center px-5 text-sm" onClick={onSubmit} disabled={submitting || !canSubmit}>
              {submitting ? '处理中...' : isCreate ? '创建管理员' : '保存权限'}
            </SketchButton>
          )}
        </footer>
      </section>
    </div>
  );
};

const AdminUsersView: React.FC<AdminUsersViewProps> = ({
  items,
  permissionDefinitions,
  loading,
  submitting,
  onRefresh,
  onCreate,
  onPermissionsChange,
  onStatusChange,
  onPasswordReset,
  formatTimestamp,
}) => {
  const [dialogState, setDialogState] = useState<AdminUserDialogState | null>(null);
  const [form, setForm] = useState<AdminUserForm>(EMPTY_FORM);

  const definitions = useMemo<AdminPermissionDefinitions>(() => permissionDefinitions || {
    modules: [],
    levels: [],
  }, [permissionDefinitions]);

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => {
      if (a.isSuperAdmin !== b.isSuperAdmin) return a.isSuperAdmin ? -1 : 1;
      if (a.disabled !== b.disabled) return a.disabled ? 1 : -1;
      return b.createdAt - a.createdAt;
    }),
    [items]
  );

  const openCreateDialog = () => {
    setForm(EMPTY_FORM);
    setDialogState({ mode: 'create', user: null });
  };

  const openEditDialog = (user: AdminUserAccount) => {
    setForm({ username: user.username, password: '', permissions: user.permissions || {} });
    setDialogState({ mode: 'edit', user });
  };

  const closeDialog = () => {
    if (submitting) return;
    setDialogState(null);
    setForm(EMPTY_FORM);
  };

  const submitDialog = async () => {
    if (!dialogState) return;
    if (dialogState.mode === 'create') {
      const ok = await onCreate({
        username: form.username.trim(),
        password: form.password,
        permissions: form.permissions,
      });
      if (ok) closeDialog();
      return;
    }
    if (!dialogState.user || dialogState.user.isSuperAdmin) return;
    const ok = await onPermissionsChange(dialogState.user.id, form.permissions);
    if (ok) closeDialog();
  };

  const resetPasswordFromDialog = async () => {
    if (!dialogState?.user || dialogState.user.isSuperAdmin) return;
    const ok = await onPasswordReset(dialogState.user.id, form.password);
    if (ok) {
      setForm((prev) => ({ ...prev, password: '' }));
    }
  };

  const activeCount = sortedItems.filter((item) => !item.disabled).length;
  const normalCount = sortedItems.filter((item) => !item.isSuperAdmin).length;

  return (
    <section className="space-y-4">
      <div className="overflow-hidden rounded-[1.75rem] border-2 border-ink bg-white shadow-sketch-sm">
        <div className="relative flex flex-col gap-4 p-4 sm:p-5 xl:flex-row xl:items-center xl:justify-between">
          <div className="absolute right-0 top-0 h-24 w-24 rounded-bl-full bg-highlight/70" />
          <div className="relative min-w-0">
            <p className="font-sans text-[11px] font-black tracking-[0.24em] text-pencil">ADMIN ACCESS</p>
            <h3 className="mt-1 font-display text-2xl text-ink sm:text-3xl">管理员管理</h3>
            <p className="mt-1 max-w-2xl font-sans text-sm leading-6 text-pencil">
              通过列表查看账号状态；新建和修改都在弹窗中完成，主页面保持紧凑。
            </p>
          </div>
          <div className="relative flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-ink/10 bg-paper px-3 py-1.5 font-sans text-xs font-black text-ink">总数 {sortedItems.length}</span>
              <span className="rounded-full border border-ink/10 bg-green-50 px-3 py-1.5 font-sans text-xs font-black text-ink">启用 {activeCount}</span>
              <span className="rounded-full border border-ink/10 bg-white px-3 py-1.5 font-sans text-xs font-black text-ink">普通管理员 {normalCount}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <SketchButton type="button" variant="secondary" className="inline-flex h-10 items-center gap-2 px-4 text-sm" onClick={onRefresh} disabled={loading}>
                <RefreshCw size={16} /> {loading ? '刷新中...' : '刷新'}
              </SketchButton>
              <SketchButton type="button" className="inline-flex h-10 items-center gap-2 px-4 text-sm" onClick={openCreateDialog} disabled={loading || submitting}>
                <Plus size={16} /> 新建管理员
              </SketchButton>
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-[1.75rem] border-2 border-ink bg-white shadow-sketch-sm">
        <div className="grid grid-cols-[1.35fr_1.85fr_0.8fr_1fr] gap-4 border-b-2 border-ink bg-paper px-5 py-3 font-sans text-xs font-black tracking-[0.12em] text-pencil max-lg:hidden">
          <span>账号</span>
          <span>权限</span>
          <span>状态</span>
          <span className="text-right">操作</span>
        </div>

        {loading ? (
          <div className="py-16 text-center">
            <UserCog className="mx-auto h-10 w-10 text-pencil" />
            <h4 className="mt-3 font-display text-xl text-ink">正在加载管理员列表</h4>
          </div>
        ) : sortedItems.length === 0 ? (
          <div className="py-16 text-center">
            <UserCog className="mx-auto h-10 w-10 text-pencil" />
            <h4 className="mt-3 font-display text-xl text-ink">暂无管理员账号</h4>
          </div>
        ) : (
          <div className="divide-y-2 divide-ink/10">
            {sortedItems.map((item) => (
              <article key={item.id} className="grid gap-4 px-5 py-4 transition-colors hover:bg-[#fffaf0] lg:grid-cols-[1.35fr_1.85fr_0.8fr_1fr] lg:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-sans text-base font-black text-ink">{item.username}</span>
                    {item.isSuperAdmin && <ShieldCheck size={16} className="text-ink" />}
                  </div>
                  <p className="mt-1 font-sans text-xs text-pencil">
                    创建 {formatTimestamp(item.createdAt)}
                    {item.updatedAt ? ` · 更新 ${formatTimestamp(item.updatedAt)}` : ''}
                  </p>
                </div>

                <p className="line-clamp-2 font-sans text-sm leading-6 text-pencil">
                  {item.isSuperAdmin ? '拥有全部后台权限' : getPermissionSummary(item.permissions || {}, definitions)}
                </p>

                <div>
                  <Badge color={item.isSuperAdmin ? 'bg-highlight' : item.disabled ? 'bg-gray-200' : 'bg-green-100'}>
                    {item.isSuperAdmin ? '超级管理员' : item.disabled ? '已禁用' : '启用中'}
                  </Badge>
                </div>

                <div className="flex flex-wrap gap-2 lg:justify-end">
                  <SketchButton type="button" variant="secondary" className="inline-flex h-9 items-center gap-1.5 px-3 text-xs" onClick={() => openEditDialog(item)} disabled={submitting}>
                    <Pencil size={14} /> 修改
                  </SketchButton>
                  {!item.isSuperAdmin && (
                    <SketchButton
                      type="button"
                      variant={item.disabled ? 'secondary' : 'danger'}
                      className="inline-flex h-9 items-center px-3 text-xs"
                      disabled={submitting}
                      onClick={() => onStatusChange(item.id, !item.disabled)}
                    >
                      {item.disabled ? '启用' : '禁用'}
                    </SketchButton>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <AdminUserDialog
        state={dialogState}
        form={form}
        definitions={definitions}
        submitting={submitting}
        onClose={closeDialog}
        onFormChange={setForm}
        onSubmit={submitDialog}
        onPasswordReset={resetPasswordFromDialog}
      />
    </section>
  );
};

export default AdminUsersView;
