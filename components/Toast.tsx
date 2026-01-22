import React, { useEffect } from 'react';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { useApp } from '../store/AppContext';

const Toast: React.FC = () => {
  const { state, removeToast } = useApp();

  useEffect(() => {
    // Auto-remove toasts after 3 seconds
    state.toasts.forEach(toast => {
      const timer = setTimeout(() => {
        removeToast(toast.id);
      }, 3000);
      return () => clearTimeout(timer);
    });
  }, [state.toasts, removeToast]);

  if (state.toasts.length === 0) return null;

  const getIcon = (type: string) => {
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

  const getStyles = (type: string) => {
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

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
      {state.toasts.map(toast => (
        <div
          key={toast.id}
          className={`flex items-center gap-3 px-4 py-3 border-2 border-l-4 rounded-lg shadow-sketch animate-in slide-in-from-right-5 ${getStyles(toast.type)}`}
        >
          {getIcon(toast.type)}
          <span className="font-hand font-bold text-lg text-ink">{toast.message}</span>
          <button
            onClick={() => removeToast(toast.id)}
            className="ml-2 p-1 hover:bg-black/10 rounded-full transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
};

export default Toast;
