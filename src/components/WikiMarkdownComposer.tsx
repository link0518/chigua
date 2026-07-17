import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bold,
  Code2,
  Eye,
  EyeOff,
  Heading2,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
} from 'lucide-react';

import type {
  MarkdownEditorCommand,
  MarkdownEditorHandle,
  MarkdownEditorThemeOptions,
} from './MarkdownEditor';
import MarkdownRenderer from './MarkdownRenderer';
import { roughBorderClassSm } from './SketchUI';

type WikiMarkdownComposerTheme = 'wiki' | 'admin';

const MarkdownEditor = React.lazy(() => import('./MarkdownEditor'));

interface WikiMarkdownComposerProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  maxLength: number;
  minHeight?: string;
  autoFocus?: boolean;
  ariaLabel?: string;
  toolbarLabel?: string;
  emptyPreviewText?: string;
  renderClassName?: string;
  readOnly?: boolean;
  theme?: WikiMarkdownComposerTheme;
}

const MARKDOWN_TOOLS: Array<{
  key: MarkdownEditorCommand;
  label: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { key: 'heading', label: '标题', title: '插入二级标题', icon: Heading2 },
  { key: 'bold', label: '加粗', title: '插入粗体', icon: Bold },
  { key: 'italic', label: '斜体', title: '插入斜体', icon: Italic },
  { key: 'quote', label: '引用', title: '插入引用块', icon: Quote },
  { key: 'bulletList', label: '无序', title: '插入无序列表', icon: List },
  { key: 'orderedList', label: '有序', title: '插入有序列表', icon: ListOrdered },
  { key: 'link', label: '链接', title: '插入链接', icon: Link2 },
  { key: 'code', label: '代码', title: '插入行内代码', icon: Code2 },
];

const MARKDOWN_TOOL_GROUPS: MarkdownEditorCommand[][] = [
  ['heading'],
  ['bold', 'italic', 'quote'],
  ['bulletList', 'orderedList'],
  ['link', 'code'],
];

