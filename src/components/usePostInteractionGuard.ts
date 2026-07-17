import { useCallback, useSyncExternalStore } from 'react';

type InteractionResult<T> =
  | { executed: true; value: T }
  | { executed: false };

const pendingPostIds = new Set<string>();
const pendingListeners = new Set<() => void>();
let pendingPostIdsSnapshot: ReadonlySet<string> = new Set();

const publishPendingPostIds = () => {
  pendingPostIdsSnapshot = new Set(pendingPostIds);
  pendingListeners.forEach((listener) => listener());
};

const subscribePendingPostIds = (listener: () => void) => {
  pendingListeners.add(listener);
  return () => {
    pendingListeners.delete(listener);
  };
};

const getPendingPostIdsSnapshot = () => pendingPostIdsSnapshot;

/**
 * 全站按帖子串行处理互动，避免跨组件或路由切换时重复提交。
 */
export const usePostInteractionGuard = () => {
  return useCallback(async <T,>(
    postId: string,
    action: () => Promise<T>
  ): Promise<InteractionResult<T>> => {
    const normalizedPostId = String(postId || '').trim();
    if (!normalizedPostId || pendingPostIds.has(normalizedPostId)) {
      return { executed: false };
    }

    pendingPostIds.add(normalizedPostId);
    publishPendingPostIds();
    try {
      return { executed: true, value: await action() };
    } finally {
      pendingPostIds.delete(normalizedPostId);
      publishPendingPostIds();
    }
  }, []);
};

/**
 * 订阅全站正在处理互动的帖子，供需要展示 pending 状态的页面使用。
 */
export const usePendingPostInteractionIds = (): ReadonlySet<string> => (
  useSyncExternalStore(
    subscribePendingPostIds,
    getPendingPostIdsSnapshot,
    getPendingPostIdsSnapshot
  )
);
