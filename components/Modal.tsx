import React, { useEffect, useCallback, useId, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { roughBorderClass } from './SketchUI';
import { useModalScrollLock } from './modalScrollLock';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  showCloseButton?: boolean;
  panelClassName?: string;
  overlayClassName?: string;
  titleClassName?: string;
  closeButtonClassName?: string;
  panelStyle?: React.CSSProperties;
}

const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  showCloseButton = true,
  panelClassName = '',
  overlayClassName = '',
  titleClassName = '',
  closeButtonClassName = '',
  panelStyle,
}) => {
  const generatedTitleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useModalScrollLock(isOpen);

  const handleDialogKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.defaultPrevented) return;

    const dialogs = Array.from(
      document.querySelectorAll<HTMLElement>('[role="dialog"]'),
    ).filter((dialog) => dialog.getClientRects().length > 0 && getComputedStyle(dialog).visibility !== 'hidden');
    if (dialogs[dialogs.length - 1] !== panelRef.current) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      onCloseRef.current();
      return;
    }

    if (e.key !== 'Tab' || !panelRef.current) return;

    const focusableElements = [
      ...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    ].filter((element) => element.getClientRects().length > 0);
    if (focusableElements.length === 0) {
      e.preventDefault();
      panelRef.current.focus({ preventScroll: true });
      return;
    }
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    if (document.activeElement === panelRef.current) {
      e.preventDefault();
      (e.shiftKey ? lastElement : firstElement).focus();
    } else if (e.shiftKey && document.activeElement === firstElement) {
      e.preventDefault();
      lastElement.focus();
    } else if (!e.shiftKey && document.activeElement === lastElement) {
      e.preventDefault();
      firstElement.focus();
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      previouslyFocusedRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      const frameId = window.requestAnimationFrame(() => {
        panelRef.current?.focus({ preventScroll: true });
      });
      document.addEventListener('keydown', handleDialogKeyDown);
      return () => {
        window.cancelAnimationFrame(frameId);
        document.removeEventListener('keydown', handleDialogKeyDown);
        const previousElement = previouslyFocusedRef.current;
        if (previousElement?.isConnected) {
          previousElement.focus({ preventScroll: true });
        }
        previouslyFocusedRef.current = null;
      };
    }
    return () => {
      document.removeEventListener('keydown', handleDialogKeyDown);
    };
  }, [isOpen, handleDialogKeyDown]);

  if (!isOpen || typeof document === 'undefined') return null;
  // Portal 会脱离后台根节点，显式继承后台字体，避免弹窗字体回退。
  const portalContextClassName = document.querySelector('.admin-font') ? 'admin-font' : '';

  return createPortal(
    <div
      className={`fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200 motion-reduce:animate-none ${portalContextClassName} ${overlayClassName}`}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? generatedTitleId : undefined}
        aria-label={title ? undefined : '对话框'}
        tabIndex={-1}
        className={`relative w-full max-w-md bg-white border-2 border-ink p-6 shadow-sketch-lg ${roughBorderClass} animate-in zoom-in-95 duration-200 motion-reduce:animate-none ${panelClassName}`}
        style={panelStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        {showCloseButton && (
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭弹窗"
            className={`absolute -top-3 -right-3 inline-flex h-11 w-11 items-center justify-center bg-white border-2 border-ink rounded-full shadow-sketch hover:bg-gray-100 hover:-translate-y-0.5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 ${closeButtonClassName}`}
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        )}

        {/* Title */}
        {title && (
          <h2 id={generatedTitleId} className={`font-display text-2xl text-ink mb-4 transform -rotate-1 ${titleClassName}`}>
            {title}
          </h2>
        )}

        {/* Content */}
        {children}
      </div>
    </div>,
    document.body,
  );
};

export default Modal;
