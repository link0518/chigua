import React from 'react';
import { AlertTriangle, Eye } from 'lucide-react';
import { Badge, SketchButton } from '@/components/SketchUI';
import type { AdminAuditLog } from '@/types';
import {
  AUDIT_CATEGORY_OPTIONS,
  AUDIT_REASON_OPTIONS,
  AUDIT_RISK_OPTIONS,
  AUDIT_TARGET_TYPE_OPTIONS,
  AUDIT_TIME_OPTIONS,
  type AuditCategoryFilter,
  type AuditFilterState,
  type AuditReasonFilter,
  type AuditRiskFilter,
  type AuditTargetTypeFilter,
  type AuditTimeFilter,
  DEFAULT_AUDIT_FILTERS,
  getAuditActionTitle,
  getAuditCategory,
  getAuditCategoryLabel,
  getAuditRiskLabel,
  getAuditRiskLevel,
  getAuditSummaryLines,
  getAuditTargetLabel,
} from '@/features/admin/audit/auditPresentation';

interface AdminAuditViewProps {
  auditTotal: number;
  auditPage: number;
  totalAuditPages: number;
  auditLoading: boolean;
  auditLogs: AdminAuditLog[];
  filters: AuditFilterState;
  formatTimestamp: (timestamp?: number) => string;
  onOpenAuditDetail: (log: AdminAuditLog) => void;
  onAuditPageChange: (page: number) => void;
  onAuditFiltersChange: (filters: Partial<AuditFilterState>) => void;
}

interface FilterSelectProps<T extends string> {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}

const FilterSelect = <T extends string>({
  label,
  value,
  options,
  onChange,
}: FilterSelectProps<T>) => (
  <label className="flex min-w-0 flex-col gap-1 text-[11px] font-bold text-pencil">
    <span>{label}</span>
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as T)}
      className="h-10 w-full rounded-lg border-2 border-ink bg-white px-3 text-sm font-sans text-ink outline-none focus:ring-2 focus:ring-highlight"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  </label>
);

const FilterTextInput: React.FC<{
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}> = ({ label, value, placeholder, onChange }) => (
  <label className="flex min-w-0 flex-col gap-1 text-[11px] font-bold text-pencil">
    <span>{label}</span>
    <input
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className="h-10 w-full rounded-lg border-2 border-ink bg-white px-3 text-sm font-sans text-ink outline-none focus:ring-2 focus:ring-highlight"
    />
  </label>
);

const formatAuditDay = (timestamp?: number) => {
  if (!timestamp) {
    return '未知时间';
  }
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) => (
    a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
  );

  if (sameDay(date, today)) {
    return '今天';
  }
  if (sameDay(date, yesterday)) {
    return '昨天';
  }
  return date.toLocaleDateString('zh-CN');
};

const groupAuditLogsByDay = (items: AdminAuditLog[]) => {
  const groups = new Map<string, AdminAuditLog[]>();
  items.forEach((item) => {
    const day = formatAuditDay(item.createdAt);
    groups.set(day, [...(groups.get(day) || []), item]);
  });
  return Array.from(groups.entries()).map(([day, logs]) => ({ day, logs }));
};

const hasActiveFilters = (filters: AuditFilterState) => (
  filters.category !== DEFAULT_AUDIT_FILTERS.category
  || filters.riskLevel !== DEFAULT_AUDIT_FILTERS.riskLevel
  || filters.targetType !== DEFAULT_AUDIT_FILTERS.targetType
  || filters.timeRange !== DEFAULT_AUDIT_FILTERS.timeRange
  || filters.reason !== DEFAULT_AUDIT_FILTERS.reason
  || filters.adminUsername.trim() !== DEFAULT_AUDIT_FILTERS.adminUsername
);

