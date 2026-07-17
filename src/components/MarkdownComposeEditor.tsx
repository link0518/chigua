import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Eye, EyeOff, Image, Smile } from 'lucide-react';

import MarkdownEditor, {
  type MarkdownEditorCommand,
  type MarkdownEditorHandle,
} from './MarkdownEditor';
import MarkdownRenderer from './MarkdownRenderer';
import MemePicker from './MemePicker';
import { DEFAULT_MEME_PACK } from './memeManifest';
import { SketchIconButton } from './SketchIconButton';
import { roughBorderClassSm } from './SketchUI';
import { isImageUploadFile, uploadImageAsMarkdown } from './imageUpload';
import { requestOverlayHistoryBack } from './overlayHistory';
import useMediaQuery from './useMediaQuery';

type MarkdownComposeHistoryState = Record<string, unknown> & {
  markdownMemeOverlayId?: string;
};

const readMarkdownComposeHistoryState = (): MarkdownComposeHistoryState => (
  window.history.state && typeof window.history.state === 'object'
    ? window.history.state as MarkdownComposeHistoryState
    : {}
);

const MARKDOWN_TOOLS: Array<{
  key: MarkdownEditorCommand;
  label: string;
  title: string;
  shortcut?: string;
}> = [
  { key: 'heading', label: '标题', title: '插入二级标题' },
  { key: 'bold', label: '加粗', title: '插入粗体', shortcut: 'Ctrl/Cmd+B' },
  { key: 'italic', label: '斜体', title: '插入斜体', shortcut: 'Ctrl/Cmd+I' },
  { key: 'quote', label: '引用', title: '插入引用块' },
  { key: 'bulletList', label: '无序', title: '插入无序列表' },
  { key: 'orderedList', label: '有序', title: '插入有序列表' },
  { key: 'link', label: '链接', title: '插入链接', shortcut: 'Ctrl/Cmd+K' },
];

const buildMemeShortcode = (packName: string, label: string) => {
  if (packName === DEFAULT_MEME_PACK) {
    return `[:${label}:] `;
  }
  return `[:${packName}/${label}:] `;
};

interface MarkdownComposeEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  maxLength: number;
  minHeight?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
  toolbarLabel?: string;
  emptyPreviewText?: string;
  renderClassName?: string;
  readOnly?: boolean;
  showToast?: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
}

