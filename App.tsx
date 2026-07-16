import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ViewType } from './types';
import type { NotificationItem } from './types';
import Toast from './components/Toast';
import Modal from './components/Modal';
import MarkdownRenderer from './components/MarkdownRenderer';
import StreakCelebration from './components/StreakCelebration';
import { api } from './api';
import {
  AlertTriangle,
  Bell,
  BookOpen,
  Bookmark,
  CheckCircle,
  Clock3,
  Flame,
  Megaphone,
  Menu,
  MessageCircle,
  Pencil,
  Reply,
  Search,
  Star,
  ThumbsUp,
  UserCircle,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import { useApp } from './store/AppContext';
import AntigravityBackground from './components/AntigravityBackground';
import Lantern from './components/CNY/Lantern';
import FallingDecorations from './components/CNY/FallingDecorations';
import HeaderDecoration from './components/CNY/HeaderDecoration';
import CNYAtmosphereBackground from './components/CNY/CNYAtmosphereBackground';
import UserMeModal from './components/UserMeModal';
import { buildPostPath } from './components/clipboard';
import AppViewRenderer, { prefetchFeedView } from '@/features/app/AppViewRenderer';
import ViewLoadErrorBoundary from '@/features/app/ViewLoadErrorBoundary';
import { getPathForView, resolveViewFromPath } from '@/features/app/routing';
import { useAccessStatus } from '@/features/app/hooks/useAccessStatus';
import { useStreakCelebration } from '@/features/app/hooks/useStreakCelebration';
import WikiLoadingScreen from './components/wiki/WikiLoadingScreen';
import SiteFooter from './components/SiteFooter';
import { setFrameRegistry } from './components/nicknameFrames';
import { setNameStyleRegistry } from './components/nameStyles';

const syncDocumentThemeClass = (className: string, enabled: boolean) => {
  document.documentElement.classList.toggle(className, enabled);
  document.body.classList.toggle(className, enabled);
};

const App: React.FC = () => {
  const { loadSettings, prefetchFeedPosts, state } = useApp();
  const [currentView, setCurrentView] = useState<ViewType>(() => resolveViewFromPath(window.location.pathname));
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [headerCompact, setHeaderCompact] = useState(() => window.scrollY > 36);
  const [announcementOpen, setAnnouncementOpen] = useState(false);
  const [userMeOpen, setUserMeOpen] = useState(false);
  const [announcementContent, setAnnouncementContent] = useState('');
  const [announcementUpdatedAt, setAnnouncementUpdatedAt] = useState<number | null>(null);
  const [announcementUnread, setAnnouncementUnread] = useState(false);
  const [updateAnnouncementUnread, setUpdateAnnouncementUnread] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notificationsUnread, setNotificationsUnread] = useState(0);
  const notificationRef = useRef<HTMLDivElement | null>(null);
  const [backgroundTasksReady, setBackgroundTasksReady] = useState(false);
  const isWikiView = currentView === ViewType.WIKI;
  const showSiteChrome = currentView !== ViewType.ADMIN && !isWikiView;
  const isCnyTheme = currentView !== ViewType.ADMIN && !isWikiView && state.settings.cnyThemeActive;
  const { accessBlocked, accessExpiresAt, accessChecked } = useAccessStatus();
  const {
    streakCelebrationOpen,
    streakCelebrationDays,
    closeStreakCelebration,
  } = useStreakCelebration({
    backgroundTasksReady,
    currentView,
  });

  const prefetchHotFeed = useCallback(() => {
    prefetchFeedView();
    void prefetchFeedPosts('today').catch(() => { });
  }, [prefetchFeedPosts]);

  useEffect(() => {
    const timer = window.setTimeout(() => setBackgroundTasksReady(true), 15000);
    return () => {
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const runPrefetch = () => prefetchFeedView();
    if (typeof window.requestIdleCallback === 'function') {
      const idleCallbackId = window.requestIdleCallback(runPrefetch, { timeout: 3000 });
      return () => window.cancelIdleCallback(idleCallbackId);
    }

    // Safari 等不支持空闲回调的浏览器延迟加载，避免阻塞首屏关键资源。
    const timer = window.setTimeout(runPrefetch, 1500);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (currentView === ViewType.FEED) {
      // 直达 /feed 时让组件代码与默认榜单请求并行，FeedView 会复用同一请求。
      prefetchHotFeed();
    }
  }, [currentView, prefetchHotFeed]);

  useEffect(() => {
    let animationFrame: number | null = null;
    const syncHeaderState = () => {
      animationFrame = null;
      // 收缩与展开使用不同阈值，避免短页面因顶栏高度变化在临界点反复切换。
      setHeaderCompact((compact) => (compact ? window.scrollY > 8 : window.scrollY > 36));
    };
    const handleScroll = () => {
      // 使用动画帧合并高频滚动事件，避免顶栏收缩时反复触发渲染。
      if (animationFrame === null) {
        animationFrame = window.requestAnimationFrame(syncHeaderState);
      }
    };

    syncHeaderState();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
    };
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      setCurrentView(resolveViewFromPath(window.location.pathname));
      setMobileMenuOpen(false);
    };

    handlePopState();
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  useEffect(() => {
    api.getAnnouncement()
      .then((data) => {
        const content = String(data?.content || '').trim();
        const updatedAt = typeof data?.updatedAt === 'number' ? data.updatedAt : null;
        setAnnouncementContent(content);
        setAnnouncementUpdatedAt(updatedAt);
        if (!content || !updatedAt) {
          setAnnouncementUnread(false);
          return;
        }
        const lastSeen = Number(localStorage.getItem('announcement:lastSeen') || '0');
        setAnnouncementUnread(updatedAt > lastSeen);
      })
      .catch(() => { });
  }, []);

  const syncUpdateAnnouncementUnread = useCallback(() => {
    api.getLatestUpdateAnnouncement()
      .then((data) => {
        const latestUpdatedAt = Number(data?.updatedAt || 0);
        if (!latestUpdatedAt) {
          setUpdateAnnouncementUnread(false);
          return;
        }
        const lastSeen = Number(localStorage.getItem('updateAnnouncements:lastSeen') || '0');
        setUpdateAnnouncementUnread(latestUpdatedAt > lastSeen);
      })
      .catch(() => { });
  }, []);

  useEffect(() => {
    syncUpdateAnnouncementUnread();
  }, [syncUpdateAnnouncementUnread]);

  useEffect(() => {
    const refreshUpdateAnnouncements = () => {
      syncUpdateAnnouncementUnread();
    };
    const timer = window.setInterval(refreshUpdateAnnouncements, 5 * 60 * 1000);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        refreshUpdateAnnouncements();
      }
    };
    window.addEventListener('focus', refreshUpdateAnnouncements);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refreshUpdateAnnouncements);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [syncUpdateAnnouncementUnread]);


  useEffect(() => {
    loadSettings().catch(() => { });
  }, [loadSettings]);

  useEffect(() => {
    let active = true;
    api.getFrames()
      .then((data) => {
        if (!active) return;
        const items = Array.isArray(data?.items) ? data.items : [];
        setFrameRegistry(items);
      })
      .catch(() => { });
    api.getNameStyles()
      .then((data) => {
        if (!active) return;
        const items = Array.isArray(data?.items) ? data.items : [];
        setNameStyleRegistry(items);
      })
      .catch(() => { });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const refreshSettings = () => {
      loadSettings().catch(() => { });
    };
    const timer = window.setInterval(refreshSettings, 5 * 60 * 1000);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        refreshSettings();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', refreshSettings);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', refreshSettings);
    };
  }, [loadSettings]);

  useLayoutEffect(() => {
    syncDocumentThemeClass('theme-wiki', isWikiView);
    syncDocumentThemeClass('theme-cny', isCnyTheme);
    return () => {
      document.documentElement.classList.remove('theme-wiki', 'theme-cny');
      document.body.classList.remove('theme-cny');
      document.body.classList.remove('theme-wiki');
    };
  }, [isCnyTheme, isWikiView]);

  useLayoutEffect(() => {
    if (currentView === ViewType.SEARCH) {
      return;
    }

    // 文本光标浏览开启时，旧页面的折叠选区会迁移到新页面的首个文本节点。
    window.getSelection()?.removeAllRanges();
  }, [currentView]);

  useEffect(() => {
    let active = true;
    const sendHeartbeat = async () => {
      if (!active) return;
      try {
        await api.sendHeartbeat();
      } catch {
        // 忽略心跳失败
      }
    };
    sendHeartbeat();
    const timer = setInterval(sendHeartbeat, 60000);
    const handleVisibility = () => {
      if (!document.hidden) {
        sendHeartbeat();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  const formatAnnouncementTime = (value: number | null) => {
    if (!value) {
      return '';
    }
    return new Date(value).toLocaleString('zh-CN');
  };

  const formatAccessExpire = (value: number | null) => {
    if (!value) {
      return '永久限制';
    }
    return `限制至 ${new Date(value).toLocaleString('zh-CN')}`;
  };

  const openAnnouncement = () => {
    setAnnouncementOpen(true);
    if (announcementUpdatedAt) {
      localStorage.setItem('announcement:lastSeen', String(announcementUpdatedAt));
      setAnnouncementUnread(false);
    }
  };

  const openUserMe = () => {
    setUserMeOpen(true);
    setMobileMenuOpen(false);
  };

  const openViewInNewTab = useCallback((view: ViewType) => {
    const targetPath = getPathForView(view);
    const nextWindow = window.open(targetPath, '_blank', 'noopener,noreferrer');
    if (nextWindow) {
      nextWindow.opener = null;
    }
  }, []);

  const markUpdateAnnouncementsSeen = useCallback((updatedAt: number) => {
    if (!updatedAt) {
      return;
    }
    localStorage.setItem('updateAnnouncements:lastSeen', String(updatedAt));
    setUpdateAnnouncementUnread(false);
  }, []);

  const formatNotificationTime = (value?: number | null) => {
    if (!value) {
      return '';
    }
    return new Date(value).toLocaleString('zh-CN');
  };

  const getNotificationLabel = (type: NotificationItem['type']) => {
    switch (type) {
      case 'post_comment':
        return '你的帖子收到新评论';
      case 'comment_reply':
        return '你的评论收到新回复';
      case 'post_like':
        return '你的帖子收到新点赞';
      case 'comment_like':
        return '你的评论收到新点赞';
      case 'rumor_marked':
        return '你举报的内容已被判定为疑似谣言';
      case 'rumor_rejected':
        return '你提交的谣言举报已被驳回';
      case 'feedback_reply':
        return '管理员回复了你的留言';
      case 'post_delete_request_approved':
        return '你的帖子删除申请已通过';
      case 'post_delete_request_rejected':
        return '你的帖子删除申请已驳回';
      case 'post_feature_request_approved':
        return '你申请的帖子已加精';
      case 'post_feature_request_rejected':
        return '你的加精申请未通过';
      default:
        return '你有新提醒';
    }
  };

  const renderNotificationIcon = (type: NotificationItem['type']) => {
    const className = 'w-5 h-5 text-pencil shrink-0';
    switch (type) {
      case 'post_comment':
        return <MessageCircle className={className} />;
      case 'comment_reply':
        return <Reply className={className} />;
      case 'post_like':
      case 'comment_like':
        return <ThumbsUp className={className} />;
      case 'rumor_marked':
        return <AlertTriangle className={className} />;
      case 'rumor_rejected':
        return <XCircle className={className} />;
      case 'feedback_reply':
        return <Reply className={className} />;
      case 'post_delete_request_approved':
        return <CheckCircle className={className} />;
      case 'post_delete_request_rejected':
        return <Trash2 className={className} />;
      case 'post_feature_request_approved':
        return <Star className={className} />;
      case 'post_feature_request_rejected':
        return <XCircle className={className} />;
      default:
        return <Bell className={className} />;
    }
  };

  const fetchNotifications = useCallback(async () => {
    setNotificationsLoading(true);
    try {
      const data = await api.getNotifications({ status: 'all', limit: 20 });
      setNotifications(data.items || []);
      setNotificationsUnread(Number(data.unreadCount || 0));
    } catch {
      // 忽略加载失败，保持现有提示
    } finally {
      setNotificationsLoading(false);
    }
  }, []);

  const openNotificationTarget = useCallback((item: NotificationItem) => {
    if (item.postId) {
      setCurrentView(ViewType.HOME);
      setMobileMenuOpen(false);
      setNotificationsOpen(false);
      const targetPath = buildPostPath(item.postId, item.commentId || null);
      if (window.location.pathname + window.location.search !== targetPath) {
        window.history.pushState({}, '', targetPath);
      }
      window.dispatchEvent(new CustomEvent('notification:navigate', {
        detail: { postId: item.postId, commentId: item.commentId || null },
      }));
      return;
    }
    setNotificationsOpen(false);
  }, []);

  const navigate = useCallback((view: ViewType) => {
    if (view === ViewType.FEED) {
      prefetchHotFeed();
    }
    const targetPath = getPathForView(view);
    const shouldRefreshHome = view === ViewType.HOME && currentView === ViewType.HOME;
    setCurrentView(view);
    setMobileMenuOpen(false);
    if (window.location.pathname !== targetPath) {
      window.history.pushState({}, '', targetPath);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
    if (shouldRefreshHome) {
      window.dispatchEvent(new CustomEvent('home:refresh'));
    }
  }, [currentView, prefetchHotFeed]);

  useEffect(() => {
    if (!backgroundTasksReady) {
      return;
    }
    fetchNotifications();
    const timer = setInterval(fetchNotifications, 30000);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchNotifications();
      }
    };
    window.addEventListener('focus', fetchNotifications);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', fetchNotifications);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [backgroundTasksReady, fetchNotifications]);

  useEffect(() => {
    setNotificationsOpen(false);
  }, [currentView]);


  useEffect(() => {
    if (!notificationsOpen) {
      return;
    }
    const run = async () => {
      await fetchNotifications();
      try {
        const data = await api.readNotifications();
        const readAt = typeof data?.readAt === 'number' ? data.readAt : Date.now();
        setNotificationsUnread(0);
        setNotifications((prev) => prev.map((item) => (item.readAt ? item : { ...item, readAt })));
      } catch {
        // 忽略标记失败
      }
    };
    run();
  }, [notificationsOpen, fetchNotifications]);

  useEffect(() => {
    if (!notificationsOpen) {
      return;
    }
    const handleClick = (event: MouseEvent) => {
      if (!notificationRef.current) {
        return;
      }
      if (!notificationRef.current.contains(event.target as Node)) {
        setNotificationsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => {
      document.removeEventListener('mousedown', handleClick);
    };
  }, [notificationsOpen]);

  const SideNavItem: React.FC<{
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
    onIntent?: () => void;
    active?: boolean;
    dot?: boolean;
  }> = ({ label, icon, onClick, onIntent, active = false, dot = false }) => (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={onIntent}
      onFocus={onIntent}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`doodle-side-nav-item group relative flex w-full items-center gap-3 px-3 py-3 text-left font-hand text-lg font-bold transition-all active:translate-x-px active:translate-y-px ${active
        ? isCnyTheme
          ? 'is-active border-cny-gold bg-cny-gold text-cny-dark-red shadow-sketch'
          : 'is-active border-ink bg-highlight text-ink shadow-sketch'
        : isCnyTheme
          ? 'border-transparent text-cny-gold hover:bg-cny-red'
          : 'border-transparent text-ink hover:bg-marker-blue/25'
        }`}
    >
      <span className="relative flex size-8 shrink-0 items-center justify-center">
        {icon}
        {dot && <span className="absolute right-0 top-0 size-2.5 rounded-full border border-ink bg-red-500" />}
      </span>
      <span>{label}</span>
    </button>
  );

  const MobileNavItem: React.FC<{
    label: string;
    onClick: () => void;
    onIntent?: () => void;
    dot?: boolean;
  }> = ({ label, onClick, onIntent, dot = false }) => (
    <button
      type="button"
      onMouseEnter={onIntent}
      onFocus={onIntent}
      onTouchStart={onIntent}
      onClick={onClick}
      className={`w-full flex items-center justify-between rounded-lg border-2 px-4 py-3 font-hand text-lg font-bold transition-all ${isCnyTheme ? 'border-cny-dark-red bg-cny-red text-cny-gold hover:bg-cny-dark-red' : 'border-ink bg-white hover:bg-highlight'}`}
    >
      <span>{label}</span>
      {dot && <span className="h-2.5 w-2.5 rounded-full bg-red-500 border border-ink" />}
    </button>
  );

  if (accessChecked && accessBlocked) {
    return (
      <div className="min-h-screen-safe flex flex-col items-center justify-center px-6 text-center bg-paper">
        <span className="text-6xl mb-4 block">⛔</span>
        <h2 className="font-display text-3xl text-ink mb-2">你已被限制浏览</h2>
        <p className="font-hand text-lg text-pencil mb-3">如有疑问请联系管理员</p>
        <p className="text-xs text-pencil">{formatAccessExpire(accessExpiresAt)}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen-safe flex flex-col font-sans selection:bg-highlight selection:text-black relative overflow-x-clip">
      {isCnyTheme && <FallingDecorations />}
      {isCnyTheme && (
        <>
          <CNYAtmosphereBackground density={80} speed={0.5} />
          <div className="fixed top-0 left-4 z-40 hidden md:block pointer-events-none">
            <Lantern size={78} delay={0.3} />
          </div>
          <div className="fixed top-0 right-4 z-40 hidden lg:block pointer-events-none">
            <Lantern size={72} delay={1.1} />
          </div>
        </>
      )}
      {!isCnyTheme && showSiteChrome && <AntigravityBackground density={60} speed={0.5} />}

      <StreakCelebration
        open={streakCelebrationOpen}
        onClose={closeStreakCelebration}
        title={`连续登录 ${streakCelebrationDays} 天！`}
        subtitle="彩纸礼花送给你～"
      />
      {/* 品牌区 */}
      {showSiteChrome && (
        <header className={`noticeboard-header ${headerCompact ? 'is-compact' : ''} ${isCnyTheme ? 'is-cny' : ''}`}>
          {isCnyTheme && <HeaderDecoration />}
          <span className="noticeboard-header__texture" aria-hidden="true" />
          <span className="noticeboard-header__torn-edge" aria-hidden="true" />
          <div className="noticeboard-header__inner">
            <button
              type="button"
              className="noticeboard-header__brand group"
              onClick={() => navigate(ViewType.HOME)}
              aria-label="返回 JX3瓜田首页"
            >
              <span className="noticeboard-header__seal" aria-hidden="true">
                <span>{isCnyTheme ? '福' : '瓜'}</span>
              </span>
              <span className="noticeboard-header__brand-copy">
                <span className="noticeboard-header__title">
                  <span className="noticeboard-header__title-line">JX3</span>
                  <span className="noticeboard-header__title-line">瓜田</span>
                  <span className="noticeboard-header__marker" aria-hidden="true" />
                </span>
                <span className="noticeboard-header__tagline">
                  江湖那么大，总有新鲜事
                </span>
              </span>
            </button>

            <div className="noticeboard-header__actions">
              <button
                type="button"
                onClick={() => navigate(ViewType.SUBMISSION)}
                className="noticeboard-header__submit"
              >
                <span className="flex items-center gap-2 whitespace-nowrap">
                  <Pencil className="size-5 shrink-0" />
                  <span className="leading-none">投稿</span>
                </span>
              </button>

              <div className="relative" ref={notificationRef}>
                <button
                  type="button"
                  onClick={() => setNotificationsOpen((prev) => !prev)}
                  className="noticeboard-header__icon-button inline-flex"
                  aria-label="提醒"
                  title="提醒"
                  aria-expanded={notificationsOpen}
                  aria-haspopup="dialog"
                >
                  <span className="relative flex items-center">
                    <Bell className="size-5" />
                    {notificationsUnread > 0 && (
                      <span className="noticeboard-header__count-badge">
                        {notificationsUnread > 99 ? '99+' : notificationsUnread}
                      </span>
                    )}
                  </span>
                </button>
                {notificationsOpen && (
                  <div className="absolute right-0 mt-3 w-80 max-w-[80vw] bg-paper-card border-2 border-ink rounded-lg shadow-sketch-sm p-4 z-50">
                    <div className="flex items-center justify-between mb-3">
                      <span className="font-hand font-bold text-base">提醒</span>
                      <span className="text-xs text-pencil font-sans">
                        {notificationsUnread > 0 ? `未读 ${notificationsUnread}` : '全部已读'}
                      </span>
                    </div>
                    {notificationsLoading ? (
                      <div className="text-center py-6 text-pencil font-hand">加载中...</div>
                    ) : notifications.length === 0 ? (
                      <div className="text-center py-6 text-pencil font-hand">暂无提醒</div>
                    ) : (
                      <div className="flex flex-col gap-3 max-h-80 overflow-auto">
                        {notifications.map((item) => (
                          <button
                            type="button"
                            key={item.id}
                            onClick={() => openNotificationTarget(item)}
                            className={`text-left border-2 rounded-lg p-3 transition-colors ${item.readAt ? 'border-gray-200 bg-gray-50 hover:bg-white' : 'border-ink/70 bg-highlight/30 hover:bg-highlight/50'}`}
                          >
                            <div className="flex items-start gap-3">
                              {renderNotificationIcon(item.type)}
                              <div className="flex-1">
                                <div className="text-sm font-sans text-ink flex items-center gap-2">
                                  <span className="font-bold">{getNotificationLabel(item.type)}</span>
                                  {!item.readAt && <span className="h-2 w-2 rounded-full bg-red-500" />}
                                </div>
                                {item.preview && (
                                  <div className={`text-xs text-pencil font-sans mt-1 break-words ${['feedback_reply', 'post_delete_request_approved', 'post_delete_request_rejected'].includes(item.type) ? 'whitespace-pre-wrap' : item.type === 'rumor_rejected' ? 'whitespace-pre-wrap line-clamp-4' : 'line-clamp-2'}`}>
                                    “{item.preview}”
                                  </div>
                                )}
                                <div className="text-[11px] text-gray-400 mt-2">
                                  {formatNotificationTime(item.createdAt)}
                                </div>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={openAnnouncement}
                className="noticeboard-header__icon-button hidden sm:inline-flex"
                aria-label="公告"
                title="公告"
              >
                <span className="relative flex items-center">
                  <Megaphone className="size-5" />
                  {announcementUnread && (
                    <span className="noticeboard-header__unread-tape" />
                  )}
                </span>
              </button>

              {/* 移动端菜单入口 */}
              <button
                type="button"
                className="noticeboard-header__menu inline-flex min-[1880px]:hidden"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                aria-label={mobileMenuOpen ? '关闭菜单' : '打开菜单'}
                aria-expanded={mobileMenuOpen}
              >
                {mobileMenuOpen ? <X /> : <Menu />}
                {(announcementUnread || updateAnnouncementUnread || notificationsUnread > 0) && (
                  <span className="noticeboard-header__menu-tape" />
                )}
              </button>
            </div>
          </div>
          {/* Mobile Nav Dropdown */}
          {mobileMenuOpen && (
            <div className={`noticeboard-header__mobile-panel min-[1880px]:hidden ${isCnyTheme ? 'is-cny' : ''}`}>
              <MobileNavItem
                label="我的"
                dot={updateAnnouncementUnread}
                onClick={openUserMe}
              />
              <MobileNavItem
                label="最新吃瓜"
                onClick={() => {
                  navigate(ViewType.HOME);
                  setMobileMenuOpen(false);
                }}
              />
              <MobileNavItem
                label="热门榜单"
                onIntent={prefetchHotFeed}
                onClick={() => {
                  navigate(ViewType.FEED);
                  setMobileMenuOpen(false);
                }}
              />
              <MobileNavItem
                label="精华"
                onClick={() => {
                  navigate(ViewType.FEATURED);
                  setMobileMenuOpen(false);
                }}
              />
              <MobileNavItem
                label="搜索"
                onClick={() => {
                  navigate(ViewType.SEARCH);
                  setMobileMenuOpen(false);
                }}
              />
              <MobileNavItem
                label="收藏"
                onClick={() => {
                  navigate(ViewType.FAVORITES);
                  setMobileMenuOpen(false);
                }}
              />
              <MobileNavItem
                label="瓜条"
                onClick={() => {
                  openViewInNewTab(ViewType.WIKI);
                  setMobileMenuOpen(false);
                }}
              />
              <MobileNavItem
                label="公告"
                dot={announcementUnread}
                onClick={() => {
                  openAnnouncement();
                  setMobileMenuOpen(false);
                }}
              />
            </div>
          )}
        </header>
      )}

      {showSiteChrome && (
        <aside className={`doodle-side-nav fixed left-[10vw] z-40 hidden w-[176px] border-2 px-3 pb-3 pt-7 shadow-paper min-[1880px]:block ${isCnyTheme ? 'border-cny-gold bg-cny-paper/95' : 'is-pastel border-ink'}`}>
          <span className={`doodle-side-nav-title pointer-events-none select-none ${isCnyTheme ? 'border-cny-gold bg-cny-red text-cny-gold' : 'border-ink bg-alert text-ink'}`}>
            瓜田导航
          </span>
          <nav aria-label="主导航" className="flex flex-col gap-2">
            <SideNavItem
              label="最新"
              icon={<Clock3 className="size-5" />}
              active={currentView === ViewType.HOME}
              onClick={() => navigate(ViewType.HOME)}
            />
            <SideNavItem
              label="热门"
              icon={<Flame className="size-5" />}
              active={currentView === ViewType.FEED}
              onIntent={prefetchHotFeed}
              onClick={() => navigate(ViewType.FEED)}
            />
            <SideNavItem
              label="精华"
              icon={<Star className="size-5" />}
              active={currentView === ViewType.FEATURED}
              onClick={() => navigate(ViewType.FEATURED)}
            />
            <SideNavItem
              label="搜索"
              icon={<Search className="size-5" />}
              active={currentView === ViewType.SEARCH}
              onClick={() => navigate(ViewType.SEARCH)}
            />
            <SideNavItem
              label="收藏"
              icon={<Bookmark className="size-5" />}
              active={currentView === ViewType.FAVORITES}
              onClick={() => navigate(ViewType.FAVORITES)}
            />
            <div className={`doodle-side-nav-divider my-1.5 ${isCnyTheme ? 'text-cny-dark-red/45' : 'text-ink/35'}`} aria-hidden="true">
              - - - - - -
            </div>
            <SideNavItem
              label="瓜条"
              icon={<BookOpen className="size-5" />}
              onClick={() => openViewInNewTab(ViewType.WIKI)}
            />
            <SideNavItem
              label="我的"
              icon={<UserCircle className="size-5" />}
              dot={updateAnnouncementUnread}
              onClick={openUserMe}
            />
          </nav>
        </aside>
      )}

      {/* 主内容区保持原有宽度与居中方式 */}
      <div className={`flex-grow flex flex-col ${currentView === ViewType.ADMIN ? 'h-screen' : ''}`}>
        <React.Suspense
          fallback={(
            currentView === ViewType.WIKI ? (
              <WikiLoadingScreen />
            ) : (
              <div
                aria-busy="true"
                className={`flex-grow w-full max-w-2xl mx-auto px-4 flex flex-col min-h-80vh-safe ${currentView === ViewType.HOME ? 'py-8' : 'pt-6 pb-20'}`}
              >
                <div className="relative w-full">
                  <div className="w-full rounded-lg border-2 border-black bg-white p-8 shadow-paper">
                    <div className="h-7 w-2/3 bg-gray-200 rounded mb-4" />
                    <div className="h-4 w-full bg-gray-200 rounded mb-2" />
                    <div className="h-4 w-11/12 bg-gray-200 rounded mb-2" />
                    <div className="h-4 w-10/12 bg-gray-200 rounded mb-6" />
                    <div className="h-10 w-32 bg-gray-200 rounded" />
                  </div>
                </div>
              </div>
            )
          )}
        >
          <ViewLoadErrorBoundary
            key={currentView}
            onNavigateHome={() => navigate(ViewType.HOME)}
          >
            <AppViewRenderer
              currentView={currentView}
              onNavigateHome={() => navigate(ViewType.HOME)}
            />
          </ViewLoadErrorBoundary>
        </React.Suspense>
      </div>

      {/* Toast Notifications */}
      {currentView !== ViewType.WIKI && <Toast />}

      <Modal
        isOpen={announcementOpen}
        onClose={() => setAnnouncementOpen(false)}
        title="公告"
      >
        {announcementContent ? (
          <div className="space-y-3">
            {announcementUpdatedAt && (
              <div className="text-xs text-pencil">更新时间：{formatAnnouncementTime(announcementUpdatedAt)}</div>
            )}
            <MarkdownRenderer content={announcementContent} className="text-sm text-ink" />
          </div>
        ) : (
          <p className="text-sm text-pencil">暂无公告</p>
        )}
      </Modal>

      <UserMeModal
        isOpen={userMeOpen}
        onClose={() => setUserMeOpen(false)}
        updateAnnouncementsUnread={updateAnnouncementUnread}
        onUpdateAnnouncementsSeen={markUpdateAnnouncementsSeen}
        onNavigate={navigate}
      />

      {/* Footer only for non-admin / non-wiki */}
      {showSiteChrome && <SiteFooter isCnyTheme={isCnyTheme} />}
    </div>
  );
};

export default App;
