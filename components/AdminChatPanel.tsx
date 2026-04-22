import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, MessageSquare, Search, Shield, Trash2 } from 'lucide-react';
import { api } from '../api';
import type { AdminChatOnlineUser, ChatMessage, ChatMuteEntry, ChatRoomConfig } from '../types';
import AdminIdentityCompact from './AdminIdentityCompact';
import {
  type AdminIdentityBanTargetType,
  type AdminIdentityField,
  type AdminIdentityLike,
  getAdminIdentitySearchValues,
} from './adminIdentity';
import MarkdownRenderer from './MarkdownRenderer';
import { SketchButton } from './SketchUI';
import type {
  AdminModerationDrawerRequest,
  AdminModerationDurationId,
  AdminModerationQuickPreset,
  AdminModerationSubmitPayload,
} from '@/features/admin/components/AdminModerationDrawer';

type ToastType = 'success' | 'error' | 'info' | 'warning';
type AdminChatMessage = ChatMessage & {
  fingerprintHash?: string;
  identityKey?: string | null;
  identityHashes?: string[];
  ip?: string;
};

interface AdminChatPanelProps {
  showToast: (message: string, type?: ToastType) => void;
  onPrepareBan?: (type: AdminIdentityBanTargetType, value: string) => void;
  onOpenModeration?: (request: AdminModerationDrawerRequest) => void;
}

const REFRESH_INTERVAL_MS = 5000;

const formatTime = (value: number | null | undefined) => {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN');
};

const normalizeSearch = (value: string) => String(value || '').trim().toLowerCase();
const toDatetimeLocalValue = (timestamp: number) => {
  const date = new Date(timestamp);
  const offset = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};
const toPositiveInt = (value: unknown, fallback: number) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(1, Math.trunc(num));
};
const toNonNegativeInt = (value: unknown, fallback: number) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.trunc(num));
};
const DEFAULT_CHAT_CONFIG: ChatRoomConfig = {
  chatEnabled: true,
  muteAll: false,
  adminOnly: false,
  messageIntervalMs: 2000,
  maxTextLength: 500,
};
const CHAT_ONLY_PERMISSIONS = ['chat'];
const SITE_BAN_PERMISSIONS = ['post', 'comment', 'like', 'view', 'site', 'chat'];
const CHAT_BAN_PRESETS: AdminModerationQuickPreset[] = [
  { id: 'chat-1d', label: '聊天室 1 天', permissions: CHAT_ONLY_PERMISSIONS, duration: '1d' },
  { id: 'chat-7d', label: '聊天室 7 天', permissions: CHAT_ONLY_PERMISSIONS, duration: '7d' },
  { id: 'site-7d', label: '全站 7 天', permissions: SITE_BAN_PERMISSIONS, duration: '7d' },
  { id: 'site-forever', label: '永久封禁', permissions: SITE_BAN_PERMISSIONS, duration: 'forever' },
];
const normalizeChatConfig = (input: any): ChatRoomConfig => ({
  chatEnabled: typeof input?.chatEnabled === 'boolean' ? input.chatEnabled : DEFAULT_CHAT_CONFIG.chatEnabled,
  muteAll: Boolean(input?.muteAll),
  adminOnly: Boolean(input?.adminOnly),
  messageIntervalMs: toNonNegativeInt(input?.messageIntervalMs, DEFAULT_CHAT_CONFIG.messageIntervalMs),
  maxTextLength: toPositiveInt(input?.maxTextLength, DEFAULT_CHAT_CONFIG.maxTextLength),
});

const includesSearch = (query: string, fields: Array<string | number | null | undefined>) => {
  if (!query) {
    return true;
  }
  return fields.some((field) => String(field || '').toLowerCase().includes(query));
};

const resolveDurationDefaultsFromMinutes = (minutes: number) => {
  const safeMinutes = Math.max(1, Math.trunc(minutes));
  if (safeMinutes === 60) {
    return { defaultDuration: '1h' as AdminModerationDurationId, defaultCustomUntil: '' };
  }
  if (safeMinutes === 24 * 60) {
    return { defaultDuration: '1d' as AdminModerationDurationId, defaultCustomUntil: '' };
  }
  if (safeMinutes === 7 * 24 * 60) {
    return { defaultDuration: '7d' as AdminModerationDurationId, defaultCustomUntil: '' };
  }
  return {
    defaultDuration: 'custom' as AdminModerationDurationId,
    defaultCustomUntil: toDatetimeLocalValue(Date.now() + safeMinutes * 60 * 1000),
  };
};

