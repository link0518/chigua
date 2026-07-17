import React from 'react';
import {
  AlertTriangle,
  BookOpen,
  EyeOff,
  Flag,
  MessageSquare,
  Trash2,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  ResponsiveContainer,
  LabelList,
  LineChart,
  Line,
} from 'recharts';
import { roughBorderClassSm } from '@/components/SketchUI';
import AdminReportCard from '@/features/admin/components/AdminReportCard';
import type { AdminChartDatum, RenderIdentity, ReportAction } from '@/features/admin/types';
import type { Report } from '@/types';

interface AdminOverviewViewProps {
  pendingReportCount: number;
  hiddenPendingCount: number;
  deleteRequestPendingCount: number;
  wikiPendingCount: number;
  rumorPendingCount: number;
  feedbackUnreadCount: number;
  totalPosts: number;
  totalVisits: number;
  onlineCount: number;
  totalWeeklyVisits: number;
  appVersionLabel: string;
  postVolumeData: AdminChartDatum[];
  visitData: AdminChartDatum[];
  visiblePendingReports: Report[];
  onOpenReports: () => void;
  onOpenHidden: () => void;
  onOpenDeleteRequests: () => void;
  onOpenWiki: () => void;
  onOpenRumors: () => void;
  onOpenFeedback: () => void;
  onReportAction: (
    id: string,
    action: ReportAction,
    content: string,
    targetType: Report['targetType'],
    targetId: string
  ) => void;
  onReportDetail: (report: Report) => void;
  renderIdentity: RenderIdentity;
  canReadContentReview: boolean;
  canReadPosts: boolean;
  canReadWiki: boolean;
  canReadFeedback: boolean;
  canReadSettings: boolean;
  canManageContentReview: boolean;
}

