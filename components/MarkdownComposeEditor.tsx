import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, Image, Smile } from 'lucide-react';

import { api } from '../api';
import { consumeUploadQuota } from './uploadRateLimit';
import MarkdownEditor, {
  type MarkdownEditorCommand,
  type MarkdownEditorHandle,
} from './MarkdownEditor';
import MarkdownRenderer from './MarkdownRenderer';
import MemePicker from './MemePicker';
import { DEFAULT_MEME_PACK } from './memeManifest';
import { SketchIconButton } from './SketchIconButton';
import { roughBorderClassSm } from './SketchUI';

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
  showToast,
}) => {
  const [showPreview, setShowPreview] = useState(false);
  const [memeOpen, setMemeOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
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

  const insertIntoEditor = useCallback((insert: string) => {
    if (!showPreview && editorRef.current?.insertText(insert)) {
      return;
    }
    handleValueChange(`${latestValueRef.current}${insert}`);
    setShowPreview(false);
    requestAnimationFrame(() => {
      editorRef.current?.focus();
    });
  }, [handleValueChange, showPreview]);

  const handleRunCommand = useCallback((command: MarkdownEditorCommand) => {
    if (showPreview) {
      return;
    }
    editorRef.current?.runCommand(command);
  }, [showPreview]);

  const handlePickUpload = useCallback(() => {
    if (uploading) {
      return;
    }
    uploadInputRef.current?.click();
  }, [uploading]);

  const handleUploadFile = useCallback(async (file: File) => {
    if (!file) {
      return;
    }
    if (!file.type.startsWith('image/')) {
      showToast?.('仅支持上传图片文件', 'warning');
      return;
    }

    const quota = consumeUploadQuota({ windowMs: 30_000, max: 3 });
    if (!quota.allowed) {
      const seconds = Math.max(1, Math.ceil(quota.retryAfterMs / 1000));
      showToast?.(`图片上传过于频繁，请 ${seconds}s 后再试`, 'warning');
      return;
    }

    setUploading(true);
    try {
      const result = await api.uploadImage(file, { uploadChannel: 'telegram' });
      insertIntoEditor(`![](${result.url}) `);
      showToast?.('图片上传成功', 'success');
    } catch {
      showToast?.('图片上传失败，请稍后重试', 'error');
    } finally {
      setUploading(false);
    }
  }, [insertIntoEditor, showToast]);

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
            disabled={uploading}
            label={uploading ? '上传中' : '上传图片'}
            icon={<Image className="w-5 h-5" />}
            variant="doodle"
            iconOnly
            className="h-11 w-11 px-0"
          />

          <div className="relative">
            <SketchIconButton
              ref={memeButtonRef}
              onClick={() => setMemeOpen((prev) => !prev)}
              label="表情"
              icon={<Smile className="w-5 h-5" />}
              variant={memeOpen ? 'active' : 'doodle'}
              iconOnly
              className="h-11 w-11 px-0"
            />
            <MemePicker
              open={memeOpen}
              onClose={() => setMemeOpen(false)}
              placement="down"
              anchorRef={memeButtonRef}
              onSelect={(packName, label) => {
                insertIntoEditor(buildMemeShortcode(packName, label));
                setMemeOpen(false);
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
              disabled={showPreview}
              aria-label={tool.title}
              title={tool.shortcut ? `${tool.title}（${tool.shortcut}）` : tool.title}
              className={`inline-flex min-h-[40px] w-full items-center justify-center rounded-full border-2 px-2.5 py-1.5 text-xs font-hand font-bold leading-none tracking-wide transition-all shadow-sketch active:translate-x-[2px] active:translate-y-[2px] active:shadow-sketch-active sm:w-auto sm:px-3 sm:text-sm ${showPreview ? 'cursor-not-allowed border-gray-200 bg-gray-100 text-pencil/60 shadow-none' : 'border-ink bg-white text-ink hover:-translate-y-0.5 hover:bg-highlight'} ${roughBorderClassSm}`}
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
