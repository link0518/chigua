import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CornerUpLeft, Eye, EyeOff, Flag, Image, LogIn, LogOut, Send, Shield, Signal, Smile, Trash2, UserX, X } from 'lucide-react';
import { api } from '../api';
import { getBrowserFingerprint } from '../fingerprint';
import type { ChatMessage, ChatOnlineUser, ChatRoomConfig } from '../types';
import { useApp } from '../store/AppContext';
import MarkdownRenderer from './MarkdownRenderer';
import MemePicker, { useMemeInsert } from './MemePicker';
import { SketchButton, SketchCard } from './SketchUI';
import { SketchIconButton } from './SketchIconButton';
import { consumeUploadQuota } from './uploadRateLimit';
import { useInsertAtCursor } from './useInsertAtCursor';

type WsPacket<T = any> = {
  event: string;
  payload: T;
};

type ChatAdminState = {
  isAdmin: boolean;
  anonymous: boolean;
  hiddenInOnline: boolean;
  nickname?: string;
};

const DEFAULT_CHAT_CONFIG: ChatRoomConfig = {
  chatEnabled: true,
  muteAll: false,
  adminOnly: false,
  messageIntervalMs: 2000,
  maxTextLength: 500,
};

const normalizeChatConfig = (input: any): ChatRoomConfig => {
  const rawInterval = Number(input?.messageIntervalMs);
  const rawMaxTextLength = Number(input?.maxTextLength);
  return {
    chatEnabled: typeof input?.chatEnabled === 'boolean' ? input.chatEnabled : DEFAULT_CHAT_CONFIG.chatEnabled,
    muteAll: Boolean(input?.muteAll),
    adminOnly: Boolean(input?.adminOnly),
    messageIntervalMs: Number.isFinite(rawInterval) ? Math.max(0, Math.trunc(rawInterval)) : DEFAULT_CHAT_CONFIG.messageIntervalMs,
    maxTextLength: Number.isFinite(rawMaxTextLength) ? Math.max(20, Math.trunc(rawMaxTextLength)) : DEFAULT_CHAT_CONFIG.maxTextLength,
  };
};

const getWsUrl = () => {
  const explicit = String(import.meta.env.VITE_WS_BASE_URL || '').trim();
  const base = explicit || `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;
  return `${base.replace(/\/$/, '')}/ws/chat`;
};

const buildClientMsgId = () => `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;

const isImageMarkdownOnly = (content: string) => {
  const match = content.match(/^!\[[^\]]*]\((https?:\/\/[^\s)]+)\)$/i);
  return match ? match[1] : '';
};

const isStickerOnly = (content: string) => /^\[:[^\]\n]{1,80}:\]$/.test(content);

const formatTime = (value: number) => {
  if (!value) return '';
  return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
};

const formatMutedUntil = (value: number | null) => {
  if (!value) return '永久禁言';
  return `禁言至 ${new Date(value).toLocaleString('zh-CN')}`;
};

const buildMessageMarkdown = (item: ChatMessage) => {
  if (item.type === 'image' && item.imageUrl) {
    return `![](${item.imageUrl})`;
  }
  if (item.type === 'sticker' && item.stickerCode) {
    return item.stickerCode;
  }
  return item.content || '';
};

const trimPreview = (value: string, maxLength = 72) => {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
};

const buildMessagePreview = (item: ChatMessage) => {
  if (item.type === 'image') {
    const text = trimPreview(item.content || '', 48);
    return text ? `[图片] ${text}` : '[图片]';
  }
  if (item.type === 'sticker') {
    return item.stickerCode || '[表情]';
  }
  return trimPreview(item.content || '', 84) || '[消息]';
};

const escapeRegExp = (value: string) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface ChatRoomViewProps {
  onExitToFeed?: () => void;
}

