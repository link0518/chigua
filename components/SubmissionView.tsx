import React, { useRef, useState } from 'react';
import { Send, Eye, EyeOff, CheckCircle } from 'lucide-react';
import { SketchCard, SketchButton, Tape } from './SketchUI';
import { useApp } from '../store/AppContext';
import MarkdownRenderer from './MarkdownRenderer';
import Turnstile, { TurnstileHandle } from './Turnstile';

const SubmissionView: React.FC = () => {
  const { addPost, showToast } = useApp();
  const [text, setText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const turnstileRef = useRef<TurnstileHandle | null>(null);
  const maxLength = 2000;

  const requestTurnstileToken = async () => {
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
        tags: [],
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
            {/* Preview Toggle */}
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <span className="font-hand font-bold text-ink">支持 Markdown</span>
                <span className="text-xs text-pencil">(**粗体** *斜体* ~~删除线~~ `代码`)</span>
              </div>
              <button
                type="button"
                onClick={() => setShowPreview(!showPreview)}
                className="flex items-center gap-1 px-3 py-1 text-sm font-hand font-bold text-pencil hover:text-ink border-2 border-gray-200 hover:border-ink rounded-full transition-all"
              >
                {showPreview ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                {showPreview ? '编辑' : '预览'}
              </button>
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
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="想说什么... 有什么好吃的瓜？&#10;&#10;支持 Markdown 格式：&#10;**粗体** *斜体* ~~删除线~~&#10;`行内代码` [链接](url)&#10;> 引用文字&#10;- 列表项"
                  maxLength={maxLength + 100}
                  className="w-full h-full min-h-[300px] resize-none bg-transparent border-2 border-gray-200 rounded-lg outline-none font-sans text-xl leading-8 text-ink placeholder:text-pencil/40 p-4 focus:border-ink transition-colors"
                />
              )}
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
                 <span className="material-symbols-outlined text-sm">visibility_off</span>
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

          <Turnstile ref={turnstileRef} action="post" />
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
