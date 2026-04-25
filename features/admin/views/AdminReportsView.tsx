import React from 'react';
import { Flag, Gavel } from 'lucide-react';
import AdminReportCard from '@/features/admin/components/AdminReportCard';
import type { RenderIdentity, ReportAction } from '@/features/admin/types';
import type { Report } from '@/types';
import { SketchButton } from '@/components/SketchUI';

const REPORT_PAGE_SIZE = 10;

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
  onOpenBulkReportModal: (action: 'resolve' | 'ignore', reportIds?: string[]) => void;
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
}) => {
  const [page, setPage] = React.useState(1);
  const totalPages = Math.max(Math.ceil(filteredReports.length / REPORT_PAGE_SIZE), 1);
  const pagedReports = React.useMemo(
    () => filteredReports.slice((page - 1) * REPORT_PAGE_SIZE, page * REPORT_PAGE_SIZE),
    [filteredReports, page]
  );
  const pagedReportIds = React.useMemo(() => pagedReports.map((report) => report.id), [pagedReports]);

  React.useEffect(() => {
    setPage(1);
  }, [searchQuery, showProcessed]);

  React.useEffect(() => {
    setPage((prev) => Math.min(prev, totalPages));
  }, [totalPages]);

  return (
    <section>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-display flex items-center gap-2">
          {showProcessed ? (
            <><Gavel size={20} /> {'\u5df2\u5904\u7406'}</>
          ) : (
            <><Flag size={20} /> {'\u5f85\u5904\u7406\u4e3e\u62a5'}</>
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
              checked={pagedReports.length > 0 && pagedReports.every((report) => selectedReports.has(report.id))}
              onChange={() => onToggleAllReports(pagedReportIds)}
            />
            {'\u672c\u9875\u5168\u9009'}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-pencil">{'\u5df2\u9009'} {selectedReports.size} {'\u6761'}</span>
            <SketchButton
              variant="secondary"
              className="h-8 px-3 text-xs"
              disabled={selectedReports.size === 0}
              onClick={() => onOpenBulkReportModal('resolve')}
            >
              {'\u6807\u8bb0\u5904\u7406'}
            </SketchButton>
            <SketchButton
              variant="secondary"
              className="h-8 px-3 text-xs"
              disabled={selectedReports.size === 0}
              onClick={() => onOpenBulkReportModal('ignore')}
            >
              {'\u5ffd\u7565\u6240\u9009'}
            </SketchButton>
            <SketchButton
              variant="secondary"
              className="h-8 px-3 text-xs"
              disabled={filteredReports.length === 0}
              onClick={() => onOpenBulkReportModal('ignore', filteredReports.map((report) => report.id))}
            >
              {'\u4e00\u952e\u5ffd\u7565\u5f53\u524d\u7b5b\u9009'}
            </SketchButton>
          </div>
        </div>
      )}

      {reportsLoading ? (
        <div className="text-center py-16 bg-white border-2 border-ink rounded-lg">
          <h3 className="font-display text-2xl text-ink mb-2">{'\u4e3e\u62a5\u52a0\u8f7d\u4e2d'}</h3>
          <p className="font-hand text-lg text-pencil">{'\u6b63\u5728\u62c9\u53d6\u5217\u8868\uff0c\u8bf7\u7a0d\u5019\u3002'}</p>
        </div>
      ) : filteredReports.length === 0 ? (
        <div className="text-center py-16 bg-white border-2 border-ink rounded-lg">
          <span className="text-6xl mb-4 block">
            {searchQuery ? '\u{1F50E}' : '\u{2705}'}
          </span>
          <h3 className="font-display text-2xl text-ink mb-2">
            {searchQuery ? '\u6ca1\u6709\u627e\u5230\u5339\u914d\u7684\u7ed3\u679c' : '\u6682\u65e0\u5f85\u5904\u7406\u4e3e\u62a5'}
          </h3>
          <p className="font-hand text-lg text-pencil">
            {searchQuery ? '\u5c1d\u8bd5\u5176\u4ed6\u5173\u952e\u8bcd' : '\u505a\u5f97\u597d\uff0c\u4fdd\u6301\u5173\u6ce8\u3002'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {pagedReports.map((report) => (
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

      {filteredReports.length > REPORT_PAGE_SIZE && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3 text-xs text-pencil font-sans">
          <SketchButton
            type="button"
            variant="secondary"
            className="h-8 px-3 text-xs"
            disabled={page <= 1}
            onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
          >
            {'\u4e0a\u4e00\u9875'}
          </SketchButton>
          <span>
            {'\u7b2c'} {page} / {totalPages} {'\u9875\uff0c\u6bcf\u9875'} {REPORT_PAGE_SIZE} {'\u6761'}
          </span>
          <SketchButton
            type="button"
            variant="secondary"
            className="h-8 px-3 text-xs"
            disabled={page >= totalPages}
            onClick={() => setPage((prev) => Math.min(prev + 1, totalPages))}
          >
            {'\u4e0b\u4e00\u9875'}
          </SketchButton>
        </div>
      )}
    </section>
  );
};

export default AdminReportsView;
