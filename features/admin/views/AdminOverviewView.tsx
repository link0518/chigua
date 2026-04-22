import React from 'react';
import { Ban, BarChart2, CheckCircle, Flag, Gavel } from 'lucide-react';
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
import AdminStatCard from '@/features/admin/components/AdminStatCard';
import type { AdminChartDatum, RenderIdentity, ReportAction } from '@/features/admin/types';
import type { Report } from '@/types';

interface AdminOverviewViewProps {
  todayReports: number;
  pendingReportCount: number;
  bannedUsers: number;
  totalPosts: number;
  totalVisits: number;
  onlineCount: number;
  totalWeeklyVisits: number;
  appVersionLabel: string;
  postVolumeData: AdminChartDatum[];
  visitData: AdminChartDatum[];
  visiblePendingReports: Report[];
  onOpenReports: () => void;
  onReportAction: (
    id: string,
    action: ReportAction,
    content: string,
    targetType: Report['targetType'],
    targetId: string
  ) => void;
  onReportDetail: (report: Report) => void;
  renderIdentity: RenderIdentity;
}

const AdminOverviewView: React.FC<AdminOverviewViewProps> = ({
  todayReports,
  pendingReportCount,
  bannedUsers,
  totalPosts,
  totalVisits,
  onlineCount,
  totalWeeklyVisits,
  appVersionLabel,
  postVolumeData,
  visitData,
  visiblePendingReports,
  onOpenReports,
  onReportAction,
  onReportDetail,
  renderIdentity,
}) => (
  <>
    <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-6">
      <AdminStatCard
        title="今日举报"
        value={todayReports.toString()}
        trend={todayReports > 10 ? '+15%' : '-5%'}
        trendUp={todayReports > 10}
        icon={<Flag size={80} />}
        color="bg-marker-orange"
      />
      <AdminStatCard
        title="待处理"
        value={pendingReportCount.toString()}
        trend={pendingReportCount > 0 ? '需处理' : '已清空'}
        trendUp={pendingReportCount > 0}
        icon={<Gavel size={80} />}
        color="bg-highlight"
      />
      <AdminStatCard
        title="封禁用户"
        value={bannedUsers.toString()}
        trend="+1"
        trendUp={false}
        icon={<Ban size={80} />}
        color="bg-marker-blue"
      />
      <AdminStatCard
        title="总帖子数"
        value={totalPosts.toString()}
        trend="活跃"
        trendUp
        icon={<BarChart2 size={80} />}
        color="bg-marker-green"
      />
      <AdminStatCard
        title="版本号"
        value={appVersionLabel}
        trend="自动更新"
        trendUp
        icon={<CheckCircle size={80} />}
        color="bg-white"
        valueClassName="text-3xl md:text-4xl leading-tight break-all"
      />
    </section>

    <section className="grid grid-cols-1 lg:grid-cols-2 gap-8">
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

      <div className={`bg-white p-6 border-2 border-ink shadow-sketch ${roughBorderClassSm}`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-display text-lg">访问统计</h3>
            <p className="text-pencil text-xs font-sans">本周独立访客 · {totalWeeklyVisits}</p>
            <p className="text-xs text-pencil font-sans mt-2">当前在线</p>
            <p className="font-display text-2xl">{onlineCount}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-pencil font-sans">总访问量</p>
            <p className="font-display text-2xl">{totalVisits}</p>
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
    </section>

    {pendingReportCount > 0 && (
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
            />
          ))}
        </div>
      </section>
    )}
  </>
);

export default AdminOverviewView;
