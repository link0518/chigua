import { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'recruitment:browser-identity-notice:v1';

const hasAcknowledged = () => {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

const persistAcknowledgement = () => {
  try {
    window.localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // 隐私模式可能禁止写入 storage，此时仍在当前页面记住确认状态。
  }
};

/** 发布或首次发起密聊前复用的匿名身份提示。 */
export const useRecruitmentIdentityNotice = () => {
  const [open, setOpen] = useState(false);
  const resolverRef = useRef<((confirmed: boolean) => void) | null>(null);
  const sessionAcknowledgedRef = useRef(false);

  useEffect(() => () => {
    resolverRef.current?.(false);
    resolverRef.current = null;
  }, []);

  const requestAcknowledgement = useCallback((): Promise<boolean> => {
    if (sessionAcknowledgedRef.current || hasAcknowledged()) {
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setOpen(true);
    });
  }, []);

  const resolve = useCallback((confirmed: boolean) => {
    if (confirmed) {
      sessionAcknowledgedRef.current = true;
      persistAcknowledgement();
    }
    setOpen(false);
    const resolver = resolverRef.current;
    resolverRef.current = null;
    resolver?.(confirmed);
  }, []);

  const cancel = useCallback(() => resolve(false), [resolve]);
  const confirm = useCallback(() => resolve(true), [resolve]);

  return {
    open,
    requestAcknowledgement,
    confirm,
    cancel,
  };
};