const MarkdownComposeEditor: React.FC<MarkdownComposeEditorProps> = ({
  value,
  onChange,
  placeholder,
  maxLength,
  minHeight = '300px',
  ariaLabel = 'Markdown 编辑器',
  autoFocus = false,
  toolbarLabel = '支持 Markdown',
  emptyPreviewText = '预览区域（请先输入内容）',
  renderClassName = 'font-sans text-lg text-ink',
  readOnly = false,
  showToast,
}) => {
  const [showPreview, setShowPreview] = useState(false);
  const [memeOpen, setMemeOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const isMobile = useMediaQuery('(max-width: 767px)');
  const generatedMemeHistoryId = useId();
  const memeHistoryId = `markdown-compose-meme:${generatedMemeHistoryId}`;
  const editorRef = useRef<MarkdownEditorHandle | null>(null);
  const memeButtonRef = useRef<HTMLButtonElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const didMountRef = useRef(false);
  const previousShowPreviewRef = useRef(showPreview);
  const latestValueRef = useRef(value);
  const editorViewportStyle = { minHeight, height: minHeight };

  latestValueRef.current = value;

  const handleValueChange = useCallback((nextValue: string) => {
    latestValueRef.current = nextValue;
    onChange(nextValue);
  }, [onChange]);

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

  const insertIntoEditor = useCallback((insert: string) => {
    if (readOnly) {
      return;
    }
    if (!showPreview && editorRef.current?.insertText(insert)) {
      return;
    }
    handleValueChange(`${latestValueRef.current}${insert}`);
    setShowPreview(false);
    requestAnimationFrame(() => {
      editorRef.current?.focus();
    });
  }, [handleValueChange, readOnly, showPreview]);

  const closeMemePicker = useCallback(() => {
    const currentState = readMarkdownComposeHistoryState();
    if (isMobile && currentState.markdownMemeOverlayId === memeHistoryId) {
      requestOverlayHistoryBack();
      return;
    }
    setMemeOpen(false);
  }, [isMobile, memeHistoryId]);

  const openMemePicker = useCallback(() => {
    setMemeOpen(true);
    if (!isMobile) {
      return;
    }
    const currentState = readMarkdownComposeHistoryState();
    if (currentState.markdownMemeOverlayId === memeHistoryId) {
      return;
    }
    window.history.pushState({
      ...currentState,
      markdownMemeOverlayId: memeHistoryId,
    }, '', window.location.pathname + window.location.search);
  }, [isMobile, memeHistoryId]);

  const toggleMemePicker = useCallback(() => {
    if (memeOpen) {
      closeMemePicker();
      return;
    }
    openMemePicker();
  }, [closeMemePicker, memeOpen, openMemePicker]);

  useEffect(() => {
    if (!isMobile) {
      const currentState = readMarkdownComposeHistoryState();
      if (currentState.markdownMemeOverlayId === memeHistoryId) {
        const nextState = { ...currentState };
        delete nextState.markdownMemeOverlayId;
        window.history.replaceState(nextState, '', window.location.pathname + window.location.search);
      }
      setMemeOpen(false);
      return undefined;
    }

    const syncMemeOverlay = () => {
      setMemeOpen(readMarkdownComposeHistoryState().markdownMemeOverlayId === memeHistoryId);
    };
    syncMemeOverlay();
    window.addEventListener('popstate', syncMemeOverlay);
    return () => window.removeEventListener('popstate', syncMemeOverlay);
  }, [isMobile, memeHistoryId]);

  const handleRunCommand = useCallback((command: MarkdownEditorCommand) => {
    if (readOnly || showPreview) {
      return;
    }
    editorRef.current?.runCommand(command);
  }, [readOnly, showPreview]);

  const handlePickUpload = useCallback(() => {
    if (readOnly || uploading) {
      return;
    }
    uploadInputRef.current?.click();
  }, [readOnly, uploading]);

  const handleUploadFile = useCallback(async (file: File) => {
    if (readOnly) {
      return;
    }
    if (!file) {
      return;
    }
    if (!isImageUploadFile(file)) {
      showToast?.('仅支持上传图片文件', 'warning');
      return;
    }

    setUploading(true);
    try {
      insertIntoEditor(await uploadImageAsMarkdown(file));
      showToast?.('图片上传成功', 'success');
    } catch {
      showToast?.('图片上传失败，请稍后重试', 'error');
    } finally {
      setUploading(false);
    }
  }, [insertIntoEditor, readOnly, showToast]);

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

  return (
    <div className="border-2 border-dashed border-gray-200 rounded-lg bg-white/70 p-3">
      <div className="bg-white/90 px-3 py-2 flex items-center justify-between gap-2 rounded-lg">
        <div className="flex items-center gap-2">
          <span className="font-hand font-bold text-ink">{toolbarLabel}</span>
        </div>
        <div className="flex items-center gap-2">
          <SketchIconButton
            onClick={() => setShowPreview((prev) => !prev)}
            label={showPreview ? '编辑' : '预览'}
            icon={showPreview ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            variant="doodle"
            iconOnly
            className="h-11 w-11 px-0"
          />

          <input
            ref={uploadInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void handleUploadFile(file);
              }
              event.target.value = '';
            }}
          />
          <SketchIconButton
            onClick={handlePickUpload}
            disabled={readOnly || uploading}
            label={uploading ? '上传中' : '上传图片'}
            icon={<Image className="w-5 h-5" />}
            variant="doodle"
            iconOnly
            className="h-11 w-11 px-0"
          />

          <div className="relative">
            <SketchIconButton
              ref={memeButtonRef}
              onClick={toggleMemePicker}
              label="表情"
              icon={<Smile className="w-5 h-5" />}
              variant={memeOpen ? 'active' : 'doodle'}
              iconOnly
              className="h-11 w-11 px-0"
            />
            <MemePicker
              open={memeOpen}
              onClose={closeMemePicker}
              placement="down"
              anchorRef={memeButtonRef}
              onSelect={(packName, label) => {
                insertIntoEditor(buildMemeShortcode(packName, label));
                closeMemePicker();
              }}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3 mt-3">
        <div className="grid w-full grid-cols-4 gap-2 sm:flex sm:w-auto sm:flex-wrap">
          {MARKDOWN_TOOLS.map((tool) => (
            <button
              key={tool.key}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => handleRunCommand(tool.key)}
              disabled={readOnly || showPreview}
              aria-label={tool.title}
              title={tool.shortcut ? `${tool.title}（${tool.shortcut}）` : tool.title}
              className={`inline-flex min-h-[40px] w-full items-center justify-center rounded-full border-2 px-2.5 py-1.5 text-xs font-hand font-bold leading-none tracking-wide transition-all shadow-sketch active:translate-x-[2px] active:translate-y-[2px] active:shadow-sketch-active sm:w-auto sm:px-3 sm:text-sm ${readOnly || showPreview ? 'cursor-not-allowed border-gray-200 bg-gray-100 text-pencil/60 shadow-none' : 'border-ink bg-white text-ink hover:-translate-y-0.5 hover:bg-highlight'} ${roughBorderClassSm}`}
            >
              {tool.label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative" style={editorViewportStyle}>
        {showPreview ? (
          <div
            className="w-full h-full p-4 border-2 border-dashed border-gray-300 rounded-lg bg-gray-50 overflow-auto"
            style={editorViewportStyle}
          >
            {value.trim() ? (
              <MarkdownRenderer content={value} className={renderClassName} />
            ) : (
              <p className="text-pencil/50 font-hand text-xl">{emptyPreviewText}</p>
            )}
          </div>
        ) : (
          <div
            className="w-full h-full border-2 border-gray-200 rounded-lg bg-transparent focus-within:border-ink transition-colors overflow-hidden"
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
              onPasteImage={handleUploadFile}
            />
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className={`font-hand text-lg ${value.length > maxLength ? 'text-red-500 font-bold' : value.length > maxLength * 0.9 ? 'text-yellow-600' : 'text-pencil'}`}>
            {value.length} / {maxLength}
          </span>
          {value.length > maxLength && (
            <span className="text-red-500 text-sm font-hand">已超出字数限制</span>
          )}
        </div>
      </div>
    </div>
  );
};

export default MarkdownComposeEditor;
