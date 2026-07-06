import React from 'react';
import { CheckCircle, Info, WarningCircle } from '@phosphor-icons/react';
import { Badge } from '@cloudflare/kumo';

import type { WikiFeedback } from './wikiTypes';

const feedbackMeta = {
  success: {
    eyebrow: '档案回执',
    title: '操作已经记录',
    icon: CheckCircle,
    badge: 'success' as const,
  },
  info: {
    eyebrow: '系统提示',
    title: '请留意当前状态',
    icon: Info,
    badge: 'info' as const,
  },
  error: {
    eyebrow: '需要处理',
    title: '这次操作没有完成',
    icon: WarningCircle,
    badge: 'error' as const,
  },
};

const WikiFloatingFeedback: React.FC<{ feedback: WikiFeedback | null }> = ({ feedback }) => {
  if (!feedback) {
    return null;
  }

  const meta = feedbackMeta[feedback.type];
  const Icon = meta.icon;
  const feedbackStyle = { '--wiki-feedback-duration': `${feedback.duration}ms` } as React.CSSProperties;

  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-[120] flex justify-center md:inset-x-auto md:right-6 md:top-6 md:bottom-auto">
      <div
        key={feedback.id}
        role={feedback.type === 'error' ? 'alert' : 'status'}
        aria-live={feedback.type === 'error' ? 'assertive' : 'polite'}
        aria-atomic="true"
        style={feedbackStyle}
        className="wiki-feedback-enter wiki-surface-soft relative w-full max-w-[24rem] overflow-hidden rounded-xl border border-kumo-line bg-kumo-base px-4 py-4 text-kumo-default shadow-xl md:w-[24rem]"
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-lg bg-kumo-tint text-kumo-brand">
            <Icon size={22} weight="duotone" />
          </div>
          <div className="min-w-0 flex-1">
            <Badge variant={meta.badge} appearance="dot">{meta.eyebrow}</Badge>
            <h3 className="mt-2 text-base font-semibold leading-none text-kumo-strong">
              {meta.title}
            </h3>
            <p className="mt-2 text-sm leading-6 text-kumo-subtle">
              {feedback.message}
            </p>
          </div>
        </div>
        <div className="mt-4 h-1 overflow-hidden rounded-full bg-kumo-fill">
          <div className="wiki-feedback-progress h-full rounded-full bg-kumo-brand" />
        </div>
      </div>
    </div>
  );
};

export default WikiFloatingFeedback;
