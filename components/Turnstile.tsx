import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

export interface TurnstileHandle {
  execute: () => Promise<string>;
  reset: () => void;
  isReady: () => boolean;
}

interface TurnstileProps {
  action: string;
  enabled?: boolean;
}

const TURNSTILE_SCRIPT_ID = 'turnstile-script';
let turnstileScriptPromise: Promise<void> | null = null;

const loadTurnstileScript = () => {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Turnstile 仅支持浏览器环境'));
  }
  if (window.turnstile) {
    return Promise.resolve();
  }
  if (turnstileScriptPromise) {
    return turnstileScriptPromise;
  }

  const existing = document.getElementById(TURNSTILE_SCRIPT_ID);
  if (existing) {
    turnstileScriptPromise = new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Turnstile 脚本加载失败')));
    });
    return turnstileScriptPromise;
  }

  turnstileScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.id = TURNSTILE_SCRIPT_ID;
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Turnstile 脚本加载失败'));
    document.head.appendChild(script);
  });

  return turnstileScriptPromise;
};

const Turnstile = forwardRef<TurnstileHandle, TurnstileProps>(({ action, enabled = true }, ref) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const pendingRef = useRef<{ resolve: (token: string) => void; reject: (error: Error) => void } | null>(null);
  const [ready, setReady] = useState(false);
  const siteKey = (import.meta.env.VITE_TURNSTILE_SITE_KEY || '').trim();

  const cleanupWidget = useCallback(() => {
    if (widgetIdRef.current && window.turnstile) {
      window.turnstile.remove(widgetIdRef.current);
      widgetIdRef.current = null;
    }
  }, []);

  const rejectPending = useCallback((message: string) => {
    if (pendingRef.current) {
      pendingRef.current.reject(new Error(message));
      pendingRef.current = null;
    }
  }, []);

  const renderWidget = useCallback(async () => {
    if (!enabled) {
      cleanupWidget();
      setReady(false);
      return;
    }
    if (!siteKey) {
      setReady(false);
      return;
    }

    try {
      await loadTurnstileScript();
      if (!containerRef.current || !window.turnstile) {
        return;
      }

      cleanupWidget();
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        action,
        size: 'invisible',
        callback: (token) => {
          if (pendingRef.current) {
            pendingRef.current.resolve(token);
            pendingRef.current = null;
          }
          if (widgetIdRef.current && window.turnstile) {
            window.turnstile.reset(widgetIdRef.current);
          }
        },
        'error-callback': () => {
          rejectPending('安全验证失败，请重试');
        },
        'expired-callback': () => {
          rejectPending('安全验证已过期，请重试');
        },
      });
      setReady(true);
    } catch (error) {
      console.error('Turnstile 脚本加载失败', error);
      rejectPending('安全验证加载失败，请稍后再试');
      setReady(false);
    }
  }, [action, cleanupWidget, enabled, rejectPending, siteKey]);

  useEffect(() => {
    renderWidget();
    return () => {
      cleanupWidget();
    };
  }, [cleanupWidget, renderWidget]);

  const execute = useCallback(() => {
    if (!enabled) {
      return Promise.reject(new Error('安全验证不可用'));
    }
    if (!siteKey) {
      return Promise.reject(new Error('安全验证未配置'));
    }
    if (!window.turnstile || !widgetIdRef.current || !ready) {
      return Promise.reject(new Error('安全验证加载中，请稍后再试'));
    }

    return new Promise((resolve, reject) => {
      pendingRef.current = { resolve, reject };
      window.turnstile.reset(widgetIdRef.current);
      window.turnstile.execute(widgetIdRef.current);
    });
  }, [enabled, ready, siteKey]);

  const reset = useCallback(() => {
    if (window.turnstile && widgetIdRef.current) {
      window.turnstile.reset(widgetIdRef.current);
    }
  }, []);

  useImperativeHandle(ref, () => ({
    execute,
    reset,
    isReady: () => ready,
  }), [execute, ready, reset]);

  return <div ref={containerRef} className="sr-only" aria-hidden="true" />;
});

Turnstile.displayName = 'Turnstile';

export default Turnstile;
