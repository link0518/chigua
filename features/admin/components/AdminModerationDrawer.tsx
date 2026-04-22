import React, { useEffect, useMemo, useState } from 'react';
import { Ban, Clock3, ShieldAlert, Undo2, X } from 'lucide-react';
import { roughBorderClass, Badge, SketchButton } from '@/components/SketchUI';
import AdminIdentityCompact from '@/components/AdminIdentityCompact';
import type { AdminIdentityLike } from '@/components/adminIdentity';
import type { AdminBanType } from '@/features/admin/types';

export type AdminModerationDurationId = '1h' | '1d' | '7d' | 'forever' | 'custom';

export type AdminModerationQuickPreset = {
  id: string;
  label: string;
  description?: string;
  permissions: string[];
  duration: AdminModerationDurationId;
};

export type AdminModerationExtraOption = {
  key: string;
  label: string;
  defaultChecked?: boolean;
};

export type AdminModerationSubmitPayload = {
  targetType: AdminBanType;
  targetValue: string;
  reason: string;
  permissions: string[];
  duration: AdminModerationDurationId;
  customUntil: string;
  expiresAt: number | null;
  extras: Record<string, boolean>;
};

export type AdminModerationDrawerConfig = {
  title: string;
  description?: string;
  summary?: string;
  identity?: AdminIdentityLike | null;
  target?: {
    type: AdminBanType;
    value: string;
    editable?: boolean;
  };
  showPermissionEditor?: boolean;
  defaultReason?: string;
  defaultPermissions?: string[];
  defaultDuration?: AdminModerationDurationId;
  defaultCustomUntil?: string;
  quickPresets?: AdminModerationQuickPreset[];
  extraOptions?: AdminModerationExtraOption[];
  submitLabel?: string;
  secondaryActionLabel?: string;
};

export type AdminModerationDrawerRequest = AdminModerationDrawerConfig & {
  onSubmit: (payload: AdminModerationSubmitPayload) => Promise<void> | void;
  onSecondaryAction?: (payload: AdminModerationSubmitPayload) => Promise<void> | void;
};

interface AdminModerationDrawerProps {
  isOpen: boolean;
  config: AdminModerationDrawerConfig | null;
  submitting?: boolean;
  onClose: () => void;
  onSubmit: (payload: AdminModerationSubmitPayload) => void;
  onSecondaryAction?: (payload: AdminModerationSubmitPayload) => void;
}

const BAN_PERMISSION_LABELS: Record<string, string> = {
  post: '发帖',
  comment: '评论',
  like: '点赞',
  view: '浏览',
  site: '站点',
  chat: '聊天室',
};

const ALL_BAN_PERMISSIONS = Object.keys(BAN_PERMISSION_LABELS);

const BAN_DURATION_OPTIONS: Array<{ id: AdminModerationDurationId; label: string; ms: number | null }> = [
  { id: '1h', label: '1 小时', ms: 60 * 60 * 1000 },
  { id: '1d', label: '1 天', ms: 24 * 60 * 60 * 1000 },
  { id: '7d', label: '7 天', ms: 7 * 24 * 60 * 60 * 1000 },
  { id: 'forever', label: '永久', ms: null },
  { id: 'custom', label: '自定义', ms: null },
];

const formatTargetType = (type: AdminBanType) => {
  switch (type) {
    case 'ip':
      return 'IP';
    case 'fingerprint':
      return '指纹';
    default:
      return '身份';
  }
};

const buildDefaultExtras = (extraOptions: AdminModerationExtraOption[] = []) => (
  extraOptions.reduce<Record<string, boolean>>((result, option) => {
    result[option.key] = Boolean(option.defaultChecked);
    return result;
  }, {})
);

const buildExpiresAt = (duration: AdminModerationDurationId, customUntil: string) => {
  const now = Date.now();
  if (duration === 'forever') {
    return null;
  }
  if (duration === 'custom') {
    if (!customUntil) {
      return null;
    }
    const timestamp = new Date(customUntil).getTime();
    return Number.isFinite(timestamp) && timestamp > now ? timestamp : null;
  }
  const option = BAN_DURATION_OPTIONS.find((item) => item.id === duration);
  if (!option?.ms) {
    return null;
  }
  return now + option.ms;
};