const THEME_OPTIONS: Record<WikiMarkdownComposerTheme, {
  frameClassName: string;
  headerClassName: string;
  headerTitleClassName: string;
  headerHintClassName: string;
  previewToggleClassName: string;
  toolGroupClassName: string;
  toolButtonClassName: string;
  editorShellClassName: string;
  previewShellClassName: string;
  counterClassName: string;
  helperClassName: string;
  editorThemeOptions: MarkdownEditorThemeOptions;
}> = {
  wiki: {
    frameClassName: 'wiki-surface-soft rounded-xl border border-kumo-line bg-kumo-base p-3 shadow-sm md:p-4',
    headerClassName: 'flex items-center justify-between gap-3 rounded-lg bg-kumo-tint px-3 py-2.5',
    headerTitleClassName: 'text-xs font-semibold text-kumo-strong',
    headerHintClassName: 'text-xs text-kumo-subtle',
    previewToggleClassName: 'wiki-motion-button wiki-focus-ring inline-flex items-center gap-2 rounded-lg border border-kumo-line bg-kumo-base px-3 py-1.5 text-xs font-semibold text-kumo-default hover:border-kumo-brand/35 hover:text-kumo-link aria-pressed:border-kumo-brand/50 aria-pressed:bg-kumo-tint aria-pressed:text-kumo-link',
    toolGroupClassName: 'flex shrink-0 gap-1.5 rounded-lg border border-kumo-line bg-kumo-tint/70 p-1',
    toolButtonClassName: 'wiki-motion-button wiki-focus-ring inline-flex size-9 items-center justify-center rounded-md border border-kumo-line bg-kumo-base text-kumo-default hover:border-kumo-brand/35 hover:text-kumo-link disabled:cursor-not-allowed disabled:opacity-40',
    editorShellClassName: 'overflow-hidden rounded-lg border border-kumo-line bg-kumo-elevated shadow-inner transition-colors focus-within:border-kumo-brand/50',
    previewShellClassName: 'overflow-auto rounded-lg border border-kumo-line bg-kumo-elevated p-4',
    counterClassName: 'text-xs font-semibold text-kumo-subtle',
    helperClassName: 'text-xs text-kumo-subtle',
    editorThemeOptions: {
      fontFamily: '"Noto Serif SC", "Noto Sans SC", sans-serif',
      fontSize: '1rem',
      lineHeight: '1.9rem',
      padding: '18px',
      textColor: '#2f3334',
      cursorColor: '#2f3334',
      placeholderColor: 'rgba(47, 51, 52, 0.32)',
      selectionColor: 'rgba(84, 99, 84, 0.14)',
      focusedSelectionColor: 'rgba(84, 99, 84, 0.2)',
    },
  },
  admin: {
    frameClassName: 'rounded-lg border-2 border-dashed border-gray-200 bg-white/70 p-3',
    headerClassName: 'flex items-center justify-between gap-3 rounded-lg bg-white/90 px-3 py-2',
    headerTitleClassName: 'font-hand text-base font-bold text-ink',
    headerHintClassName: 'font-sans text-xs text-pencil',
    previewToggleClassName: `inline-flex items-center gap-2 border-2 border-ink bg-white px-3 py-1.5 text-xs font-bold text-ink shadow-sketch transition-all hover:-translate-y-0.5 hover:bg-highlight ${roughBorderClassSm}`,
    toolGroupClassName: `flex shrink-0 gap-1.5 border-2 border-dashed border-gray-200 bg-white/70 p-1 ${roughBorderClassSm}`,
    toolButtonClassName: `inline-flex size-9 items-center justify-center border-2 border-ink bg-white text-ink shadow-sketch transition-all hover:-translate-y-0.5 hover:bg-highlight disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-100 disabled:text-pencil/60 disabled:shadow-none ${roughBorderClassSm}`,
    editorShellClassName: 'overflow-hidden rounded-lg border-2 border-gray-200 bg-white transition-colors focus-within:border-ink',
    previewShellClassName: 'overflow-auto rounded-lg border-2 border-gray-200 bg-gray-50 p-4',
    counterClassName: 'font-sans text-xs text-pencil',
    helperClassName: 'font-sans text-xs text-pencil',
    editorThemeOptions: {
      fontFamily: '"Noto Sans SC", sans-serif',
      fontSize: '0.95rem',
      lineHeight: '1.65rem',
      padding: '14px',
      textColor: '#222222',
      cursorColor: '#222222',
      placeholderColor: 'rgba(68, 68, 68, 0.45)',
      selectionColor: 'rgba(250, 204, 21, 0.2)',
      focusedSelectionColor: 'rgba(250, 204, 21, 0.28)',
    },
  },
};

