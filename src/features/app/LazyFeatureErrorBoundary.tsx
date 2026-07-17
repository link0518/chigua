import React from 'react';

interface LazyFeatureErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  featureName: string;
}

interface LazyFeatureErrorBoundaryState {
  hasError: boolean;
}

/**
 * 非关键异步功能加载失败时只降级当前功能，避免装饰组件拖垮整个页面。
 */
class LazyFeatureErrorBoundary extends React.Component<
  LazyFeatureErrorBoundaryProps,
  LazyFeatureErrorBoundaryState
> {
  declare readonly props: Readonly<LazyFeatureErrorBoundaryProps>;

  state: LazyFeatureErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): LazyFeatureErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`${this.props.featureName}加载失败`, {
      error,
      componentStack: info.componentStack,
    });
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? null;
    }
    return this.props.children;
  }
}

export default LazyFeatureErrorBoundary;
