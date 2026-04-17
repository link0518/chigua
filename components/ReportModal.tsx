import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Flag } from 'lucide-react';

import Modal from './Modal';
import { SketchButton } from './SketchUI';
import { useApp } from '../store/AppContext';
import type { ReportReasonCode, ReportSubmissionPayload } from '../types';

interface ReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  postId?: string;
  commentId?: string;
  chatMessageId?: number;
  targetType?: 'post' | 'comment' | 'chat';
  contentPreview?: string;
}

type ReportReasonOption = {
  id: ReportReasonCode | 'other';
  label: string;
  desc: string;
  highlight?: boolean;
  requireEvidence?: boolean;
};

const DEFAULT_REASONS: ReportReasonOption[] = [
  { id: 'privacy', label: '隐私风险', desc: '泄露他人隐私信息' },
  { id: 'harassment', label: '骚扰辱骂', desc: '人身攻击、恶意骚扰或辱骂' },
  { id: 'spam', label: '垃圾广告', desc: '营销推广、引流或重复刷屏' },
  { id: 'misinformation', label: '虚假信息', desc: '明显失实或误导性内容' },
  {
    id: 'rumor',
    label: '举报谣言',
    desc: '怀疑内容捏造、夸大，或缺乏可信证据',
    highlight: true,
    requireEvidence: true,
  },
];

const CHAT_REASONS: ReportReasonOption[] = [
  { id: 'privacy', label: '隐私风险', desc: '泄露他人隐私信息' },
  { id: 'harassment', label: '骚扰辱骂', desc: '人身攻击、恶意骚扰或辱骂' },
  { id: 'spam', label: '垃圾广告', desc: '营销推广、引流或重复刷屏' },
  { id: 'misinformation', label: '虚假信息', desc: '明显失实或误导性内容' },
  { id: 'other', label: '其他', desc: '其他不适宜内容' },
];

