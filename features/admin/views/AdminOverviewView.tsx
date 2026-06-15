import React from 'react';
import {
  AlertTriangle,
  Ban,
  BarChart2,
  BookOpen,
  CheckCircle,
  Flag,
  Gavel,
  MessageSquare,
  Shield,
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
import AdminStatCard from '@/features/admin/components/AdminStatCard';
import type { AdminChartDatum, RenderIdentity, ReportAction } from '@/features/admin/types';
import type { Report } from '@/types';

interface AdminOverviewViewProps {
  todayReports: number;
  pendingReportCount: number;
  wikiPendingCount: number;
  rumorPendingCount: number;
  feedbackUnreadCount: number;
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
  onOpenWiki: () => void;
  onOpenRumors: () => void;
  onOpenFeedback: () => void;
  onOpenChat: () => void;
  onOpenBans: () => void;
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
  wikiPendingCount,
  rumorPendingCount,
  feedbackUnreadCount,
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
  onOpenWiki,
  onOpenRumors,
  onOpenFeedback,
  onOpenChat,
  onOpenBans,
  onReportAction,
  onReportDetail,
  renderIdentity,
}) => {
  const totalTodoCount = pendingReportCount + wikiPendingCount + rumorPendingCount + feedbackUnreadCount;
  const workItems = [
    {
      title: '待处理举报',
      count: pendingReportCount,
      description: '举报审核、删除、忽略与封禁',
      icon: <Flag size={26} />,
      color: 'bg-highlight',
      actionLabel: '处理举报',
      onClick: onOpenReports,
    },
    {
      title: '谣言审核',
      count: rumorPendingCount,
      description: '处理谣言举报与疑似标记',
      icon: <AlertTriangle size={26} />,
      color: 'bg-marker-orange',
      actionLabel: '进入审核',
      onClick: onOpenRumors,
    },
    {
      title: '瓜条审核',
      count: wikiPendingCount,
      description: '审核新瓜条与编辑提交',
      icon: <BookOpen size={26} />,
      color: 'bg-marker-green',
      actionLabel: '查看提交',
      onClick: onOpenWiki,
    },
    {
      title: '留言管理',
      count: feedbackUnreadCount,
      description: '查看未读留言与联系方式',
      icon: <MessageSquare size={26} />,
      color: 'bg-marker-blue',
      actionLabel: '处理留言',
      onClick: onOpenFeedback,
    },
  ];

  const quickEntries = [
    {
      title: '聊天室管理',
      value: `${onlineCount}`,
      description: '在线人数与最近消息',
      icon: <MessageSquare size={20} />,
      onClick: onOpenChat,
    },
    {
      title: '封禁管理',
      value: `${bannedUsers}`,
      description: '查看和调整封禁记录',
      icon: <Shield size={20} />,
      onClick: onOpenBans,
    },
  ];

  return (
    <>
      <section className={`relative overflow-hidden rounded-[28px] border-2 border-ink bg-[#fff7d9] p-5 shadow-sketch ${roughBorderClassSm}`}>
        <div className="absolute right-[-48px] top-[-72px] h-48 w-48 rounded-full border-2 border-ink/10 bg-white/35" />
        <div className="relative z-10 flex flex-col gap-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="font-sans text-xs font-bold tracking-[0.24em] text-pencil">TODAY DESK</p>
              <h2 className="mt-2 font-display text-3xl text-ink">今日待办工作台</h2>
              <p className="mt-1 font-sans text-sm text-pencil">
                先处理审核与反馈，再进入内容、封禁和系统管理。
              </p>
            </div>
            <div className="rounded-2xl border-2 border-ink bg-white px-5 py-3 text-right shadow-sketch-sm">
              <p className="font-sans text-xs text-pencil">待处理合计</p>
              <p className="font-display text-4xl text-ink">{totalTodoCount}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {workItems.map((item) => (
              <button
                key={item.title}
                type="button"
                onClick={item.onClick}
                className="group min-h-[156px] rounded-2xl border-2 border-ink bg-white p-4 text-left shadow-sketch-sm transition-all hover:-translate-y-0.5 hover:bg-paper"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className={`flex h-12 w-12 items-center justify-center rounded-2xl border-2 border-ink ${item.color}`}>
                    {item.icon}
                  </span>
                  <span className={`rounded-full border border-ink px-3 py-1 text-xs font-bold ${item.count > 0 ? 'bg-red-500 text-white' : 'bg-gray-100 text-pencil'}`}>
                    {item.count > 0 ? `${item.count} 项` : '无待办'}
                  </span>
                </div>
                <h3 className="mt-4 font-display text-xl text-ink">{item.title}</h3>
                <p className="mt-1 min-h-[36px] font-sans text-sm text-pencil">{item.description}</p>
                <p className="mt-3 font-sans text-xs font-bold text-ink group-hover:underline">{item.actionLabel} →</p>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {quickEntries.map((item) => (
              <button
                key={item.title}
                type="button"
                onClick={item.onClick}
                className="flex items-center justify-between gap-4 rounded-2xl border-2 border-ink bg-white/80 px-4 py-3 text-left shadow-sketch-sm transition-all hover:-translate-y-0.5 hover:bg-white"
              >
                <span className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-ink bg-paper">
                    {item.icon}
                  </span>
                  <span>
                    <span className="block font-sans text-sm font-bold text-ink">{item.title}</span>
                    <span className="block font-sans text-xs text-pencil">{item.description}</span>
                  </span>
                </span>
                <span className="font-display text-2xl text-ink">{item.value}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
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

      <section className="grid grid-cols-1 gap-8 lg:grid-cols-2">
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
};

export default AdminOverviewView;
