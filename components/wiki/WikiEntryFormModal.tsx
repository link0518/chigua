import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Banner, Button, Input, LayerCard, Textarea } from '@cloudflare/kumo';
import {
  Info,
  PaperPlaneTilt,
  Tag,
  X,
} from '@phosphor-icons/react';

import { api } from '../../api';
import WikiMarkdownComposer from '../WikiMarkdownComposer';
import Turnstile, { TurnstileHandle } from '../Turnstile';
import WikiFloatingFeedback from './WikiFeedback';
import { WIKI_NARRATIVE_MAX_LENGTH } from './wikiConstants';
import { useEscapeToClose, useWikiFeedback } from './wikiHooks';
import type { WikiEntry, WikiFormMode } from './wikiTypes';
import { parseTagInput } from './wikiUtils';

interface WikiEntryFormModalProps {
  mode: WikiFormMode;
  open: boolean;
  entry?: WikiEntry | null;
  turnstileEnabled: boolean;
  onClose: () => void;
  onSubmitted: (message: string) => void;
}

const WikiEntryFormModal: React.FC<WikiEntryFormModalProps> = ({
  mode,
  open,
  entry,
  turnstileEnabled,
  onClose,
  onSubmitted,
}) => {
  const [name, setName] = useState('');
  const [narrative, setNarrative] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [editSummary, setEditSummary] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const turnstileRef = useRef<TurnstileHandle | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const { feedback, showFeedback } = useWikiFeedback();

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const handleClose = useCallback(() => {
    clearCloseTimer();
    onClose();
  }, [clearCloseTimer, onClose]);

  useEscapeToClose(open, handleClose);

  useEffect(() => {
    clearCloseTimer();
    if (!open) {
      return;
    }
    setName(entry?.name || '');
    setNarrative(entry?.narrative || '');
    setTagInput((entry?.tags || []).join('，'));
    setEditSummary('');
    setMessage('');
    setSubmitting(false);
  }, [clearCloseTimer, entry, open]);

  useEffect(() => () => {
    clearCloseTimer();
  }, [clearCloseTimer]);

  if (!open) {
    return null;
  }

  const parsedTags = parseTagInput(tagInput);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const tags = parseTagInput(tagInput);
    const trimmedName = name.trim();
    const trimmedNarrative = narrative.trim();
    const trimmedEditSummary = editSummary.trim();

    if (!trimmedName || !trimmedNarrative) {
      setMessage('请填写名字和记录叙述。');
      return;
    }
    if (trimmedNarrative.length > WIKI_NARRATIVE_MAX_LENGTH) {
      setMessage(`记录叙述不能超过 ${WIKI_NARRATIVE_MAX_LENGTH} 个字符。`);
      return;
    }
    if (mode === 'edit' && !trimmedEditSummary) {
      setMessage('');
      showFeedback('请填写修改原因', 'error');
      return;
    }

    setSubmitting(true);
    setMessage('');
    try {
      const turnstileToken = turnstileEnabled
        ? await turnstileRef.current?.execute()
        : '';
      const payload = {
        name: trimmedName,
        narrative: trimmedNarrative,
        tags,
        editSummary: mode === 'edit' ? trimmedEditSummary : '',
        turnstileToken: turnstileToken || '',
      };

      if (mode === 'edit' && entry) {
        await api.createWikiEdit(entry.slug, payload);
      } else {
        await api.createWikiSubmission(payload);
      }

      const successMessage = mode === 'edit'
        ? '修改已提交，等待审核'
        : '瓜条已提交，等待审核';
      setMessage(successMessage);
      onSubmitted(successMessage);
      clearCloseTimer();
      closeTimerRef.current = window.setTimeout(() => {
        closeTimerRef.current = null;
        onClose();
      }, 900);
    } catch (submitError) {
      setMessage(submitError instanceof Error ? submitError.message : '提交失败，请稍后再试。');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div data-wiki-overlay-modal="true" className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-6">
      <WikiFloatingFeedback feedback={feedback} />
      <button
        type="button"
        aria-label="关闭弹窗"
        className="wiki-modal-backdrop-enter fixed inset-0 bg-kumo-scrim/45 backdrop-blur-sm"
        onClick={handleClose}
      />
      <form
        onSubmit={handleSubmit}
        className="wiki-modal-panel-enter wiki-form-modal-panel relative z-10 flex w-full max-w-5xl flex-col overflow-hidden rounded-t-2xl border border-kumo-line bg-kumo-base shadow-2xl sm:rounded-2xl"
      >
        <header className="wiki-surface-soft flex shrink-0 items-start justify-between gap-4 border-b border-kumo-line bg-kumo-base px-5 py-5 md:px-8 md:py-6">
          <div className="flex min-w-0 items-start gap-4">
            <div className="hidden size-12 shrink-0 items-center justify-center rounded-xl bg-kumo-tint text-kumo-brand sm:flex">
              <PaperPlaneTilt size={24} weight="duotone" />
            </div>
            <div className="min-w-0">
              <Badge variant={mode === 'edit' ? 'info' : 'beta'}>
                {mode === 'edit' ? '编辑提案' : '新建瓜条'}
              </Badge>
              <h1 className="mt-3 text-2xl font-semibold tracking-tight text-kumo-strong">
                {mode === 'edit' ? '编辑瓜条' : '提交瓜条'}
              </h1>
              <p className="mt-1 text-sm text-kumo-subtle">提交后进入后台审核，只公开审核通过的版本。</p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            shape="square"
            className="wiki-motion-button"
            aria-label="关闭弹窗"
            onClick={handleClose}
            icon={<X size={18} />}
          />
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-kumo-overlay p-5 md:p-8">
          <div className="grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
            <aside className="hidden lg:block">
              <LayerCard className="wiki-surface-soft sticky top-0 overflow-hidden p-0 shadow-sm">
                {['基本信息', '正文叙述', mode === 'edit' ? '修改说明' : '审核提醒'].map((step, index) => (
                  <div key={step} className="wiki-form-step flex items-center gap-3 border-b border-kumo-line px-4 py-3 last:border-b-0">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-kumo-tint text-xs font-semibold tabular-nums text-kumo-brand">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span className="text-sm font-semibold text-kumo-strong">{step}</span>
                  </div>
                ))}
              </LayerCard>
            </aside>

            <div className="min-w-0 space-y-5">
              <LayerCard className="wiki-surface-soft p-4 shadow-sm md:p-5">
                <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_18rem]">
                  <Input
                    label="名字"
                    value={name}
                    onChange={(event) => setName(event.currentTarget.value)}
                    placeholder="输入姓名或词条名"
                    className="w-full"
                    required
                  />

                  <Input
                    label="标签"
                    value={tagInput}
                    onChange={(event) => setTagInput(event.currentTarget.value)}
                    placeholder="逗号、顿号、分号分隔"
                    className="w-full"
                  />
                </div>

                {parsedTags.length > 0 && (
                  <div className="wiki-surface-soft mt-4 rounded-lg border border-kumo-line bg-kumo-tint px-3 py-3">
                    <div className="flex items-center gap-2 text-xs font-semibold text-kumo-subtle">
                      <Tag size={14} />
                      已解析标签
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {parsedTags.map((tag) => (
                        <React.Fragment key={tag}>
                          <Badge variant="secondary">#{tag}</Badge>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                )}
              </LayerCard>

              <div>
                <div className="mb-2 text-sm font-semibold text-kumo-strong">记录叙述</div>
                <WikiMarkdownComposer
                  value={narrative}
                  onChange={setNarrative}
                  placeholder="客观中立地描述该词条..."
                  maxLength={WIKI_NARRATIVE_MAX_LENGTH}
                  minHeight="300px"
                  ariaLabel={mode === 'edit' ? '编辑瓜条 Markdown 编辑器' : '新增瓜条 Markdown 编辑器'}
                  toolbarLabel="记录叙述"
                  emptyPreviewText="预览区为空，请先填写记录叙述。"
                  renderClassName="wiki-markdown-body text-[15px] leading-8 text-kumo-default [&_blockquote]:my-5 [&_ol]:my-5 [&_p]:mb-5 [&_pre]:my-5 [&_ul]:my-5"
                  theme="wiki"
                />
              </div>

              {mode === 'edit' && (
                <LayerCard className="wiki-surface-soft p-4 shadow-sm md:p-5">
                  <Textarea
                    label="修改原因"
                    value={editSummary}
                    onChange={(event) => setEditSummary(event.currentTarget.value)}
                    placeholder="请说明本次修改的依据、补充内容或修正原因..."
                    rows={3}
                    className="min-h-[7rem] w-full"
                  />
                </LayerCard>
              )}

              <Banner
                variant="secondary"
                icon={<Info size={20} weight="duotone" />}
                title="审核提醒"
                description="所有提交与编辑都会进入审核。公开页面只展示审核通过的版本。"
              />

              {message && (
                <p role="status" className="wiki-surface-soft rounded-lg border border-kumo-line bg-kumo-base px-4 py-3 text-sm text-kumo-default shadow-sm">
                  {message}
                </p>
              )}
            </div>
          </div>
        </main>

        <footer className="wiki-modal-footer flex shrink-0 flex-col-reverse gap-3 border-t border-kumo-line bg-kumo-base/95 px-5 py-5 shadow-[0_-12px_32px_rgba(0,0,0,0.06)] backdrop-blur sm:flex-row sm:items-center sm:justify-end md:px-8">
          <Button type="button" variant="secondary" size="lg" className="wiki-motion-button min-h-11 w-full sm:w-auto sm:min-w-24" onClick={handleClose}>
            取消
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="wiki-motion-button wiki-solid-action min-h-11 w-full sm:w-auto sm:min-w-32"
            loading={submitting}
            disabled={submitting}
            icon={<PaperPlaneTilt size={16} />}
          >
            {submitting ? '提交中...' : mode === 'edit' ? '提交编辑' : '提交瓜条'}
          </Button>
        </footer>
        <Turnstile ref={turnstileRef} action="wiki" enabled={turnstileEnabled} />
      </form>
    </div>
  );
};

export default WikiEntryFormModal;
