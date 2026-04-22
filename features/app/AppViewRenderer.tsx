import React from 'react';
import { ViewType } from '@/types';
import HomeView from '@/components/HomeView';

const SubmissionView = React.lazy(() => import('@/components/SubmissionView'));
const FeedView = React.lazy(() => import('@/components/FeedView'));
const SearchView = React.lazy(() => import('@/components/SearchView'));
const AdminGate = React.lazy(() => import('@/components/AdminGate'));
const FavoritesView = React.lazy(() => import('@/components/FavoritesView'));
const ChatRoomView = React.lazy(() => import('@/components/ChatRoomView'));
const WikiView = React.lazy(() => import('@/components/wiki/WikiView'));

interface AppViewRendererProps {
  currentView: ViewType;
  chatEnabled: boolean;
  onNavigateHome: () => void;
}

const AppViewRenderer: React.FC<AppViewRendererProps> = ({
  currentView,
  chatEnabled,
  onNavigateHome,
}) => {
  switch (currentView) {
    case ViewType.HOME:
      return <HomeView />;
    case ViewType.SUBMISSION:
      return <SubmissionView />;
    case ViewType.FEED:
      return <FeedView />;
    case ViewType.SEARCH:
      return <SearchView />;
    case ViewType.FAVORITES:
      return <FavoritesView />;
    case ViewType.CHAT:
      if (!chatEnabled) {
        return <HomeView />;
      }
      return <ChatRoomView onExitToFeed={onNavigateHome} />;
    case ViewType.WIKI:
      return <WikiView />;
    case ViewType.ADMIN:
      return (
        <React.Suspense
          fallback={(
            <div className="flex-grow w-full max-w-2xl mx-auto px-4 py-12 flex flex-col text-center min-h-70vh-safe">
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
        <div className="flex-grow w-full max-w-2xl mx-auto px-4 py-12 flex flex-col items-center text-center min-h-70vh-safe">
          <span className="text-6xl mb-4 block">🧭</span>
          <h2 className="font-display text-3xl text-ink mb-2">页面不存在</h2>
          <p className="font-hand text-lg text-pencil mb-6">你访问的地址未找到</p>
          <button
            type="button"
            onClick={onNavigateHome}
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

export default AppViewRenderer;
