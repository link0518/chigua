import React, { useEffect, useRef, useState } from 'react';
import { Send, Eye, EyeOff, CheckCircle, Smile, Image } from 'lucide-react';
import { SketchCard, SketchButton, Tape } from './SketchUI';
import { useApp } from '../store/AppContext';
import MarkdownRenderer from './MarkdownRenderer';
import Turnstile, { TurnstileHandle } from './Turnstile';
import MemePicker, { useMemeInsert } from './MemePicker';
import { api } from '../api';
import { useInsertAtCursor } from './useInsertAtCursor';
import { SketchIconButton } from './SketchIconButton';
import { consumeUploadQuota } from './uploadRateLimit';

const normalizeTag = (value: string) => value
  .trim()
  .replace(/^#+/, '')
  .replace(/\s+/g, ' ');

const SubmissionView: React.FC = () => {
  const { addPost, showToast, state } = useApp();
  const [text, setText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [memeOpen, setMemeOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const turnstileRef = useRef<TurnstileHandle | null>(null);
  const memeButtonRef = useRef<HTMLButtonElement | null>(null);
  const { textareaRef, insertMeme } = useMemeInsert(text, setText);
  const { insertAtCursor } = useInsertAtCursor(text, setText, textareaRef);
  const maxLength = 2000;
  const maxTags = 2;
  const maxTagLength = 6;
  const turnstileEnabled = state.settings.turnstileEnabled;
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [availableTags, setAvailableTags] = useState<Array<{ name: string; count: number }>>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [customTag, setCustomTag] = useState('');

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
      showToast('只支持上传图片文件', 'warning');
      return;
    }

    const quota = consumeUploadQuota({ windowMs: 30_000, max: 3 });
    if (!quota.allowed) {
      const seconds = Math.max(1, Math.ceil(quota.retryAfterMs / 1000));
      showToast(`上传太频繁啦，请 ${seconds}s 后再试`, 'warning');
      return;
    }

    setUploading(true);
    try {
      const result = await api.uploadImage(file, { uploadChannel: 'telegram' });
      insertAtCursor(`![](${result.url}) `);
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
      showToast(`标签长度不能超过${maxTagLength}个字`, 'warning');
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!text.trim()) {
      showToast('内容不能为空哦！', 'warning');
      return;
    }

    if (text.length > maxLength) {
      showToast('内容超过字数限制！', 'error');
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

    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 800));

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

    // Reset after showing success
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
          <p className="font-hand text-xl text-pencil mb-6">你的瓜已经新鲜上架啦～ 🍉</p>
          <div className="animate-pulse font-hand text-pencil">稍后自动返回...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-80px)] p-4">

      {/* Decorative background elements */}
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
            {/* Preview / Upload / Meme */}
            <div className="sticky top-3 z-10 bg-white/90 backdrop-blur-sm px-3 py-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-hand font-bold text-ink">支持 Markdown</span>
                {/* <span className="text-xs text-pencil">(**粗体** *斜体* ~~删除线~~ `代码` · 表情短码)</span> */}
              </div>
              <div className="flex items-center gap-2">

                <SketchIconButton
                  onClick={() => setShowPreview(!showPreview)}
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
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      void handleUploadFile(file);
                    }
                    e.target.value = '';
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
                    variant="doodle"
                    iconOnly
                    className="h-11 w-11 px-0"
                  />
                  <MemePicker
                    open={memeOpen}
                    onClose={() => setMemeOpen(false)}
                    placement="down"
                    anchorRef={memeButtonRef}
                    onSelect={(packName, label) => {
                      insertMeme(packName, label);
                      setMemeOpen(false);
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Text Area or Preview */}
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
                <textarea
                  ref={textareaRef}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="想说什么... 有什么好吃的瓜？&#10;&#10;支持 Markdown 与表情包：&#10;点右上角“表情”插入（会显示为 [:微笑:] 这种短码）&#10;**粗体** *斜体* ~~删除线~~&#10;`行内代码` [链接](url)&#10;> 引用文字&#10;- 列表项"
                  maxLength={maxLength + 100}
                  className="w-full h-full min-h-[300px] resize-none bg-transparent border-2 border-gray-200 rounded-lg outline-none font-sans text-xl leading-8 text-ink placeholder:text-pencil/40 p-4 focus:border-ink transition-colors"
                />
              )}
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
                  onChange={(e) => setCustomTag(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addCustomTag();
                    }
                  }}
                  placeholder={`输入新标签并回车（最多${maxTagLength}字）`}
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

            {/* Footer */}
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-4">
                <span className={`font-hand text-lg ${text.length > maxLength ? 'text-red-500 font-bold' : text.length > maxLength * 0.9 ? 'text-yellow-600' : 'text-pencil'}`}>
                  {text.length} / {maxLength}
                </span>
                {text.length > maxLength && (
                  <span className="text-red-500 text-sm font-hand">超出限制！</span>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-pencil">
                <EyeOff className="w-4 h-4" />
                <span className="font-hand">完全匿名投稿</span>
              </div>
            </div>

            {/* Submit Button */}
            <div className="mt-2">
              <SketchButton
                type="submit"
                fullWidth
                className="h-14 flex items-center justify-center gap-3 text-2xl"
                disabled={isSubmitting || !text.trim() || text.length > maxLength}
              >
                <span>{isSubmitting ? '投喂中...' : '匿名投喂'}</span>
                {!isSubmitting && <Send className="w-5 h-5" />}
              </SketchButton>
            </div>
          </form>

          <Turnstile ref={turnstileRef} action="post" enabled={turnstileEnabled} />
        </SketchCard>

        {/* Markdown Help */}
        <div className="mt-6 p-4 bg-white/50 border-2 border-dashed border-gray-200 rounded-lg">
          <h3 className="font-hand font-bold text-ink mb-2">Markdown 快捷语法</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm font-mono text-pencil">
            <span><code className="bg-gray-100 px-1 rounded">**粗体**</code> → <strong>粗体</strong></span>
            <span><code className="bg-gray-100 px-1 rounded">*斜体*</code> → <em>斜体</em></span>
            <span><code className="bg-gray-100 px-1 rounded">~~删除~~</code> → <del>删除</del></span>
            <span><code className="bg-gray-100 px-1 rounded">`代码`</code> → <code className="bg-gray-100 px-1 rounded">代码</code></span>
            <span><code className="bg-gray-100 px-1 rounded">[链接](url)</code> → 链接</span>
            <span><code className="bg-gray-100 px-1 rounded">&gt; 引用</code> → 引用块</span>
          </div>
        </div>

      </div>
    </div>
  );
};

export default SubmissionView;
