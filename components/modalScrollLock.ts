import { useEffect } from 'react';

interface BodyStyleSnapshot {
  position: string;
  top: string;
  left: string;
  right: string;
  width: string;
  overflow: string;
  paddingRight: string;
}

interface ScrollSnapshot {
  x: number;
  y: number;
  bodyStyle: BodyStyleSnapshot;
}

const activeLocks = new Set<symbol>();
let scrollSnapshot: ScrollSnapshot | null = null;

const saveAndLockBody = () => {
  const { body, documentElement } = document;
  const scrollbarWidth = Math.max(0, window.innerWidth - documentElement.clientWidth);
  const computedPaddingRight = Number.parseFloat(window.getComputedStyle(body).paddingRight) || 0;
  const documentStyle = window.getComputedStyle(documentElement);
  const scrollbarSpaceAlreadyReserved = documentStyle.overflowY === 'scroll'
    || String(documentStyle.scrollbarGutter || '').includes('stable');

  scrollSnapshot = {
    x: window.scrollX,
    y: window.scrollY,
    bodyStyle: {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
      paddingRight: body.style.paddingRight,
    },
  };

  // position: fixed 可避免 iOS Safari 中遮罩下的页面继续滚动。
  body.style.position = 'fixed';
  body.style.top = `-${scrollSnapshot.y}px`;
  body.style.left = `-${scrollSnapshot.x}px`;
  body.style.right = '0';
  body.style.width = '100%';
  body.style.overflow = 'hidden';

  // 桌面端隐藏滚动条后补回宽度，避免页面左右跳动。
  if (scrollbarWidth > 0 && !scrollbarSpaceAlreadyReserved) {
    body.style.paddingRight = `${computedPaddingRight + scrollbarWidth}px`;
  }
};

const restoreBody = () => {
  if (!scrollSnapshot) return;

  const { body, documentElement } = document;
  const { x, y, bodyStyle } = scrollSnapshot;

  body.style.position = bodyStyle.position;
  body.style.top = bodyStyle.top;
  body.style.left = bodyStyle.left;
  body.style.right = bodyStyle.right;
  body.style.width = bodyStyle.width;
  body.style.overflow = bodyStyle.overflow;
  body.style.paddingRight = bodyStyle.paddingRight;
  scrollSnapshot = null;

  // 临时关闭平滑滚动，确保恢复到打开弹层前的准确位置。
  const previousScrollBehavior = documentElement.style.scrollBehavior;
  documentElement.style.scrollBehavior = 'auto';
  window.scrollTo(x, y);
  window.requestAnimationFrame(() => {
    // 弹层关闭会同时恢复页面控件，下一帧再校准一次可避免底部高度变化造成位置偏差。
    if (activeLocks.size === 0) {
      window.scrollTo(x, y);
    }
    documentElement.style.scrollBehavior = previousScrollBehavior;
  });
};

/**
 * 获取一份页面滚动锁。返回的释放函数可重复调用，适配 React StrictMode。
 */
export const acquireModalScrollLock = () => {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return () => undefined;
  }

  const lockToken = Symbol('modal-scroll-lock');
  let released = false;

  if (activeLocks.size === 0) {
    saveAndLockBody();
  }
  activeLocks.add(lockToken);

  return () => {
    if (released) return;
    released = true;

    activeLocks.delete(lockToken);
    if (activeLocks.size === 0) {
      restoreBody();
    }
  };
};

/** 在弹层打开期间持有滚动锁，支持多个弹层嵌套。 */
export const useModalScrollLock = (isLocked: boolean) => {
  useEffect(() => {
    if (!isLocked) return undefined;
    return acquireModalScrollLock();
  }, [isLocked]);
};