const WikiMarkdownComposer: React.FC<WikiMarkdownComposerProps> = ({
  value,
  onChange,
  placeholder,
  maxLength,
  minHeight = '280px',
  autoFocus = false,
  ariaLabel = 'Wiki Markdown 编辑器',
  toolbarLabel = '支持 Markdown',
  emptyPreviewText = '预览区为空，请先输入内容。',
  renderClassName = 'font-sans text-sm text-ink',
  readOnly = false,
  theme = 'wiki',
}) => {
  const [showPreview, setShowPreview] = useState(false);
  const editorRef = useRef<MarkdownEditorHandle | null>(null);
  const didMountRef = useRef(false);
  const previousShowPreviewRef = useRef(showPreview);
  const latestValueRef = useRef(value);
  const themeConfig = THEME_OPTIONS[theme];
  const editorViewportStyle = useMemo(() => ({ minHeight, height: minHeight }), [minHeight]);

  latestValueRef.current = value;

  const handleValueChange = useCallback((nextValue: string) => {
    latestValueRef.current = nextValue;
    onChange(nextValue);
  }, [onChange]);

  const handleRunCommand = useCallback((command: MarkdownEditorCommand) => {
    if (readOnly || showPreview) {
      return;
    }
    editorRef.current?.runCommand(command);
  }, [readOnly, showPreview]);

  const handleEditorContainerMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (readOnly || showPreview || event.button !== 0) {
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    if (!target) {
      return;
    }
    if (target.closest('.cm-editor')) {
      return;
    }
    if (target.closest('button, input, textarea, select, a, [role="button"]')) {
      return;
    }
    event.preventDefault();
    editorRef.current?.focus();
  }, [readOnly, showPreview]);

  useEffect(() => {
    if (!showPreview || value.trim()) {
      return;
    }
    setShowPreview(false);
  }, [showPreview, value]);

  useEffect(() => {
    const previousShowPreview = previousShowPreviewRef.current;
    previousShowPreviewRef.current = showPreview;

    const shouldFocus = (!didMountRef.current && autoFocus) || (didMountRef.current && previousShowPreview && !showPreview);
    didMountRef.current = true;
    if (!shouldFocus) {
      return;
    }
    requestAnimationFrame(() => {
      editorRef.current?.focus();
    });
  }, [autoFocus, showPreview]);

  const counterClassName = value.length > maxLength
    ? `${themeConfig.counterClassName} text-red-500`
    : value.length > maxLength * 0.9
      ? `${themeConfig.counterClassName} text-yellow-600`
      : themeConfig.counterClassName;

  return (
    <div className={themeConfig.frameClassName}>
      <div className={themeConfig.headerClassName}>
        <div className="min-w-0">
          <p className={themeConfig.headerTitleClassName}>{toolbarLabel}</p>
          <p className={themeConfig.headerHintClassName}>Markdown 记录区</p>
        </div>
        <button
          type="button"
          onClick={() => setShowPreview((prev) => !prev)}
          aria-pressed={showPreview}
          className={themeConfig.previewToggleClassName}
        >
          {showPreview ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          <span>{showPreview ? '编辑' : '预览'}</span>
        </button>
      </div>

      <div className="wiki-editor-toolbar wiki-scrollbar-none mt-3 flex gap-2 overflow-x-auto pb-1 pr-4 md:flex-wrap md:overflow-visible md:pb-0 md:pr-0 md:[mask-image:none]">
        {MARKDOWN_TOOL_GROUPS.map((group, groupIndex) => (
          <div key={groupIndex} className={themeConfig.toolGroupClassName}>
            {group.map((toolKey) => {
              const tool = MARKDOWN_TOOLS.find((item) => item.key === toolKey);
              if (!tool) {
                return null;
              }
              const Icon = tool.icon;
              return (
                <button
                  key={tool.key}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => handleRunCommand(tool.key)}
                  disabled={readOnly || showPreview}
                  aria-label={tool.title}
                  title={tool.title}
                  className={themeConfig.toolButtonClassName}
                >
                  <Icon className="h-4 w-4" />
                  <span className="sr-only">{tool.label}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="relative mt-3" style={editorViewportStyle}>
        {showPreview ? (
          <div className={themeConfig.previewShellClassName} style={editorViewportStyle}>
            {value.trim() ? (
              <MarkdownRenderer content={value} className={renderClassName} />
            ) : (
              <p className={themeConfig.helperClassName}>{emptyPreviewText}</p>
            )}
          </div>
        ) : (
          <React.Suspense
            fallback={(
              <div className={`${themeConfig.editorShellClassName} flex items-center justify-center`} style={editorViewportStyle}>
                <span className={themeConfig.helperClassName}>编辑器载入中...</span>
              </div>
            )}
          >
            <div
              className={themeConfig.editorShellClassName}
              style={editorViewportStyle}
              onMouseDown={handleEditorContainerMouseDown}
            >
              <MarkdownEditor
                ref={editorRef}
                value={value}
                onChange={handleValueChange}
                placeholder={placeholder}
                minHeight={minHeight}
                autoFocus={autoFocus}
                ariaLabel={ariaLabel}
                readOnly={readOnly}
                themeOptions={themeConfig.editorThemeOptions}
              />
            </div>
          </React.Suspense>
        )}
      </div>

      <div className="mt-3 flex justify-end">
        <span className={counterClassName}>
          {value.length} / {maxLength}
        </span>
      </div>
    </div>
  );
};

export default WikiMarkdownComposer;
