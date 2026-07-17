import React, { createContext, useContext } from 'react';

export interface ToastMessage {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
}

export interface ToastUIContextValue {
  toasts: ToastMessage[];
  removeToast: (id: string) => void;
}

const ToastUIContext = createContext<ToastUIContextValue | undefined>(undefined);

interface ToastUIProviderProps {
  value: ToastUIContextValue;
  children: React.ReactNode;
}

/** Toast 展示域不包含 showToast，避免业务动作消费者随队列变化刷新。 */
export const ToastUIProvider = React.memo<ToastUIProviderProps>(({ value, children }) => (
  <ToastUIContext.Provider value={value}>{children}</ToastUIContext.Provider>
));

ToastUIProvider.displayName = 'ToastUIProvider';

export const useToastUI = (): ToastUIContextValue => {
  const context = useContext(ToastUIContext);
  if (!context) {
    throw new Error('useToastUI must be used within a ToastUIProvider');
  }
  return context;
};
