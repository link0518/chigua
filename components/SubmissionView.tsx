import React, { useEffect, useRef, useState } from 'react';
import { EyeOff, Send } from 'lucide-react';

import { api } from '../api';
import { useApp } from '../store/AppContext';
import MarkdownComposeEditor from './MarkdownComposeEditor';
import { SketchCard, SketchButton, Tape } from './SketchUI';
import Turnstile, { TurnstileHandle } from './Turnstile';

const normalizeTag = (value: string) => value
  .trim()
  .replace(/^#+/, '')
  .replace(/\s+/g, ' ');

const SubmissionView: React.FC = () => {
  const { addPost, showToast, state } = useApp();
  const [text, setText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [availableTags, setAvailableTags] = useState<Array<{ name: string; count: number }>>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [customTag, setCustomTag] = useState('');
  const turnstileRef = useRef<TurnstileHandle | null>(null);
  const maxLength = 2000;
  const maxTags = 2;
  const maxTagLength = 6;
  const turnstileEnabled = state.settings.turnstileEnabled;

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
      const newPost = await addPost({
        content: text.trim(),
        author: '匿名',
        timestamp: '刚刚',
        tags: selectedTags,
      }, turnstileToken);
      const targetPath = `/post/${encodeURIComponent(newPost.id)}`;
      if (window.location.pathname + window.location.search !== targetPath) {
        window.history.pushState({}, '', targetPath);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '投稿失败，请稍后重试';
      showToast(message, 'error');
      setIsSubmitting(false);
      return;
    }

    setIsSubmitting(false);
    showToast('投稿成功！你的瓜已经新鲜上架啦…', 'success');
    setText('');
    setSelectedTags([]);
    setCustomTag('');
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

        <SketchCard className="relative">
          <Tape />

          <form className="mt-6 flex flex-col h-full gap-4" onSubmit={handleSubmit}>
            <MarkdownComposeEditor
              value={text}
              onChange={setText}
              placeholder={'想说什么就写下来吧……有什么好吃的瓜\n畅所欲言，祝侠士们天天开心'}
              maxLength={maxLength}
              minHeight="300px"
              autoFocus
              ariaLabel="投稿 Markdown 编辑器"
              showToast={showToast}
            />

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

            <div className="flex justify-end items-center">
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
