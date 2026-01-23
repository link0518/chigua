/// <reference types="vite/client" />

interface TurnstileOptions {
  sitekey: string;
  action?: string;
  size?: 'normal' | 'compact' | 'invisible';
  callback?: (token: string) => void;
  'error-callback'?: () => void;
  'expired-callback'?: () => void;
}

interface TurnstileInstance {
  render: (container: HTMLElement, options: TurnstileOptions) => string;
  execute: (widgetId: string) => void;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

interface Window {
  turnstile?: TurnstileInstance;
}

interface ImportMetaEnv {
  readonly VITE_APP_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
