import React, { useEffect } from 'react';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { useToastUI } from '../store/ToastUIContext';
import type { ToastMessage } from '../store/ToastUIContext';

const getIcon = (type: ToastMessage['type']) => {
  switch (type) {
    case 'success':
      return <CheckCircle className="w-5 h-5 text-green-600" />;
    case 'error':
      return <AlertCircle className="w-5 h-5 text-red-600" />;
    case 'warning':
      return <AlertTriangle className="w-5 h-5 text-yellow-600" />;
    default:
      return <Info className="w-5 h-5 text-blue-600" />;
  }
};

const getStyles = (type: ToastMessage['type']) => {
  switch (type) {
    case 'success':
      return 'bg-green-50 border-green-500';
    case 'error':
      return 'bg-red-50 border-red-500';
    case 'warning':
      return 'bg-yellow-50 border-yellow-500';
    default:
      return 'bg-blue-50 border-blue-500';
  }
};

interface ToastItemProps {
  toast: ToastMessage;
  onRemove: (id: string) => void;
}

const ToastItem: React.FC<ToastItemProps> = React.memo(({ toast, onRemove }) => {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      onRemove(toast.id);
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [onRemove, toast.id]);

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 border-2 border-l-4 rounded-lg shadow-sketch animate-in slide-in-from-right-5 ${getStyles(toast.type)}`}
    >
      {getIcon(toast.type)}
      <span className="font-hand font-bold text-lg text-ink">{toast.message}</span>
      <button
        type="button"
        onClick={() => onRemove(toast.id)}
        className="ml-2 p-1 hover:bg-black/10 rounded-full transition-colors"
        aria-label="关闭提示"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
});

ToastItem.displayName = 'ToastItem';

const Toast: React.FC = () => {
  const { toasts, removeToast } = useToastUI();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
      {toasts.map(toast => (
        <ToastItem
          key={toast.id}
          toast={toast}
          onRemove={removeToast}
        />
      ))}
    </div>
  );
};

export default Toast;
