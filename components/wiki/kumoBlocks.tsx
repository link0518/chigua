import React from 'react';
import { cn } from '@cloudflare/kumo';

export const WikiPageHeader: React.FC<{
  eyebrow?: React.ReactNode;
  title: string;
  description?: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}> = ({ eyebrow, title, description, meta, actions, children }) => (
  <header className="wiki-surface-soft border-b border-kumo-line bg-kumo-base/95 backdrop-blur">
    <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          {eyebrow}
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-kumo-strong md:text-3xl">
            {title}
          </h1>
          {description && (
            <p className="mt-1.5 max-w-3xl text-sm leading-6 text-kumo-subtle">
              {description}
            </p>
          )}
          {meta && (
            <div className="mt-4 flex flex-wrap gap-2">
              {meta}
            </div>
          )}
        </div>
        {actions && (
          <div className="wiki-action-strip wiki-scrollbar-none flex shrink-0 gap-2 overflow-x-auto pb-1 pr-4 xl:flex-wrap xl:overflow-visible xl:pb-0 xl:pr-0 xl:[mask-image:none]">
            {actions}
          </div>
        )}
      </div>
      {children}
    </div>
  </header>
);

export const WikiResourceListPage: React.FC<{
  children: React.ReactNode;
  aside?: React.ReactNode;
  className?: string;
}> = ({ children, aside, className }) => (
  <div className={cn('min-h-full w-full bg-kumo-overlay', className)}>
    <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-5 px-4 py-5 pb-16 sm:px-6 lg:px-8 xl:flex-row xl:gap-6">
      <main className="min-w-0 flex-1">
        {children}
      </main>
      {aside && (
        <aside className="w-full shrink-0 xl:sticky xl:top-5 xl:w-[21rem] xl:self-start">
          {aside}
        </aside>
      )}
    </div>
  </div>
);
