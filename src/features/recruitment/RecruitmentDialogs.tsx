import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Flag, ShieldAlert } from 'lucide-react';

import { api } from '@/api';
import Modal from '@/components/Modal';
import Turnstile, { type TurnstileHandle } from '@/components/Turnstile';
import { useAppActions } from '@/store/AppActionsContext';
import { useAppShell } from '@/store/AppShellContext';
import type {
  RecruitmentMessage,
  RecruitmentParticipantRole,
  RecruitmentReportTargetType,
  RecruitmentXinfaOption,
} from '@/types';

interface XinfaSelectProps {
  id: string;
  label: string;
  value: string;
  options: RecruitmentXinfaOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}

export const XinfaSelect: React.FC<XinfaSelectProps> = ({
  id,
  label,
  value,
  options,
  onChange,
  disabled = false,
  autoFocus = false,
}) => (
  <div className="grid gap-2">
    <label htmlFor={id} className="text-sm font-semibold text-ink">
      {label}
    </label>
    <select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      autoFocus={autoFocus}
      className="min-h-11 w-full rounded-lg border border-ink/20 bg-white px-3 py-2 text-sm text-ink outline-none transition-colors hover:border-ink/45 focus:border-ink focus:ring-2 focus:ring-ink/15 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <option value="">请选择心法</option>
      {options.map((item) => (
        <option key={item.id} value={item.id}>
          {item.school && !item.name.startsWith(item.school) ? `${item.school} · ` : ''}{item.name}
        </option>
      ))}
    </select>
  </div>
);

interface IdentityNoticeDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const IdentityNoticeDialog: React.FC<IdentityNoticeDialogProps> = ({
  open,
  onConfirm,
  onCancel,
}) => (
  <Modal
    isOpen={open}
    onClose={onCancel}
    title="先确认一件事"
    showCloseButton={false}
    panelClassName="!max-w-md !rounded-xl !border !border-ink/15 !shadow-[0_18px_50px_rgba(44,44,44,0.14)]"
    titleClassName="!mb-5 !rotate-0 !font-sans !text-xl !font-semibold"
  >
    <div className="flex items-start gap-3 rounded-lg border border-ink/15 bg-highlight/25 p-4">
      <AlertTriangle className="mt-0.5 size-5 shrink-0 text-ink" aria-hidden="true" />
      <p className="min-w-0 break-words text-sm leading-6 text-ink">
        招募与密聊仅绑定当前浏览器，清除 Cookie 后无法找回。
      </p>
    </div>
    <div className="mt-5 grid grid-cols-2 gap-3">
      <button
        type="button"
        className="inline-flex min-h-11 min-w-0 items-center justify-center rounded-md border border-ink/20 bg-white px-3 text-sm font-semibold text-ink transition-colors hover:bg-paper-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
        onClick={onCancel}
      >
        取消
      </button>
      <button
        type="button"
        className="inline-flex min-h-11 min-w-0 items-center justify-center rounded-md bg-ink px-3 text-sm font-semibold text-white transition-colors hover:bg-pencil focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 active:scale-[0.98]"
        onClick={onConfirm}
      >
        我知道了
      </button>
    </div>
  </Modal>
);

interface RecruitmentReportDialogProps {
  open: boolean;
  targetType: RecruitmentReportTargetType;
  targetId: string;
  evidenceMessages?: RecruitmentMessage[];
  reportedRole?: RecruitmentParticipantRole;
  onClose: () => void;
  onReported?: () => void;
}

