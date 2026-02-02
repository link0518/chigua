import React, { useEffect, useRef, useState } from 'react';
import { Send, Smile } from 'lucide-react';
import Modal from './Modal';
import { SketchButton } from './SketchUI';
import MemePicker, { useMemeInsert } from './MemePicker';

interface CommentInputModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (text: string) => Promise<void> | void;
  maxLength: number;
  submitting: boolean;
  title?: string;
  initialText?: string;
  helperText?: string;
  onCancelReply?: () => void;
}

const CommentInputModal: React.FC<CommentInputModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  maxLength,
  submitting,
  title = '写评论',
  initialText = '',
  helperText,
  onCancelReply,
}) => {
  const [text, setText] = useState(initialText);
  const [memeOpen, setMemeOpen] = useState(false);
  const [viewportTopInset, setViewportTopInset] = useState(0);
  const isMobile = typeof window !== 'undefined' ? window.matchMedia('(max-width: 767px)').matches : false;
  const memeButtonRef = useRef<HTMLButtonElement | null>(null);
  const { textareaRef, insertMeme } = useMemeInsert(text, setText);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setText(initialText);
    setMemeOpen(false);
    setViewportTopInset(0);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }, [initialText, isOpen, textareaRef]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const vv = window.visualViewport;
    if (!vv) {
      return;
    }
    let rafId: number | null = null;
    const update = () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      rafId = requestAnimationFrame(() => {
        // iOS/部分安卓：键盘弹起时 visualViewport 可能会有 offsetTop，
        // 这里把它作为“需要额外向下避让”的量，避免弹窗顶部被导航栏/状态栏遮到。
        setViewportTopInset(Math.max(0, Math.round(vv.offsetTop)));
      });
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [isOpen]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) {
      await onSubmit('');
      return;
    }
    if (trimmed.length > maxLength) {
      await onSubmit(text);
      return;
    }
    await onSubmit(trimmed);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      titleClassName="mb-2"
      panelClassName="max-w-xl p-4 sm:p-6 max-h-[calc(100vh-240px)] sm:max-h-[calc(100vh-180px)] overflow-hidden"
      closeButtonClassName="top-2 right-2"
      overlayClassName="items-start sm:items-center pt-[calc(env(safe-area-inset-top)+72px)]"
    >
      {isMobile && viewportTopInset > 0 && (
        <div style={{ height: viewportTopInset }} />
      )}
      <form className="flex flex-col h-full" onSubmit={handleSubmit}>
        <div className="flex-1 flex flex-col gap-2 min-h-0">
          {(helperText || onCancelReply) && (
            <div className="flex items-center justify-between gap-2 border-2 border-ink bg-highlight rounded-lg px-3 py-2 shadow-sketch -mt-1">
              <div className="font-hand font-bold text-ink text-sm">
                {helperText || ''}
              </div>
              {onCancelReply && (
                <button
                  type="button"
                  onClick={onCancelReply}
                  className="px-3 py-1 border-2 border-ink rounded-lg bg-white hover:bg-gray-50 transition-colors shadow-sketch font-hand font-bold text-sm"
                >
                  取消回复
                </button>
              )}
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="留下你的评论...（支持 Markdown / 表情包）"
            maxLength={maxLength + 10}
            className="w-full flex-1 min-h-[96px] sm:min-h-[160px] p-3 border-2 border-ink rounded-lg resize-none font-sans bg-white focus:outline-none focus:shadow-sketch-sm transition-shadow"
          />
          <div className="flex items-center justify-between text-xs text-pencil">
            <span>{text.length} / {maxLength}</span>
            {text.length > maxLength && <span className="text-red-500">超出限制</span>}
          </div>
        </div>

        <div className="mt-2 pt-2 border-t border-gray-100 flex items-center justify-between gap-2">
          <div className="relative">
            <button
              ref={memeButtonRef}
              type="button"
              onClick={() => setMemeOpen((prev) => !prev)}
              className="px-3 h-10 flex items-center justify-center border-2 border-ink rounded-lg bg-white hover:bg-highlight transition-colors shadow-sketch"
              aria-label="插入表情包"
              title="表情包"
            >
              <Smile className="w-4 h-4" />
            </button>
            <MemePicker
              open={memeOpen}
              onClose={() => setMemeOpen(false)}
              anchorRef={memeButtonRef}
              onSelect={(packName, label) => {
                insertMeme(packName, label);
                setMemeOpen(false);
              }}
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 h-10 border-2 border-ink rounded-lg bg-white hover:bg-highlight transition-colors shadow-sketch font-hand font-bold"
            >
              取消
            </button>
            <SketchButton
              type="submit"
              className="px-4 h-10 flex items-center justify-center gap-2"
              disabled={submitting || !text.trim() || text.trim().length > maxLength}
            >
              <span>发布</span>
              <Send className="w-4 h-4" />
            </SketchButton>
          </div>
        </div>
      </form>
    </Modal>
  );
};

export default CommentInputModal;