const ChatRoomView: React.FC<ChatRoomViewProps> = ({ onExitToFeed }) => {
  const { showToast, state } = useApp();
  const [entered, setEntered] = useState(false);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'online' | 'offline'>('idle');
  const [nickname, setNickname] = useState('');
  const [selfSessionId, setSelfSessionId] = useState('');
  const [onlineCount, setOnlineCount] = useState(0);
  const [onlineUsers, setOnlineUsers] = useState<ChatOnlineUser[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [uploading, setUploading] = useState(false);
  const [memeOpen, setMemeOpen] = useState(false);
  const [mutedUntil, setMutedUntil] = useState<number | null>(null);
  const [mutedReason, setMutedReason] = useState<string | null>(null);
  const [lobbyOnlineCount, setLobbyOnlineCount] = useState(0);
  const [replyTarget, setReplyTarget] = useState<ChatMessage | null>(null);
  const [unreadAttentionIds, setUnreadAttentionIds] = useState<number[]>([]);
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [adminAnonymous, setAdminAnonymous] = useState(false);
  const [adminHiddenInOnline, setAdminHiddenInOnline] = useState(false);
  const [adminActionBusyKey, setAdminActionBusyKey] = useState('');
  const [reportBusyMessageId, setReportBusyMessageId] = useState<number | null>(null);
  const [chatConfig, setChatConfig] = useState<ChatRoomConfig>(DEFAULT_CHAT_CONFIG);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectTimesRef = useRef(0);
  const shouldReconnectRef = useRef(false);
  const aliveRef = useRef(true);
  const listEndRef = useRef<HTMLDivElement | null>(null);
  const messageBoxRef = useRef<HTMLDivElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const memeButtonRef = useRef<HTMLButtonElement | null>(null);
  const messageNodeMapRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const messagesRef = useRef<ChatMessage[]>([]);
  const replyTargetRef = useRef<ChatMessage | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const isAdminUserRef = useRef(false);
  const adminAnonymousRef = useRef(false);
  const adminHiddenInOnlineRef = useRef(false);
  const chatConfigRef = useRef<ChatRoomConfig>(DEFAULT_CHAT_CONFIG);
  const lastSendAtRef = useRef(0);

  const { textareaRef, insertMeme } = useMemeInsert(input, setInput);
  const { insertAtCursor } = useInsertAtCursor(input, setInput, textareaRef);

  useEffect(() => {
    replyTargetRef.current = replyTarget;
  }, [replyTarget]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    isAdminUserRef.current = isAdminUser;
  }, [isAdminUser]);

  useEffect(() => {
    adminAnonymousRef.current = adminAnonymous;
  }, [adminAnonymous]);

  useEffect(() => {
    adminHiddenInOnlineRef.current = adminHiddenInOnline;
  }, [adminHiddenInOnline]);

  useEffect(() => {
    chatConfigRef.current = chatConfig;
  }, [chatConfig]);

  const applyAdminState = useCallback((adminState: Partial<ChatAdminState> | null | undefined) => {
    if (!adminState || !adminState.isAdmin) {
      isAdminUserRef.current = false;
      adminAnonymousRef.current = false;
      adminHiddenInOnlineRef.current = false;
      setIsAdminUser(false);
      setAdminAnonymous(false);
      setAdminHiddenInOnline(false);
      return;
    }
    isAdminUserRef.current = true;
    adminAnonymousRef.current = Boolean(adminState.anonymous);
    adminHiddenInOnlineRef.current = Boolean(adminState.hiddenInOnline);
    setIsAdminUser(true);
    setAdminAnonymous(Boolean(adminState.anonymous));
    setAdminHiddenInOnline(Boolean(adminState.hiddenInOnline));
    if (adminState.nickname) {
      setNickname(String(adminState.nickname));
    }
  }, []);

  const refreshAdminSession = useCallback(async () => {
    if (state.adminSession.checked && !state.adminSession.loggedIn) {
      isAdminUserRef.current = false;
      adminAnonymousRef.current = false;
      adminHiddenInOnlineRef.current = false;
      setIsAdminUser(false);
      setAdminAnonymous(false);
      setAdminHiddenInOnline(false);
      return false;
    }
    try {
      const session = await api.getAdminSession();
      const csrfToken = String(session?.csrfToken || '').trim();
      if (csrfToken) {
        api.setCsrfToken(csrfToken);
      }
      const loggedIn = Boolean(session?.loggedIn);
      isAdminUserRef.current = loggedIn;
      setIsAdminUser(loggedIn);
      if (!loggedIn) {
        adminAnonymousRef.current = false;
        adminHiddenInOnlineRef.current = false;
        setAdminAnonymous(false);
        setAdminHiddenInOnline(false);
      }
      return loggedIn;
    } catch {
      isAdminUserRef.current = false;
      adminAnonymousRef.current = false;
      adminHiddenInOnlineRef.current = false;
      setIsAdminUser(false);
      setAdminAnonymous(false);
      setAdminHiddenInOnline(false);
      return false;
    }
  }, [state.adminSession.checked, state.adminSession.loggedIn]);

  useEffect(() => {
    if (!state.adminSession.checked) {
      return;
    }
    isAdminUserRef.current = Boolean(state.adminSession.loggedIn);
    setIsAdminUser(Boolean(state.adminSession.loggedIn));
    if (!state.adminSession.loggedIn) {
      adminAnonymousRef.current = false;
      adminHiddenInOnlineRef.current = false;
      setAdminAnonymous(false);
      setAdminHiddenInOnline(false);
    }
  }, [state.adminSession.checked, state.adminSession.loggedIn]);

  const canManageMessages = useMemo(() => {
    if (!isAdminUser) {
      return false;
    }
    if (!state.adminSession.checked) {
      return true;
    }
    return Boolean(state.adminSession.loggedIn);
  }, [isAdminUser, state.adminSession.checked, state.adminSession.loggedIn]);

  const refreshLobbyOnline = useCallback(async () => {
    try {
      const data = await api.getChatOnline();
      setLobbyOnlineCount(Number(data?.onlineCount || 0));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    refreshLobbyOnline().catch(() => { });
    const timer = window.setInterval(() => {
      if (!entered) {
        refreshLobbyOnline().catch(() => { });
      }
    }, 15000);
    return () => {
      window.clearInterval(timer);
    };
  }, [entered, refreshLobbyOnline]);

  const isMessageListNearBottom = useCallback((threshold = 96) => {
    const box = messageBoxRef.current;
    if (!box) {
      return true;
    }
    const distance = box.scrollHeight - box.scrollTop - box.clientHeight;
    return distance <= threshold;
  }, []);

  const markUnreadAttentionRead = useCallback(() => {
    setUnreadAttentionIds([]);
  }, []);

  const cleanupReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const closeSocket = useCallback((reason: string) => {
    const ws = wsRef.current;
    if (!ws) return;
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ event: 'chat.leave', payload: { reason } }));
      }
      ws.close(1000, reason);
    } catch {
      // ignore
    }
    wsRef.current = null;
  }, []);

  const isSelfMessage = useCallback((item: ChatMessage) => {
    if (!selfSessionId) {
      return false;
    }
    return item.sessionId === selfSessionId;
  }, [selfSessionId]);

  const isMentionToSelf = useCallback((item: ChatMessage) => {
    const target = String(nickname || '').trim();
    const content = String(item.content || '').trim();
    if (!target || !content) {
      return false;
    }
    const escaped = escapeRegExp(target);
    const regex = new RegExp(`(^|\\s|[，。,.!?！？:：])@${escaped}(?=$|\\s|[，。,.!?！？:：])`);
    return regex.test(content);
  }, [nickname]);

  const isReplyToSelf = useCallback((item: ChatMessage, existing: ChatMessage[]) => {
    if (!item.replyTo) {
      return false;
    }
    if (nickname && item.replyTo.nickname === nickname) {
      return true;
    }
    if (!selfSessionId || !item.replyTo.id) {
      return false;
    }
    return existing.some((message) => message.id === item.replyTo?.id && message.sessionId === selfSessionId);
  }, [nickname, selfSessionId]);

  const shouldAttentionForIncoming = useCallback((item: ChatMessage, existing: ChatMessage[]) => {
    if (item.deleted || isSelfMessage(item)) {
      return false;
    }
    return isMentionToSelf(item) || isReplyToSelf(item, existing);
  }, [isMentionToSelf, isReplyToSelf, isSelfMessage]);

  const applyJoinedPayload = useCallback((payload: any) => {
    shouldAutoScrollRef.current = true;
    setNickname(String(payload?.nickname || '匿名'));
    setSelfSessionId(String(payload?.sessionId || ''));
    setOnlineCount(Number(payload?.onlineCount || 0));
    setOnlineUsers(Array.isArray(payload?.users) ? payload.users : []);
    setMessages(Array.isArray(payload?.history) ? payload.history : []);
    setUnreadAttentionIds([]);
    setMutedUntil(typeof payload?.mutedUntil === 'number' ? payload.mutedUntil : null);
    setMutedReason(payload?.mutedReason ? String(payload.mutedReason) : null);
    setChatConfig(normalizeChatConfig(payload?.chatConfig));
    applyAdminState(payload?.adminState);
    setStatus('online');
    reconnectTimesRef.current = 0;
  }, [applyAdminState]);

  const handleRealtimeMessage = useCallback((raw: string) => {
    let packet: WsPacket | null = null;
    try {
      packet = JSON.parse(String(raw || ''));
    } catch {
      return;
    }
    if (!packet || typeof packet.event !== 'string') {
      return;
    }

    const payload = packet.payload || {};

    if (packet.event === 'chat.joined') {
      applyJoinedPayload(payload);
      return;
    }

    if (packet.event === 'chat.online.changed') {
      setOnlineCount(Number(payload?.onlineCount || 0));
      setOnlineUsers(Array.isArray(payload?.users) ? payload.users : []);
      return;
    }

    if (packet.event === 'chat.admin.state') {
      applyAdminState(payload as ChatAdminState);
      return;
    }

    if (packet.event === 'chat.config') {
      setChatConfig(normalizeChatConfig(payload));
      return;
    }

    if (packet.event === 'chat.message.new') {
      const incoming = payload as ChatMessage;
      const existing = messagesRef.current;
      const nearBottom = isMessageListNearBottom();
      const isSelfIncoming = isSelfMessage(incoming);
      const shouldAutoScroll = nearBottom || isSelfIncoming;
      shouldAutoScrollRef.current = shouldAutoScroll;

      let insertedNewMessage = false;
      setMessages((prev) => {
        if (prev.some((item) => item.id === incoming.id)) {
          return prev;
        }
        const pendingIdx = prev.findIndex((item) => {
          return item.pending && item.clientMsgId && incoming.clientMsgId && item.clientMsgId === incoming.clientMsgId;
        });
        if (pendingIdx >= 0) {
          const next = [...prev];
          next[pendingIdx] = { ...incoming, pending: false };
          return next;
        }
        insertedNewMessage = true;
        return [...prev, incoming];
      });

      if (insertedNewMessage && shouldAttentionForIncoming(incoming, existing) && !shouldAutoScroll) {
        setUnreadAttentionIds((prev) => (prev.includes(incoming.id) ? prev : [...prev, incoming.id]));
      }
      return;
    }

    if (packet.event === 'chat.send.ack') {
      const clientMsgId = String(payload?.clientMsgId || '');
      const messageId = Number(payload?.messageId || 0);
      if (!clientMsgId) return;
      setMessages((prev) => prev.map((item) => {
        if (item.clientMsgId !== clientMsgId) {
          return item;
        }
        return {
          ...item,
          id: messageId > 0 ? messageId : item.id,
          pending: false,
        };
      }));
      return;
    }

    if (packet.event === 'chat.message.deleted') {
      const deletedId = Number(payload?.id || 0);
      if (!deletedId) return;
      setMessages((prev) => prev.map((item) => (
        item.id === deletedId ? { ...item, deleted: true, deletedAt: payload?.deletedAt || null } : item
      )));
      if (replyTargetRef.current?.id === deletedId) {
        setReplyTarget(null);
      }
      return;
    }

    if (packet.event === 'chat.muted') {
      const until = typeof payload?.mutedUntil === 'number' ? payload.mutedUntil : null;
      const reason = payload?.reason ? String(payload.reason) : null;
      setMutedUntil(until);
      setMutedReason(reason);
      showToast(reason ? `你已被禁言：${reason}` : '你已被禁言', 'warning');
      return;
    }

    if (packet.event === 'chat.kicked') {
      shouldReconnectRef.current = false;
      setEntered(false);
      setStatus('idle');
      setNickname('');
      setSelfSessionId('');
      setOnlineCount(0);
      setOnlineUsers([]);
      setMessages([]);
      setUnreadAttentionIds([]);
      setReplyTarget(null);
      showToast(payload?.message ? String(payload.message) : '你已被管理员移出聊天室', 'warning');
      return;
    }

    if (packet.event === 'chat.banned') {
      shouldReconnectRef.current = false;
      setEntered(false);
      setStatus('idle');
      setNickname('');
      setSelfSessionId('');
      setOnlineCount(0);
      setOnlineUsers([]);
      setMessages([]);
      setUnreadAttentionIds([]);
      setReplyTarget(null);
      showToast(payload?.message ? String(payload.message) : '账号已被封禁，无法进入聊天室', 'error');
      return;
    }


    if (packet.event === 'chat.closed') {
      shouldReconnectRef.current = false;
      setEntered(false);
      setStatus('idle');
      setNickname('');
      setSelfSessionId('');
      setOnlineCount(0);
      setOnlineUsers([]);
      setMessages([]);
      setUnreadAttentionIds([]);
      setReplyTarget(null);
      setChatConfig((prev) => ({ ...prev, chatEnabled: false }));
      showToast(payload?.message ? String(payload.message) : '聊天室已关闭', 'warning');
      onExitToFeed?.();
      return;
    }
    if (packet.event === 'chat.error') {
      const message = payload?.message ? String(payload.message) : '聊天室操作失败';
      showToast(message, 'warning');
    }
  }, [applyAdminState, applyJoinedPayload, isMessageListNearBottom, isSelfMessage, onExitToFeed, shouldAttentionForIncoming, showToast]);

  const connect = useCallback(async () => {
    cleanupReconnectTimer();
    setStatus('connecting');

    const fingerprint = await getBrowserFingerprint();
    if (!aliveRef.current || !shouldReconnectRef.current) {
      return;
    }

    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      const joinPayload: Record<string, any> = { fingerprint, clientTs: Date.now() };
      if (isAdminUserRef.current) {
        joinPayload.adminAnonymous = adminAnonymousRef.current;
        joinPayload.hiddenInOnline = adminHiddenInOnlineRef.current;
      }
      ws.send(JSON.stringify({
        event: 'chat.join',
        payload: joinPayload,
      }));
    };

    ws.onmessage = (event) => {
      handleRealtimeMessage(String(event.data || ''));
    };

    ws.onclose = () => {
      if (wsRef.current === ws) {
        wsRef.current = null;
      }
      if (!aliveRef.current) {
        return;
      }
      if (!shouldReconnectRef.current) {
        setStatus('idle');
        return;
      }
      setStatus('offline');
      reconnectTimesRef.current += 1;
      const delay = Math.min(1000 * reconnectTimesRef.current, 5000);
      reconnectTimerRef.current = window.setTimeout(() => {
        connect().catch(() => { });
      }, delay);
    };

    ws.onerror = () => {
      // 由 onclose 统一处理重连
    };
  }, [cleanupReconnectTimer, handleRealtimeMessage]);
  const enterChat = useCallback(() => {
    if (entered) {
      return;
    }
    shouldReconnectRef.current = true;
    setEntered(true);
    setMutedUntil(null);
    setMutedReason(null);
    lastSendAtRef.current = 0;
    refreshAdminSession()
      .catch(() => false)
      .finally(() => {
        connect().catch((error) => {
          const message = error instanceof Error ? error.message : '连接聊天室失败';
          showToast(message, 'error');
          setStatus('offline');
        });
      });
  }, [connect, entered, refreshAdminSession, showToast]);

  const leaveChat = useCallback(() => {
    shouldReconnectRef.current = false;
    cleanupReconnectTimer();
    closeSocket('user_leave');
    setEntered(false);
    setStatus('idle');
    setNickname('');
    setSelfSessionId('');
    setOnlineCount(0);
    setOnlineUsers([]);
    setMessages([]);
    setUnreadAttentionIds([]);
    setAdminActionBusyKey('');
    setReportBusyMessageId(null);
    setMutedUntil(null);
    setMutedReason(null);
    lastSendAtRef.current = 0;
    setInput('');
    setReplyTarget(null);
    refreshLobbyOnline().catch(() => { });
    onExitToFeed?.();
  }, [cleanupReconnectTimer, closeSocket, onExitToFeed, refreshLobbyOnline]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      shouldReconnectRef.current = false;
      cleanupReconnectTimer();
      closeSocket('unmount');
    };
  }, [cleanupReconnectTimer, closeSocket]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      shouldReconnectRef.current = false;
      cleanupReconnectTimer();
      closeSocket('beforeunload');
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [cleanupReconnectTimer, closeSocket]);

  useEffect(() => {
    if (!messageBoxRef.current) return;
    if (!shouldAutoScrollRef.current) return;
    listEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleMessageScroll = useCallback(() => {
    if (!unreadAttentionIds.length) {
      return;
    }
    if (isMessageListNearBottom()) {
      markUnreadAttentionRead();
    }
  }, [isMessageListNearBottom, markUnreadAttentionRead, unreadAttentionIds.length]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden) {
        return;
      }
      if (isMessageListNearBottom()) {
        markUnreadAttentionRead();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [isMessageListNearBottom, markUnreadAttentionRead]);

  const bindMessageRef = useCallback((messageId: number, node: HTMLDivElement | null) => {
    if (node) {
      messageNodeMapRef.current.set(messageId, node);
      return;
    }
    messageNodeMapRef.current.delete(messageId);
  }, []);

  const jumpToMessage = useCallback((messageId: number) => {
    const node = messageNodeMapRef.current.get(messageId);
    if (!node) {
      return;
    }
    setUnreadAttentionIds((prev) => prev.filter((id) => id !== messageId));
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    node.classList.add('ring-2', 'ring-amber-300');
    window.setTimeout(() => {
      node.classList.remove('ring-2', 'ring-amber-300');
    }, 1200);
  }, []);

  const handleMention = useCallback((targetNickname: string) => {
    const nicknameValue = String(targetNickname || '').trim();
    if (!nicknameValue) {
      return;
    }
    insertAtCursor(`@${nicknameValue} `);
    textareaRef.current?.focus();
  }, [insertAtCursor, textareaRef]);

  const handleReply = useCallback((target: ChatMessage) => {
    if (target.deleted) {
      return;
    }
    setReplyTarget(target);
    handleMention(target.nickname);
  }, [handleMention]);

  const updateAdminRealtimeState = useCallback((next: Partial<Pick<ChatAdminState, 'anonymous' | 'hiddenInOnline'>>) => {
    if (!isAdminUser || !entered || status !== 'online') {
      return;
    }
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }
    ws.send(JSON.stringify({
      event: 'chat.admin.update',
      payload: next,
    }));
  }, [entered, isAdminUser, status]);

  const handleToggleAdminAnonymous = useCallback(() => {
    const next = !adminAnonymous;
    adminAnonymousRef.current = next;
    setAdminAnonymous(next);
    updateAdminRealtimeState({ anonymous: next });
  }, [adminAnonymous, updateAdminRealtimeState]);

  const handleToggleAdminHiddenInOnline = useCallback(() => {
    const next = !adminHiddenInOnline;
    adminHiddenInOnlineRef.current = next;
    setAdminHiddenInOnline(next);
    updateAdminRealtimeState({ hiddenInOnline: next });
  }, [adminHiddenInOnline, updateAdminRealtimeState]);

  const runAdminMessageAction = useCallback(async (
    key: string,
    action: () => Promise<any>,
    successMessage: string,
  ) => {
    if (adminActionBusyKey) {
      return;
    }
    setAdminActionBusyKey(key);
    try {
      await action();
      showToast(successMessage, 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '管理员操作失败';
      showToast(message, 'error');
    } finally {
      setAdminActionBusyKey('');
    }
  }, [adminActionBusyKey, showToast]);

  const handleAdminDeleteMessage = useCallback((item: ChatMessage) => {
    if (!canManageMessages || item.deleted || item.id <= 0) {
      return;
    }
    runAdminMessageAction(
      `delete:${item.id}`,
      () => api.deleteAdminChatMessage(item.id, '聊天室管理员删除消息'),
      '已删除消息',
    ).catch(() => { });
  }, [canManageMessages, runAdminMessageAction]);

  const handleAdminMuteByMessage = useCallback((item: ChatMessage) => {
    if (!canManageMessages || !item.sessionId) {
      return;
    }
    if (item.sessionId === selfSessionId) {
      showToast('不能禁言自己', 'warning');
      return;
    }
    runAdminMessageAction(
      `mute:${item.id}`,
      () => api.muteAdminChatSession(item.sessionId, { durationMinutes: 30, reason: '聊天室管理员禁言' }),
      '已禁言 30 分钟',
    ).catch(() => { });
  }, [canManageMessages, runAdminMessageAction, selfSessionId, showToast]);

  const handleReportMessage = useCallback(async (item: ChatMessage) => {
    if (canManageMessages || item.deleted || item.id <= 0) {
      return;
    }
    if (isSelfMessage(item)) {
      showToast('不能举报自己的消息', 'warning');
      return;
    }
    if (reportBusyMessageId) {
      return;
    }

    const reasonInput = window.prompt('请输入举报理由（最多 200 字）', '');
    if (reasonInput === null) {
      return;
    }
    const reason = reasonInput.trim();
    if (!reason) {
      showToast('举报理由不能为空', 'warning');
      return;
    }
    if (reason.length > 200) {
      showToast('举报理由不能超过 200 字', 'warning');
      return;
    }

    setReportBusyMessageId(item.id);
    try {
      await api.reportChatMessage(item.id, reason);
      showToast('举报已提交，管理员会尽快处理', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '举报失败，请稍后重试';
      showToast(message, 'error');
    } finally {
      setReportBusyMessageId(null);
    }
  }, [canManageMessages, isSelfMessage, reportBusyMessageId, showToast]);

  const handlePickUpload = () => {
    if (!entered || status !== 'online' || uploading) {
      return;
    }
    uploadInputRef.current?.click();
  };

  const handleUploadFile = async (file: File) => {
    if (!file) {
      return;
    }
    if (!file.type.startsWith('image/')) {
      showToast('仅支持图片上传', 'warning');
      return;
    }

    const quota = consumeUploadQuota({ windowMs: 30_000, max: 3 });
    if (!quota.allowed) {
      const seconds = Math.max(1, Math.ceil(quota.retryAfterMs / 1000));
      showToast(`上传过于频繁，请 ${seconds}s 后重试`, 'warning');
      return;
    }

    setUploading(true);
    try {
      const result = await api.uploadImage(file, { uploadChannel: 'telegram' });
      insertAtCursor(`![](${result.url})`);
      showToast('图片上传成功', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '图片上传失败';
      showToast(message, 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleSend = () => {
    if (!entered || status !== 'online') {
      return;
    }
    const config = chatConfigRef.current;
    if (!config.chatEnabled) {
      showToast('聊天室已关闭', 'warning');
      return;
    }
    const maxTextLength = Math.max(20, Math.trunc(config.maxTextLength || DEFAULT_CHAT_CONFIG.maxTextLength));
    if (config.muteAll) {
      showToast('聊天室已开启全体禁言', 'warning');
      return;
    }
    if (config.adminOnly && !isAdminUserRef.current) {
      showToast('当前仅管理员可以发言', 'warning');
      return;
    }
    if (mutedUntil || mutedReason) {
      showToast(mutedReason ? `你正在禁言中：${mutedReason}` : '你正在禁言中', 'warning');
      return;
    }

    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      showToast('连接未就绪，请稍后重试', 'warning');
      return;
    }

    const content = input.trim();
    if (!content) {
      return;
    }
    if (content.length > maxTextLength) {
      showToast(`消息不能超过 ${maxTextLength} 字`, 'warning');
      return;
    }

    const intervalMs = Math.max(0, Math.trunc(config.messageIntervalMs || 0));
    const now = Date.now();
    if (intervalMs > 0 && now - lastSendAtRef.current < intervalMs) {
      const seconds = Math.max(1, Math.ceil((intervalMs - (now - lastSendAtRef.current)) / 1000));
      showToast(`发送过于频繁，请 ${seconds} 秒后重试`, 'warning');
      return;
    }

    shouldAutoScrollRef.current = true;
    const clientMsgId = buildClientMsgId();
    const replyToMessageId = replyTarget?.id || null;
    const imageOnlyUrl = isImageMarkdownOnly(content);
    const stickerOnly = isStickerOnly(content);

    let type: ChatMessage['type'] = 'text';
    let textContent = content;
    let imageUrl = '';
    let stickerCode = '';
    let payload: Record<string, any> = {
      clientMsgId,
      type: 'text',
      content,
      replyToMessageId,
    };

    if (imageOnlyUrl) {
      type = 'image';
      textContent = '';
      imageUrl = imageOnlyUrl;
      payload = {
        clientMsgId,
        type: 'image',
        imageUrl,
        replyToMessageId,
      };
    } else if (stickerOnly) {
      type = 'sticker';
      textContent = '';
      stickerCode = content;
      payload = {
        clientMsgId,
        type: 'sticker',
        stickerCode,
        replyToMessageId,
      };
    }

    ws.send(JSON.stringify({ event: 'chat.send', payload }));
    lastSendAtRef.current = now;

    const optimisticMessage: ChatMessage = {
      id: -Date.now(),
      sessionId: selfSessionId || `local-${clientMsgId}`,
      nickname: nickname || '我',
      isAdmin: isAdminUser && !adminAnonymous,
      type,
      content: textContent,
      imageUrl,
      stickerCode,
      clientMsgId,
      createdAt: Date.now(),
      pending: true,
      replyTo: replyTarget ? {
        id: replyTarget.id,
        nickname: replyTarget.nickname,
        preview: buildMessagePreview(replyTarget),
      } : null,
    };
    setMessages((prev) => [...prev, optimisticMessage]);

    setInput('');
    setReplyTarget(null);
  };

  const textMaxLength = useMemo(() => {
    return Math.max(20, Math.trunc(chatConfig.maxTextLength || DEFAULT_CHAT_CONFIG.maxTextLength));
  }, [chatConfig.maxTextLength]);
  const sendIntervalSeconds = useMemo(() => {
    return Math.max(0, Math.trunc((chatConfig.messageIntervalMs || 0) / 1000));
  }, [chatConfig.messageIntervalMs]);
  const chatRuleBlocked = !chatConfig.chatEnabled || chatConfig.muteAll || (chatConfig.adminOnly && !isAdminUser);

  const statusLabel = useMemo(() => {
    if (status === 'online') return '在线';
    if (status === 'connecting') return '连接中';
    if (status === 'offline') return '重连中';
    return '未进入';
  }, [status]);

  const unreadAttentionIdSet = useMemo(() => new Set(unreadAttentionIds), [unreadAttentionIds]);

  if (!entered) {
    return (
      <div className="flex justify-center w-full py-8">
        <div className="w-full max-w-2xl px-4">
          <SketchCard className="p-6 sm:p-8">
            <div className="flex flex-col gap-4">
              <h2 className="font-display text-3xl text-ink">匿名聊天室</h2>
              <p className="font-hand text-lg text-pencil">
                进入后将随机分配“侠士编号”，退出后再次进入会重新分配。
              </p>
              <p className="text-sm text-pencil font-sans">当前在线人数：{lobbyOnlineCount}</p>
              <div className="flex gap-3">
                <SketchButton
                  className="h-12 px-6 text-lg flex items-center gap-2"
                  onClick={enterChat}
                >
                  <LogIn className="w-5 h-5" />
                  进入聊天室
                </SketchButton>
                <SketchButton
                  variant="secondary"
                  className="h-12 px-6 text-lg"
                  onClick={() => refreshLobbyOnline().catch(() => { })}
                >
                  刷新在线
                </SketchButton>
              </div>
            </div>
          </SketchCard>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-6xl mx-auto px-4 py-6 flex flex-col md:flex-row gap-4 min-h-[calc(100vh-220px)]">
      <section className="flex-1 min-w-0 bg-white border-2 border-ink rounded-xl shadow-sketch p-4 flex flex-col">
        <div className="flex items-center justify-between gap-3 pb-3 border-b border-gray-200">
          <div className="flex flex-col">
            <h2 className="font-display text-2xl text-ink flex items-center gap-2">
              聊天室
              {unreadAttentionIds.length > 0 && (
                <span className="inline-flex min-w-6 h-6 items-center justify-center rounded-full bg-red-500 text-white text-xs px-2">
                  {unreadAttentionIds.length}
                </span>
              )}
            </h2>
            <p className="text-sm text-pencil font-sans">
              昵称：<span className="font-bold text-ink">{nickname || '分配中...'}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isAdminUser && (
              <>
                <button
                  type="button"
                  className={`h-9 px-3 rounded-full border text-xs font-sans inline-flex items-center gap-1 ${adminAnonymous ? 'border-purple-200 bg-purple-50 text-purple-700' : 'border-gray-200 bg-gray-50 text-pencil hover:text-ink'}`}
                  onClick={handleToggleAdminAnonymous}
                >
                  <UserX className="w-3.5 h-3.5" />
                  {adminAnonymous ? '匿名发言中' : '实名发言'}
                </button>
                <button
                  type="button"
                  className={`h-9 px-3 rounded-full border text-xs font-sans inline-flex items-center gap-1 ${adminHiddenInOnline ? 'border-slate-200 bg-slate-100 text-slate-700' : 'border-gray-200 bg-gray-50 text-pencil hover:text-ink'}`}
                  onClick={handleToggleAdminHiddenInOnline}
                >
                  {adminHiddenInOnline ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  {adminHiddenInOnline ? '隐身中' : '显示在线'}
                </button>
              </>
            )}
            {unreadAttentionIds.length > 0 && (
              <button
                type="button"
                className="h-9 px-3 rounded-full border border-red-200 bg-red-50 text-red-600 text-xs font-sans"
                onClick={() => {
                  shouldAutoScrollRef.current = true;
                  listEndRef.current?.scrollIntoView({ behavior: 'smooth' });
                  markUnreadAttentionRead();
                }}
              >
                有 {unreadAttentionIds.length} 条 @/回复 未读
              </button>
            )}
            <span className={`text-xs font-sans px-2 py-1 border rounded-full flex items-center gap-1 ${status === 'online' ? 'border-green-600 text-green-700 bg-green-50' : 'border-amber-600 text-amber-700 bg-amber-50'}`}>
              <Signal className="w-3.5 h-3.5" />
              {statusLabel}
            </span>
            <SketchButton
              variant="secondary"
              className="h-9 px-3 text-sm flex items-center gap-1"
              onClick={leaveChat}
            >
              <LogOut className="w-4 h-4" />
              退出
            </SketchButton>
          </div>
        </div>

        {!chatConfig.chatEnabled && (
          <div className="mt-3 border border-rose-400 bg-rose-50 text-rose-700 rounded-lg px-3 py-2 text-sm font-sans">
            聊天室已关闭，当前无法发言或进入。
          </div>
        )}
        {chatConfig.muteAll && (
          <div className="mt-3 border border-rose-400 bg-rose-50 text-rose-700 rounded-lg px-3 py-2 text-sm font-sans">
            聊天室已开启全体禁言，当前无人可发言。
          </div>
        )}
        {!chatConfig.muteAll && chatConfig.adminOnly && !isAdminUser && (
          <div className="mt-3 border border-amber-400 bg-amber-50 text-amber-700 rounded-lg px-3 py-2 text-sm font-sans">
            当前仅管理员可以发言。
          </div>
        )}
        {(mutedUntil || mutedReason) && (
          <div className="mt-3 border border-amber-400 bg-amber-50 text-amber-700 rounded-lg px-3 py-2 text-sm font-sans">
            你已被禁言。{formatMutedUntil(mutedUntil)}{mutedReason ? `，原因：${mutedReason}` : ''}
          </div>
        )}

        <div
          ref={messageBoxRef}
          className="mt-3 flex-1 min-h-[320px] max-h-[58vh] overflow-auto pr-1 space-y-3"
          onScroll={handleMessageScroll}
        >
          {messages.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-pencil font-hand">
              暂无消息，开始聊聊吧
            </div>
          ) : (
            messages.map((item) => {
              const isSelf = isSelfMessage(item);
              const isUnreadAttention = unreadAttentionIdSet.has(item.id);
              return (
                <article
                  key={`${item.id}-${item.clientMsgId || ''}`}
                  className={`flex ${isSelf ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    ref={(node) => bindMessageRef(item.id, node)}
                    className={`w-fit max-w-[92%] sm:max-w-[76%] rounded-2xl border px-3 py-2 transition-shadow ${item.deleted ? 'border-gray-200 bg-gray-50' : isSelf ? 'border-ink bg-amber-50' : 'border-gray-200 bg-white'} ${isUnreadAttention ? 'ring-2 ring-red-300 bg-red-50/60' : ''}`}
                  >
                    <div className={`flex items-center gap-2 flex-wrap text-xs text-pencil ${isSelf ? 'justify-end' : ''}`}>
                      {!isSelf && <span className="font-bold text-ink">{item.nickname}</span>}
                      {isSelf && <span className="font-bold text-ink">我</span>}
                      {item.isAdmin && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full border border-emerald-300 bg-emerald-50 text-emerald-700 text-[10px] font-bold">
                          <Shield className="w-3 h-3 mr-1" />
                          管理员
                        </span>
                      )}
                      {!item.deleted && (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-pencil hover:text-ink"
                          onClick={() => handleReply(item)}
                        >
                          <CornerUpLeft className="w-3 h-3" />
                          回复
                        </button>
                      )}
                      {!item.deleted && !isSelf && (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-pencil hover:text-ink"
                          onClick={() => handleMention(item.nickname)}
                        >
                          @Ta
                        </button>
                      )}
                      {!canManageMessages && !item.deleted && !isSelf && (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-sky-600 hover:text-sky-700 disabled:text-gray-300"
                          disabled={reportBusyMessageId === item.id}
                          onClick={() => {
                            handleReportMessage(item).catch(() => { });
                          }}
                        >
                          <Flag className="w-3 h-3" />
                          {reportBusyMessageId === item.id ? '举报中' : '举报'}
                        </button>
                      )}
                      {canManageMessages && !item.deleted && (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-rose-500 hover:text-rose-600 disabled:text-gray-300"
                          disabled={Boolean(adminActionBusyKey)}
                          onClick={() => handleAdminDeleteMessage(item)}
                        >
                          <Trash2 className="w-3 h-3" />
                          删除
                        </button>
                      )}
                      {canManageMessages && !item.deleted && !isSelf && (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-amber-600 hover:text-amber-700 disabled:text-gray-300"
                          disabled={Boolean(adminActionBusyKey)}
                          onClick={() => handleAdminMuteByMessage(item)}
                        >
                          <Shield className="w-3 h-3" />
                          禁言30m
                        </button>
                      )}
                      <span>{formatTime(item.createdAt)}</span>
                      {item.pending && <span className="text-amber-600">发送中</span>}
                      {isUnreadAttention && <span className="text-red-500">@/回复</span>}
                    </div>

                    {!item.deleted && item.replyTo && (
                      <button
                        type="button"
                        onClick={() => jumpToMessage(item.replyTo!.id)}
                        className="mt-2 w-full text-left rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 hover:bg-gray-100"
                      >
                        <p className="text-xs font-semibold text-ink truncate">@{item.replyTo.nickname}</p>
                        <p className="text-xs text-pencil truncate">{item.replyTo.preview || '引用消息'}</p>
                      </button>
                    )}

                    <div className="mt-2">
                      {item.deleted ? (
                        <p className="text-sm text-gray-500 font-sans italic">该消息已被管理员删除</p>
                      ) : (
                        <MarkdownRenderer content={buildMessageMarkdown(item)} className="text-sm text-ink" />
                      )}
                    </div>
                  </div>
                </article>
              );
            })
          )}
          <div ref={listEndRef} />
        </div>

        <div className="mt-3 border-t border-gray-200 pt-3">
          {replyTarget && (
            <div className="mb-2 border border-amber-300 bg-amber-50 rounded-lg px-3 py-2 flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-ink">正在回复 @{replyTarget.nickname}</p>
                <p className="text-[11px] text-pencil mt-0.5">#{replyTarget.id} · {formatTime(replyTarget.createdAt)}</p>
                <p className="mt-1 rounded border border-amber-200 bg-white/70 px-2 py-1 text-xs text-pencil truncate">
                  {buildMessagePreview(replyTarget)}
                </p>
              </div>
              <button
                type="button"
                className="text-pencil hover:text-ink"
                onClick={() => setReplyTarget(null)}
                aria-label="取消引用"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                handleSend();
              }
            }}
            placeholder={chatRuleBlocked ? (!chatConfig.chatEnabled ? '聊天室已关闭，暂时无法发言' : (chatConfig.muteAll ? '聊天室已开启全体禁言，暂时无法发言' : '当前仅管理员可发言')) : (mutedUntil || mutedReason ? '你正在禁言中，暂时无法发言' : '输入消息（支持 Markdown、表情短码、图片）')}
            className="w-full min-h-[96px] resize-none border-2 border-gray-200 rounded-lg p-3 text-sm font-sans focus:border-ink outline-none"
            maxLength={textMaxLength}
            disabled={Boolean(mutedUntil || mutedReason) || status !== 'online' || chatRuleBlocked}
          />

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              ref={uploadInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  void handleUploadFile(file);
                }
                event.target.value = '';
              }}
            />
            <SketchIconButton
              onClick={handlePickUpload}
                disabled={uploading || status !== 'online' || Boolean(mutedUntil || mutedReason) || chatRuleBlocked}
              label={uploading ? '上传中' : '上传图片'}
              icon={<Image className="w-4 h-4" />}
              variant="doodle"
              iconOnly
              className="h-10 w-10 px-0"
            />
            <div className="relative">
              <SketchIconButton
                ref={memeButtonRef}
                onClick={() => setMemeOpen((prev) => !prev)}
                disabled={status !== 'online' || Boolean(mutedUntil || mutedReason) || chatRuleBlocked}
                label="表情"
                icon={<Smile className="w-4 h-4" />}
                variant={memeOpen ? 'active' : 'doodle'}
                iconOnly
                className="h-10 w-10 px-0"
              />
              <MemePicker
                open={memeOpen}
                onClose={() => setMemeOpen(false)}
                anchorRef={memeButtonRef}
                onSelect={(packName, label) => {
                  insertMeme(packName, label);
                  setMemeOpen(false);
                }}
              />
            </div>

          </div>

          <p className="mt-2 text-[11px] text-pencil font-sans">
            当前限制：{sendIntervalSeconds} 秒/条，单条最多 {textMaxLength} 字。
          </p>

          <div className="mt-2 flex items-center justify-end gap-2">
            <span className={`text-xs font-sans ${input.length > textMaxLength ? 'text-red-500' : 'text-pencil'}`}>
              {input.length} / {textMaxLength}
            </span>
            <SketchButton
              className="h-10 px-4 text-sm flex items-center gap-1"
              disabled={status !== 'online' || !input.trim() || input.trim().length > textMaxLength || Boolean(mutedUntil || mutedReason) || chatRuleBlocked}
              onClick={handleSend}
            >
              <Send className="w-4 h-4" />
              发送
            </SketchButton>
          </div>
        </div>
      </section>

      <aside className="w-full md:w-72 shrink-0 bg-white border-2 border-ink rounded-xl shadow-sketch p-4 flex flex-col">
        <h3 className="font-display text-xl text-ink">在线成员</h3>
        <div className="mt-2 text-sm font-sans text-ink">
          在线人数：<span className="font-bold">{onlineCount}</span>
        </div>
        <div className="mt-3 overflow-auto max-h-[50vh] space-y-2 pr-1">
          {onlineUsers.length === 0 ? (
            <p className="text-sm text-pencil font-hand">暂无在线成员</p>
          ) : (
            onlineUsers.map((user) => (
              <div key={`${user.nickname}-${user.joinedAt}`} className="border border-gray-200 rounded-lg px-3 py-2 bg-gray-50">
                <p className="text-sm font-sans font-bold text-ink inline-flex items-center gap-1.5">
                  <span>{user.nickname}</span>
                  {user.isAdmin && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full border border-emerald-300 bg-emerald-50 text-emerald-700 text-[10px] font-bold">
                      <Shield className="w-3 h-3 mr-1" />
                      管理员
                    </span>
                  )}
                </p>
              </div>
            ))
          )}
        </div>
      </aside>
    </div>
  );
};

export default ChatRoomView;
