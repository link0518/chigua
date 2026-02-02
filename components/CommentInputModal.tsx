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
  const memeButtonRef = useRef<HTMLButtonElement | null>(null);
  const { textareaRef, insertMeme } = useMemeInsert(text, setText);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setText(initialText);
    setMemeOpen(false);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }, [initialText, isOpen, textareaRef]);

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
      panelClassName="max-w-xl"
    >
      <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
        {(helperText || onCancelReply) && (
          <div className="flex items-center justify-between gap-2 border-2 border-ink bg-highlight rounded-lg px-3 py-2 shadow-sketch">
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
          className="w-full min-h-[160px] p-3 border-2 border-ink rounded-lg resize-none font-sans bg-white focus:outline-none focus:shadow-sketch-sm transition-shadow"
        />

        <div className="flex items-center justify-between text-xs text-pencil">
          <span>{text.length} / {maxLength}</span>
          {text.length > maxLength && <span className="text-red-500">超出限制</span>}
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="relative">
            <button
              ref={memeButtonRef}
              type="button"
              onClick={() => setMemeOpen((prev) => !prev)}
              className="px-3 h-11 flex items-center justify-center border-2 border-ink rounded-lg bg-white hover:bg-highlight transition-colors shadow-sketch"
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
              className="px-4 h-11 border-2 border-ink rounded-lg bg-white hover:bg-highlight transition-colors shadow-sketch font-hand font-bold"
            >
              取消
            </button>
            <SketchButton
              type="submit"
              className="px-4 h-11 flex items-center justify-center gap-2"
              disabled={submitting || !text.trim() || text.trim().length > maxLength}
            >
              <span>发送</span>
              <Send className="w-4 h-4" />
            </SketchButton>
          </div>
        </div>
      </form>
    </Modal>
  );
};

export default CommentInputModal;