const AdminOverviewView: React.FC<AdminOverviewViewProps> = ({
  pendingReportCount,
  hiddenPendingCount,
  deleteRequestPendingCount,
  wikiPendingCount,
  rumorPendingCount,
  feedbackUnreadCount,
  totalPosts,
  totalVisits,
  onlineCount,
  totalWeeklyVisits,
  appVersionLabel,
  postVolumeData,
  visitData,
  visiblePendingReports,
  onOpenReports,
  onOpenHidden,
  onOpenDeleteRequests,
  onOpenWiki,
  onOpenRumors,
  onOpenFeedback,
  onReportAction,
  onReportDetail,
  renderIdentity,
  canReadContentReview,
  canReadPosts,
  canReadWiki,
  canReadFeedback,
  canReadSettings,
  canManageContentReview,
}) => {
  const toDisplayCount = (value: unknown) => {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : 0;
  };
  const reportTodoCount = toDisplayCount(pendingReportCount);
  const hiddenTodoCount = toDisplayCount(hiddenPendingCount);
  const deleteRequestTodoCount = toDisplayCount(deleteRequestPendingCount);
  const wikiTodoCount = toDisplayCount(wikiPendingCount);
  const rumorTodoCount = toDisplayCount(rumorPendingCount);
  const feedbackTodoCount = toDisplayCount(feedbackUnreadCount);
  const totalTodoCount = reportTodoCount + hiddenTodoCount + deleteRequestTodoCount + wikiTodoCount + rumorTodoCount + feedbackTodoCount;
  const workItems = [
    {
      title: '举报',
      count: reportTodoCount,
      icon: <Flag size={18} />,
      color: 'bg-highlight',
      visible: canReadContentReview,
      onClick: onOpenReports,
    },
    {
      title: '隐藏内容',
      count: hiddenTodoCount,
      icon: <EyeOff size={18} />,
      color: 'bg-yellow-100',
      visible: canReadContentReview,
      onClick: onOpenHidden,
    },
    {
      title: '删除申请',
      count: deleteRequestTodoCount,
      icon: <Trash2 size={18} />,
      color: 'bg-red-100',
      visible: canReadContentReview,
      onClick: onOpenDeleteRequests,
    },
    {
      title: '谣言',
      count: rumorTodoCount,
      icon: <AlertTriangle size={18} />,
      color: 'bg-marker-orange',
      visible: canReadContentReview,
      onClick: onOpenRumors,
    },
    {
      title: '瓜条',
      count: wikiTodoCount,
      icon: <BookOpen size={18} />,
      color: 'bg-marker-green',
      visible: canReadWiki,
      onClick: onOpenWiki,
    },
    {
      title: '留言',
      count: feedbackTodoCount,
      icon: <MessageSquare size={18} />,
      color: 'bg-marker-blue',
      visible: canReadFeedback,
      onClick: onOpenFeedback,
    },
  ].filter((item) => item.visible);

  return (
    <>
      <section className={`border-2 border-ink bg-[#fff7d9] p-3 shadow-sketch ${roughBorderClassSm}`}>
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center justify-between gap-3 lg:justify-start">
            <div>
              <p className="font-sans text-[11px] font-bold tracking-[0.22em] text-pencil">TODAY DESK</p>
              <h2 className="font-display text-xl text-ink sm:text-2xl">今日待办</h2>
            </div>
            <div className="shrink-0 rounded-2xl border-2 border-ink bg-white px-3 py-2 text-center shadow-sketch-sm">
              <p className="font-display text-2xl leading-none text-ink">{totalTodoCount}</p>
              <p className="mt-1 font-sans text-[10px] font-bold text-pencil">待处理</p>
            </div>
          </div>

          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 xl:mx-0 xl:flex-1 xl:justify-end xl:overflow-visible xl:pb-0">
            {workItems.map((item) => (
              <button
                key={item.title}
                type="button"
                onClick={item.onClick}
                className="group flex min-w-[8.5rem] items-center gap-2 rounded-2xl border-2 border-ink bg-white px-3 py-2 text-left shadow-sketch-sm transition-all hover:-translate-y-0.5 hover:bg-paper xl:min-w-0"
              >
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-ink ${item.color}`}>
                  {item.icon}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-sans text-xs font-bold text-ink">{item.title}</span>
                  <span className={`mt-0.5 inline-flex rounded-full border border-ink px-2 py-0.5 text-[11px] font-bold ${item.count > 0 ? 'bg-red-500 text-white' : 'bg-gray-100 text-pencil'}`}>
                    {item.count > 0 ? item.count : '无'}
                  </span>
                </span>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2 border-t-2 border-dashed border-ink/20 pt-2 xl:border-l-2 xl:border-t-0 xl:pl-3 xl:pt-0">
            {canReadPosts && (
              <span className="rounded-full border border-ink bg-white px-3 py-1 text-xs font-bold text-ink shadow-sketch-sm">
                总帖子 {toDisplayCount(totalPosts)}
              </span>
            )}
            <span className="rounded-full border border-ink bg-white px-3 py-1 text-xs font-bold text-pencil shadow-sketch-sm">
              {appVersionLabel}
            </span>
          </div>
        </div>
      </section>

      {(canReadPosts || canReadSettings) && (
        <section className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          {canReadPosts && (
            <div className={`bg-white p-6 border-2 border-ink shadow-sketch ${roughBorderClassSm}`}>
          <div className="flex justify-between items-start mb-6">
            <div>
              <h3 className="font-display text-lg">每日发帖量</h3>
              <p className="text-pencil text-xs font-sans">近 7 天数据</p>
            </div>
            <p className="font-display text-2xl">{postVolumeData.reduce((sum, item) => sum + item.value, 0)}</p>
          </div>
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={postVolumeData} margin={{ top: 24, right: 12, left: 12, bottom: 6 }}>
                <Line type="monotone" dataKey="value" stroke="#2c2c2c" strokeWidth={3} strokeDasharray="5 5" dot={{ r: 4, fill: '#2c2c2c' }}>
                  <LabelList dataKey="value" position="top" offset={12} fill="#2c2c2c" fontSize={11} />
                </Line>
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#555' }} dy={10} interval={0} />
              </LineChart>
            </ResponsiveContainer>
          </div>
            </div>
          )}

          {canReadSettings && (
            <div className={`bg-white p-6 border-2 border-ink shadow-sketch ${roughBorderClassSm}`}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="font-display text-lg">访问统计</h3>
              <p className="text-pencil text-xs font-sans">本周独立访客 · {totalWeeklyVisits}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-pencil font-sans">总访问量</p>
              <p className="font-display text-2xl">{totalVisits}</p>
              <p className="mt-1 inline-flex rounded-full border border-ink bg-highlight px-2 py-0.5 text-[11px] font-bold text-ink shadow-sketch-sm">
                当前在线 {toDisplayCount(onlineCount)}
              </p>
            </div>
          </div>
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={visitData} margin={{ top: 28, right: 12, left: 12, bottom: 6 }}>
                <Bar dataKey="value" fill="white" stroke="#2c2c2c" strokeWidth={2} radius={[4, 4, 0, 0]}>
                  <LabelList dataKey="value" position="top" offset={12} fill="#2c2c2c" fontSize={12} />
                </Bar>
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#555' }} dy={10} interval={0} />
              </BarChart>
            </ResponsiveContainer>
          </div>
            </div>
          )}
        </section>
      )}

      {canReadContentReview && pendingReportCount > 0 && (
        <section>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-display flex items-center gap-2">
              <Flag size={20} /> 最新待处理举报
            </h2>
            <button
              onClick={onOpenReports}
              className="font-hand text-ink hover:underline"
            >
              查看全部 →
            </button>
          </div>
          <div className="flex flex-col gap-4">
            {visiblePendingReports.slice(0, 2).map((report) => (
              <AdminReportCard
                key={report.id}
                report={report}
                onAction={onReportAction}
                onDetail={onReportDetail}
                renderIdentity={renderIdentity}
                showStatus={false}
                selectable={false}
                canManage={canManageContentReview}
              />
            ))}
          </div>
        </section>
      )}
    </>
  );
};

export default AdminOverviewView;
