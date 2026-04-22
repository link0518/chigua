import React from 'react';
import { Ban, CheckCircle, EyeOff, MessageSquare, Trash2, XCircle } from 'lucide-react';
import { SketchButton } from '@/components/SketchUI';
import type { Report } from '@/types';
import type { RenderIdentity, ReportAction } from '@/features/admin/types';

interface AdminReportCardProps {
  report: Report;
  onAction: (
    id: string,
    action: ReportAction,
    content: string,
    targetType: Report['targetType'],
    targetId: string
  ) => void;
  onDetail?: (report: Report) => void;
  renderIdentity: RenderIdentity;
  showStatus?: boolean;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: () => void;
}

const getRiskBg = (level: string) => {
  switch (level) {
    case 'high':
      return 'bg-highlight';
    case 'medium':
      return 'bg-alert';
    default:
      return 'bg-gray-200';
  }
};

const AdminReportCard: React.FC<AdminReportCardProps> = ({
  report,
  onAction,
  onDetail,
  renderIdentity,
  showStatus = false,
  selectable = true,
  selected = false,
  onSelect,
}) => (
  <div className="bg-white p-5 rounded-lg border-2 border-ink shadow-sketch-sm hover:shadow-sketch transition-all group">
    <div className="flex flex-col md:flex-row gap-6 justify-between items-start">
      <div className="flex-1">
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          {selectable && (
            <input
              type="checkbox"
              className="accent-black"
              checked={selected}
              onChange={onSelect}
            />
          )}
          <span className="bg-gray-100 border border-ink text-ink text-[10px] font-bold px-2 py-0.5 rounded font-sans">ID: #{report.id}</span>
          <span className="text-pencil text-xs font-bold font-sans">{report.timestamp}</span>
          <span className={`text-ink text-xs flex items-center gap-1 border border-ink px-2 py-0.5 rounded font-bold font-sans ${getRiskBg(report.riskLevel)}`}>
            {report.reason}
          </span>
          {report.targetType === 'comment' && (
            <span className="text-xs flex items-center gap-1 border border-ink px-2 py-0.5 rounded font-bold font-sans bg-blue-50 text-blue-700">
              评论举报
            </span>
          )}
          {report.targetType === 'chat' && (
            <span className="text-xs flex items-center gap-1 border border-ink px-2 py-0.5 rounded font-bold font-sans bg-cyan-50 text-cyan-700">
              聊天室发言举报
            </span>
          )}
          {showStatus && (
            <span className={`text-xs flex items-center gap-1 border border-ink px-2 py-0.5 rounded font-bold font-sans ${report.status === 'resolved' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
              {report.status === 'resolved' ? <CheckCircle size={12} /> : <XCircle size={12} />}
              {report.status === 'resolved' ? '已处理' : '已忽略'}
            </span>
          )}
        </div>
        <p className="text-ink text-base leading-relaxed font-sans font-semibold">
          "{report.contentSnippet}"
        </p>
        <div className="flex flex-wrap items-center gap-3 text-xs text-pencil font-sans mt-3">
          {renderIdentity({
            ip: report.targetIp,
            sessionId: report.targetSessionId,
            fingerprint: report.targetFingerprint,
            identityKey: report.targetIdentityKey,
            identityHashes: report.targetIdentityHashes,
          })}
          <button
            type="button"
            onClick={() => onDetail?.(report)}
            className="text-xs font-bold text-ink hover:underline"
          >
            查看详情
          </button>
          <button
            type="button"
            onClick={() => onDetail?.(report)}
            className="text-xs font-bold text-ink hover:underline"
          >
            举报者信息
          </button>
        </div>
      </div>

      {!showStatus && (
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 min-w-fit mt-2 md:mt-0 font-sans">
          <SketchButton
            variant="secondary"
            className="h-10 px-3 text-xs flex items-center gap-1"
            onClick={() => onAction(report.id, 'ignore', report.contentSnippet, report.targetType, report.targetId)}
          >
            <EyeOff size={14} /> 忽略
          </SketchButton>
          <SketchButton
            variant="danger"
            className="h-10 px-3 text-xs flex items-center gap-1"
            onClick={() => onAction(report.id, 'delete', report.contentSnippet, report.targetType, report.targetId)}
          >
            <Trash2 size={14} /> 删除
          </SketchButton>
          {report.targetType === 'chat' && (
            <SketchButton
              variant="secondary"
              className="h-10 px-3 text-xs flex items-center gap-1"
              onClick={() => onAction(report.id, 'mute', report.contentSnippet, report.targetType, report.targetId)}
            >
              <MessageSquare size={14} /> 禁言
            </SketchButton>
          )}
          <SketchButton
            variant="primary"
            className="h-10 px-3 text-xs flex items-center gap-1 text-white"
            onClick={() => onAction(report.id, 'ban', report.contentSnippet, report.targetType, report.targetId)}
          >
            <Ban size={14} /> 封禁
          </SketchButton>
        </div>
      )}
    </div>
  </div>
);

export default AdminReportCard;
