import React from 'react';
import { FileText, MagnifyingGlass, ShieldCheck } from '@phosphor-icons/react';
import { cn } from '@cloudflare/kumo';

type WikiLoadingVariant = 'page' | 'detail';

interface WikiLoadingStep {
  label: string;
  state: 'ok' | 'run' | 'wait';
}

interface WikiLoadingScreenProps {
  variant?: WikiLoadingVariant;
  title?: string;
  description?: string;
  className?: string;
}

const WIKI_LOADING_STEPS: WikiLoadingStep[] = [
  { label: '读取公开瓜条', state: 'ok' },
  { label: '生成标签索引', state: 'run' },
  { label: '准备详情页面', state: 'wait' },
];

const STATE_LABELS: Record<WikiLoadingStep['state'], string> = {
  ok: 'OK',
  run: 'RUN',
  wait: '...',
};

const STATE_ICONS: Record<WikiLoadingStep['state'], React.ReactNode> = {
  ok: <ShieldCheck size={15} weight="fill" />,
  run: <MagnifyingGlass size={15} weight="bold" />,
  wait: <span aria-hidden="true">···</span>,
};

const WikiLoadingScreen: React.FC<WikiLoadingScreenProps> = ({
  variant = 'page',
  title = '正在整理档案索引',
  description = '同步条目、标签和时间线',
  className,
}) => {
  const isPage = variant === 'page';

  return (
    <div
      data-theme="kumo"
      aria-busy="true"
      role="status"
      aria-live="polite"
      className={cn(
        'wiki-page flex w-full items-center justify-center bg-kumo-overlay px-4 text-kumo-default',
        isPage ? 'min-h-screen py-10' : 'h-full min-h-[24rem] py-8',
        className,
      )}
    >
      <div className={cn(
        'wiki-loading-stage pattern-grid-lg flex w-full items-center justify-center',
        isPage ? 'max-w-3xl' : 'max-w-xl',
      )}
      >
        <section className="wiki-loading-panel wiki-surface-soft relative w-full overflow-hidden rounded-2xl border border-kumo-line bg-kumo-base/95 p-5 text-center shadow-2xl sm:p-7">
          <div className="wiki-loading-scan" aria-hidden="true" />
          <div className="relative z-10">
            <div className="mb-5 flex items-center justify-between gap-3 text-left">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-kumo-contrast text-kumo-inverse shadow-sm">
                  <FileText size={20} weight="bold" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold uppercase text-kumo-subtle">JX3 Wiki</div>
                  <div className="truncate text-sm font-semibold text-kumo-strong">Archive Sync</div>
                </div>
              </div>
              <div className="hidden rounded-full border border-kumo-line bg-kumo-tint px-3 py-1 text-xs font-semibold text-kumo-subtle sm:block">
                档案库
              </div>
            </div>

            <div className="mx-auto flex max-w-sm flex-col items-center">
              <div className="wiki-loading-seal flex size-20 items-center justify-center rounded-full border border-kumo-line bg-kumo-tint text-kumo-strong shadow-sm">
                <MagnifyingGlass size={34} weight="bold" />
              </div>
              <h2 className="mt-5 text-xl font-semibold text-kumo-strong sm:text-2xl">
                {title}
              </h2>
              <p className="mt-2 text-sm leading-6 text-kumo-subtle">
                {description}
              </p>
              <div className="wiki-loading-meter mt-5 h-1.5 w-full overflow-hidden rounded-full bg-kumo-tint" aria-hidden="true">
                <span />
              </div>
            </div>

            <div className="wiki-loading-log mx-auto mt-6 grid max-w-md gap-2 text-left" aria-hidden="true">
              {WIKI_LOADING_STEPS.map((step, index) => (
                <div
                  key={step.label}
                  className="wiki-loading-log-row flex items-center justify-between gap-4 rounded-xl border border-kumo-line bg-kumo-base/80 px-3 py-2 text-xs text-kumo-subtle"
                  style={{ '--wiki-loading-index': index } as React.CSSProperties}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className={cn(
                      'wiki-loading-state flex size-6 shrink-0 items-center justify-center rounded-full',
                      step.state === 'ok' && 'bg-kumo-tint text-kumo-success',
                      step.state === 'run' && 'bg-kumo-tint text-kumo-strong',
                      step.state === 'wait' && 'bg-kumo-overlay text-kumo-subtle',
                    )}
                    >
                      {STATE_ICONS[step.state]}
                    </span>
                    <span className="truncate">{step.label}</span>
                  </span>
                  <strong className="shrink-0 font-semibold text-kumo-strong">
                    {STATE_LABELS[step.state]}
                  </strong>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
      <span className="sr-only">{title}，{description}</span>
    </div>
  );
};

export default WikiLoadingScreen;