const ReportModal: React.FC<ReportModalProps> = ({
  isOpen,
  onClose,
  postId,
  commentId,
  chatMessageId,
  targetType = 'post',
  contentPreview,
}) => {
  const { reportPost, reportComment, reportChatMessage, showToast } = useApp();
  const [selectedReason, setSelectedReason] = useState<string>('');
  const [otherReason, setOtherReason] = useState('');
  const [evidence, setEvidence] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const reasons = useMemo(
    () => (targetType === 'chat' ? CHAT_REASONS : DEFAULT_REASONS),
    [targetType]
  );

  const selectedReasonItem = reasons.find((item) => item.id === selectedReason);
  const requiresEvidence = Boolean(selectedReasonItem?.requireEvidence);
  const requiresOtherReason = selectedReason === 'other';

  const resetForm = () => {
    setSelectedReason('');
    setOtherReason('');
    setEvidence('');
  };

  useEffect(() => {
    if (!isOpen) {
      resetForm();
    }
  }, [isOpen]);

  const buildPayload = (): ReportSubmissionPayload | null => {
    if (!selectedReasonItem) {
      return null;
    }
    if (requiresOtherReason) {
      const reason = otherReason.trim();
      if (!reason) {
        return null;
      }
      return { reason };
    }
    return {
      reason: selectedReasonItem.label,
      reasonCode: selectedReasonItem.id === 'other' ? undefined : selectedReasonItem.id,
      evidence: requiresEvidence ? evidence.trim() : undefined,
    };
  };

  const handleSubmit = async () => {
    const payload = buildPayload();
    if (!payload) {
      return;
    }
    if (requiresEvidence && !payload.evidence) {
      return;
    }

    setIsSubmitting(true);
    try {
      let result = null;
      if (targetType === 'comment') {
        if (!commentId) {
          throw new Error('评论不存在');
        }
        result = await reportComment(commentId, payload);
      } else if (targetType === 'chat') {
        if (!chatMessageId || chatMessageId <= 0) {
          throw new Error('消息不存在');
        }
        await reportChatMessage(chatMessageId, payload.reason);
      } else {
        if (!postId) {
          throw new Error('帖子不存在');
        }
        result = await reportPost(postId, payload);
      }

      resetForm();
      onClose();
      if (result?.autoHidden) {
        showToast(targetType === 'comment' ? '举报已提交，该评论已暂时隐藏' : '举报已提交，该帖子已暂时隐藏', 'success');
      } else {
        showToast('举报已提交，感谢你的反馈', 'success');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '举报失败，请稍后重试';
      showToast(message, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isSubmitDisabled = !selectedReason
    || (requiresOtherReason && !otherReason.trim())
    || (requiresEvidence && !evidence.trim())
    || isSubmitting;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="举报内容">
      <div className="flex flex-col gap-4">
        {contentPreview && (
          <div className="rounded-lg border border-dashed border-ink bg-gray-50 p-3">
            <p className="line-clamp-2 font-sans text-sm text-pencil">"{contentPreview}"</p>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <label className="font-hand text-lg font-bold text-ink">举报原因</label>
          <div className="flex flex-col gap-2">
            {reasons.map((reason) => {
              const selected = selectedReason === reason.id;
              const isHighlight = Boolean(reason.highlight);
              return (
                <label
                  key={reason.id}
                  className={`cursor-pointer rounded-lg border-2 p-3 transition-all ${selected
                    ? isHighlight
                      ? 'border-red-500 bg-red-50 shadow-sketch-sm'
                      : 'border-ink bg-highlight/30'
                    : isHighlight
                      ? 'border-red-200 bg-red-50/60 hover:border-red-400'
                      : 'border-gray-200 hover:border-ink/50'
                    }`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="radio"
                      name="reportReason"
                      value={reason.id}
                      checked={selected}
                      onChange={(event) => setSelectedReason(event.target.value)}
                      className="mt-1 accent-ink"
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {isHighlight && <AlertTriangle className="h-4 w-4 text-red-500" />}
                        <span className={`font-hand font-bold ${isHighlight ? 'text-red-600' : 'text-ink'}`}>
                          {reason.label}
                        </span>
                      </div>
                      <p className="text-xs text-pencil">{reason.desc}</p>
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        {requiresOtherReason && (
          <div className="flex flex-col gap-1">
            <label className="font-hand text-sm font-bold text-ink">请补充具体原因</label>
            <textarea
              value={otherReason}
              onChange={(event) => setOtherReason(event.target.value)}
              placeholder="请描述你的举报原因..."
              className="h-20 w-full resize-none rounded-lg border-2 border-ink p-3 font-sans focus:outline-none focus:shadow-sketch-sm transition-shadow"
            />
          </div>
        )}

        {requiresEvidence && (
          <div className="flex flex-col gap-2 rounded-xl border-2 border-red-200 bg-red-50/80 p-4">
            <label className="font-hand text-base font-bold text-red-700">请填写你判断是谣言的原因或证据</label>
            <textarea
              value={evidence}
              onChange={(event) => setEvidence(event.target.value)}
              placeholder="例如：与已公开公告矛盾、时间线对不上、没有可信来源、截图疑似拼接等"
              className="h-28 w-full resize-none rounded-lg border-2 border-red-200 bg-white p-3 font-sans text-sm focus:border-red-400 focus:outline-none"
              maxLength={500}
            />
            <div className="flex items-center justify-between text-xs text-red-600/80">
              <span>务必详细描述原因，方便审核判断。</span>
              <span>{evidence.length} / 500</span>
            </div>
          </div>
        )}

        <div className="mt-2 flex gap-3">
          <SketchButton
            variant="secondary"
            className="flex-1"
            onClick={() => {
              resetForm();
              onClose();
            }}
          >
            取消
          </SketchButton>
          <SketchButton
            variant="danger"
            className="flex-1 flex items-center justify-center gap-2"
            onClick={handleSubmit}
            disabled={isSubmitDisabled}
          >
            <Flag className="h-4 w-4" />
            {isSubmitting ? '提交中...' : '提交举报'}
          </SketchButton>
        </div>
      </div>
    </Modal>
  );
};

export default ReportModal;
