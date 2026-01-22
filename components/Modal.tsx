import React, { useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import { roughBorderClass } from './SketchUI';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  showCloseButton?: boolean;
}

const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  showCloseButton = true,
}) => {
  const handleEscape = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleEscape]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className={`relative w-full max-w-md bg-white border-2 border-ink p-6 shadow-sketch-lg ${roughBorderClass} animate-in zoom-in-95 duration-200`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        {showCloseButton && (
          <button
            onClick={onClose}
            className="absolute -top-3 -right-3 p-2 bg-white border-2 border-ink rounded-full shadow-sketch hover:bg-gray-100 hover:-translate-y-0.5 transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        )}

        {/* Title */}
        {title && (
          <h2 className="font-display text-2xl text-ink mb-4 transform -rotate-1">
            {title}
          </h2>
        )}

        {/* Content */}
        {children}
      </div>
    </div>
  );
};

export default Modal;
