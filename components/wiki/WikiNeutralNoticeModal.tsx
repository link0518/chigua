import React from 'react';
import { Badge, Button, LayerCard } from '@cloudflare/kumo';
import {
  ArrowRight,
  Checks,
  Eye,
  ListChecks,
  Scales,
  X,
} from '@phosphor-icons/react';

import { useEscapeToClose } from './wikiHooks';

interface WikiNeutralNoticeModalProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

const rules = [
  {
    icon: Checks,
    title: '写可核对的信息',
    description: '优先写时间、人物、版本和公开线索。',
  },
  {
    icon: Eye,
    title: '保持中性',
    description: '不攻击，不吹捧，也不揣测。',
  },
  {
    icon: ListChecks,
    title: '按线索整理',
    description: '按来龙去脉组织内容，方便后续查阅。',
  },
];

const WikiNeutralNoticeModal: React.FC<WikiNeutralNoticeModalProps> = ({ open, onCancel, onConfirm }) => {
  useEscapeToClose(open, onCancel);

  if (!open) {
    return null;
  }

  return (
    <div data-wiki-overlay-modal="true" className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-6">
      <button
        type="button"
        aria-label="关闭提示"
        className="wiki-modal-backdrop-enter fixed inset-0 bg-kumo-scrim/45 backdrop-blur-sm"
        onClick={onCancel}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="wiki-neutral-notice-title"
        aria-describedby="wiki-neutral-notice-description"
        className="wiki-modal-panel-enter relative z-10 flex max-h-[min(88vh,44rem)] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-kumo-line bg-kumo-base shadow-2xl sm:rounded-2xl"
      >
        <header className="flex items-start gap-4 border-b border-kumo-line px-6 py-6 sm:px-8">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-kumo-tint text-kumo-brand">
            <Scales size={24} weight="duotone" />
          </div>
          <div className="min-w-0 flex-1">
            <Badge variant="secondary">编审提醒</Badge>
            <h2 id="wiki-neutral-notice-title" className="mt-3 text-2xl font-semibold tracking-tight text-kumo-strong">
              新建前请确认
            </h2>
            <p id="wiki-neutral-notice-description" className="mt-2 text-sm leading-6 text-kumo-subtle">
              请按客观、中性的方式整理信息。
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            shape="square"
            className="wiki-motion-button"
            aria-label="关闭提示"
            onClick={onCancel}
            icon={<X size={18} />}
          />
        </header>

        <main className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-6 sm:px-8">
          {rules.map((rule, index) => {
            const Icon = rule.icon;
            return (
              <LayerCard key={rule.title} className="wiki-surface-soft p-4 shadow-sm">
                <div className="flex items-start gap-4">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-kumo-tint text-sm font-semibold text-kumo-brand">
                    {String(index + 1).padStart(2, '0')}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Icon size={18} className="text-kumo-brand" />
                      <h3 className="text-sm font-semibold text-kumo-strong">{rule.title}</h3>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-kumo-subtle">
                      {rule.description}
                    </p>
                  </div>
                </div>
              </LayerCard>
            );
          })}
        </main>

        <footer className="flex flex-col-reverse gap-3 border-t border-kumo-line px-6 py-5 sm:flex-row sm:items-center sm:justify-end sm:px-8">
          <Button type="button" variant="secondary" size="lg" className="wiki-motion-button min-h-11 sm:min-w-24" onClick={onCancel}>
            返回
          </Button>
          <Button type="button" variant="primary" size="lg" className="wiki-motion-button wiki-solid-action min-h-11 sm:min-w-28" onClick={onConfirm} icon={<ArrowRight size={16} />}>
            继续新建
          </Button>
        </footer>
      </div>
    </div>
  );
};

export default WikiNeutralNoticeModal;
