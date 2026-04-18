import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

import MarkdownEditor, {
  type MarkdownEditorCommand,
  type MarkdownEditorHandle,
  type MarkdownEditorThemeOptions,
} from './MarkdownEditor';
import MarkdownRenderer from './MarkdownRenderer';
import { roughBorderClassSm } from './SketchUI';

type WikiMarkdownComposerTheme = 'wiki' | 'admin';

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
  theme?: WikiMarkdownComposerTheme;
}

const MARKDOWN_TOOLS: Array<{
  key: MarkdownEditorCommand;
  label: string;
  title: string;
}> = [
  { key: 'heading', label: '标题', title: '插入二级标题' },
  { key: 'bold', label: '加粗', title: '插入粗体' },
  { key: 'italic', label: '斜体', title: '插入斜体' },
  { key: 'quote', label: '引用', title: '插入引用块' },
  { key: 'bulletList', label: '无序', title: '插入无序列表' },
  { key: 'orderedList', label: '有序', title: '插入有序列表' },
  { key: 'link', label: '链接', title: '插入链接' },
  { key: 'code', label: '代码', title: '插入行内代码' },
];

const THEME_OPTIONS: Record<WikiMarkdownComposerTheme, {
  frameClassName: string;
  headerClassName: string;
  headerTitleClassName: string;
  headerHintClassName: string;
  previewToggleClassName: string;
  toolButtonClassName: string;
  editorShellClassName: string;
  previewShellClassName: string;
  counterClassName: string;
  helperClassName: string;
  editorThemeOptions: MarkdownEditorThemeOptions;
}> = {
  wiki: {
    frameClassName: 'rounded-xl border border-outline-variant/25 bg-surface-container-low/40 p-3 md:p-4',
    headerClassName: 'flex items-center justify-between gap-3 rounded-lg bg-white/80 px-3 py-2.5',
    headerTitleClassName: 'font-label text-[10px] font-bold tracking-[0.22em] text-[#2f3334]/65',
    headerHintClassName: 'font-body text-xs text-[#2f3334]/45',
    previewToggleClassName: 'inline-flex items-center gap-2 rounded-full border border-black/5 bg-white px-3 py-1.5 font-label text-[10px] font-bold tracking-widest text-[#2f3334]/75 transition-all hover:border-[#546354]/35 hover:text-[#546354]',
    toolButtonClassName: 'inline-flex min-h-[36px] items-center justify-center rounded-full border border-black/5 bg-white px-3 py-1.5 font-label text-[10px] font-bold tracking-widest text-[#2f3334]/72 transition-all hover:-translate-y-0.5 hover:border-[#546354]/35 hover:text-[#546354] disabled:cursor-not-allowed disabled:opacity-40',
    editorShellClassName: 'overflow-hidden rounded-lg border border-outline-variant/20 bg-white/90 transition-colors focus-within:border-primary/50',
    previewShellClassName: 'overflow-auto rounded-lg border border-outline-variant/20 bg-white/90 p-4',
    counterClassName: 'font-label text-[10px] font-bold tracking-widest text-[#2f3334]/45',
    helperClassName: 'font-body text-xs text-[#2f3334]/45',
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
    toolButtonClassName: `inline-flex min-h-[38px] items-center justify-center border-2 border-ink bg-white px-3 py-1.5 text-xs font-bold text-ink shadow-sketch transition-all hover:-translate-y-0.5 hover:bg-highlight disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-100 disabled:text-pencil/60 disabled:shadow-none ${roughBorderClassSm}`,
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
    if (showPreview) {
      return;
    }
    editorRef.current?.runCommand(command);
  }, [showPreview]);

  const handleEditorContainerMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (showPreview || event.button !== 0) {
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
  }, [showPreview]);

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
          <p className={themeConfig.headerHintClassName}>支持标题、强调、引用、列表、链接与代码。</p>
        </div>
        <button
          type="button"
          onClick={() => setShowPreview((prev) => !prev)}
          className={themeConfig.previewToggleClassName}
        >
          {showPreview ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          <span>{showPreview ? '编辑' : '预览'}</span>
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {MARKDOWN_TOOLS.map((tool) => (
          <button
            key={tool.key}
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => handleRunCommand(tool.key)}
            disabled={showPreview}
            aria-label={tool.title}
            title={tool.title}
            className={themeConfig.toolButtonClassName}
          >
            {tool.label}
          </button>
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
              themeOptions={themeConfig.editorThemeOptions}
            />
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <span className={themeConfig.helperClassName}>最终会保存为 Markdown 原文，展示时按安全白名单渲染。</span>
        <span className={counterClassName}>
          {value.length} / {maxLength}
        </span>
      </div>
    </div>
  );
};

export default WikiMarkdownComposer;
