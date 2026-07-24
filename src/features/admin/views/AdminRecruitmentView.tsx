import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Ban,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  Flag,
  Handshake,
  Lock,
  MessageSquare,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Trash2,
  Unlock,
} from 'lucide-react';

import { api } from '@/api';
import Modal from '@/components/Modal';
import { Badge, SketchButton } from '@/components/SketchUI';
import { useAppActions } from '@/store/AppActionsContext';

type ReportStatus = 'pending' | 'reviewing' | 'resolved' | 'dismissed' | 'all';
type ReportTargetType = 'post' | 'thread' | 'message' | 'contact_exchange' | 'all';
type BanPermission = 'recruit' | 'chat' | 'site';

type RecruitmentReport = {
  id: string;
  targetType: Exclude<ReportTargetType, 'all'>;
  postId?: string | null;
  threadId?: string | null;
  messageId?: string | null;
  contactExchangeId?: string | null;
  reasonCode: string;
  detail: string;
  status: Exclude<ReportStatus, 'all'>;
  action?: string | null;
  resolution?: string | null;
  createdAt: number;
  reviewedAt?: number | null;
  reviewedBy?: string | null;
  evidenceCount: number;
  target?: {
    post?: { id: string; xinfaId?: string | null; contentSnippet?: string; status?: string | null; moderationStatus?: string | null } | null;
    thread?: { id: string; status?: string | null; lockedAt?: number | null } | null;
    message?: { id: string; moderationStatus?: string | null; deletedAt?: number | null } | null;
    contactExchange?: { id: string; moderationStatus?: string | null; deletedAt?: number | null } | null;
  };
};

type EvidenceItem = {
  id: string;
  type: 'message' | 'contact_exchange';
  position: number;
  threadId?: string | null;
  senderRole?: 'publisher' | 'applicant' | null;
  isReportedParty?: boolean;
  content?: string | null;
  createdAt: number;
  moderationStatus?: string | null;
};

type ContactEvidence = {
  exchangeId: string;
  threadId?: string | null;
  status?: string | null;
  deleted?: boolean;
  contact?: { type?: string; value?: string; label?: string } | null;
};

type EvidenceResponse = {
  evidence: EvidenceItem[];
  contact?: ContactEvidence | null;
  auditedAt?: number;
};

type ActionState = {
  kind: 'report' | 'post' | 'thread' | 'message' | 'contact_exchange';
  id: string;
  reportId: string;
  action: string;
  title: string;
  reason: string;
  permissions: BanPermission[];
};

interface AdminRecruitmentViewProps {
  canManage: boolean;
  canManageUserSafety: boolean;
  onPendingCountChange?: (count: number) => void;
}

const PAGE_SIZE = 12;

const formatTime = (value?: number | null) => value
  ? new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '-';

const targetLabel = (type: Exclude<ReportTargetType, 'all'>) => ({
  post: '招募',
  thread: '密聊会话',
  message: '密聊消息',
  contact_exchange: '联系方式',
}[type]);

const statusLabel = (status: ReportStatus) => ({
  pending: '待处理',
  reviewing: '复核中',
  resolved: '已处理',
  dismissed: '已忽略',
  all: '全部',
}[status]);

const reasonLabel = (reason: string) => ({
  spam: '垃圾招募',
  harassment: '骚扰',
  privacy: '隐私风险',
  scam: '诈骗风险',
  other: '其他',
}[reason] || reason || '未说明');

const normalizeReports = (value: unknown): { items: RecruitmentReport[]; total: number; page: number; limit: number } => {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const items = Array.isArray(data.items) ? data.items as RecruitmentReport[] : [];
  return {
    items,
    total: Number(data.total || 0),
    page: Number(data.page || 1),
    limit: Number(data.limit || PAGE_SIZE),
  };
};

