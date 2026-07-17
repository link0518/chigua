import React from 'react';
import Modal from '@/components/Modal';
import { Badge } from '@/components/SketchUI';
import type { AdminAuditLog } from '@/types';
import {
  formatAuditDiffLine,
  formatAuditRawJson,
  getAuditActionTitle,
  getAuditCategory,
  getAuditCategoryLabel,
  getAuditDiffItems,
  getAuditRiskLabel,
  getAuditRiskLevel,
  getAuditTargetLabel,
} from '@/features/admin/audit/auditPresentation';

interface AdminAuditDetailModalProps {
  isOpen: boolean;
  log: AdminAuditLog | null;
  formatTimestamp: (timestamp?: number) => string;
  onClose: () => void;
}

const InfoRow: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="min-w-0">
    <dt className="text-[11px] font-bold text-pencil">{label}</dt>
    <dd className="mt-1 break-words text-sm text-ink">{value || '-'}</dd>
  </div>
);

const AdminAuditDetailModal: React.FC<AdminAuditDetailModalProps> = ({
  isOpen,
  log,
  formatTimestamp,
  onClose,
}) => {
  const diffItems = getAuditDiffItems(log);
  const category = log ? getAuditCategory(log) : 'other';
  const riskLevel = log ? getAuditRiskLevel(log) : 'normal';

  return (
    <Modal
      isOpen={isOpen && Boolean(log)}
      onClose={onClose}
      title="操作详情"
      panelClassName="max-w-3xl"
    >
      {log ? (
        <div className="flex flex-col gap-5 font-sans">
          <div className="flex flex-col gap-3 border-b-2 border-dashed border-gray-200 pb-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge color="bg-highlight">{getAuditCategoryLabel(category)}</Badge>
              <Badge color={riskLevel === 'high' ? 'bg-alert' : 'bg-gray-100'}>
                {getAuditRiskLabel(riskLevel)}
              </Badge>
            </div>
            <h3 className="font-display text-2xl leading-tight text-ink">{getAuditActionTitle(log)}</h3>
          </div>

          <dl className="grid grid-cols-1 gap-3 rounded-lg border-2 border-ink bg-white p-4 md:grid-cols-2">
            <InfoRow label="操作者" value={log.adminUsername || '未知'} />
            <InfoRow label="时间" value={formatTimestamp(log.createdAt)} />
            <InfoRow label="目标" value={`${getAuditTargetLabel(log.targetType)} #${log.targetId || '-'}`} />
            <InfoRow label="IP" value={log.ip || '-'} />
          </dl>

          <section>
            <h4 className="mb-2 text-xs font-bold text-pencil">操作理由</h4>
            <div className="rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 p-3 text-sm text-ink">
              {log.reason || '未填写理由'}
            </div>
          </section>

          <section>
            <h4 className="mb-2 text-xs font-bold text-pencil">变更摘要</h4>
            {diffItems.length ? (
              <div className="flex flex-col gap-2">
                {diffItems.map((item) => (
                  <div key={item.field} className="rounded-lg border border-gray-200 bg-white p-3 text-sm text-ink">
                    {formatAuditDiffLine(item)}
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 p-3 text-sm text-pencil">
                未记录字段变化
              </div>
            )}
          </section>

          {log.sessionId ? (
            <details className="rounded-lg border border-gray-200 bg-white p-3 text-xs text-pencil">
              <summary className="cursor-pointer font-bold text-ink">安全上下文</summary>
              <p className="mt-2 break-all">Session：{log.sessionId}</p>
            </details>
          ) : null}

          <details className="rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 p-3">
            <summary className="cursor-pointer text-xs font-bold text-ink">查看原始数据</summary>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <p className="mb-2 text-xs text-pencil">变更前</p>
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-gray-200 bg-white p-3 text-xs text-ink">
                  {formatAuditRawJson(log.before)}
                </pre>
              </div>
              <div>
                <p className="mb-2 text-xs text-pencil">变更后</p>
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-gray-200 bg-white p-3 text-xs text-ink">
                  {formatAuditRawJson(log.after)}
                </pre>
              </div>
            </div>
          </details>
        </div>
      ) : null}
    </Modal>
  );
};

export default AdminAuditDetailModal;
