import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Send, Eye, EyeOff, CheckCircle, Smile, Image } from 'lucide-react';

import { api } from '../api';
import { useApp } from '../store/AppContext';
import MarkdownEditor, {
  type MarkdownEditorCommand,
  type MarkdownEditorHandle,
} from './MarkdownEditor';
import MarkdownRenderer from './MarkdownRenderer';
import MemePicker from './MemePicker';
import { DEFAULT_MEME_PACK } from './memeManifest';
import { SketchIconButton } from './SketchIconButton';
import { SketchCard, SketchButton, Tape, roughBorderClassSm } from './SketchUI';
import Turnstile, { TurnstileHandle } from './Turnstile';
import { consumeUploadQuota } from './uploadRateLimit';

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

const normalizeTag = (value: string) => value
  .trim()
  .replace(/^#+/, '')
  .replace(/\s+/g, ' ');

const buildMemeShortcode = (packName: string, label: string) => {
  if (packName === DEFAULT_MEME_PACK) {
    return `[:${label}:] `;
  }
  return `[:${packName}/${label}:] `;
};

const SubmissionView: React.FC = () => {
  const { addPost, showToast, state } = useApp();
  const [text, setText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [memeOpen, setMemeOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [availableTags, setAvailableTags] = useState<Array<{ name: string; count: number }>>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [customTag, setCustomTag] = useState('');
  const turnstileRef = useRef<TurnstileHandle | null>(null);
  const memeButtonRef = useRef<HTMLButtonElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const editorRef = useRef<MarkdownEditorHandle | null>(null);
  const maxLength = 2000;
  const maxTags = 2;
  const maxTagLength = 6;
  const turnstileEnabled = state.settings.turnstileEnabled;

  const insertIntoEditor = useCallback((insert: string) => {
    if (!showPreview && editorRef.current?.insertText(insert)) {
      return;
    }
    setText((prev) => `${prev}${insert}`);
    setShowPreview(false);
    requestAnimationFrame(() => {
      editorRef.current?.focus();
    });
  }, [showPreview]);

  const handleRunCommand = useCallback((command: MarkdownEditorCommand) => {
    if (showPreview) {
      return;
    }
    editorRef.current?.runCommand(command);
  }, [showPreview]);

  const handlePickUpload = () => {
    if (uploading) {
      return;
    }
    uploadInputRef.current?.click();
  };

  const handleUploadFile = async (file: File) => {
    if (!file) {
      return;
    }
    if (!file.type.startsWith('image/')) {
      showToast('仅支持上传图片文件', 'warning');
      return;
    }

    const quota = consumeUploadQuota({ windowMs: 30_000, max: 3 });
    if (!quota.allowed) {
      const seconds = Math.max(1, Math.ceil(quota.retryAfterMs / 1000));
      showToast(`图片上传过于频繁，请 ${seconds}s 后再试`, 'warning');
      return;
    }

    setUploading(true);
    try {
      const result = await api.uploadImage(file, { uploadChannel: 'telegram' });
      insertIntoEditor(`![](${result.url}) `);
      showToast('图片上传成功', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '图片上传失败，请稍后重试';
      showToast(message, 'error');
    } finally {
      setUploading(false);
    }
  };

  useEffect(() => {
    let active = true;
    setTagsLoading(true);
    api.getPostTags(60)
      .then((data) => {
        if (!active) {
          return;
        }
        const items = Array.isArray(data?.items) ? data.items : [];
        setAvailableTags(
          items
            .map((item: any) => ({
              name: normalizeTag(String(item?.name || '')),
              count: Number(item?.count || 0),
            }))
            .filter((item) => item.name)
        );
      })
      .catch(() => {
        if (!active) {
          return;
        }
        setAvailableTags([]);
      })
      .finally(() => {
        if (active) {
          setTagsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (showPreview) {
      return;
    }
    requestAnimationFrame(() => {
      editorRef.current?.focus();
    });
  }, [showPreview]);

  const addSelectedTag = (rawTag: string) => {
    const normalized = normalizeTag(rawTag);
    if (!normalized) {
      return false;
    }
    const exists = selectedTags.some((item) => item.toLowerCase() === normalized.toLowerCase());
    if (exists) {
      return false;
    }
    if (selectedTags.length >= maxTags) {
      showToast(`最多选择 ${maxTags} 个标签`, 'warning');
      return false;
    }
    setSelectedTags((prev) => [...prev, normalized]);
    return true;
  };

  const removeSelectedTag = (tag: string) => {
    const key = tag.toLowerCase();
    setSelectedTags((prev) => prev.filter((item) => item.toLowerCase() !== key));
  };

  const toggleTag = (tag: string) => {
    const key = tag.toLowerCase();
    if (selectedTags.some((item) => item.toLowerCase() === key)) {
      removeSelectedTag(tag);
      return;
    }
    addSelectedTag(tag);
  };

  const addCustomTag = () => {
    const normalized = normalizeTag(customTag);
    if (!normalized) {
      showToast('请输入标签名称', 'warning');
      return;
    }
    if (normalized.length > maxTagLength) {
      showToast(`标签长度不能超过 ${maxTagLength} 个字`, 'warning');
      return;
    }
    const added = addSelectedTag(normalized);
    if (!added) {
      return;
    }
    setCustomTag('');
  };

  const requestTurnstileToken = async () => {
    if (!turnstileEnabled) {
      return '';
    }
    if (!turnstileRef.current) {
      throw new Error('安全验证加载中，请稍后再试');
    }
    return turnstileRef.current.execute();
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!text.trim()) {
      showToast('内容不能为空哦', 'warning');
      return;
    }

    if (text.length > maxLength) {
      showToast('内容超过字数限制', 'error');
      return;
    }

    if (selectedTags.length === 0) {
      showToast('请选择至少 1 个标签', 'warning');
      return;
    }

    setIsSubmitting(true);

    let turnstileToken = '';
    try {
      turnstileToken = await requestTurnstileToken();
    } catch (error) {
      const message = error instanceof Error ? error.message : '安全验证失败，请重试';
      showToast(message, 'error');
      setIsSubmitting(false);
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 800));

    try {
      await addPost({
        content: text.trim(),
        author: '匿名',
        timestamp: '刚刚',
        tags: selectedTags,
      }, turnstileToken);
    } catch (error) {
      const message = error instanceof Error ? error.message : '投稿失败，请稍后重试';
      showToast(message, 'error');
      setIsSubmitting(false);
      return;
    }

    setIsSubmitting(false);
    setIsSuccess(true);
    showToast('投稿成功！你的瓜已经新鲜上架啦～', 'success');

    setTimeout(() => {
      setText('');
      setSelectedTags([]);
      setCustomTag('');
      setIsSuccess(false);
      setShowPreview(false);
    }, 2000);
  };

  if (isSuccess) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-80px)] p-4">
        <div className="max-w-md w-full text-center">
          <div className="mb-6 animate-bounce">
            <CheckCircle className="w-24 h-24 text-green-500 mx-auto" />
          </div>
          <h2 className="font-display text-4xl text-ink mb-4">投稿成功！</h2>
          <p className="font-hand text-xl text-pencil mb-6">你的瓜已经新鲜上架啦，稍后会自动返回。</p>
          <div className="animate-pulse font-hand text-pencil">稍后自动返回...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-80px)] p-4">
      <div className="absolute top-1/4 left-10 hidden lg:block opacity-20 transform -rotate-12">
        <svg width="150" height="150" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="2" className="text-ink">
          <path d="M20,50 Q50,10 80,50 T140,50" />
          <path d="M25,60 Q55,20 85,60 T145,60" />
          <circle cx="85" cy="30" r="5" />
        </svg>
      </div>

      <div className="max-w-2xl w-full relative">
        <div className="text-center mb-8">
          <h2 className="font-display text-4xl text-ink transform -rotate-2 inline-block">
            匿名投稿
          </h2>
          <p className="font-hand text-lg text-pencil mt-2">完全匿名，畅所欲言</p>
        </div>

        <SketchCard rotate className="relative">
          <Tape />

          <form className="mt-6 flex flex-col h-full gap-4" onSubmit={handleSubmit}>
            <div className="sticky top-3 z-10 bg-white/90 backdrop-blur-sm px-3 py-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-hand font-bold text-ink">支持 Markdown</span>
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

            <div className="border-2 border-dashed border-gray-200 rounded-lg bg-white/70 p-3">
              <div className="flex flex-wrap items-center gap-2 mb-3">
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

              <div className="relative flex-grow min-h-[300px]">
                {showPreview ? (
                  <div className="w-full h-full min-h-[300px] p-4 border-2 border-dashed border-gray-300 rounded-lg bg-gray-50 overflow-auto">
                    {text.trim() ? (
                      <MarkdownRenderer content={text} className="font-sans text-lg text-ink" />
                    ) : (
                      <p className="text-pencil/50 font-hand text-xl">预览区域（请先输入内容）</p>
                    )}
                  </div>
                ) : (
                  <div className="w-full h-full min-h-[300px] border-2 border-gray-200 rounded-lg bg-transparent focus-within:border-ink transition-colors overflow-hidden">
                    <MarkdownEditor
                      ref={editorRef}
                      value={text}
                      onChange={setText}
                      placeholder="想说什么就写下来吧……有什么好吃的瓜
畅所欲言，祝侠士们天天开心"
                      minHeight="300px"
                      autoFocus
                      ariaLabel="投稿 Markdown 编辑器"
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="border-2 border-dashed border-gray-200 rounded-lg p-3 bg-white/70">
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="font-hand text-base text-ink">选择标签（最多 {maxTags} 个）</p>
                <span className="text-xs text-pencil font-sans">{selectedTags.length}/{maxTags}</span>
              </div>

              {selectedTags.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {selectedTags.map((tag) => (
                    <button
                      key={`selected-${tag}`}
                      type="button"
                      onClick={() => removeSelectedTag(tag)}
                      className="px-2 py-1 rounded-full border border-ink bg-highlight text-ink text-xs font-bold font-sans hover:opacity-80"
                      title="点击移除标签"
                    >
                      #{tag} ×
                    </button>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {tagsLoading ? (
                  <span className="text-xs text-pencil font-sans">标签加载中...</span>
                ) : availableTags.length === 0 ? (
                  <span className="text-xs text-pencil font-sans">暂无标签，发布时可创建新标签</span>
                ) : (
                  availableTags.slice(0, 30).map((item) => {
                    const active = selectedTags.some((tag) => tag.toLowerCase() === item.name.toLowerCase());
                    return (
                      <button
                        key={`preset-${item.name}`}
                        type="button"
                        onClick={() => toggleTag(item.name)}
                        className={`px-2 py-1 rounded-full border text-xs font-bold font-sans transition-colors ${active ? 'border-ink bg-highlight text-ink' : 'border-gray-300 bg-white text-pencil hover:border-ink hover:text-ink'}`}
                        title={`已使用 ${item.count} 次`}
                      >
                        #{item.name}
                      </button>
                    );
                  })
                )}
              </div>

              <div className="mt-3 flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={customTag}
                  onChange={(event) => setCustomTag(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addCustomTag();
                    }
                  }}
                  placeholder={`输入新标签并回车（最多 ${maxTagLength} 字）`}
                  maxLength={maxTagLength}
                  className="flex-1 h-10 border-2 border-gray-200 rounded-lg px-3 text-sm font-sans focus:border-ink outline-none"
                />
                <SketchButton
                  type="button"
                  variant="secondary"
                  className="h-10 px-4 text-sm"
                  onClick={addCustomTag}
                >
                  新增标签
                </SketchButton>
              </div>
            </div>

            <div className="flex justify-between items-center">
              <div className="flex items-center gap-4">
                <span className={`font-hand text-lg ${text.length > maxLength ? 'text-red-500 font-bold' : text.length > maxLength * 0.9 ? 'text-yellow-600' : 'text-pencil'}`}>
                  {text.length} / {maxLength}
                </span>
                {text.length > maxLength && (
                  <span className="text-red-500 text-sm font-hand">已超出字数限制</span>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-pencil">
                <EyeOff className="w-4 h-4" />
                <span className="font-hand">完全匿名投稿</span>
              </div>
            </div>

            <div className="mt-2">
              <SketchButton
                type="submit"
                fullWidth
                className="h-14 flex items-center justify-center gap-3 text-2xl"
                disabled={isSubmitting || !text.trim() || text.length > maxLength}
              >
                <span>{isSubmitting ? '投稿中...' : '匿名投稿'}</span>
                {!isSubmitting && <Send className="w-5 h-5" />}
              </SketchButton>
            </div>
          </form>

          <Turnstile ref={turnstileRef} action="post" enabled={turnstileEnabled} />
        </SketchCard>
      </div>
    </div>
  );
};

export default SubmissionView;
