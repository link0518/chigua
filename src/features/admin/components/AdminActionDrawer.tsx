import React from 'react';
import { X } from 'lucide-react';

import { Badge, SketchButton, roughBorderClass } from '@/components/SketchUI';

interface AdminActionDrawerProps {
  isOpen: boolean;
  title: string;
  actionLabel: string;
  actionVariant?: 'primary' | 'secondary' | 'danger';
  summary?: string;
  meta?: React.ReactNode;
  reason: string;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  submitting?: boolean;
  confirmDisabled?: boolean;
  children?: React.ReactNode;
  onReasonChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}

const AdminActionDrawer: React.FC<AdminActionDrawerProps> = ({
  isOpen,
  title,
  actionLabel,
  actionVariant = 'secondary',
  summary,
  meta,
  reason,
  reasonLabel = '处理理由（可选）',
  reasonPlaceholder = '填写理由便于审计追溯',
  submitting = false,
  confirmDisabled = false,
  children,
  onReasonChange,
  onClose,
  onConfirm,
}) => {
  if (!isOpen) {
    return null;
  }

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
        className={`absolute inset-y-3 right-3 w-[calc(100vw-1.5rem)] max-w-xl overflow-hidden border-2 border-ink bg-white shadow-sketch-lg ${roughBorderClass}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex h-full max-h-[calc(100vh-1.5rem)] flex-col">
          <div className="border-b-2 border-dashed border-ink/20 px-5 py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <Badge color="bg-highlight">统一处置</Badge>
                <h2 className="mt-2 font-display text-2xl text-ink">{title}</h2>
                {meta && <div className="mt-2 text-xs font-sans text-pencil">{meta}</div>}
              </div>
              <button
                type="button"
                className="rounded-full border-2 border-ink bg-white p-2 shadow-sketch transition-all hover:-translate-y-0.5 hover:bg-gray-50"
                onClick={onClose}
                disabled={submitting}
                aria-label="关闭处置面板"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            <div className="flex flex-col gap-4">
              {summary !== undefined && (
                <div className="rounded-2xl border border-dashed border-ink/30 bg-gray-50 px-4 py-3">
                  <p className="mb-2 text-xs font-bold text-pencil">处置对象</p>
                  <p className="line-clamp-5 whitespace-pre-wrap break-words text-sm font-sans leading-6 text-ink">
                    {summary || '（无内容）'}
                  </p>
                </div>
              )}

              {children}

              <label className="block">
                <span className="mb-2 block text-xs font-bold text-pencil">{reasonLabel}</span>
                <textarea
                  value={reason}
                  onChange={(event) => onReasonChange(event.target.value)}
                  className="h-28 w-full resize-none rounded-2xl border-2 border-gray-200 p-3 text-sm font-sans outline-none focus:border-ink"
                  placeholder={reasonPlaceholder}
                />
              </label>
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
              <SketchButton
                variant={actionVariant}
                className={`h-10 px-4 text-sm ${actionVariant === 'primary' ? 'text-white' : ''}`}
                onClick={onConfirm}
                disabled={submitting || confirmDisabled}
              >
                {submitting ? '处理中...' : actionLabel}
              </SketchButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminActionDrawer;
