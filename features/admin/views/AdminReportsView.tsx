import React from 'react';
import { Flag, Gavel } from 'lucide-react';
import AdminReportCard from '@/features/admin/components/AdminReportCard';
import type { RenderIdentity, ReportAction } from '@/features/admin/types';
import type { Report } from '@/types';
import { SketchButton } from '@/components/SketchUI';

interface AdminReportsViewProps {
  showProcessed: boolean;
  reportsLoading: boolean;
  searchQuery: string;
  filteredReports: Report[];
  selectedReports: Set<string>;
  onReportAction: (
    id: string,
    action: ReportAction,
    content: string,
    targetType: Report['targetType'],
    targetId: string
  ) => void;
  onReportDetail: (report: Report) => void;
  renderIdentity: RenderIdentity;
  onToggleAllReports: (reportIds: string[]) => void;
  onOpenBulkReportModal: () => void;
  onToggleReportSelection: (reportId: string) => void;
}

const AdminReportsView: React.FC<AdminReportsViewProps> = ({
  showProcessed,
  reportsLoading,
  searchQuery,
  filteredReports,
  selectedReports,
  onReportAction,
  onReportDetail,
  renderIdentity,
  onToggleAllReports,
  onOpenBulkReportModal,
  onToggleReportSelection,
}) => (
  <section>
    <div className="flex items-center justify-between mb-6">
      <h2 className="text-xl font-display flex items-center gap-2">
        {showProcessed ? (
          <><Gavel size={20} /> 已处理</>
        ) : (
          <><Flag size={20} /> 待处理举报</>
        )}
        <span className="bg-ink text-white text-xs px-2 py-1 rounded-full font-sans">
          {reportsLoading ? '...' : filteredReports.length}
        </span>
      </h2>
    </div>
    {!showProcessed && (
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-sans mb-4">
        <label className="flex items-center gap-2 text-pencil">
          <input
            type="checkbox"
            className="accent-black"
            checked={filteredReports.length > 0 && filteredReports.every((report) => selectedReports.has(report.id))}
            onChange={() => onToggleAllReports(filteredReports.map((report) => report.id))}
          />
          本页全选
        </label>
        <div className="flex items-center gap-2">
          <span className="text-pencil">已选 {selectedReports.size} 条</span>
          <SketchButton
            variant="secondary"
            className="h-8 px-3 text-xs"
            disabled={selectedReports.size === 0}
            onClick={onOpenBulkReportModal}
          >
            标记处理
          </SketchButton>
        </div>
      </div>
    )}

    {reportsLoading ? (
      <div className="text-center py-16 bg-white border-2 border-ink rounded-lg">
        <h3 className="font-display text-2xl text-ink mb-2">举报加载中</h3>
        <p className="font-hand text-lg text-pencil">先拉取完整列表，稍等一下…</p>
      </div>
    ) : filteredReports.length === 0 ? (
      <div className="text-center py-16 bg-white border-2 border-ink rounded-lg">
        <span className="text-6xl mb-4 block">
          {searchQuery ? '🔎' : '✅'}
        </span>
        <h3 className="font-display text-2xl text-ink mb-2">
          {searchQuery ? '没有找到匹配的结果' : '暂无待处理举报'}
        </h3>
        <p className="font-hand text-lg text-pencil">
          {searchQuery ? '尝试其他关键词' : '做得好，保持关注。'}
        </p>
      </div>
    ) : (
      <div className="flex flex-col gap-4">
        {filteredReports.map((report) => (
          <AdminReportCard
            key={report.id}
            report={report}
            onAction={onReportAction}
            onDetail={onReportDetail}
            renderIdentity={renderIdentity}
            showStatus={showProcessed}
            selectable={!showProcessed}
            selected={selectedReports.has(report.id)}
            onSelect={() => onToggleReportSelection(report.id)}
          />
        ))}
      </div>
    )}
  </section>
);

export default AdminReportsView;
