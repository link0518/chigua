import { useEffect, useState } from 'react';

const MOBILE_QUERY = '(max-width: 767px)';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

const getMediaQueryMatch = (query: string) => (
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query).matches
    : false
);

/**
 * 将纯装饰动画推迟到首帧之后，并集中处理移动端、减弱动态效果和页面可见性。
 * 页面隐藏时调用方会卸载动画组件，避免后台标签页继续占用 CPU/GPU。
 */
export const useDeferredVisualEffects = () => {
  const [ready, setReady] = useState(false);
  const [isMobile, setIsMobile] = useState(() => getMediaQueryMatch(MOBILE_QUERY));
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(
    () => getMediaQueryMatch(REDUCED_MOTION_QUERY)
  );
  const [pageVisible, setPageVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState === 'visible'
  );

  useEffect(() => {
    const mobileQuery = window.matchMedia(MOBILE_QUERY);
    const reducedMotionQuery = window.matchMedia(REDUCED_MOTION_QUERY);
    const syncPreferences = () => {
      setIsMobile(mobileQuery.matches);
      setPrefersReducedMotion(reducedMotionQuery.matches);
    };

    syncPreferences();
    mobileQuery.addEventListener('change', syncPreferences);
    reducedMotionQuery.addEventListener('change', syncPreferences);
    return () => {
      mobileQuery.removeEventListener('change', syncPreferences);
      reducedMotionQuery.removeEventListener('change', syncPreferences);
    };
  }, []);

  useEffect(() => {
    const syncVisibility = () => {
      setPageVisible(document.visibilityState === 'visible');
    };

    syncVisibility();
    document.addEventListener('visibilitychange', syncVisibility);
    return () => {
      document.removeEventListener('visibilitychange', syncVisibility);
    };
  }, []);

  useEffect(() => {
    let animationFrameId: number | null = null;
    let idleCallbackId: number | null = null;
    let fallbackTimer: number | null = null;

    const markReady = () => setReady(true);
    const scheduleAfterFirstPaint = () => {
      if (typeof window.requestIdleCallback === 'function') {
        idleCallbackId = window.requestIdleCallback(markReady, { timeout: 1800 });
        return;
      }
      // Safari 等不支持 requestIdleCallback 的浏览器留出首屏渲染窗口。
      fallbackTimer = window.setTimeout(markReady, 800);
    };

    animationFrameId = window.requestAnimationFrame(scheduleAfterFirstPaint);
    return () => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }
      if (idleCallbackId !== null) {
        window.cancelIdleCallback(idleCallbackId);
      }
      if (fallbackTimer !== null) {
        window.clearTimeout(fallbackTimer);
      }
    };
  }, []);

  return {
    ready,
    isMobile,
    pageVisible,
    prefersReducedMotion,
    effectsEnabled: ready && pageVisible && !prefersReducedMotion,
  };
};
