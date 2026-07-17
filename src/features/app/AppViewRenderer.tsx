import React from 'react';
import { ViewType } from '@/types';
import HomeView from '@/components/HomeView';

const SubmissionView = React.lazy(() => import('@/components/SubmissionView'));

const importFeedView = () => import('@/components/FeedView');
let feedViewPromise: ReturnType<typeof importFeedView> | null = null;

const loadFeedView = () => {
  if (!feedViewPromise) {
    feedViewPromise = importFeedView().catch((error) => {
      // 预取失败时允许首次渲染重新请求；渲染期失败由视图错误边界提供恢复入口。
      feedViewPromise = null;
      throw error;
    });
  }
  return feedViewPromise;
};

export const prefetchFeedView = () => {
  // 这里只加载组件代码；榜单数据由 App 的热门导航意图或 FeedView 挂载流程预取。
  void loadFeedView().catch(() => undefined);
};

const FeedView = React.lazy(loadFeedView);
const FeaturedView = React.lazy(() => import('@/components/FeaturedView'));
const SearchView = React.lazy(() => import('@/components/SearchView'));
const AdminGate = React.lazy(() => import('@/components/AdminGate'));
const FavoritesView = React.lazy(() => import('@/components/FavoritesView'));
const WikiView = React.lazy(() => import('@/components/wiki/WikiView'));

interface AppViewRendererProps {
  currentView: ViewType;
  onNavigateHome: () => void;
}

const AppViewRenderer: React.FC<AppViewRendererProps> = React.memo(({
  currentView,
  onNavigateHome,
}) => {
  switch (currentView) {
    case ViewType.HOME:
      return <HomeView />;
    case ViewType.SUBMISSION:
      return <SubmissionView />;
    case ViewType.FEED:
      return <FeedView />;
    case ViewType.FEATURED:
      return <FeaturedView />;
    case ViewType.SEARCH:
      return <SearchView />;
    case ViewType.FAVORITES:
      return <FavoritesView />;
    case ViewType.WIKI:
      return <WikiView />;
    case ViewType.ADMIN:
      return (
        <React.Suspense
          fallback={(
            <div
              className="mx-auto flex min-h-70vh-safe w-full max-w-2xl flex-grow items-center justify-center px-4 py-12"
              role="status"
              aria-label="后台加载中"
            >
              <span
                className="h-10 w-10 animate-spin rounded-full border-4 border-ink/20 border-t-ink motion-reduce:animate-none"
                aria-hidden="true"
              />
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
});

AppViewRenderer.displayName = 'AppViewRenderer';

export default AppViewRenderer;
