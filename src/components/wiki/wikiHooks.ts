import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';

import {
  WIKI_MOBILE_FEED_QUERY,
  WIKI_PHOTO_VIEWER_SELECTOR,
} from './wikiConstants';
import type { WikiFeedback } from './wikiTypes';

export const useWikiMobileFeed = () => {
  const [enabled, setEnabled] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia(WIKI_MOBILE_FEED_QUERY).matches
  ));

  useEffect(() => {
    const media = window.matchMedia(WIKI_MOBILE_FEED_QUERY);
    const handleChange = () => setEnabled(media.matches);
    handleChange();

    if (media.addEventListener) {
      media.addEventListener('change', handleChange);
      return () => media.removeEventListener('change', handleChange);
    }

    media.addListener(handleChange);
    return () => media.removeListener(handleChange);
  }, []);

  return enabled;
};

export const useEscapeToClose = (enabled: boolean, onClose: () => void) => {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, onClose]);
};

const WIKI_MODAL_FOCUSABLE_SELECTOR = [
  'a[href]:not([tabindex="-1"])',
  'button:not([disabled]):not([tabindex="-1"])',
  'input:not([disabled]):not([type="hidden"]):not([tabindex="-1"])',
  'select:not([disabled]):not([tabindex="-1"])',
  'textarea:not([disabled]):not([tabindex="-1"])',
  '[contenteditable="true"]:not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const getWikiModalFocusableElements = (container: HTMLElement) => (
  Array.from(container.querySelectorAll<HTMLElement>(WIKI_MODAL_FOCUSABLE_SELECTOR))
    .filter((element) => (
      element.getAttribute('aria-hidden') !== 'true'
      && !element.hasAttribute('inert')
      && element.getClientRects().length > 0
    ))
);

/**
 * 为自定义 Wiki 弹窗提供基础模态焦点行为：初始聚焦、Tab 循环和关闭恢复。
 * 容器自身可通过 data-wiki-modal-initial-focus 与 tabIndex={-1} 接收初始焦点。
 */
export const useWikiModalFocus = (
  enabled: boolean,
  containerRef: RefObject<HTMLElement | null>
) => {
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    restoreFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    const initialFocus = container.matches('[data-wiki-modal-initial-focus="true"]')
      ? container
      : container.querySelector<HTMLElement>('[data-wiki-modal-initial-focus="true"]');
    const focusFrame = window.requestAnimationFrame(() => {
      const target = initialFocus || getWikiModalFocusableElements(container)[0] || container;
      try {
        target.focus({ preventScroll: true });
      } catch {
        target.focus();
      }
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') {
        return;
      }

      const photoViewer = document.querySelector<HTMLElement>(WIKI_PHOTO_VIEWER_SELECTOR);
      if (photoViewer) {
        const viewerFocusableElements = getWikiModalFocusableElements(photoViewer);
        if (viewerFocusableElements.length === 0) {
          event.preventDefault();
          photoViewer.focus();
          return;
        }

        const first = viewerFocusableElements[0];
        const last = viewerFocusableElements[viewerFocusableElements.length - 1];
        const activeElement = document.activeElement;
        const focusOutsideViewer = !(activeElement instanceof Node)
          || !photoViewer.contains(activeElement);

        if (event.shiftKey && (activeElement === first || focusOutsideViewer)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (activeElement === last || focusOutsideViewer)) {
          event.preventDefault();
          first.focus();
        }
        return;
      }

      const focusableElements = getWikiModalFocusableElements(container);
      if (focusableElements.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }

      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement;
      const focusOutside = !(activeElement instanceof Node) || !container.contains(activeElement);

      if (event.shiftKey && (activeElement === first || activeElement === container || focusOutside)) {
        event.preventDefault();
        last.focus();
        return;
      }

      if (!event.shiftKey && (activeElement === last || activeElement === container || focusOutside)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleKeyDown, true);
      const restoreTarget = restoreFocusRef.current;
      restoreFocusRef.current = null;
      if (restoreTarget?.isConnected) {
        try {
          restoreTarget.focus({ preventScroll: true });
        } catch {
          restoreTarget.focus();
        }
      }
    };
  }, [containerRef, enabled]);
};

export const useWikiFeedback = () => {
  const [feedback, setFeedback] = useState<WikiFeedback | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);
  const feedbackSeedRef = useRef(0);

  const showFeedback = useCallback((message: string, type: WikiFeedback['type'] = 'success') => {
    if (feedbackTimerRef.current) {
      window.clearTimeout(feedbackTimerRef.current);
    }
    const duration = type === 'error' ? 4200 : type === 'info' ? 3200 : 2600;
    feedbackSeedRef.current += 1;
    setFeedback({
      id: feedbackSeedRef.current,
      message,
      type,
      duration,
    });
    feedbackTimerRef.current = window.setTimeout(() => {
      setFeedback(null);
      feedbackTimerRef.current = null;
    }, duration);
  }, []);

  useEffect(() => () => {
    if (feedbackTimerRef.current) {
      window.clearTimeout(feedbackTimerRef.current);
    }
  }, []);

  return { feedback, showFeedback };
};
