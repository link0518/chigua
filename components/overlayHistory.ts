let navigationInFlight = false;
let resetTimer: number | null = null;
let pendingPopHandler: (() => void) | null = null;

const resetNavigationLock = () => {
  if (resetTimer !== null) {
    window.clearTimeout(resetTimer);
    resetTimer = null;
  }
  if (pendingPopHandler) {
    window.removeEventListener('popstate', pendingPopHandler);
    pendingPopHandler = null;
  }
  navigationInFlight = false;
};

/**
 * 串行执行弹层历史回退，防止关闭按钮、遮罩和返回键在 popstate 到达前重复退栈。
 */
export const requestOverlayHistoryNavigation = (delta = -1) => {
  if (typeof window === 'undefined' || navigationInFlight || delta === 0) {
    return false;
  }

  navigationInFlight = true;
  pendingPopHandler = resetNavigationLock;
  window.addEventListener('popstate', pendingPopHandler, { once: true });
  window.history.go(delta);

  // 极端情况下没有可回退记录，避免锁永久残留。
  resetTimer = window.setTimeout(resetNavigationLock, 800);
  return true;
};

export const requestOverlayHistoryBack = () => requestOverlayHistoryNavigation(-1);
