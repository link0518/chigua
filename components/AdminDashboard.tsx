import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, Tooltip, ResponsiveContainer,
  LineChart, Line
} from 'recharts';
import { Flag, Gavel, BarChart2, Bell, Search, Trash2, Ban, EyeOff, LayoutDashboard, LogOut, CheckCircle, XCircle, FileText, RotateCcw } from 'lucide-react';
import { SketchButton, Badge, roughBorderClassSm } from './SketchUI';
import { AdminPost, Report } from '../types';
import { useApp } from '../store/AppContext';
import Modal from './Modal';
import { api } from '../api';

type AdminView = 'overview' | 'reports' | 'processed' | 'stats' | 'posts';
type PostStatusFilter = 'all' | 'active' | 'deleted';
type PostSort = 'time' | 'hot' | 'reports';

const WEEK_DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const POST_PAGE_SIZE = 10;

const StatCard: React.FC<{ title: string; value: string; trend: string; trendUp: boolean; icon: React.ReactNode; color?: string }> = ({ title, value, trend, trendUp, icon, color = 'bg-white' }) => (
  <div className={`${color} p-6 border-2 border-ink shadow-sketch relative overflow-hidden group hover:-translate-y-1 transition-transform duration-200 sticky-curl ${roughBorderClassSm}`}>
    <div className="absolute -right-4 -top-4 text-ink/10 rotate-12 group-hover:rotate-0 transition-transform scale-150 opacity-100">
      {icon}
    </div>
    <p className="text-pencil text-sm font-bold mb-2 uppercase tracking-wider font-sans">{title}</p>
    <div className="flex items-end gap-3 relative z-10">
      <span className="text-5xl font-display text-ink">{value}</span>
      <span className={`text-xs font-bold border border-ink px-2 py-1 rounded-sm shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] ${trendUp ? 'bg-alert' : 'bg-gray-200'}`}>
        {trend}
      </span>
    </div>
  </div>
);