const AdminAuditView: React.FC<AdminAuditViewProps> = ({
  auditTotal,
  auditPage,
  totalAuditPages,
  auditLoading,
  auditLogs,
  filters,
  formatTimestamp,
  onOpenAuditDetail,
  onAuditPageChange,
  onAuditFiltersChange,
}) => {
  const groups = groupAuditLogsByDay(auditLogs);

  return (
    <section>
      <div className="mb-4 flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <FilterSelect<AuditCategoryFilter>
            label="操作类型"
            value={filters.category}
            options={AUDIT_CATEGORY_OPTIONS}
            onChange={(category) => onAuditFiltersChange({ category })}
          />
          <FilterTextInput
            label="管理员"
            value={filters.adminUsername}
            placeholder="全部管理员"
            onChange={(adminUsername) => onAuditFiltersChange({ adminUsername })}
          />
          <FilterSelect<AuditRiskFilter>
            label="风险"
            value={filters.riskLevel}
            options={AUDIT_RISK_OPTIONS}
            onChange={(riskLevel) => onAuditFiltersChange({ riskLevel })}
          />
          <FilterSelect<AuditTargetTypeFilter>
            label="目标"
            value={filters.targetType}
            options={AUDIT_TARGET_TYPE_OPTIONS}
            onChange={(targetType) => onAuditFiltersChange({ targetType })}
          />
          <FilterSelect<AuditTimeFilter>
            label="时间"
            value={filters.timeRange}
            options={AUDIT_TIME_OPTIONS}
            onChange={(timeRange) => onAuditFiltersChange({ timeRange })}
          />
          <FilterSelect<AuditReasonFilter>
            label="理由"
            value={filters.reason}
            options={AUDIT_REASON_OPTIONS}
            onChange={(reason) => onAuditFiltersChange({ reason })}
          />
        </div>

        <div className="flex flex-col gap-3 text-xs text-pencil font-sans md:flex-row md:items-center md:justify-between">
          <span>共 {auditTotal} 条 · 第 {auditPage} / {totalAuditPages} 页</span>
          {hasActiveFilters(filters) ? (
            <SketchButton
              type="button"
              variant="secondary"
              className="h-8 px-3 text-xs md:self-auto"
              onClick={() => onAuditFiltersChange({ ...DEFAULT_AUDIT_FILTERS })}
            >
              重置筛选
            </SketchButton>
          ) : null}
        </div>
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
          <p className="font-hand text-lg text-pencil">试试调整搜索或筛选条件</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((group) => (
            <div key={group.day} className="flex flex-col gap-3">
              <div className="flex items-center gap-3 text-xs font-bold text-pencil">
                <span className="whitespace-nowrap">{group.day}</span>
                <span className="h-px flex-1 bg-gray-200" />
              </div>

              {group.logs.map((log) => {
                const category = getAuditCategory(log);
                const riskLevel = getAuditRiskLevel(log);
                const summaryLines = getAuditSummaryLines(log, 2);

                return (
                  <div key={log.id} className="bg-white p-5 rounded-lg border-2 border-ink shadow-sketch-sm">
                    <div className="flex flex-col gap-4 md:flex-row md:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs font-sans text-pencil">
                          <span className="bg-gray-100 border border-ink text-ink text-[10px] font-bold px-2 py-0.5 rounded font-sans">
                            #{log.id}
                          </span>
                          <Badge color="bg-highlight">{getAuditCategoryLabel(category)}</Badge>
                          <Badge color={riskLevel === 'high' ? 'bg-alert' : 'bg-gray-100'}>
                            {riskLevel === 'high' ? <AlertTriangle size={12} className="mr-1" /> : null}
                            {getAuditRiskLabel(riskLevel)}
                          </Badge>
                          <span>{formatTimestamp(log.createdAt)}</span>
                        </div>

                        <h3 className="font-display text-2xl leading-tight text-ink">
                          {getAuditActionTitle(log)}
                        </h3>
                        <p className="mt-1 text-sm font-sans text-pencil break-words">
                          {log.adminUsername || '未知管理员'} · {getAuditTargetLabel(log.targetType)} #{log.targetId || '-'} · IP {log.ip || '-'}
                        </p>

                        <div className="mt-3 flex flex-col gap-1">
                          {summaryLines.map((line) => (
                            <p key={line} className="text-sm font-sans text-ink break-words">
                              变更：{line}
                            </p>
                          ))}
                        </div>

                        <p className="mt-2 text-xs text-pencil font-sans break-words">
                          理由：{log.reason || '未填写理由'}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 md:items-start">
                        <SketchButton
                          type="button"
                          variant="secondary"
                          className="inline-flex h-9 items-center gap-1.5 px-3 text-xs"
                          onClick={() => onOpenAuditDetail(log)}
                        >
                          <Eye size={14} />
                          详情
                        </SketchButton>
                      </div>
                    </div>
                  </div>
                );
              })}
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
};

export default AdminAuditView;
