import React from 'react';
import { SketchButton } from '@/components/SketchUI';
import type { AdminAuditLog } from '@/types';

interface AdminAuditViewProps {
  auditTotal: number;
  auditPage: number;
  totalAuditPages: number;
  auditLoading: boolean;
  auditLogs: AdminAuditLog[];
  formatTimestamp: (timestamp?: number) => string;
  onOpenAuditDetail: (log: AdminAuditLog) => void;
  onAuditPageChange: (page: number) => void;
}

const AdminAuditView: React.FC<AdminAuditViewProps> = ({
  auditTotal,
  auditPage,
  totalAuditPages,
  auditLoading,
  auditLogs,
  formatTimestamp,
  onOpenAuditDetail,
  onAuditPageChange,
}) => (
  <section>
    <div className="flex items-center justify-between text-xs text-pencil font-sans mb-4">
      <span>共 {auditTotal} 条</span>
      <span>第 {auditPage} / {totalAuditPages} 页</span>
    </div>

    {auditLoading ? (
      <div className="text-center py-16 bg-white border-2 border-ink rounded-lg">
        <span className="text-6xl mb-4 block">🧾</span>
        <h3 className="font-display text-2xl text-ink mb-2">加载审计日志</h3>
        <p className="font-hand text-lg text-pencil">请稍等片刻</p>
      </div>
    ) : auditLogs.length === 0 ? (
      <div className="text-center py-16 bg-white border-2 border-ink rounded-lg">
        <span className="text-6xl mb-4 block">📁</span>
        <h3 className="font-display text-2xl text-ink mb-2">暂无记录</h3>
        <p className="font-hand text-lg text-pencil">试试调整搜索条件</p>
      </div>
    ) : (
      <div className="flex flex-col gap-4">
        {auditLogs.map((log) => (
          <div key={log.id} className="bg-white p-5 rounded-lg border-2 border-ink shadow-sketch-sm">
            <div className="flex flex-col md:flex-row gap-4 justify-between">
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-3 text-xs font-sans text-pencil mb-2">
                  <span className="bg-gray-100 border border-ink text-ink text-[10px] font-bold px-2 py-0.5 rounded font-sans">
                    #{log.id}
                  </span>
                  <span>{formatTimestamp(log.createdAt)}</span>
                  <span>操作者：{log.adminUsername || '未知'}</span>
                  <span>IP：{log.ip || '-'}</span>
                </div>
                <p className="font-sans text-sm text-ink">
                  <span className="font-bold">{log.action}</span> · {log.targetType} · {log.targetId}
                </p>
                {log.reason && (
                  <p className="text-xs text-pencil font-sans mt-1">理由：{log.reason}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <SketchButton
                  variant="secondary"
                  className="h-8 px-3 text-xs"
                  onClick={() => onOpenAuditDetail(log)}
                >
                  查看详情
                </SketchButton>
              </div>
            </div>
          </div>
        ))}
      </div>
    )}

    {auditLogs.length > 0 && (
      <div className="flex items-center justify-center gap-4 mt-6">
        <SketchButton
          variant="secondary"
          className="px-4 py-2 text-sm"
          disabled={auditPage <= 1}
          onClick={() => onAuditPageChange(Math.max(auditPage - 1, 1))}
        >
          上一页
        </SketchButton>
        <span className="text-xs text-pencil font-sans">第 {auditPage} / {totalAuditPages} 页</span>
        <SketchButton
          variant="secondary"
          className="px-4 py-2 text-sm"
          disabled={auditPage >= totalAuditPages}
          onClick={() => onAuditPageChange(Math.min(auditPage + 1, totalAuditPages))}
        >
          下一页
        </SketchButton>
      </div>
    )}
  </section>
);

export default AdminAuditView;