const AdminDashboard: React.FC = () => {
  const { state, handleReport, showToast, getPendingReports, loadReports, loadStats, logoutAdmin } = useApp();
  const [currentView, setCurrentView] = useState<AdminView>('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [postSearch, setPostSearch] = useState('');
  const [postStatus, setPostStatus] = useState<PostStatusFilter>('active');
  const [postSort, setPostSort] = useState<PostSort>('time');
  const [postPage, setPostPage] = useState(1);
  const [postTotal, setPostTotal] = useState(0);
  const [postItems, setPostItems] = useState<AdminPost[]>([]);
  const [postLoading, setPostLoading] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    reportId: string;
    action: 'ignore' | 'delete' | 'ban';
    content: string;
  }>({ isOpen: false, reportId: '', action: 'ignore', content: '' });
  const [postConfirmModal, setPostConfirmModal] = useState<{
    isOpen: boolean;
    postId: string;
    action: 'delete' | 'restore';
    content: string;
  }>({ isOpen: false, postId: '', action: 'delete', content: '' });

  useEffect(() => {
    loadReports().catch(() => { });
    loadStats().catch(() => { });
  }, [loadReports, loadStats]);

  // Generate chart data from state
  const visitData = useMemo(() =>
    WEEK_DAYS.map((name, i) => ({
      name,
      value: state.stats.weeklyVisits[i] || 0
    })), [state.stats.weeklyVisits]);

  const postVolumeData = useMemo(() =>
    WEEK_DAYS.map((name, i) => ({
      name,
      value: state.stats.weeklyPosts[i] || 0
    })), [state.stats.weeklyPosts]);

  const pendingReports = getPendingReports();
  const processedReports = state.reports.filter(r => r.status !== 'pending');

  // Filter reports by search query
  const filteredReports = useMemo(() => {
    const reports = currentView === 'processed' ? processedReports : pendingReports;
    if (!searchQuery.trim()) return reports;
    const query = searchQuery.toLowerCase();
    return reports.filter(r =>
      r.id.toLowerCase().includes(query) ||
      r.contentSnippet.toLowerCase().includes(query) ||
      r.reason.toLowerCase().includes(query)
    );
  }, [currentView, pendingReports, processedReports, searchQuery]);

  const fetchAdminPosts = useCallback(async () => {
    setPostLoading(true);
    try {
      const data = await api.getAdminPosts({
        status: postStatus,
        sort: postSort,
        search: postSearch.trim(),
        page: postPage,
        limit: POST_PAGE_SIZE,
      });
      setPostItems(data.items || []);
      setPostTotal(data.total || 0);
    } catch (error) {
      const message = error instanceof Error ? error.message : '帖子加载失败，请稍后重试';
      showToast(message, 'error');
    } finally {
      setPostLoading(false);
    }
  }, [postPage, postSearch, postSort, postStatus, showToast]);

  useEffect(() => {
    if (currentView !== 'posts') {
      return;
    }
    const timer = setTimeout(() => {
      fetchAdminPosts().catch(() => { });
    }, 300);
    return () => clearTimeout(timer);
  }, [currentView, fetchAdminPosts]);

  const handleAction = (reportId: string, action: 'ignore' | 'delete' | 'ban', content: string) => {
    setConfirmModal({ isOpen: true, reportId, action, content });
  };

  const confirmAction = async () => {
    const { reportId, action } = confirmModal;
    try {
      await handleReport(reportId, action);
      const messages = {
        ignore: '已忽略该举报',
        delete: '已删除该内容',
        ban: '已封禁用户并删除内容',
      };
      showToast(messages[action], action === 'ignore' ? 'info' : 'success');
      setConfirmModal({ isOpen: false, reportId: '', action: 'ignore', content: '' });
    } catch (error) {
      const message = error instanceof Error ? error.message : '处理失败，请稍后重试';
      showToast(message, 'error');
    }
  };

  const getActionLabel = (action: 'ignore' | 'delete' | 'ban') => {
    switch (action) {
      case 'ignore': return '忽略该举报';
      case 'delete': return '删除该内容';
      case 'ban': return '封禁用户并删除';
    }
  };

  const handlePostAction = (postId: string, action: 'delete' | 'restore', content: string) => {
    setPostConfirmModal({ isOpen: true, postId, action, content });
  };

  const confirmPostAction = async () => {
    const { postId, action } = postConfirmModal;
    try {
      await api.handleAdminPost(postId, action);
      showToast(action === 'delete' ? '帖子已删除' : '帖子已恢复', 'success');
      setPostConfirmModal({ isOpen: false, postId: '', action: 'delete', content: '' });
      await fetchAdminPosts();
    } catch (error) {
      const message = error instanceof Error ? error.message : '操作失败，请稍后重试';
      showToast(message, 'error');
    }
  };

  const getPostActionLabel = (action: 'delete' | 'restore') => (action === 'delete' ? '删除帖子' : '恢复帖子');

  const NavItem: React.FC<{ view: AdminView; icon: React.ReactNode; label: string; badge?: number }> = ({ view, icon, label, badge }) => (
    <button
      onClick={() => setCurrentView(view)}
      className={`flex items-center gap-3 px-4 py-3 rounded-lg border-2 transition-all w-full text-left ${currentView === view
        ? 'border-ink bg-highlight shadow-sketch-sm'
        : 'border-transparent hover:border-ink hover:bg-white'
        }`}
    >
      {icon}
      <span>{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="ml-auto bg-ink text-white text-xs px-2 py-0.5 rounded-full">{badge}</span>
      )}
    </button>
  );

  const totalPostPages = Math.max(Math.ceil(postTotal / POST_PAGE_SIZE), 1);
  const isReportView = currentView === 'reports' || currentView === 'processed';
  const isPostView = currentView === 'posts';

  return (
    <div className="flex min-h-screen bg-paper overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 flex flex-col border-r-2 border-ink bg-paper z-20 hidden md:flex">
        <div className="p-6">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-full bg-ink border-2 border-ink flex items-center justify-center text-white">
              <LayoutDashboard size={20} />
            </div>
            <div>
              <h1 className="font-display text-xl leading-none">衙门</h1>
              <span className="text-xs text-pencil font-sans">管理员后台</span>
            </div>
          </div>

          <nav className="flex flex-col gap-3 font-sans font-bold text-sm">
            <NavItem view="overview" icon={<LayoutDashboard size={18} />} label="概览" />
            <NavItem view="posts" icon={<FileText size={18} />} label="帖子管理" />
            <NavItem view="reports" icon={<Flag size={18} />} label="待处理举报" badge={pendingReports.length} />
            <NavItem view="processed" icon={<Gavel size={18} />} label="已处理" badge={processedReports.length} />
            <NavItem view="stats" icon={<BarChart2 size={18} />} label="数据统计" />
          </nav>
        </div>
        <div className="mt-auto p-6 border-t-2 border-ink/10">
          <button
            onClick={() => {
              logoutAdmin().catch(() => { });
            }}
            className="flex items-center gap-2 text-pencil hover:text-red-500 font-bold text-sm transition-colors"
          >
            <LogOut size={16} /> 退出登录
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Header */}
        <header className="h-20 flex items-center justify-between px-8 border-b-2 border-ink bg-paper/90 backdrop-blur-sm z-10">
          <h2 className="text-2xl font-display flex items-center gap-2">
            {currentView === 'overview' && <><LayoutDashboard /> 概览</>}
            {currentView === 'posts' && <><FileText /> 帖子管理</>}
            {currentView === 'reports' && <><Flag /> 待处理举报</>}
            {currentView === 'processed' && <><Gavel /> 已处理</>}
            {currentView === 'stats' && <><BarChart2 /> 数据统计</>}
          </h2>
          <div className="flex items-center gap-4">
            {(isReportView || isPostView) && (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-pencil w-4 h-4" />
                <input
                  type="text"
                  value={isPostView ? postSearch : searchQuery}
                  onChange={(e) => {
                    if (isPostView) {
                      setPostSearch(e.target.value);
                      setPostPage(1);
                    } else {
                      setSearchQuery(e.target.value);
                    }
                  }}
                  placeholder={isPostView ? '搜索帖子内容...' : '搜索 ID 或内容...'}
                  className="pl-9 pr-4 py-2 rounded-full border-2 border-ink bg-white text-sm focus:shadow-sketch-sm outline-none transition-all w-64 font-sans"
                />
              </div>
            )}
            <button className="relative p-2 border-2 border-transparent hover:border-ink rounded-full hover:bg-highlight transition-all">
              <Bell size={20} />
              {pendingReports.length > 0 && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full border border-ink"></span>
              )}
            </button>
          </div>
        </header>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8">
          <div className="max-w-6xl mx-auto flex flex-col gap-8">

            {/* Overview View */}
            {currentView === 'overview' && (
              <>
                {/* Stats Row */}
                <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  <StatCard
                    title="今日举报"
                    value={state.stats.todayReports.toString()}
                    trend={state.stats.todayReports > 10 ? '+15%' : '-5%'}
                    trendUp={state.stats.todayReports > 10}
                    icon={<Flag size={80} />}
                    color="bg-marker-orange"
                  />
                  <StatCard
                    title="待处理"
                    value={pendingReports.length.toString()}
                    trend={pendingReports.length > 0 ? '需处理' : '已清空'}
                    trendUp={pendingReports.length > 0}
                    icon={<Gavel size={80} />}
                    color="bg-highlight"
                  />
                  <StatCard
                    title="封禁用户"
                    value={state.stats.bannedUsers.toString()}
                    trend="+1"
                    trendUp={false}
                    icon={<Ban size={80} />}
                    color="bg-marker-blue"
                  />
                  <StatCard
                    title="总帖子数"
                    value={state.stats.totalPosts.toString()}
                    trend="活跃"
                    trendUp={true}
                    icon={<BarChart2 size={80} />}
                    color="bg-marker-green"
                  />
                </section>

                {/* Charts Row */}
                <section className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <div className={`bg-white p-6 border-2 border-ink shadow-sketch ${roughBorderClassSm}`}>
                    <div className="flex justify-between items-start mb-6">
                      <div>
                        <h3 className="font-display text-lg">每日发帖量</h3>
                        <p className="text-pencil text-xs font-sans">近7天数据</p>
                      </div>
                      <p className="font-display text-2xl">{postVolumeData.reduce((a, b) => a + b.value, 0)}</p>
                    </div>
                    <div className="h-48 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={postVolumeData}>
                          <Line type="monotone" dataKey="value" stroke="#2c2c2c" strokeWidth={3} strokeDasharray="5 5" dot={{ r: 4, fill: '#2c2c2c' }} />
                          <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#555' }} dy={10} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className={`bg-white p-6 border-2 border-ink shadow-sketch ${roughBorderClassSm}`}>
                    <div className="flex justify-between items-start mb-6">
                      <div>
                        <h3 className="font-display text-lg">访问统计</h3>
                        <p className="text-pencil text-xs font-sans">本周独立访客</p>
                      </div>
                      <p className="font-display text-2xl">{(visitData.reduce((a, b) => a + b.value, 0) / 1000).toFixed(1)}k</p>
                    </div>
                    <div className="h-48 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={visitData}>
                          <Bar dataKey="value" fill="white" stroke="#2c2c2c" strokeWidth={2} radius={[4, 4, 0, 0]} />
                          <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#555' }} dy={10} />
                          <Tooltip
                            cursor={{ fill: '#fef08a', opacity: 0.4 }}
                            contentStyle={{ border: '2px solid #2c2c2c', borderRadius: '8px', boxShadow: '2px 2px 0px 0px #000' }}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </section>

                {/* Recent Reports Preview */}
                {pendingReports.length > 0 && (
                  <section>
                    <div className="flex items-center justify-between mb-6">
                      <h2 className="text-xl font-display flex items-center gap-2">
                        <Flag size={20} /> 最新待处理举报
                      </h2>
                      <button
                        onClick={() => setCurrentView('reports')}
                        className="font-hand text-ink hover:underline"
                      >
                        查看全部 →
                      </button>
                    </div>
                    <div className="flex flex-col gap-4">
                      {pendingReports.slice(0, 2).map(report => (
                        <ReportCard
                          key={report.id}
                          report={report}
                          onAction={handleAction}
                          showStatus={false}
                        />
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}

            {/* Posts View */}
            {currentView === 'posts' && (
              <section>
                <div className="flex flex-col gap-3 mb-6">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-xs text-pencil font-sans">状态</span>
                    {(['all', 'active', 'deleted'] as PostStatusFilter[]).map((status) => (
                      <button
                        key={status}
                        onClick={() => {
                          setPostStatus(status);
                          setPostPage(1);
                        }}
                        className={`px-3 py-1 text-xs font-bold rounded-full border-2 transition-all ${postStatus === status ? 'border-ink bg-highlight' : 'border-transparent bg-white hover:border-ink'
                          }`}
                      >
                        {status === 'all' ? '全部' : status === 'active' ? '未删除' : '已删除'}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-xs text-pencil font-sans">排序</span>
                    {(['time', 'hot', 'reports'] as PostSort[]).map((sort) => (
                      <button
                        key={sort}
                        onClick={() => {
                          setPostSort(sort);
                          setPostPage(1);
                        }}
                        className={`px-3 py-1 text-xs font-bold rounded-full border-2 transition-all ${postSort === sort ? 'border-ink bg-highlight' : 'border-transparent bg-white hover:border-ink'
                          }`}
                      >
                        {sort === 'time' ? '时间' : sort === 'hot' ? '热度' : '举报数'}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center justify-between text-xs text-pencil font-sans">
                    <span>共 {postTotal} 条</span>
                    <span>第 {postPage} / {totalPostPages} 页</span>
                  </div>
                </div>

                {postLoading ? (
                  <div className="text-center py-16 bg-white border-2 border-ink rounded-lg">
                    <span className="text-6xl mb-4 block">⏳</span>
                    <h3 className="font-display text-2xl text-ink mb-2">正在加载帖子</h3>
                    <p className="font-hand text-lg text-pencil">请稍等片刻</p>
                  </div>
                ) : postItems.length === 0 ? (
                  <div className="text-center py-16 bg-white border-2 border-ink rounded-lg">
                    <span className="text-6xl mb-4 block">🗂️</span>
                    <h3 className="font-display text-2xl text-ink mb-2">暂无帖子</h3>
                    <p className="font-hand text-lg text-pencil">调整筛选条件试试</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-4">
                    {postItems.map((post) => (
                      <div key={post.id} className="bg-white p-5 rounded-lg border-2 border-ink shadow-sketch-sm hover:shadow-sketch transition-all">
                        <div className="flex flex-col md:flex-row gap-6 justify-between items-start">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-3 flex-wrap">
                              <span className="bg-gray-100 border border-ink text-ink text-[10px] font-bold px-2 py-0.5 rounded font-sans">ID: #{post.id}</span>
                              <span className="text-pencil text-xs font-bold font-sans">{post.timestamp}</span>
                              <Badge color={post.deleted ? 'bg-gray-200' : 'bg-highlight'}>
                                {post.deleted ? '已删除' : '正常'}
                              </Badge>
                              <span className="text-ink text-xs flex items-center gap-1 border border-ink px-2 py-0.5 rounded font-bold font-sans">
                                举报 {post.reports}
                              </span>
                            </div>
                            <p className="text-ink text-base leading-relaxed font-sans font-semibold line-clamp-2">
                              "{post.content}"
                            </p>
                            <div className="flex flex-wrap items-center gap-4 text-xs text-pencil font-sans mt-3">
                              <span>点赞 {post.likes}</span>
                              <span>评论 {post.comments}</span>
                              <span>举报 {post.reports}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 min-w-fit mt-2 md:mt-0 font-sans">
                            {post.deleted ? (
                              <SketchButton
                                variant="secondary"
                                className="h-10 px-3 text-xs flex items-center gap-1"
                                onClick={() => handlePostAction(post.id, 'restore', post.content)}
                              >
                                <RotateCcw size={14} /> 恢复
                              </SketchButton>
                            ) : (
                              <SketchButton
                                variant="danger"
                                className="h-10 px-3 text-xs flex items-center gap-1"
                                onClick={() => handlePostAction(post.id, 'delete', post.content)}
                              >
                                <Trash2 size={14} /> 删除
                              </SketchButton>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {postItems.length > 0 && (
                  <div className="flex items-center justify-center gap-4 mt-6">
                    <SketchButton
                      variant="secondary"
                      className="px-4 py-2 text-sm"
                      disabled={postPage <= 1}
                      onClick={() => setPostPage((prev) => Math.max(prev - 1, 1))}
                    >
                      上一页
                    </SketchButton>
                    <span className="text-xs text-pencil font-sans">第 {postPage} / {totalPostPages} 页</span>
                    <SketchButton
                      variant="secondary"
                      className="px-4 py-2 text-sm"
                      disabled={postPage >= totalPostPages}
                      onClick={() => setPostPage((prev) => Math.min(prev + 1, totalPostPages))}
                    >
                      下一页
                    </SketchButton>
                  </div>
                )}
              </section>
            )}

            {/* Reports View */}
            {(currentView === 'reports' || currentView === 'processed') && (
              <section>
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-display flex items-center gap-2">
                    {currentView === 'reports' ? (
                      <><Flag size={20} /> 待处理举报</>
                    ) : (
                      <><Gavel size={20} /> 已处理</>
                    )}
                    <span className="bg-ink text-white text-xs px-2 py-1 rounded-full font-sans">
                      {filteredReports.length}
                    </span>
                  </h2>
                </div>

                {filteredReports.length === 0 ? (
                  <div className="text-center py-16 bg-white border-2 border-ink rounded-lg">
                    <span className="text-6xl mb-4 block">
                      {searchQuery ? '🔍' : '✅'}
                    </span>
                    <h3 className="font-display text-2xl text-ink mb-2">
                      {searchQuery ? '没有找到匹配的结果' : '暂无待处理举报'}
                    </h3>
                    <p className="font-hand text-lg text-pencil">
                      {searchQuery ? '尝试其他关键词' : '做得好！保持关注～'}
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-4">
                    {filteredReports.map(report => (
                      <ReportCard
                        key={report.id}
                        report={report}
                        onAction={handleAction}
                        showStatus={currentView === 'processed'}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* Stats View */}
            {currentView === 'stats' && (
              <section className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className={`bg-white p-6 border-2 border-ink shadow-sketch ${roughBorderClassSm}`}>
                  <h3 className="font-display text-xl mb-6">每日发帖量</h3>
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={postVolumeData}>
                        <Line type="monotone" dataKey="value" stroke="#2c2c2c" strokeWidth={3} dot={{ r: 6, fill: '#2c2c2c' }} />
                        <XAxis dataKey="name" axisLine={false} tickLine={false} />
                        <Tooltip />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className={`bg-white p-6 border-2 border-ink shadow-sketch ${roughBorderClassSm}`}>
                  <h3 className="font-display text-xl mb-6">访问统计</h3>
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={visitData}>
                        <Bar dataKey="value" fill="#fef08a" stroke="#2c2c2c" strokeWidth={2} radius={[4, 4, 0, 0]} />
                        <XAxis dataKey="name" axisLine={false} tickLine={false} />
                        <Tooltip />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </section>
            )}

          </div>
        </div>
      </main>

      {/* Confirm Modal */}
      <Modal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal({ isOpen: false, reportId: '', action: 'ignore', content: '' })}
        title="确认操作"
      >
        <div className="flex flex-col gap-4">
          <p className="font-hand text-lg text-ink">
            确定要 <strong className="text-red-600">{getActionLabel(confirmModal.action)}</strong> 吗？
          </p>
          <div className="p-3 bg-gray-50 border border-dashed border-ink rounded-lg">
            <p className="text-sm text-pencil font-sans line-clamp-2">"{confirmModal.content}"</p>
          </div>
          <div className="flex gap-3 mt-2">
            <SketchButton
              variant="secondary"
              className="flex-1"
              onClick={() => setConfirmModal({ isOpen: false, reportId: '', action: 'ignore', content: '' })}
            >
              取消
            </SketchButton>
            <SketchButton
              variant={confirmModal.action === 'ignore' ? 'secondary' : 'danger'}
              className="flex-1"
              onClick={confirmAction}
            >
              确认{confirmModal.action === 'ban' ? '封禁' : confirmModal.action === 'delete' ? '删除' : '忽略'}
            </SketchButton>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={postConfirmModal.isOpen}
        onClose={() => setPostConfirmModal({ isOpen: false, postId: '', action: 'delete', content: '' })}
        title="确认操作"
      >
        <div className="flex flex-col gap-4">
          <p className="font-hand text-lg text-ink">
            确定要 <strong className="text-red-600">{getPostActionLabel(postConfirmModal.action)}</strong> 吗？
          </p>
          <div className="p-3 bg-gray-50 border border-dashed border-ink rounded-lg">
            <p className="text-sm text-pencil font-sans line-clamp-2">"{postConfirmModal.content}"</p>
          </div>
          <div className="flex gap-3 mt-2">
            <SketchButton
              variant="secondary"
              className="flex-1"
              onClick={() => setPostConfirmModal({ isOpen: false, postId: '', action: 'delete', content: '' })}
            >
              取消
            </SketchButton>
            <SketchButton
              variant={postConfirmModal.action === 'delete' ? 'danger' : 'secondary'}
              className="flex-1"
              onClick={confirmPostAction}
            >
              确认{postConfirmModal.action === 'delete' ? '删除' : '恢复'}
            </SketchButton>
          </div>
        </div>
      </Modal>
    </div>
  );
};

// Separate ReportCard component
const ReportCard: React.FC<{
  report: Report;
  onAction: (id: string, action: 'ignore' | 'delete' | 'ban', content: string) => void;
  showStatus?: boolean;
}> = ({ report, onAction, showStatus = false }) => {
  const getRiskBg = (level: string) => {
    switch (level) {
      case 'high': return 'bg-highlight';
      case 'medium': return 'bg-alert';
      default: return 'bg-gray-200';
    }
  };

  return (
    <div className="bg-white p-5 rounded-lg border-2 border-ink shadow-sketch-sm hover:shadow-sketch transition-all group">
      <div className="flex flex-col md:flex-row gap-6 justify-between items-start">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <span className="bg-gray-100 border border-ink text-ink text-[10px] font-bold px-2 py-0.5 rounded font-sans">ID: #{report.id}</span>
            <span className="text-pencil text-xs font-bold font-sans">{report.timestamp}</span>
            <span className={`text-ink text-xs flex items-center gap-1 border border-ink px-2 py-0.5 rounded font-bold font-sans ${getRiskBg(report.riskLevel)}`}>
              {report.reason}
            </span>
            {showStatus && (
              <span className={`text-xs flex items-center gap-1 border border-ink px-2 py-0.5 rounded font-bold font-sans ${report.status === 'resolved' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                }`}>
                {report.status === 'resolved' ? <CheckCircle size={12} /> : <XCircle size={12} />}
                {report.status === 'resolved' ? '已处理' : '已忽略'}
              </span>
            )}
          </div>
          <p className="text-ink text-base leading-relaxed font-sans font-semibold">
            "{report.contentSnippet}"
          </p>
        </div>

        {!showStatus && (
          <div className="flex items-center gap-2 min-w-fit mt-2 md:mt-0 font-sans">
            <SketchButton
              variant="secondary"
              className="h-10 px-3 text-xs flex items-center gap-1"
              onClick={() => onAction(report.id, 'ignore', report.contentSnippet)}
            >
              <EyeOff size={14} /> 忽略
            </SketchButton>
            <SketchButton
              variant="danger"
              className="h-10 px-3 text-xs flex items-center gap-1"
              onClick={() => onAction(report.id, 'delete', report.contentSnippet)}
            >
              <Trash2 size={14} /> 删除
            </SketchButton>
            <SketchButton
              variant="primary"
              className="h-10 px-3 text-xs flex items-center gap-1 text-white"
              onClick={() => onAction(report.id, 'ban', report.contentSnippet)}
            >
              <Ban size={14} /> 封禁
            </SketchButton>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminDashboard;