export const RecruitmentReportDialog: React.FC<RecruitmentReportDialogProps> = ({
  open,
  targetType,
  targetId,
  evidenceMessages = [],
  reportedRole,
  onClose,
  onReported,
}) => {
  const { showToast } = useAppActions();
  const { settings } = useAppShell();
  const [reason, setReason] = useState('');
  const [selectedEvidenceIds, setSelectedEvidenceIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const turnstileRef = useRef<TurnstileHandle | null>(null);
  const dismissedRef = useRef(false);
  const maxLength = 500;

  useEffect(() => {
    if (open) {
      dismissedRef.current = false;
      setReason('');
      setSelectedEvidenceIds([]);
    }
  }, [open, targetId]);

  const closeDialog = () => {
    // 请求可能仍在处理中；标记主动关闭，避免旧请求完成后影响新弹窗。
    dismissedRef.current = true;
    onClose();
  };

  const requestToken = async () => {
    if (!settings.turnstileEnabled) return '';
    if (!turnstileRef.current) throw new Error('安全验证加载中，请稍后再试');
    return turnstileRef.current.execute();
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalized = reason.trim();
    if (!normalized) {
      showToast('请填写举报原因', 'warning');
      return;
    }
    if (targetType === 'thread') {
      if (!selectedEvidenceIds.length) {
        showToast('请至少选择一条证据消息', 'warning');
        return;
      }
      const selectedMessages = evidenceMessages.filter((message) => selectedEvidenceIds.includes(message.id));
      if (!reportedRole || !selectedMessages.some((message) => message.senderRole === reportedRole)) {
        showToast('会话举报至少需要选择一条对方发送的消息', 'warning');
        return;
      }
    }
    setSubmitting(true);
    try {
      const turnstileToken = await requestToken();
      await api.reportRecruitment({
        targetType,
        targetId,
        reasonCode: 'other',
        detail: normalized,
        evidenceMessageIds: targetType === 'thread' ? selectedEvidenceIds : undefined,
        turnstileToken,
      });
      if (dismissedRef.current) return;
      showToast('举报已提交', 'success');
      onReported?.();
      onClose();
    } catch (error) {
      if (!dismissedRef.current) {
        showToast(error instanceof Error ? error.message : '举报失败，请稍后重试', 'error');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={open}
      onClose={closeDialog}
      title="举报"
      panelClassName={`${targetType === 'thread' ? '!max-w-2xl' : '!max-w-lg'} !rounded-xl !border !border-ink/15 !shadow-[0_18px_50px_rgba(44,44,44,0.14)]`}
      titleClassName="!mb-5 !rotate-0 !font-sans !text-xl !font-semibold"
      closeButtonClassName="!right-3 !top-3 !h-9 !w-9 !rounded-md !border !border-ink/15 !shadow-none hover:!bg-paper-soft focus-visible:!ring-ink"
    >
      <form className="grid gap-4" onSubmit={submit}>
        <div className="flex items-start gap-3 text-sm leading-6 text-pencil">
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-ink" aria-hidden="true" />
          <span>请说明需要处理的问题。</span>
        </div>
        {targetType === 'thread' && (
          <fieldset className="grid gap-2">
            <legend className="text-sm font-semibold text-ink">选择证据消息（1～20 条）</legend>
            <p className="text-xs leading-5 text-pencil">至少包含一条对方发送的消息；仅所选内容会进入后台证据链。</p>
            {evidenceMessages.length ? (
              <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border border-ink/15 bg-paper-soft/55 p-2">
                {evidenceMessages.map((message) => {
                  const checked = selectedEvidenceIds.includes(message.id);
                  const fromReportedParty = message.senderRole === reportedRole;
                  return (
                    <label key={message.id} className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm transition-colors ${checked ? 'border-ink bg-highlight/45' : 'border-transparent bg-white hover:border-ink/20'}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setSelectedEvidenceIds((current) => {
                            if (current.includes(message.id)) {
                              return current.filter((id) => id !== message.id);
                            }
                            if (current.length >= 20) {
                              showToast('单次最多选择 20 条证据消息', 'warning');
                              return current;
                            }
                            return [...current, message.id];
                          });
                        }}
                        className="mt-1 size-4 shrink-0 accent-black"
                      />
                      <span className="min-w-0">
                        <span className="block text-xs font-semibold text-pencil">{fromReportedParty ? '对方' : '我'}发送</span>
                        <span className="mt-1 block whitespace-pre-wrap break-words leading-6 text-ink">{message.content}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <p className="rounded-md border border-alert/45 bg-red-50/70 p-3 text-sm leading-6 text-ink">当前没有可选择的消息，请先保留相关对话后再举报会话。</p>
            )}
            <span className="justify-self-end text-xs tabular-nums text-pencil">已选择 {selectedEvidenceIds.length}/20</span>
          </fieldset>
        )}
        <div className="grid gap-2">
          <label htmlFor="recruitment-report-reason" className="text-sm font-semibold text-ink">
            举报原因
          </label>
          <textarea
            id="recruitment-report-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={maxLength}
            rows={5}
            autoFocus
            placeholder="请描述具体情况"
            className="w-full resize-y rounded-md border border-ink/20 bg-white p-3 text-sm leading-6 text-ink outline-none transition-colors hover:border-ink/45 focus:border-ink focus:ring-2 focus:ring-ink/15"
          />
          <span className="justify-self-end text-xs text-pencil">{reason.length}/{maxLength}</span>
        </div>
        <button
          type="submit"
          disabled={submitting || !reason.trim() || (targetType === 'thread' && selectedEvidenceIds.length === 0)}
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-alert px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-alert/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Flag className="size-4" aria-hidden="true" />
          {submitting ? '提交中...' : '提交举报'}
        </button>
        <Turnstile
          ref={turnstileRef}
          action="recruitment_report"
          enabled={settings.turnstileEnabled}
        />
      </form>
    </Modal>
  );
};
