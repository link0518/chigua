import React, { useState } from 'react';
import { Flag } from 'lucide-react';
import Modal from './Modal';
import { SketchButton } from './SketchUI';
import { useApp } from '../store/AppContext';

interface ReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  postId: string;
  contentPreview?: string;
}

const REPORT_REASONS = [
  { id: 'privacy', label: '隐私风险', desc: '泄露他人隐私信息' },
  { id: 'harassment', label: '骚扰辱骂', desc: '人身攻击或恶意骚扰' },
  { id: 'spam', label: '垃圾广告', desc: '推广或垃圾信息' },
  { id: 'misinformation', label: '虚假信息', desc: '明显不实内容' },
  { id: 'other', label: '其他', desc: '其他违规行为' },
];

const ReportModal: React.FC<ReportModalProps> = ({
  isOpen,
  onClose,
  postId,
  contentPreview,
}) => {
  const { reportPost, showToast } = useApp();
  const [selectedReason, setSelectedReason] = useState<string>('');
  const [customReason, setCustomReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!selectedReason) return;

    setIsSubmitting(true);

    const reason = selectedReason === 'other' ? customReason : REPORT_REASONS.find(r => r.id === selectedReason)?.label || '';
    try {
      await reportPost(postId, reason);
      setSelectedReason('');
      setCustomReason('');
      onClose();
      showToast('举报已提交，感谢您的反馈！', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '举报失败，请稍后重试';
      showToast(message, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="举报内容">
      <div className="flex flex-col gap-4">
        {/* Content Preview */}
        {contentPreview && (
          <div className="p-3 bg-gray-50 border border-dashed border-ink rounded-lg">
            <p className="text-sm text-pencil font-sans line-clamp-2">"{contentPreview}"</p>
          </div>
        )}

        {/* Reason Selection */}
        <div className="flex flex-col gap-2">
          <label className="font-hand font-bold text-lg text-ink">举报原因</label>
          <div className="flex flex-col gap-2">
            {REPORT_REASONS.map(reason => (
              <label
                key={reason.id}
                className={`flex items-start gap-3 p-3 border-2 rounded-lg cursor-pointer transition-all ${
                  selectedReason === reason.id
                    ? 'border-ink bg-highlight/30'
                    : 'border-gray-200 hover:border-ink/50'
                }`}
              >
                <input
                  type="radio"
                  name="reportReason"
                  value={reason.id}
                  checked={selectedReason === reason.id}
                  onChange={(e) => setSelectedReason(e.target.value)}
                  className="mt-1 accent-ink"
                />
                <div>
                  <span className="font-hand font-bold text-ink">{reason.label}</span>
                  <p className="text-xs text-pencil">{reason.desc}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Custom Reason Input */}
        {selectedReason === 'other' && (
          <div className="flex flex-col gap-1">
            <label className="font-hand font-bold text-sm text-ink">请说明具体原因</label>
            <textarea
              value={customReason}
              onChange={(e) => setCustomReason(e.target.value)}
              placeholder="请描述您举报的原因..."
              className="w-full h-20 p-3 border-2 border-ink rounded-lg resize-none font-hand focus:outline-none focus:shadow-sketch-sm transition-shadow"
            />
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 mt-2">
          <SketchButton
            variant="secondary"
            className="flex-1"
            onClick={onClose}
          >
            取消
          </SketchButton>
          <SketchButton
            variant="danger"
            className="flex-1 flex items-center justify-center gap-2"
            onClick={handleSubmit}
            disabled={!selectedReason || (selectedReason === 'other' && !customReason.trim()) || isSubmitting}
          >
            <Flag className="w-4 h-4" />
            {isSubmitting ? '提交中...' : '提交举报'}
          </SketchButton>
        </div>
      </div>
    </Modal>
  );
};

export default ReportModal;
