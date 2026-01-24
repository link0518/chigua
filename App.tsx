import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ViewType } from './types';
import type { NotificationItem } from './types';
import SubmissionView from './components/SubmissionView';
import FeedView from './components/FeedView';
const AdminGate = React.lazy(() => import('./components/AdminGate'));
import HomeView from './components/HomeView';
import Toast from './components/Toast';
import Modal from './components/Modal';
import MarkdownRenderer from './components/MarkdownRenderer';
import { api } from './api';
import { Menu, X } from 'lucide-react';

const normalizePath = (path: string) => {
  if (!path || path === '/') {
    return '/';
  }
  return path.endsWith('/') ? path.slice(0, -1) : path;
};

// 简易路由映射：仅允许 /tiancai 进入后台，其余未知路径显示提示
const resolveViewFromPath = (path: string) => {
  const normalized = normalizePath(path);
  if (normalized === '/tiancai') {
    return ViewType.ADMIN;
  }
  if (normalized === '/' || /^\/post\/[^/]+$/.test(normalized)) {
    return ViewType.HOME;
  }
  return ViewType.NOT_FOUND;
};

const getPathForView = (view: ViewType) => {
  if (view === ViewType.ADMIN) {
    return '/tiancai';
  }
  return '/';
};

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<ViewType>(() => resolveViewFromPath(window.location.pathname));
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [announcementOpen, setAnnouncementOpen] = useState(false);
  const [announcementContent, setAnnouncementContent] = useState('');
  const [announcementUpdatedAt, setAnnouncementUpdatedAt] = useState<number | null>(null);
  const [announcementUnread, setAnnouncementUnread] = useState(false);
  const [accessBlocked, setAccessBlocked] = useState(false);
  const [accessExpiresAt, setAccessExpiresAt] = useState<number | null>(null);
  const [accessChecked, setAccessChecked] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notificationsUnread, setNotificationsUnread] = useState(0);
  const notificationRef = useRef<HTMLDivElement | null>(null);

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
      .catch(() => {});
  }, []);

  useEffect(() => {
    api.getAccessStatus()
      .then((data) => {
        if (data?.blocked || data?.viewBlocked) {
          setAccessBlocked(true);
          setAccessExpiresAt(typeof data?.expiresAt === 'number' ? data.expiresAt : null);
        }
      })
      .catch(() => {})
      .finally(() => {
        setAccessChecked(true);
      });
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
      default:
        return '你有新提醒';
    }
  };

  const getNotificationIcon = (type: NotificationItem['type']) => {
    switch (type) {
      case 'post_comment':
        return 'chat_bubble';
      case 'comment_reply':
        return 'forum';
      case 'post_like':
        return 'thumb_up';
      default:
        return 'notifications';
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
      const commentParam = item.commentId ? `?comment=${encodeURIComponent(item.commentId)}` : '';
      const targetPath = `/post/${encodeURIComponent(item.postId)}${commentParam}`;
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
    const targetPath = getPathForView(view);
    setCurrentView(view);
    setMobileMenuOpen(false);
    if (window.location.pathname !== targetPath) {
      window.history.pushState({}, '', targetPath);
    }
  }, []);

  useEffect(() => {
    if (currentView !== ViewType.HOME) {
      setNotificationsOpen(false);
      return;
    }
    fetchNotifications();
    const timer = setInterval(fetchNotifications, 30000);
    return () => {
      clearInterval(timer);
    };
  }, [currentView, fetchNotifications]);

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

  const renderView = () => {
    switch (currentView) {
      case ViewType.HOME:
        return <HomeView />;
      case ViewType.SUBMISSION:
        return <SubmissionView />;
      case ViewType.FEED:
        return <FeedView />;
      case ViewType.ADMIN:
        return (
          <React.Suspense
            fallback={(
              <div className="flex-grow w-full max-w-2xl mx-auto px-4 py-12 flex flex-col items-center text-center min-h-[70vh]">
                <span className="text-5xl mb-4 block">⏳</span>
                <h2 className="font-display text-3xl text-ink mb-2">后台加载中</h2>
                <p className="font-hand text-lg text-pencil">马上就好</p>
              </div>
            )}
          >
            <AdminGate />
          </React.Suspense>
        );
      case ViewType.NOT_FOUND:
        return (
          <div className="flex-grow w-full max-w-2xl mx-auto px-4 py-12 flex flex-col items-center text-center min-h-[70vh]">
            <span className="text-6xl mb-4 block">🧭</span>
            <h2 className="font-display text-3xl text-ink mb-2">页面不存在</h2>
            <p className="font-hand text-lg text-pencil mb-6">你访问的地址未找到</p>
            <button
              type="button"
              onClick={() => navigate(ViewType.HOME)}
              className="px-6 py-2 border-2 border-ink rounded-full font-hand font-bold text-lg bg-white hover:bg-highlight transition-all shadow-sketch"
            >
              返回首页
            </button>
          </div>
        );
      default:
        return <HomeView />;
    }
  };

  const NavItem: React.FC<{ view: ViewType; label: string; active?: boolean }> = ({ view, label, active }) => (
    <button
      onClick={() => navigate(view)}
      className={`relative hover:text-gray-600 transition-colors font-hand text-xl font-bold ${currentView === view || active
        ? 'after:absolute after:w-full after:h-0.5 after:bg-black after:bottom-0 after:left-0 after:scale-x-100'
        : 'after:absolute after:w-full after:h-0.5 after:bg-black after:bottom-0 after:left-0 after:scale-x-0 hover:after:scale-x-100 after:transition-transform'
        }`}
    >
      {label}
    </button>
  );

  const MobileNavItem: React.FC<{ label: string; onClick: () => void; dot?: boolean }> = ({ label, onClick, dot = false }) => (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center justify-between rounded-lg border-2 border-ink bg-white px-4 py-3 font-hand text-lg font-bold hover:bg-highlight transition-all"
    >
      <span>{label}</span>
      {dot && <span className="h-2.5 w-2.5 rounded-full bg-red-500 border border-ink" />}
    </button>
  );

  if (accessChecked && accessBlocked) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center bg-paper">
        <span className="text-6xl mb-4 block">⛔</span>
        <h2 className="font-display text-3xl text-ink mb-2">你已被限制浏览</h2>
        <p className="font-hand text-lg text-pencil mb-3">如有疑问请联系管理员</p>
        <p className="text-xs text-pencil">{formatAccessExpire(accessExpiresAt)}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col font-sans selection:bg-highlight selection:text-black">
      {/* Top Navigation */}
      {currentView !== ViewType.ADMIN && (
        <header className="sticky top-0 z-50 w-full border-b-2 border-black bg-[#f9f7f1] px-4 md:px-6 py-3 shadow-[0_4px_0_0_rgba(0,0,0,0.1)]">
          <div className="absolute top-full left-0 w-full h-2 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMTAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTAgMTAgTTEwIDAgTDIwIDEwIiBmaWxsPSJub25lIiBzdHJva2U9IiMwMDAiIHN0cm9rZS13aWR0aD0iMSIvPjwvc3ZnPg==')] opacity-10"></div>
          <div className="max-w-3xl mx-auto flex items-center justify-between gap-3 sm:gap-4 flex-wrap sm:flex-nowrap">
            {/* Logo */}
            <div
              className="flex items-center gap-3 cursor-pointer group"
              onClick={() => navigate(ViewType.HOME)}
            >
                <div className="size-10 sm:size-12 flex items-center justify-center rounded-full border-2 border-black bg-alert shadow-sketch group-hover:rotate-12 transition-transform duration-300">
                  <span className="text-black text-[22px] font-sans font-bold">瓜</span>
                </div>
              <h1 className="text-black text-2xl sm:text-3xl font-display font-bold tracking-widest relative leading-none sm:leading-tight">
                <span className="block sm:inline">JX3</span>
                <span className="block sm:inline">瓜田</span>
                <span className="absolute -bottom-1 left-0 w-full h-[6px] bg-marker-green/50 -rotate-1 rounded-full"></span>
              </h1>
            </div>

            <div className="flex items-center gap-2 sm:gap-6">
              {/* Desktop Nav */}
              <nav className="hidden sm:flex gap-6">
                <NavItem view={ViewType.HOME} label="最新" />
                <NavItem view={ViewType.FEED} label="热门" />
              </nav>

              {/* Action Button */}
              <button
                onClick={() => navigate(ViewType.SUBMISSION)}
                className="flex items-center justify-center rounded-full px-3 py-2 sm:px-5 sm:py-2.5 bg-black text-white hover:bg-ink/90 transition-all shadow-sketch active:shadow-sketch-active active:translate-x-[2px] active:translate-y-[2px] transform rotate-1 hover:-rotate-1"
              >
                <span className="flex items-center gap-2 font-sans text-base sm:text-lg font-semibold whitespace-nowrap">
                  <span className="material-symbols-outlined text-[20px] shrink-0">edit</span>
                  <span className="leading-none">投稿</span>
                </span>
              </button>

              {currentView === ViewType.HOME && (
                <div className="relative" ref={notificationRef}>
                  <button
                    onClick={() => setNotificationsOpen((prev) => !prev)}
                    className="flex items-center justify-center rounded-full px-2.5 py-2 sm:px-3 sm:py-2.5 border-2 border-ink bg-white hover:bg-highlight transition-all shadow-sketch active:shadow-sketch-active active:translate-x-[2px] active:translate-y-[2px]"
                    aria-label="提醒"
                    title="提醒"
                  >
                    <span className="relative flex items-center">
                      <span className="material-symbols-outlined text-[20px]">notifications</span>
                      {notificationsUnread > 0 && (
                        <span className="absolute -top-2 -right-2 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                          {notificationsUnread > 99 ? '99+' : notificationsUnread}
                        </span>
                      )}
                    </span>
                  </button>
                  {notificationsOpen && (
                    <div className="absolute right-0 mt-3 w-80 max-w-[80vw] bg-white border-2 border-ink rounded-lg shadow-sketch-sm p-4 z-50">
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
                                <span className="material-symbols-outlined text-[20px] text-pencil">
                                  {getNotificationIcon(item.type)}
                                </span>
                                <div className="flex-1">
                                  <div className="text-sm font-sans text-ink flex items-center gap-2">
                                    <span className="font-bold">{getNotificationLabel(item.type)}</span>
                                    {!item.readAt && <span className="h-2 w-2 rounded-full bg-red-500" />}
                                  </div>
                                  {item.preview && (
                                    <div className="text-xs text-pencil font-sans mt-1 line-clamp-2">
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
              )}

              <button
                onClick={openAnnouncement}
                className="hidden sm:flex items-center justify-center rounded-full px-2.5 py-2 sm:px-3 sm:py-2.5 border-2 border-ink bg-white hover:bg-highlight transition-all shadow-sketch active:shadow-sketch-active active:translate-x-[2px] active:translate-y-[2px]"
                aria-label="公告"
                title="公告"
              >
                <span className="relative flex items-center">
                  <span className="material-symbols-outlined text-[20px]">campaign</span>
                  {announcementUnread && (
                    <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-red-500" />
                  )}
                </span>
              </button>

              {/* Mobile Menu Toggle (Simplified) */}
              <button
                className="sm:hidden ml-2 relative"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                aria-label="打开菜单"
              >
                {mobileMenuOpen ? <X /> : <Menu />}
                {(announcementUnread || notificationsUnread > 0) && (
                  <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-red-500 border-2 border-ink" />
                )}
              </button>
            </div>
          </div>
          {/* Mobile Nav Dropdown */}
          {mobileMenuOpen && (
            <div className="sm:hidden absolute top-full left-0 w-full bg-paper border-b-2 border-ink shadow-xl p-4 flex flex-col gap-3 animate-in slide-in-from-top-2 z-50">
              <MobileNavItem
                label="最新吃瓜"
                onClick={() => {
                  navigate(ViewType.HOME);
                  setMobileMenuOpen(false);
                }}
              />
              <MobileNavItem
                label="热门榜单"
                onClick={() => {
                  navigate(ViewType.FEED);
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

      {/* Main Content Area */}
      <div className={`flex-grow flex flex-col ${currentView === ViewType.ADMIN ? 'h-screen' : ''}`}>
        {renderView()}
      </div>

      {/* Toast Notifications */}
      <Toast />

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

      {/* Footer only for non-admin */}
      {currentView !== ViewType.ADMIN && (
        <footer className="w-full border-t-2 border-black bg-paper/90 py-4 mt-auto">
          <div className="max-w-3xl mx-auto px-4">
            <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs font-sans text-pencil">


              <span>纯匿名</span>
              <span>·</span>
              <span>理性吃瓜</span>
              <span>·</span>
              <span>© 2026 JX3瓜田</span>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
};

export default App;
