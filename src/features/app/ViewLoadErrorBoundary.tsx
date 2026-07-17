import React from 'react';

interface ViewLoadErrorBoundaryProps {
  children: React.ReactNode;
  onNavigateHome: () => void;
}

interface ViewLoadErrorBoundaryState {
  hasError: boolean;
}

/**
 * 捕获懒加载视图在部署切换或网络异常时抛出的加载错误。
 * 边界由外层按 currentView 设置 key，切换页面后会自动重建。
 */
class ViewLoadErrorBoundary extends React.Component<
  ViewLoadErrorBoundaryProps,
  ViewLoadErrorBoundaryState
> {
  declare readonly props: Readonly<ViewLoadErrorBoundaryProps>;

  state: ViewLoadErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ViewLoadErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('视图组件加载失败', {
      error,
      componentStack: info.componentStack,
    });
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="flex-grow w-full max-w-2xl mx-auto px-4 py-16 flex flex-col items-center text-center min-h-70vh-safe">
        <span className="text-6xl mb-4 block" aria-hidden="true">🧩</span>
        <h2 className="font-display text-3xl text-ink mb-2">页面组件加载失败</h2>
        <p className="font-hand text-lg text-pencil mb-6">
          可能刚刚完成版本更新，刷新页面即可加载最新资源。
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-6 py-2 border-2 border-ink rounded-full font-hand font-bold text-lg bg-highlight hover:bg-alert transition-all shadow-sketch"
          >
            刷新页面
          </button>
          <button
            type="button"
            onClick={this.props.onNavigateHome}
            className="px-6 py-2 border-2 border-ink rounded-full font-hand font-bold text-lg bg-white hover:bg-highlight transition-all shadow-sketch"
          >
            返回首页
          </button>
        </div>
      </div>
    );
  }
}

export default ViewLoadErrorBoundary;