const getActionIdentityValue = (identity: {
  identityKey?: string | null;
  fingerprintHash?: string | null;
}) => String(identity.identityKey || identity.fingerprintHash || '').trim();

const AdminChatPanel: React.FC<AdminChatPanelProps> = ({ showToast, onPrepareBan, onOpenModeration }) => {
  const [onlineUsers, setOnlineUsers] = useState<AdminChatOnlineUser[]>([]);
  const [onlineCount, setOnlineCount] = useState(0);
  const [messages, setMessages] = useState<AdminChatMessage[]>([]);
  const [mutes, setMutes] = useState<ChatMuteEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [manualIdentityValue, setManualIdentityValue] = useState('');
  const [manualReason, setManualReason] = useState('');
  const [manualScope, setManualScope] = useState<'chat' | 'site'>('chat');
  const [manualMuteMinutes, setManualMuteMinutes] = useState(30);
  const [manualBanDays, setManualBanDays] = useState(7);
  const [messageMuteMinutes, setMessageMuteMinutes] = useState(30);
  const [messageBanMinutes, setMessageBanMinutes] = useState(7 * 24 * 60);
  const [messageBanScope, setMessageBanScope] = useState<'chat' | 'site'>('chat');
  const [busyKey, setBusyKey] = useState('');
  const [chatConfig, setChatConfig] = useState<ChatRoomConfig>(DEFAULT_CHAT_CONFIG);
  const [configChatEnabled, setConfigChatEnabled] = useState(true);
  const [configMuteAll, setConfigMuteAll] = useState(false);
  const [configAdminOnly, setConfigAdminOnly] = useState(false);
  const [configIntervalSeconds, setConfigIntervalSeconds] = useState(2);
  const [configMaxTextLength, setConfigMaxTextLength] = useState(500);

  const fetchAll = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
    }
    try {
      const [onlineRes, messageRes, muteRes, configRes] = await Promise.all([
        api.getAdminChatOnline(),
        api.getAdminChatMessages({ limit: 120, includeDeleted: 1 }),
        api.getAdminChatMutes(),
        api.getAdminChatConfig(),
      ]);
      setOnlineCount(Number(onlineRes?.onlineCount || 0));
      setOnlineUsers(Array.isArray(onlineRes?.users) ? onlineRes.users : []);
      setMessages(Array.isArray(messageRes?.items) ? messageRes.items : []);
      setMutes(Array.isArray(muteRes?.items) ? muteRes.items : []);
      const normalizedConfig = normalizeChatConfig(configRes);
      setChatConfig(normalizedConfig);
      if (!silent) {
        setConfigChatEnabled(normalizedConfig.chatEnabled);
        setConfigMuteAll(normalizedConfig.muteAll);
        setConfigAdminOnly(normalizedConfig.adminOnly);
        setConfigIntervalSeconds(Math.max(0, Math.trunc(normalizedConfig.messageIntervalMs / 1000)));
        setConfigMaxTextLength(normalizedConfig.maxTextLength);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '聊天室管理数据加载失败';
      showToast(message, 'error');
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [showToast]);

  useEffect(() => {
    fetchAll().catch(() => { });
    const timer = window.setInterval(() => {
      fetchAll(true).catch(() => { });
    }, REFRESH_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [fetchAll]);

  const runAction = useCallback(async (
    key: string,
    action: () => Promise<any>,
    success: string,
  ) => {
    if (busyKey) return;
    setBusyKey(key);
    try {
      await action();
      showToast(success, 'success');
      await fetchAll(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : '操作失败，请稍后重试';
      showToast(message, 'error');
    } finally {
      setBusyKey('');
    }
  }, [busyKey, fetchAll, showToast]);

  const applyMute = useCallback((identityValue: string, minutes: number, reason: string) => {
    const safeMinutes = Math.max(1, Math.trunc(minutes));
    return runAction(
      `mute:${identityValue}`,
      () => api.muteAdminChatUser(identityValue, { durationMinutes: safeMinutes, reason }),
      '已执行禁言',
    );
  }, [runAction]);

  const applyKick = useCallback((identityValue: string, reason: string) => {
    return runAction(
      `kick:${identityValue}`,
      () => api.kickAdminChatUser(identityValue, reason),
      '已踢出用户',
    );
  }, [runAction]);

  const applyBan = useCallback((params: {
    identityValue: string;
    durationMinutes: number;
    scope: 'chat' | 'site';
    reason?: string;
    ip?: string;
  }) => {
    const identityValue = String(params.identityValue || '').trim();
    if (!identityValue) {
      showToast('缺少身份，无法执行封禁', 'warning');
      return Promise.resolve();
    }
    const durationMinutes = toPositiveInt(params.durationMinutes, 7 * 24 * 60);
    const scope = params.scope === 'site' ? 'site' : 'chat';
    const reason = String(params.reason || '').trim();
    const ip = String(params.ip || '').trim();
    return runAction(
      `ban:${identityValue}`,
      () => api.banAdminChatUser(identityValue, { durationMinutes, scope, reason, ip }),
      scope === 'site' ? '已封禁站点访问' : '已封禁聊天室',
    );
  }, [runAction, showToast]);


  const openBanDrawer = useCallback((params: {
    title: string;
    summary?: string;
    identity?: AdminIdentityLike | null;
    targetType?: AdminIdentityBanTargetType;
    targetValue: string;
    editableTarget?: boolean;
    reason?: string;
    durationMinutes?: number;
    permissions?: string[];
    ip?: string;
    allowUnban?: boolean;
  }) => {
    const value = String(params.targetValue || '').trim();
    if (!value) {
      showToast('缺少身份，无法执行封禁', 'warning');
      return;
    }
    if (!onOpenModeration) {
      const permissions = params.permissions?.length ? params.permissions : CHAT_ONLY_PERMISSIONS;
      const scope = permissions.length === 1 && permissions[0] === 'chat' ? 'chat' : 'site';
      applyBan({
        identityValue: value,
        durationMinutes: Math.max(1, Math.trunc(params.durationMinutes || 7 * 24 * 60)),
        scope,
        reason: params.reason,
        ip: params.ip,
      });
      return;
    }
    const defaults = resolveDurationDefaultsFromMinutes(Math.max(1, Math.trunc(params.durationMinutes || 7 * 24 * 60)));
    onOpenModeration({
      title: params.title,
      description: params.targetType === 'ip'
        ? '按 IP 执行通用封禁。'
        : '默认沿用聊天室封禁逻辑，会同步处理身份链与 IP。',
      summary: params.summary,
      identity: params.identity,
      target: {
        type: params.targetType || 'identity',
        value,
        editable: Boolean(params.editableTarget),
      },
      defaultReason: params.reason || '',
      defaultPermissions: params.permissions?.length ? params.permissions : CHAT_ONLY_PERMISSIONS,
      defaultDuration: defaults.defaultDuration,
      defaultCustomUntil: defaults.defaultCustomUntil,
      quickPresets: CHAT_BAN_PRESETS,
      submitLabel: '确认封禁',
      secondaryActionLabel: params.allowUnban ? '解除封禁' : undefined,
      onSubmit: async (payload: AdminModerationSubmitPayload) => {
        const targetValue = payload.targetValue.trim();
        if (!targetValue) {
          throw new Error('缺少身份，无法执行封禁');
        }
        if (payload.targetType === 'ip') {
          await api.handleAdminBan('ban', 'ip', targetValue, payload.reason.trim(), {
            permissions: payload.permissions,
            expiresAt: payload.expiresAt,
          });
        } else {
          const permissions = payload.permissions.length ? payload.permissions : CHAT_ONLY_PERMISSIONS;
          const scope = permissions.length === 1 && permissions[0] === 'chat' ? 'chat' : 'site';
          await api.banAdminChatUser(targetValue, {
            expiresAt: payload.expiresAt,
            permissions,
            scope,
            reason: payload.reason.trim(),
            ip: String(params.ip || '').trim(),
            identityType: payload.targetType,
          });
        }
        showToast(payload.permissions.length === 1 && payload.permissions[0] === 'chat' ? '已封禁聊天室' : '已封禁站点访问', 'success');
        await fetchAll(true);
      },
      onSecondaryAction: params.allowUnban ? async (payload: AdminModerationSubmitPayload) => {
        const targetValue = payload.targetValue.trim();
        if (!targetValue) {
          throw new Error('缺少身份，无法解除封禁');
        }
        if (payload.targetType === 'ip') {
          await api.handleAdminBan('unban', 'ip', targetValue, payload.reason.trim());
        } else {
          await api.unbanAdminChatUser(targetValue, payload.reason.trim(), {
            identityType: payload.targetType,
            ip: String(params.ip || '').trim(),
          });
        }
        showToast('已解除封禁', 'success');
        await fetchAll(true);
      } : undefined,
    });
  }, [applyBan, fetchAll, onOpenModeration, showToast]);

  const saveChatConfig = useCallback(() => {
    const safeIntervalSeconds = Math.min(60, toNonNegativeInt(configIntervalSeconds, 2));
    const safeMaxTextLength = Math.min(2000, Math.max(20, toPositiveInt(configMaxTextLength, 500)));
    return runAction(
      'chat-config:update',
      () => api.updateAdminChatConfig({
        chatEnabled: configChatEnabled,
        muteAll: configMuteAll,
        adminOnly: configAdminOnly,
        messageIntervalMs: safeIntervalSeconds * 1000,
        maxTextLength: safeMaxTextLength,
      }),
      '聊天室配置已更新',
    );
  }, [configAdminOnly, configChatEnabled, configIntervalSeconds, configMaxTextLength, configMuteAll, runAction]);

  const activeMuteSet = useMemo(() => {
    return new Set(mutes.map((item) => getActionIdentityValue(item)));
  }, [mutes]);

  const search = useMemo(() => normalizeSearch(searchQuery), [searchQuery]);
  const handleIdentitySearch = useCallback((field: AdminIdentityField) => {
    setSearchQuery(field.value);
  }, []);
  const handleIdentityBanPrepare = useCallback((field: AdminIdentityField & { type: AdminIdentityBanTargetType }) => {
    onPrepareBan?.(field.type, field.value);
  }, [onPrepareBan]);
  const openIdentityFieldBanDrawer = useCallback((
    field: AdminIdentityField & { type: AdminIdentityBanTargetType },
    options: {
      title: string;
      summary?: string;
      identity?: AdminIdentityLike | null;
      reason?: string;
      durationMinutes?: number;
      permissions?: string[];
      ip?: string;
      allowUnban?: boolean;
    }
  ) => {
    if (onOpenModeration) {
      openBanDrawer({
        title: options.title,
        summary: options.summary,
        identity: options.identity,
        targetType: field.type,
        targetValue: field.value,
        reason: options.reason,
        durationMinutes: options.durationMinutes,
        permissions: options.permissions,
        ip: options.ip,
        allowUnban: options.allowUnban,
      });
      return;
    }
    handleIdentityBanPrepare(field);
  }, [handleIdentityBanPrepare, onOpenModeration, openBanDrawer]);
  const renderIpActions = useCallback((ip?: string) => {
    const value = String(ip || '').trim();
    if (!value) {
      return null;
    }
    return (
      <span className="ml-2 inline-flex items-center gap-1">
        <button
          type="button"
          onClick={() => setSearchQuery(value)}
          className="rounded border border-gray-300 px-1.5 py-0.5 text-[10px] font-bold text-gray-600 hover:border-ink hover:text-ink"
        >
          搜索
        </button>
        {(onOpenModeration || onPrepareBan) && (
          <button
            type="button"
            onClick={() => {
              if (onOpenModeration) {
                openBanDrawer({
                  title: 'IP 封禁',
                  targetType: 'ip',
                  targetValue: value,
                  permissions: SITE_BAN_PERMISSIONS,
                  durationMinutes: 7 * 24 * 60,
                  allowUnban: true,
                });
                return;
              }
              onPrepareBan?.('ip', value);
            }}
            className="rounded border border-gray-300 px-1.5 py-0.5 text-[10px] font-bold text-gray-600 hover:border-ink hover:text-ink"
          >
            封禁
          </button>
        )}
      </span>
    );
  }, [onOpenModeration, onPrepareBan, openBanDrawer]);

  const filteredOnlineUsers = useMemo(() => {
    if (!search) {
      return onlineUsers;
    }
    return onlineUsers.filter((user) => includesSearch(search, [
      user.nickname,
      ...getAdminIdentitySearchValues(user),
      user.sessionId,
      user.connections,
      formatTime(user.joinedAt),
    ]));
  }, [onlineUsers, search]);

  const filteredMutes = useMemo(() => {
    if (!search) {
      return mutes;
    }
    return mutes.filter((item) => includesSearch(search, [
      ...getAdminIdentitySearchValues(item),
      item.reason,
      formatTime(item.mutedUntil),
    ]));
  }, [mutes, search]);

  const filteredMessages = useMemo(() => {
    if (!search) {
      return messages;
    }
    return messages.filter((message) => includesSearch(search, [
      message.id,
      message.nickname,
      message.content,
      message.imageUrl,
      message.stickerCode,
      ...getAdminIdentitySearchValues(message),
      formatTime(message.createdAt),
    ]));
  }, [messages, search]);

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-2xl text-ink flex items-center gap-2">
            <MessageSquare size={22} />
            聊天室管理
          </h3>
          <p className="text-xs text-pencil font-sans mt-1">
            在线人数 {onlineCount}，在线用户 {onlineUsers.length}，消息 {messages.length}
          </p>
        </div>
        <div className="flex w-full sm:w-auto items-center gap-2">
          <div className="relative flex-1 sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-pencil w-4 h-4" />
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="搜索昵称/ID/内容/IP/身份..."
              className="h-9 w-full rounded-full border-2 border-ink bg-white pl-9 pr-3 text-xs font-sans outline-none focus:shadow-sketch-sm"
            />
          </div>
          <SketchButton
            variant="secondary"
            className="h-9 px-3 text-xs shrink-0"
            onClick={() => fetchAll().catch(() => { })}
          >
            {loading ? '刷新中...' : '刷新'}
          </SketchButton>
        </div>
      </div>

      <div className="bg-white border-2 border-ink rounded-lg p-4 shadow-sketch-sm flex flex-col gap-3">
        <p className="text-sm font-bold text-ink font-sans">聊天室发言规则</p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <label className="h-9 px-3 rounded-lg border border-gray-200 text-xs text-pencil font-sans inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={configChatEnabled}
              onChange={(event) => setConfigChatEnabled(event.target.checked)}
            />
            开启聊天室（关闭后用户无法进入）
          </label>
          <label className="h-9 px-3 rounded-lg border border-gray-200 text-xs text-pencil font-sans inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={configMuteAll}
              onChange={(event) => setConfigMuteAll(event.target.checked)}
            />
            全体禁言（管理员也不可发言）
          </label>
          <label className="h-9 px-3 rounded-lg border border-gray-200 text-xs text-pencil font-sans inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={configAdminOnly}
              onChange={(event) => setConfigAdminOnly(event.target.checked)}
            />
            仅管理员可发言
          </label>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-center">
          <label className="text-xs text-pencil font-sans flex items-center gap-2">
            发言间隔（秒）
            <input
              type="number"
              min={0}
              max={60}
              value={configIntervalSeconds}
              onChange={(event) => setConfigIntervalSeconds(toNonNegativeInt(event.target.value, 2))}
              className="h-8 border border-gray-300 rounded px-2 w-24 text-xs"
            />
          </label>
          <label className="text-xs text-pencil font-sans flex items-center gap-2">
            最大字数
            <input
              type="number"
              min={20}
              max={2000}
              value={configMaxTextLength}
              onChange={(event) => setConfigMaxTextLength(toPositiveInt(event.target.value, 500))}
              className="h-8 border border-gray-300 rounded px-2 w-24 text-xs"
            />
          </label>
          <div className="text-xs text-pencil font-sans">
            当前生效：{chatConfig.chatEnabled ? '已开启' : '已关闭'}，{Math.max(0, Math.trunc(chatConfig.messageIntervalMs / 1000))} 秒/条，{chatConfig.maxTextLength} 字
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SketchButton
            variant="secondary"
            className="h-8 px-3 text-xs"
            disabled={Boolean(busyKey)}
            onClick={() => saveChatConfig()}
          >
            保存聊天室配置
          </SketchButton>
          <span className="text-[11px] text-pencil font-sans">配置保存后会立即推送到在线聊天室。</span>
        </div>
      </div>

      <div className="bg-white border-2 border-ink rounded-lg p-4 shadow-sketch-sm flex flex-col gap-3">
        <p className="text-sm font-bold text-ink font-sans">手动操作</p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <input
            value={manualIdentityValue}
            onChange={(event) => setManualIdentityValue(event.target.value.trim())}
            placeholder="输入新身份或指纹"
            className="h-9 border-2 border-gray-200 rounded-lg px-3 text-xs font-sans focus:border-ink outline-none"
          />
          <input
            value={manualReason}
            onChange={(event) => setManualReason(event.target.value)}
            placeholder="理由（可选）"
            className="h-9 border-2 border-gray-200 rounded-lg px-3 text-xs font-sans focus:border-ink outline-none"
          />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_1fr_1fr] gap-2 items-center">
          <label className="text-xs text-pencil font-sans flex items-center gap-2">
            禁言分钟
            <input
              type="number"
              min={1}
              value={manualMuteMinutes}
              onChange={(event) => setManualMuteMinutes(Number(event.target.value || 30))}
              className="h-8 border border-gray-300 rounded px-2 w-20 text-xs"
            />
          </label>
          <label className="text-xs text-pencil font-sans flex items-center gap-2">
            封禁天数
            <input
              type="number"
              min={1}
              value={manualBanDays}
              onChange={(event) => setManualBanDays(Number(event.target.value || 7))}
              className="h-8 border border-gray-300 rounded px-2 w-20 text-xs"
            />
          </label>
          <label className="text-xs text-pencil font-sans flex items-center gap-2">
            封禁范围
            <select
              value={manualScope}
              onChange={(event) => setManualScope(event.target.value === 'site' ? 'site' : 'chat')}
              className="h-8 border border-gray-300 rounded px-2 text-xs"
            >
              <option value="chat">仅聊天室</option>
              <option value="site">全站</option>
            </select>
          </label>
          <div className="text-xs text-pencil font-sans">按钮默认作用于上方输入的新身份或指纹</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SketchButton
            variant="secondary"
            className="h-8 px-3 text-xs"
            disabled={!manualIdentityValue || Boolean(busyKey)}
            onClick={() => applyMute(manualIdentityValue, manualMuteMinutes, manualReason)}
          >
            禁言
          </SketchButton>
          <SketchButton
            variant="secondary"
            className="h-8 px-3 text-xs"
            disabled={!manualIdentityValue || Boolean(busyKey)}
            onClick={() => runAction(
              `unmute:${manualIdentityValue}`,
              () => api.unmuteAdminChatUser(manualIdentityValue, manualReason),
              '已解除禁言',
            )}
          >
            解除禁言
          </SketchButton>
          <SketchButton
            variant="secondary"
            className="h-8 px-3 text-xs"
            disabled={!manualIdentityValue || Boolean(busyKey)}
            onClick={() => applyKick(manualIdentityValue, manualReason)}
          >
            踢出
          </SketchButton>
          <SketchButton
            variant="secondary"
            className="h-8 px-3 text-xs"
            disabled={!manualIdentityValue || Boolean(busyKey)}
            onClick={() => openBanDrawer({
              title: '聊天室封禁处置',
              targetValue: manualIdentityValue,
              editableTarget: true,
              reason: manualReason,
              durationMinutes: toPositiveInt(manualBanDays, 7) * 24 * 60,
              permissions: manualScope === 'site' ? SITE_BAN_PERMISSIONS : CHAT_ONLY_PERMISSIONS,
              allowUnban: true,
            })}
          >
            封禁处置
          </SketchButton>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="bg-white border-2 border-ink rounded-lg p-4 shadow-sketch-sm">
          <h4 className="font-display text-lg text-ink mb-3">在线用户</h4>
          {filteredOnlineUsers.length === 0 ? (
            <p className="text-sm text-pencil font-hand">{search ? '没有匹配的在线用户' : '暂无在线用户'}</p>
          ) : (
            <div className="space-y-3 max-h-[420px] overflow-auto pr-1">
              {filteredOnlineUsers.map((user) => (
                <div key={`${user.fingerprintHash}-${user.sessionId}`} className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                  <div className="grid grid-cols-1 gap-3">
                    <div className="text-xs font-sans text-pencil space-y-1 min-w-0">
                      <p className="break-all"><span className="font-bold text-ink">昵称：</span>{user.nickname}</p>
                      <AdminIdentityCompact
                        identity={user}
                        label="身份"
                        showSession={false}
                        actions={{
                          onSearch: handleIdentitySearch,
                          onBan: (field) => openIdentityFieldBanDrawer(field, {
                            title: field.type === 'ip' ? 'IP 封禁' : '聊天室封禁处置',
                            identity: user,
                            durationMinutes: 7 * 24 * 60,
                            permissions: field.type === 'ip' ? SITE_BAN_PERMISSIONS : CHAT_ONLY_PERMISSIONS,
                            allowUnban: true,
                          }),
                        }}
                      />
                      <p className="break-all"><span className="font-bold text-ink">会话：</span>{user.sessionId}</p>
                      <p><span className="font-bold text-ink">连接：</span>{user.connections}</p>
                      <p><span className="font-bold text-ink">加入：</span>{formatTime(user.joinedAt)}</p>
                      <p><span className="font-bold text-ink">状态：</span>{activeMuteSet.has(getActionIdentityValue(user)) ? '禁言中' : '正常'}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>


        <div className="bg-white border-2 border-ink rounded-lg p-4 shadow-sketch-sm">
          <h4 className="font-display text-lg text-ink mb-3">当前禁言</h4>
          {filteredMutes.length === 0 ? (
            <p className="text-sm text-pencil font-hand">{search ? '没有匹配的禁言记录' : '暂无禁言记录'}</p>
          ) : (
            <div className="space-y-2 max-h-[420px] overflow-auto pr-1">
              {filteredMutes.map((item) => (
                <div key={item.identityKey || item.fingerprintHash} className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                  <AdminIdentityCompact
                    identity={item}
                    label="身份"
                    actions={{
                      onSearch: handleIdentitySearch,
                      onBan: (field) => openIdentityFieldBanDrawer(field, {
                        title: field.type === 'ip' ? 'IP 封禁' : '禁言转封禁',
                        summary: item.reason || undefined,
                        identity: item,
                        reason: field.type === 'ip' ? item.reason || '' : '禁言转封禁',
                        durationMinutes: 7 * 24 * 60,
                        permissions: field.type === 'ip' ? SITE_BAN_PERMISSIONS : CHAT_ONLY_PERMISSIONS,
                        allowUnban: true,
                      }),
                    }}
                  />
                  <p className="text-xs text-pencil font-sans">截止：{formatTime(item.mutedUntil)}</p>
                  {item.reason && <p className="text-xs text-pencil font-sans break-all">理由：{item.reason}</p>}
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <SketchButton
                      variant="secondary"
                      className="h-7 px-2 text-[11px]"
                      disabled={Boolean(busyKey)}
                      onClick={() => runAction(
                        `unmute:${getActionIdentityValue(item)}`,
                        () => api.unmuteAdminChatUser(getActionIdentityValue(item), '管理员解除禁言'),
                        '已解除禁言',
                      )}
                    >
                      解除禁言
                    </SketchButton>
                    <SketchButton
                      variant="secondary"
                      className="h-7 px-2 text-[11px]"
                      disabled={Boolean(busyKey)}
                      onClick={() => openBanDrawer({
                        title: '禁言转封禁',
                        summary: item.reason || undefined,
                        identity: item,
                        targetValue: getActionIdentityValue(item),
                        reason: '禁言转封禁',
                        durationMinutes: 7 * 24 * 60,
                        permissions: CHAT_ONLY_PERMISSIONS,
                        allowUnban: true,
                      })}
                    >
                      转封禁
                    </SketchButton>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="bg-white border-2 border-ink rounded-lg p-4 shadow-sketch-sm">
        <h4 className="font-display text-lg text-ink mb-3">最近消息</h4>
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_1fr] gap-2 mb-3">
          <label className="text-xs text-pencil font-sans flex items-center gap-2">
            禁言分钟
            <input
              type="number"
              min={1}
              value={messageMuteMinutes}
              onChange={(event) => setMessageMuteMinutes(toPositiveInt(event.target.value, 30))}
              className="h-8 border border-gray-300 rounded px-2 w-24 text-xs"
            />
          </label>
          <label className="text-xs text-pencil font-sans flex items-center gap-2">
            封禁分钟
            <input
              type="number"
              min={1}
              value={messageBanMinutes}
              onChange={(event) => setMessageBanMinutes(toPositiveInt(event.target.value, 7 * 24 * 60))}
              className="h-8 border border-gray-300 rounded px-2 w-28 text-xs"
            />
          </label>
          <label className="text-xs text-pencil font-sans flex items-center gap-2">
            封禁范围
            <select
              value={messageBanScope}
              onChange={(event) => setMessageBanScope(event.target.value === 'site' ? 'site' : 'chat')}
              className="h-8 border border-gray-300 rounded px-2 text-xs"
            >
              <option value="chat">仅聊天室</option>
              <option value="site">全站</option>
            </select>
          </label>
        </div>
        <p className="text-[11px] text-pencil font-sans mb-3">封禁会同步写入 IP 与整条身份链，优先用于处理最近消息里的违规用户。</p>
        {filteredMessages.length === 0 ? (
          <p className="text-sm text-pencil font-hand">{search ? '没有匹配的消息' : '暂无消息'}</p>
        ) : (
          <div className="space-y-3 max-h-[640px] overflow-auto pr-1">
            {filteredMessages.map((message) => (
              <div key={message.id} className={`border rounded-lg p-3 ${message.deleted ? 'border-gray-200 bg-gray-50' : 'border-gray-200 bg-white'}`}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="text-xs text-pencil font-sans space-y-1 min-w-0">
                    <p>
                      <span className="font-bold text-ink">{message.nickname}</span>
                      <span className="mx-2">#{message.id}</span>
                      <span>{formatTime(message.createdAt)}</span>
                    </p>
                    <AdminIdentityCompact
                      identity={message}
                      label="身份"
                      showIp={false}
                      actions={{
                        onSearch: handleIdentitySearch,
                        onBan: (field) => openIdentityFieldBanDrawer(field, {
                          title: '消息封禁',
                          summary: message.content || message.imageUrl || message.stickerCode || `消息 #${message.id}`,
                          identity: message,
                          reason: `管理员封禁（消息#${message.id}）`,
                          durationMinutes: messageBanMinutes,
                          permissions: messageBanScope === 'site' ? SITE_BAN_PERMISSIONS : CHAT_ONLY_PERMISSIONS,
                          ip: String(message.ip || ''),
                          allowUnban: true,
                        }),
                      }}
                    />
                    <p className="break-all">
                      <span className="font-bold text-ink">IP：</span>
                      {message.ip || '-'}
                      {renderIpActions(message.ip)}
                    </p>
                  </div>
                  {!message.deleted && (
                    <div className="flex flex-wrap justify-end gap-1 shrink-0">
                      <SketchButton
                        variant="secondary"
                        className="h-7 px-2 text-[11px] inline-flex items-center gap-1"
                        disabled={Boolean(busyKey)}
                        onClick={() => runAction(
                          `delete:${message.id}`,
                          () => api.deleteAdminChatMessage(message.id, '管理员删除消息'),
                          '消息已删除',
                        )}
                      >
                        <Trash2 size={12} /> 删除
                      </SketchButton>
                      <SketchButton
                        variant="secondary"
                        className="h-7 px-2 text-[11px] inline-flex items-center gap-1"
                        disabled={Boolean(busyKey) || !getActionIdentityValue(message)}
                        onClick={() => applyMute(
                          getActionIdentityValue(message),
                          messageMuteMinutes,
                          `管理员禁言（消息#${message.id}）`,
                        )}
                      >
                        <Shield size={12} /> 禁言
                      </SketchButton>
                      <SketchButton
                        variant="secondary"
                        className="h-7 px-2 text-[11px] inline-flex items-center gap-1"
                        disabled={Boolean(busyKey) || !getActionIdentityValue(message)}
                        onClick={() => openBanDrawer({
                          title: '消息封禁',
                          summary: message.content || message.imageUrl || message.stickerCode || `消息 #${message.id}`,
                          identity: message,
                          targetValue: getActionIdentityValue(message),
                          ip: String(message.ip || ''),
                          reason: `管理员封禁（消息#${message.id}）`,
                          durationMinutes: messageBanMinutes,
                          permissions: messageBanScope === 'site' ? SITE_BAN_PERMISSIONS : CHAT_ONLY_PERMISSIONS,
                          allowUnban: true,
                        })}
                      >
                        <Ban size={12} /> 封禁
                      </SketchButton>
                    </div>
                  )}
                </div>
                {message.deleted ? (
                  <p className="text-xs text-gray-500 font-sans italic">该消息已删除</p>
                ) : message.type === 'image' && message.imageUrl ? (
                  <div className="text-xs text-pencil font-sans break-all">{message.imageUrl}</div>
                ) : message.type === 'sticker' && message.stickerCode ? (
                  <div className="text-xs text-pencil font-sans">{message.stickerCode}</div>
                ) : (
                  <MarkdownRenderer content={message.content || ''} className="text-sm text-ink" />
                )}
                {!message.deleted && !getActionIdentityValue(message) && (
                  <p className="text-[11px] text-amber-700 font-sans mt-2">该消息缺少身份标识，无法执行禁言或封禁。</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="text-xs text-pencil font-sans">
        在线用户列表已改为纯展示；禁言/封禁操作集中在“最近消息”中，封禁默认同步到 IP + 身份链。
        当前有禁言：{activeMuteSet.size} 人。
      </div>
    </section>
  );
};

export default AdminChatPanel;
