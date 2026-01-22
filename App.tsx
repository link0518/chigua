import React, { useCallback, useEffect, useState } from 'react';
import { ViewType } from './types';
import SubmissionView from './components/SubmissionView';
import FeedView from './components/FeedView';
import AdminGate from './components/AdminGate';
import HomeView from './components/HomeView';
import Toast from './components/Toast';
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

  const navigate = useCallback((view: ViewType) => {
    const targetPath = getPathForView(view);
    setCurrentView(view);
    setMobileMenuOpen(false);
    if (window.location.pathname !== targetPath) {
      window.history.pushState({}, '', targetPath);
    }
  }, []);

  const renderView = () => {
    switch (currentView) {
      case ViewType.HOME:
        return <HomeView />;
      case ViewType.SUBMISSION:
        return <SubmissionView />;
      case ViewType.FEED:
        return <FeedView />;
      case ViewType.ADMIN:
        return <AdminGate />;
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

  return (
    <div className="min-h-screen flex flex-col font-sans selection:bg-highlight selection:text-black">
      {/* Top Navigation */}
      {currentView !== ViewType.ADMIN && (
        <header className="sticky top-0 z-50 w-full border-b-2 border-black bg-[#f9f7f1] px-4 md:px-6 py-3 shadow-[0_4px_0_0_rgba(0,0,0,0.1)]">
          <div className="absolute top-full left-0 w-full h-2 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMTAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTAgMTAgTTEwIDAgTDIwIDEwIiBmaWxsPSJub25lIiBzdHJva2U9IiMwMDAiIHN0cm9rZS13aWR0aD0iMSIvPjwvc3ZnPg==')] opacity-10"></div>
          <div className="max-w-3xl mx-auto flex items-center justify-between gap-4">
            {/* Logo */}
            <div
              className="flex items-center gap-3 cursor-pointer group"
              onClick={() => navigate(ViewType.HOME)}
            >
                <div className="size-12 flex items-center justify-center rounded-full border-2 border-black bg-alert shadow-sketch group-hover:rotate-12 transition-transform duration-300">
                  <span className="text-black text-[22px] font-sans font-bold">瓜</span>
                </div>
              <h1 className="text-black text-3xl font-display font-bold tracking-widest relative">
                JX3瓜田
                <span className="absolute -bottom-1 left-0 w-full h-[6px] bg-marker-green/50 -rotate-1 rounded-full"></span>
              </h1>
            </div>

            <div className="flex items-center gap-6">
              {/* Desktop Nav */}
              <nav className="hidden sm:flex gap-6">
                <NavItem view={ViewType.HOME} label="最新" />
                <NavItem view={ViewType.FEED} label="热门" />
              </nav>

              {/* Action Button */}
              <button
                onClick={() => navigate(ViewType.SUBMISSION)}
                className="flex items-center justify-center rounded-full px-5 py-2.5 bg-black text-white hover:bg-ink/90 transition-all shadow-sketch active:shadow-sketch-active active:translate-x-[2px] active:translate-y-[2px] transform rotate-1 hover:-rotate-1"
              >
                <span className="flex items-center gap-2 font-hand text-lg font-bold">
                  <span className="material-symbols-outlined text-[20px]">edit</span>
                  <span className="hidden md:inline">投稿</span>
                  <span className="md:hidden">投稿</span>
                </span>
              </button>

              {/* Mobile Menu Toggle (Simplified) */}
              <button
                className="sm:hidden ml-2"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              >
                {mobileMenuOpen ? <X /> : <Menu />}
              </button>
            </div>
          </div>
          {/* Mobile Nav Dropdown */}
          {mobileMenuOpen && (
            <div className={`sm:hidden absolute top-full left-0 w-full bg-paper border-b-2 border-ink shadow-xl p-4 flex flex-col gap-4 animate-in slide-in-from-top-2 z-50`}>
              <NavItem view={ViewType.HOME} label="最新吃瓜" />
              <NavItem view={ViewType.FEED} label="热门榜单" />
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