const AdminModerationDrawer: React.FC<AdminModerationDrawerProps> = ({
  isOpen,
  config,
  submitting = false,
  onClose,
  onSubmit,
  onSecondaryAction,
}) => {
  const [targetType, setTargetType] = useState<AdminBanType>('identity');
  const [targetValue, setTargetValue] = useState('');
  const [reason, setReason] = useState('');
  const [permissions, setPermissions] = useState<string[]>(ALL_BAN_PERMISSIONS);
  const [duration, setDuration] = useState<AdminModerationDurationId>('7d');
  const [customUntil, setCustomUntil] = useState('');
  const [extras, setExtras] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!isOpen || !config) {
      return;
    }
    setTargetType(config.target?.type || 'identity');
    setTargetValue(config.target?.value || '');
    setReason(config.defaultReason || '');
    setPermissions(config.defaultPermissions?.length ? config.defaultPermissions : ALL_BAN_PERMISSIONS);
    setDuration(config.defaultDuration || '7d');
    setCustomUntil(config.defaultCustomUntil || '');
    setExtras(buildDefaultExtras(config.extraOptions));
  }, [config, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose, submitting]);

  const expiresAt = useMemo(
    () => buildExpiresAt(duration, customUntil),
    [customUntil, duration]
  );

  const permissionPreview = useMemo(
    () => (permissions.length ? permissions : ALL_BAN_PERMISSIONS).map((item) => BAN_PERMISSION_LABELS[item] || item),
    [permissions]
  );

  const submitPayload = useMemo<AdminModerationSubmitPayload>(() => ({
    targetType,
    targetValue: targetValue.trim(),
    reason: reason.trim(),
    permissions,
    duration,
    customUntil,
    expiresAt,
    extras,
  }), [customUntil, duration, expiresAt, extras, permissions, reason, targetType, targetValue]);

  if (!isOpen || !config) {
    return null;
  }

  const showPermissionEditor = config.showPermissionEditor !== false;
  const targetRequired = Boolean(config.target);
  const targetEditable = Boolean(config.target?.editable);
  const primaryDisabled = submitting
    || (targetRequired && !targetValue.trim())
    || (showPermissionEditor && permissions.length === 0)
    || (showPermissionEditor && duration === 'custom' && !expiresAt);

  const togglePermission = (permission: string) => {
    setPermissions((current) => (
      current.includes(permission)
        ? current.filter((item) => item !== permission)
        : [...current, permission]
    ));
  };

  const applyQuickPreset = (preset: AdminModerationQuickPreset) => {
    setPermissions(preset.permissions);
    setDuration(preset.duration);
    if (preset.duration !== 'custom') {
      setCustomUntil('');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] bg-black/45 backdrop-blur-sm"
      onClick={() => {
        if (!submitting) {
          onClose();
        }
      }}
    >
      <div
        className={`absolute inset-y-3 right-3 w-[calc(100vw-1.5rem)] max-w-2xl overflow-hidden border-2 border-ink bg-white shadow-sketch-lg ${roughBorderClass}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex h-full max-h-[calc(100vh-1.5rem)] flex-col">
          <div className="border-b-2 border-dashed border-ink/20 px-5 py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge color="bg-highlight">
                    <ShieldAlert size={12} className="mr-1" />
                    违规处置
                  </Badge>
                  {config.secondaryActionLabel && (
                    <Badge color="bg-gray-100">
                      <Undo2 size={12} className="mr-1" />
                      支持解封
                    </Badge>
                  )}
                </div>
                <h2 className="text-2xl font-display text-ink">{config.title}</h2>
                {config.description && (
                  <p className="mt-2 text-sm font-sans text-pencil">{config.description}</p>
                )}
              </div>
              <button
                type="button"
                className="rounded-full border-2 border-ink bg-white p-2 shadow-sketch transition-all hover:-translate-y-0.5 hover:bg-gray-50"
                onClick={onClose}
                disabled={submitting}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            <div className="flex flex-col gap-4">
              {config.summary && (
                <div className="rounded-2xl border border-dashed border-ink/30 bg-gray-50 px-4 py-3">
                  <div className="mb-2 flex items-center gap-2 text-xs font-bold text-pencil">
                    <Ban size={12} />
                    处置上下文
                  </div>
                  <p className="text-sm font-sans leading-6 text-ink">“{config.summary}”</p>
                </div>
              )}

              {config.identity && (
                <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3">
                  <p className="mb-2 text-xs font-bold text-pencil">关联身份</p>
                  <div className="text-sm font-sans text-ink">
                    <AdminIdentityCompact
                      identity={config.identity}
                      label={null}
                      showAliases
                      showIp
                      showSession={false}
                      actions={undefined}
                    />
                  </div>
                </div>
              )}

              {config.target && (
                <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3">
                  <p className="mb-3 text-xs font-bold text-pencil">封禁对象</p>
                  <div className="grid gap-3 md:grid-cols-[132px_1fr]">
                    <select
                      value={targetType}
                      disabled={!targetEditable}
                      onChange={(event) => setTargetType(event.target.value as AdminBanType)}
                      className="h-10 rounded-xl border-2 border-gray-200 px-3 text-sm font-sans outline-none focus:border-ink disabled:cursor-not-allowed disabled:bg-gray-50"
                    >
                      <option value="identity">身份</option>
                      <option value="fingerprint">指纹</option>
                      <option value="ip">IP</option>
                    </select>
                    <input
                      value={targetValue}
                      disabled={!targetEditable}
                      onChange={(event) => setTargetValue(event.target.value)}
                      className="h-10 rounded-xl border-2 border-gray-200 px-3 text-sm font-sans outline-none focus:border-ink disabled:cursor-not-allowed disabled:bg-gray-50"
                      placeholder={`输入需要处置的${formatTargetType(targetType)}`}
                    />
                  </div>
                </div>
              )}

              {showPermissionEditor && config.quickPresets && config.quickPresets.length > 0 && (
                <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3">
                  <p className="mb-3 text-xs font-bold text-pencil">快捷方案</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {config.quickPresets.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => applyQuickPreset(preset)}
                        className="rounded-2xl border border-dashed border-ink/25 bg-gray-50 px-3 py-3 text-left transition-all hover:-translate-y-0.5 hover:border-ink hover:bg-highlight/10"
                      >
                        <div className="text-sm font-bold text-ink">{preset.label}</div>
                        {preset.description && (
                          <div className="mt-1 text-xs font-sans leading-5 text-pencil">{preset.description}</div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {showPermissionEditor && (
                <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3">
                  <p className="mb-3 text-xs font-bold text-pencil">高级设置</p>
                  <div className="mb-4 flex flex-wrap gap-2">
                    {ALL_BAN_PERMISSIONS.map((permission) => {
                      const active = permissions.includes(permission);
                      return (
                        <button
                          key={permission}
                          type="button"
                          onClick={() => togglePermission(permission)}
                          className={`rounded-full border px-3 py-1.5 text-xs font-bold transition-all ${active ? 'border-ink bg-highlight text-ink' : 'border-gray-300 bg-white text-gray-600 hover:border-ink hover:text-ink'}`}
                        >
                          {BAN_PERMISSION_LABELS[permission]}
                        </button>
                      );
                    })}
                  </div>
                  <div className="grid gap-3 md:grid-cols-[180px_1fr]">
                    <select
                      value={duration}
                      onChange={(event) => setDuration(event.target.value as AdminModerationDurationId)}
                      className="h-10 rounded-xl border-2 border-gray-200 px-3 text-sm font-sans outline-none focus:border-ink"
                    >
                      {BAN_DURATION_OPTIONS.map((option) => (
                        <option key={option.id} value={option.id}>{option.label}</option>
                      ))}
                    </select>
                    {duration === 'custom' ? (
                      <input
                        type="datetime-local"
                        value={customUntil}
                        onChange={(event) => setCustomUntil(event.target.value)}
                        className="h-10 rounded-xl border-2 border-gray-200 px-3 text-sm font-sans outline-none focus:border-ink"
                      />
                    ) : (
                      <div className="flex items-center rounded-xl border border-dashed border-ink/20 bg-gray-50 px-3 text-sm font-sans text-pencil">
                        <Clock3 size={14} className="mr-2" />
                        {duration === 'forever' ? '当前为永久封禁' : '当前按预设时长执行'}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {config.extraOptions && config.extraOptions.length > 0 && (
                <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3">
                  <p className="mb-3 text-xs font-bold text-pencil">附带处理</p>
                  <div className="flex flex-col gap-2">
                    {config.extraOptions.map((option) => (
                      <label key={option.key} className="flex items-center gap-2 text-sm font-sans text-pencil">
                        <input
                          type="checkbox"
                          className="accent-black"
                          checked={Boolean(extras[option.key])}
                          onChange={(event) => setExtras((current) => ({ ...current, [option.key]: event.target.checked }))}
                        />
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="rounded-2xl border border-dashed border-ink/25 bg-highlight/10 px-4 py-3">
                <p className="mb-2 text-xs font-bold text-pencil">结果预览</p>
                <div className="flex flex-wrap items-center gap-2">
                  {permissionPreview.map((item) => (
                    <Badge key={item} color="bg-white">{item}</Badge>
                  ))}
                  {showPermissionEditor && (
                    <Badge color="bg-white">{duration === 'forever' ? '永久' : duration === 'custom' ? '自定义' : BAN_DURATION_OPTIONS.find((item) => item.id === duration)?.label}</Badge>
                  )}
                </div>
              </div>

              <div>
                <label className="mb-2 block text-xs font-bold text-pencil">处理原因（可选）</label>
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  className="h-24 w-full resize-none rounded-2xl border-2 border-gray-200 p-3 text-sm font-sans outline-none focus:border-ink"
                  placeholder="写明原因，便于审计与回溯"
                />
              </div>
            </div>
          </div>

          <div className="border-t-2 border-dashed border-ink/20 px-5 py-4">
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <SketchButton
                variant="secondary"
                className="h-10 px-4 text-sm"
                onClick={onClose}
                disabled={submitting}
              >
                取消
              </SketchButton>
              {config.secondaryActionLabel && onSecondaryAction && (
                <SketchButton
                  variant="secondary"
                  className="h-10 px-4 text-sm"
                  onClick={() => onSecondaryAction(submitPayload)}
                  disabled={submitting || (targetRequired && !targetValue.trim())}
                >
                  {config.secondaryActionLabel}
                </SketchButton>
              )}
              <SketchButton
                variant="danger"
                className="h-10 px-4 text-sm"
                onClick={() => onSubmit(submitPayload)}
                disabled={primaryDisabled}
              >
                {submitting ? '提交中...' : (config.submitLabel || '确认封禁')}
              </SketchButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminModerationDrawer;
