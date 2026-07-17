import React, { useEffect, useId, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useModalScrollLock } from './modalScrollLock';

export interface MobileBottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: React.ReactNode;
  id?: string;
  footer?: React.ReactNode;
  className?: string;
  overlayClassName?: string;
  headerClassName?: string;
  contentClassName?: string;
  footerClassName?: string;
  panelStyle?: React.CSSProperties;
  ariaLabel?: string;
  closeButtonAriaLabel?: string;
  closeOnOverlayClick?: boolean;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  fallbackFocusRef?: React.RefObject<HTMLElement | null>;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const canRestoreFocus = (element: HTMLElement | null | undefined) => {
  if (!element?.isConnected || element.closest('[inert]')) {
    return false;
  }
  if ('disabled' in element && Boolean((element as HTMLButtonElement).disabled)) {
    return false;
  }
  const style = getComputedStyle(element);
  return element.getClientRects().length > 0
    && style.display !== 'none'
    && style.visibility !== 'hidden';
};

const MobileBottomSheet: React.FC<MobileBottomSheetProps> = ({
  isOpen,
  onClose,
  children,
  title,
  id,
  footer,
  className = '',
  overlayClassName = '',
  headerClassName = '',
  contentClassName = '',
  footerClassName = '',
  panelStyle,
  ariaLabel = '内容面板',
  closeButtonAriaLabel = '关闭面板',
  closeOnOverlayClick = true,
  returnFocusRef,
  fallbackFocusRef,
}) => {
  const generatedId = useId();
  const panelId = id ?? `${generatedId}-mobile-bottom-sheet`;
  const titleId = `${panelId}-title`;
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const returnFocusRefRef = useRef(returnFocusRef);
  const fallbackFocusRefRef = useRef(fallbackFocusRef);
  const hasTitle = title !== undefined && title !== null;

  useLayoutEffect(() => {
    onCloseRef.current = onClose;
    returnFocusRefRef.current = returnFocusRef;
    fallbackFocusRefRef.current = fallbackFocusRef;
  }, [fallbackFocusRef, onClose, returnFocusRef]);

  useModalScrollLock(isOpen);

  useEffect(() => {
    if (!isOpen) return undefined;

    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    const focusFrame = window.requestAnimationFrame(() => {
      panelRef.current?.focus({ preventScroll: true });
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      const panel = panelRef.current;
      if (!panel) return;

      // 仅让 DOM 中最上层的对话框响应快捷键，避免嵌套弹层同时关闭。
      const dialogs = Array.from(
        document.querySelectorAll<HTMLElement>('[role="dialog"]'),
      ).filter((dialog) => dialog.getClientRects().length > 0 && getComputedStyle(dialog).visibility !== 'hidden');
      if (dialogs[dialogs.length - 1] !== panel) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab') return;

      const focusableElements = [
        ...panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ].filter((element) => element.getClientRects().length > 0);

      if (focusableElements.length === 0) {
        event.preventDefault();
        panel.focus({ preventScroll: true });
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (document.activeElement === panel) {
        event.preventDefault();
        (event.shiftKey ? lastElement : firstElement).focus();
      } else if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleKeyDown);

      const explicitElement = returnFocusRefRef.current?.current;
      const previousElement = previouslyFocusedRef.current;
      const fallbackElement = fallbackFocusRefRef.current?.current;
      const focusTarget = [explicitElement, previousElement, fallbackElement].find(canRestoreFocus);
      focusTarget?.focus({ preventScroll: true });
      previouslyFocusedRef.current = null;
    };
  }, [isOpen]);

  if (!isOpen || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-[70] flex items-end bg-black/50 backdrop-blur-sm animate-in fade-in duration-200 motion-reduce:animate-none ${overlayClassName}`}
      style={{ height: '100dvh' }}
      onClick={(event) => {
        if (closeOnOverlayClick && event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={panelRef}
        id={panelId}
        role="dialog"
        aria-modal="true"
        aria-labelledby={hasTitle ? titleId : undefined}
        aria-label={hasTitle ? undefined : ariaLabel}
        tabIndex={-1}
        className={`flex w-full min-h-0 flex-col overflow-hidden rounded-t-3xl border-2 border-b-0 border-ink bg-white shadow-2xl outline-none animate-in slide-in-from-bottom-4 duration-200 motion-reduce:animate-none ${className}`}
        style={{
          height: '92dvh',
          maxHeight: 'calc(100dvh - max(12px, env(safe-area-inset-top, 0px)))',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          ...panelStyle,
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 justify-center pt-2" aria-hidden="true">
          <span className="h-1 w-10 rounded-full bg-gray-300" />
        </div>

        <header className={`flex min-h-12 shrink-0 items-center gap-3 border-b border-gray-200 px-4 ${headerClassName}`}>
          {hasTitle ? (
            <h2 id={titleId} className="min-w-0 flex-1 truncate font-display text-lg text-ink">
              {title}
            </h2>
          ) : (
            <span className="flex-1" />
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label={closeButtonAriaLabel}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink transition-colors hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        <div className={`min-h-0 flex-1 overflow-y-auto overscroll-contain ${contentClassName}`}>
          {children}
        </div>

        {footer !== undefined && footer !== null && (
          <footer className={`shrink-0 border-t border-gray-200 bg-white ${footerClassName}`}>
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
};

export default MobileBottomSheet;