const AdminRecruitmentView: React.FC<AdminRecruitmentViewProps> = ({
  canManage,
  canManageUserSafety,
  onPendingCountChange,
}) => {
  const { showToast } = useAppActions();
  const [status, setStatus] = useState<ReportStatus>('pending');
  const [targetType, setTargetType] = useState<ReportTargetType>('all');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<RecruitmentReport[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionState, setActionState] = useState<ActionState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [evidenceReport, setEvidenceReport] = useState<RecruitmentReport | null>(null);
  const [evidenceReason, setEvidenceReason] = useState('');
  const [evidence, setEvidence] = useState<EvidenceResponse | null>(null);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);

  const loadReports = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = normalizeReports(await api.getAdminRecruitmentReports({
        status,
        targetType,
        page,
        limit: PAGE_SIZE,
      }));
      setItems(data.items);
      setTotal(data.total);
      onPendingCountChange?.(status === 'pending' ? data.total : 0);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '招募举报加载失败');
      setItems([]);
      setTotal(0);
      onPendingCountChange?.(0);
    } finally {
      setLoading(false);
    }
  }, [onPendingCountChange, page, status, targetType]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const canGoPrev = page > 1;
  const canGoNext = page < totalPages;

  const openEvidence = (report: RecruitmentReport) => {
    setEvidenceReport(report);
    setEvidenceReason('');
    setEvidence(null);
    setEvidenceError(null);
  };

  const loadEvidence = async () => {
    if (!evidenceReport || !evidenceReason.trim()) {
      showToast('请填写查看理由，便于隐私审计', 'warning');
      return;
    }
    setEvidenceLoading(true);
    setEvidenceError(null);
    try {
      const data = await api.getAdminRecruitmentEvidence(evidenceReport.id, evidenceReason.trim()) as EvidenceResponse;
      setEvidence(data);
    } catch (requestError) {
      setEvidenceError(requestError instanceof Error ? requestError.message : '证据加载失败');
    } finally {
      setEvidenceLoading(false);
    }
  };

  const openReportAction = (report: RecruitmentReport, action: ActionState['action']) => {
    setActionState({
      kind: 'report',
      id: report.id,
      reportId: report.id,
      action,
      title: action === 'ban' ? '封禁举报对象' : action === 'resolve' ? '处理招募举报' : '忽略招募举报',
      reason: '',
      permissions: ['recruit', 'chat'],
    });
  };

  const openTargetAction = (
    kind: ActionState['kind'],
    id: string,
    action: string,
    title: string,
    reportId: string,
  ) => setActionState({ kind, id, reportId, action, title, reason: '', permissions: ['recruit', 'chat'] });

  const openEvidenceMessageAction = (item: EvidenceItem) => {
    if (!evidenceReport || item.type !== 'message') return;
    const removed = item.moderationStatus === 'removed';
    const reportId = evidenceReport.id;
    setEvidenceReport(null);
    setEvidence(null);
    openTargetAction(
      'message',
      item.id,
      removed ? 'restore' : 'remove',
      removed ? '恢复证据消息' : '删除证据消息',
      reportId,
    );
  };

  const submitAction = async () => {
    if (!actionState || !actionState.reason.trim()) {
      showToast('请填写处理理由', 'warning');
      return;
    }
    if (actionState.kind === 'report' && actionState.action === 'ban' && !canManageUserSafety) {
      showToast('封禁还需要用户处置权限', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const reason = actionState.reason.trim();
      if (actionState.kind === 'report') {
        await api.handleAdminRecruitmentReport(actionState.id, actionState.action as 'ignore' | 'resolve' | 'ban', reason, {
          permissions: actionState.permissions,
        });
      } else if (actionState.kind === 'post') {
        await api.handleAdminRecruitmentPost(actionState.id, actionState.action as 'remove' | 'restore', reason, actionState.reportId);
      } else if (actionState.kind === 'thread') {
        await api.handleAdminRecruitmentThread(actionState.id, actionState.action as 'lock' | 'unlock', reason, actionState.reportId);
      } else if (actionState.kind === 'message') {
        await api.handleAdminRecruitmentMessage(actionState.id, actionState.action as 'remove' | 'restore', reason, actionState.reportId);
      } else {
        await api.handleAdminRecruitmentContactExchange(actionState.id, actionState.action as 'remove' | 'restore', reason, actionState.reportId);
      }
      showToast('招募治理操作已完成', 'success');
      setActionState(null);
      await loadReports();
    } catch (requestError) {
      showToast(requestError instanceof Error ? requestError.message : '治理操作失败', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleBanPermission = (permission: BanPermission) => {
    setActionState((current) => {
      if (!current) return current;
      const exists = current.permissions.includes(permission);
      const permissions = exists
        ? current.permissions.filter((item) => item !== permission)
        : [...current.permissions, permission];
      return { ...current, permissions };
    });
  };

  const renderTargetActions = (report: RecruitmentReport) => {
    if (!canManage) return null;
    const target = report.target || {};
    const actions: React.ReactNode[] = [];
    if (report.targetType === 'post' && report.postId && target.post) {
      const removed = target.post.moderationStatus === 'removed';
      actions.push(
        <button
          key="post"
          type="button"
          onClick={() => openTargetAction('post', report.postId as string, removed ? 'restore' : 'remove', removed ? '恢复招募' : '下架招募', report.id)}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-ink px-2.5 text-xs font-bold hover:bg-highlight"
        >
          {removed ? <RotateCcw className="size-3.5" aria-hidden="true" /> : <Trash2 className="size-3.5" aria-hidden="true" />}
          {removed ? '恢复招募' : '下架招募'}
        </button>,
      );
    }
    if (report.targetType === 'thread' && report.threadId && target.thread) {
      const locked = Boolean(target.thread.lockedAt);
      actions.push(
        <button
          key="thread"
          type="button"
          onClick={() => openTargetAction('thread', report.threadId as string, locked ? 'unlock' : 'lock', locked ? '解锁会话' : '锁定会话', report.id)}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-ink px-2.5 text-xs font-bold hover:bg-highlight"
        >
          {locked ? <Unlock className="size-3.5" aria-hidden="true" /> : <Lock className="size-3.5" aria-hidden="true" />}
          {locked ? '解锁会话' : '锁定会话'}
        </button>,
      );
    }
    if (report.targetType === 'message' && report.messageId && target.message) {
      const removed = target.message.moderationStatus === 'removed';
      actions.push(
        <button
          key="message"
          type="button"
          onClick={() => openTargetAction('message', report.messageId as string, removed ? 'restore' : 'remove', removed ? '恢复消息' : '删除消息', report.id)}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-ink px-2.5 text-xs font-bold hover:bg-highlight"
        >
          {removed ? <RotateCcw className="size-3.5" aria-hidden="true" /> : <Trash2 className="size-3.5" aria-hidden="true" />}
          {removed ? '恢复消息' : '删除消息'}
        </button>,
      );
    }
    if (report.targetType === 'contact_exchange' && report.contactExchangeId && target.contactExchange) {
      const removed = target.contactExchange.moderationStatus === 'removed';
      actions.push(
        <button
          key="contact"
          type="button"
          onClick={() => openTargetAction('contact_exchange', report.contactExchangeId as string, removed ? 'restore' : 'remove', removed ? '恢复联系方式' : '删除联系方式', report.id)}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-ink px-2.5 text-xs font-bold hover:bg-highlight"
        >
          <Handshake className="size-3.5" aria-hidden="true" />
          {removed ? '恢复联系方式' : '删除联系方式'}
        </button>,
      );
    }
    return actions.length ? <div className="flex flex-wrap gap-2">{actions}</div> : null;
  };

  const statusOptions: ReportStatus[] = ['pending', 'reviewing', 'resolved', 'dismissed', 'all'];
  const targetOptions: ReportTargetType[] = ['all', 'post', 'thread', 'message', 'contact_exchange'];

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ShieldAlert className="size-6 text-ink" aria-hidden="true" />
            <h3 className="font-display text-2xl text-ink">招募治理</h3>
          </div>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-pencil">只通过具体举报查看有限证据，不提供全部密聊浏览或全文搜索。</p>
        </div>
        <button
          type="button"
          onClick={() => void loadReports()}
          disabled={loading}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border-2 border-ink bg-white px-3 py-2 text-sm font-bold shadow-sketch disabled:cursor-not-allowed disabled:opacity-60"
          title="刷新举报"
        >
          <RefreshCw className={`size-4 ${loading ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" />
          刷新
        </button>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b-2 border-dashed border-ink/20 pb-4">
        <span className="mr-1 text-xs font-bold text-pencil">状态</span>
        {statusOptions.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => { setStatus(item); setPage(1); }}
            className={`rounded-md border-2 px-3 py-1.5 text-xs font-bold transition-colors ${status === item ? 'border-ink bg-highlight' : 'border-transparent bg-white hover:border-ink'}`}
          >
            {statusLabel(item)}
          </button>
        ))}
        <span className="ml-2 mr-1 text-xs font-bold text-pencil">目标</span>
        <select
          value={targetType}
          onChange={(event) => { setTargetType(event.target.value as ReportTargetType); setPage(1); }}
          className="h-9 rounded-md border-2 border-ink bg-white px-2 text-xs font-bold outline-none focus:ring-2 focus:ring-marker-blue"
          aria-label="举报目标类型"
        >
          {targetOptions.map((item) => <option key={item} value={item}>{item === 'all' ? '全部' : targetLabel(item)}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="grid gap-3" aria-busy="true" aria-label="招募举报加载中">
          {[0, 1, 2].map((item) => <div key={item} className="h-32 animate-pulse rounded-lg border-2 border-ink/10 bg-white motion-reduce:animate-none" />)}
        </div>
      ) : error ? (
        <div className="flex min-h-48 flex-col items-center justify-center rounded-lg border-2 border-alert bg-red-50 px-4 text-center" role="alert">
          <p className="max-w-md break-words text-sm leading-6 text-ink">{error}</p>
          <button type="button" onClick={() => void loadReports()} className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-lg border-2 border-ink bg-white px-3 py-2 text-sm font-bold shadow-sketch">
            <RefreshCw className="size-4" aria-hidden="true" /> 重试
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="flex min-h-56 flex-col items-center justify-center rounded-lg border-2 border-dashed border-ink/25 bg-white px-4 text-center">
          <CheckCircle2 className="mb-3 size-9 text-marker-green" aria-hidden="true" />
          <h4 className="font-display text-xl text-ink">没有匹配的招募举报</h4>
          <p className="mt-1 text-sm text-pencil">当前筛选条件下暂无需要处理的记录。</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {items.map((report) => {
            const postTarget = report.target?.post;
            return (
              <article key={report.id} className="rounded-lg border-2 border-ink bg-white p-4 shadow-sketch-sm sm:p-5">
                <div className="flex flex-col gap-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-pencil">
                    <Badge color="bg-highlight">{targetLabel(report.targetType)}</Badge>
                    <Badge color={report.status === 'pending' ? 'bg-alert/60' : 'bg-gray-100'}>{statusLabel(report.status)}</Badge>
                    <span className="font-mono">#{report.id}</span>
                    <span>{formatTime(report.createdAt)}</span>
                    <span>证据 {report.evidenceCount}</span>
                  </div>
                  <div className="grid min-w-0 gap-2">
                    <div className="flex min-w-0 items-center gap-2 text-sm font-bold text-ink">
                      <Flag className="size-4 shrink-0" aria-hidden="true" />
                      <span>{reasonLabel(report.reasonCode)}</span>
                    </div>
                    <p className="whitespace-pre-wrap break-words text-sm leading-6 text-ink">{report.detail || '（未填写补充说明）'}</p>
                    {postTarget?.contentSnippet && (
                      <div className="border-l-4 border-marker-blue bg-marker-blue/10 px-3 py-2 text-sm leading-6 text-ink">
                        <span className="mr-1 text-xs font-bold text-pencil">招募摘要</span>
                        <span className="break-words">{postTarget.contentSnippet}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 border-t-2 border-dashed border-ink/15 pt-3">
                    <button
                      type="button"
                      onClick={() => openEvidence(report)}
                      disabled={!canManage}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-md border-2 border-ink bg-white px-3 text-xs font-bold shadow-sketch-sm disabled:cursor-not-allowed disabled:opacity-50"
                      title="按举报 ID 查看有限证据"
                    >
                      <Eye className="size-3.5" aria-hidden="true" /> 查看有限证据
                    </button>
                    {report.status === 'pending' || report.status === 'reviewing' ? (
                      <>
                        <button type="button" onClick={() => openReportAction(report, 'resolve')} disabled={!canManage} className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-ink bg-highlight px-3 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-50">
                          <CheckCircle2 className="size-3.5" aria-hidden="true" /> 处理
                        </button>
                        <button type="button" onClick={() => openReportAction(report, 'ignore')} disabled={!canManage} className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-ink bg-white px-3 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-50">
                          忽略
                        </button>
                        <button type="button" onClick={() => openReportAction(report, 'ban')} disabled={!canManage || !canManageUserSafety} className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-ink bg-alert/55 px-3 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-50" title={canManageUserSafety ? '同时需要招募治理和用户处置权限' : '需要用户处置权限'}>
                          <Ban className="size-3.5" aria-hidden="true" /> 封禁
                        </button>
                      </>
                    ) : null}
                    {renderTargetActions(report)}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {total > 0 && (
        <div className="flex items-center justify-center gap-3 text-xs text-pencil">
          <button type="button" disabled={!canGoPrev} onClick={() => setPage((value) => Math.max(1, value - 1))} className="inline-flex size-9 items-center justify-center rounded-md border-2 border-ink bg-white disabled:cursor-not-allowed disabled:opacity-40" title="上一页" aria-label="上一页"><ChevronLeft className="size-4" aria-hidden="true" /></button>
          <span>第 {page} / {totalPages} 页 · 共 {total} 条</span>
          <button type="button" disabled={!canGoNext} onClick={() => setPage((value) => Math.min(totalPages, value + 1))} className="inline-flex size-9 items-center justify-center rounded-md border-2 border-ink bg-white disabled:cursor-not-allowed disabled:opacity-40" title="下一页" aria-label="下一页"><ChevronRight className="size-4" aria-hidden="true" /></button>
        </div>
      )}

      <Modal isOpen={Boolean(evidenceReport)} onClose={() => { if (!evidenceLoading) setEvidenceReport(null); }} title="有限证据" panelClassName="max-w-2xl">
        <div className="grid gap-4">
          <div className="flex items-start gap-2 rounded-lg border-2 border-dashed border-ink/25 bg-marker-yellow/20 p-3 text-sm leading-6 text-ink">
            <ShieldAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            <p className="min-w-0 break-words">只展示该举报已关联的证据。每次查看都会记录隐私审计，不会开放同一会话的其他消息。</p>
          </div>
          {!evidence && (
            <>
              <label className="grid gap-2 text-sm font-bold text-ink" htmlFor="recruitment-evidence-reason">
                查看理由
                <textarea id="recruitment-evidence-reason" value={evidenceReason} onChange={(event) => setEvidenceReason(event.target.value)} maxLength={500} rows={3} className="w-full resize-y rounded-lg border-2 border-ink bg-white p-3 text-sm font-normal leading-6 outline-none focus:ring-2 focus:ring-marker-blue" placeholder="说明为什么需要查看这条举报的密聊证据" />
              </label>
              {evidenceError && <p className="text-sm leading-6 text-red-700" role="alert">{evidenceError}</p>}
              <SketchButton type="button" fullWidth disabled={evidenceLoading || !evidenceReason.trim()} onClick={() => void loadEvidence()} className="inline-flex min-h-11 items-center justify-center gap-2">
                <Eye className="size-4" aria-hidden="true" /> {evidenceLoading ? '读取中...' : '确认查看'}
              </SketchButton>
            </>
          )}
          {evidence && (
            <div className="grid max-h-[60vh] gap-4 overflow-y-auto">
              <div className="text-xs text-pencil">举报 #{evidenceReport?.id} · 审计时间 {formatTime(evidence.auditedAt)}</div>
              {evidence.evidence.length === 0 ? (
                <p className="rounded-lg border border-dashed border-ink/25 p-4 text-sm text-pencil">该举报没有消息证据。</p>
              ) : (
                <div className="grid gap-3">
                  {evidence.evidence.map((item) => (
                    <div key={`${item.type}-${item.id}`} className="rounded-lg border-2 border-ink/30 bg-paper-soft p-3">
                      <div className="mb-2 flex items-center gap-2 text-xs text-pencil">
                        <MessageSquare className="size-3.5" aria-hidden="true" />
                        <span>消息证据 · {item.isReportedParty ? '被举报方' : '举报方'} · {formatTime(item.createdAt)}</span>
                        {item.moderationStatus === 'removed' && <Badge color="bg-alert/50">已删除</Badge>}
                      </div>
                      <p className="whitespace-pre-wrap break-words text-sm leading-6 text-ink">{item.content || '（消息已删除）'}</p>
                      {canManage && (
                        <button
                          type="button"
                          onClick={() => openEvidenceMessageAction(item)}
                          className="mt-3 inline-flex min-h-8 items-center gap-1.5 rounded-md border border-ink/30 bg-white px-2.5 text-xs font-bold hover:bg-highlight"
                        >
                          {item.moderationStatus === 'removed'
                            ? <RotateCcw className="size-3.5" aria-hidden="true" />
                            : <Trash2 className="size-3.5" aria-hidden="true" />}
                          {item.moderationStatus === 'removed' ? '恢复消息' : '删除消息'}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {evidence.contact && (
                <div className="rounded-lg border-2 border-ink/30 bg-paper-soft p-3">
                  <div className="mb-2 flex items-center gap-2 text-xs text-pencil"><Handshake className="size-3.5" aria-hidden="true" /> 联系方式证据</div>
                  <p className="whitespace-pre-wrap break-words text-sm leading-6 text-ink">
                    {evidence.contact.contact?.value || (evidence.contact.deleted ? '（联系方式已删除）' : '（未提供联系方式）')}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>

      <Modal isOpen={Boolean(actionState)} onClose={() => { if (!submitting) setActionState(null); }} title={actionState?.title || '招募治理'} panelClassName="max-w-lg">
        {actionState && (
          <div className="grid gap-4">
            <p className="break-words text-sm leading-6 text-pencil">目标：<span className="font-mono text-ink">{actionState.id}</span></p>
            {actionState.kind === 'report' && actionState.action === 'ban' && (
              <div className="grid gap-2">
                <p className="text-sm font-bold text-ink">封禁范围</p>
                <div className="flex flex-wrap gap-2">
                  {(['recruit', 'chat', 'site'] as BanPermission[]).map((permission) => (
                    <label key={permission} className="inline-flex items-center gap-2 rounded-md border border-ink/30 bg-white px-3 py-2 text-xs font-bold">
                      <input type="checkbox" checked={actionState.permissions.includes(permission)} onChange={() => toggleBanPermission(permission)} className="accent-black" />
                      {permission === 'recruit' ? '招募' : permission === 'chat' ? '密聊' : '全站'}
                    </label>
                  ))}
                </div>
                <p className="text-xs leading-5 text-pencil">封禁动作同时需要“招募治理”和“用户处置”处理权限。</p>
              </div>
            )}
            <label className="grid gap-2 text-sm font-bold text-ink" htmlFor="recruitment-action-reason">
              处理理由
              <textarea id="recruitment-action-reason" value={actionState.reason} onChange={(event) => setActionState((current) => current ? { ...current, reason: event.target.value } : current)} maxLength={500} rows={4} className="w-full resize-y rounded-lg border-2 border-ink bg-white p-3 text-sm font-normal leading-6 outline-none focus:ring-2 focus:ring-marker-blue" placeholder="填写理由，便于审计与复核" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <SketchButton type="button" variant="secondary" disabled={submitting} onClick={() => setActionState(null)}>取消</SketchButton>
              <SketchButton type="button" variant={actionState.action === 'ban' || actionState.action === 'remove' ? 'danger' : 'primary'} disabled={submitting || (actionState.kind === 'report' && actionState.action === 'ban' && actionState.permissions.length === 0)} onClick={() => void submitAction()}>
                {submitting ? '处理中...' : '确认操作'}
              </SketchButton>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
};

export default AdminRecruitmentView;
