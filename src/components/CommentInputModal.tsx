import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Image, Send, Smile } from 'lucide-react';
import Modal from './Modal';
import { SketchButton } from './SketchUI';
import MemePicker, { useMemeInsert } from './MemePicker';
import { useInsertAtCursor } from './useInsertAtCursor';
import { SketchIconButton } from './SketchIconButton';
import { isImageUploadFile, uploadImageAsMarkdown } from './imageUpload';
import useMediaQuery from './useMediaQuery';
import { requestOverlayHistoryBack } from './overlayHistory';

interface CommentInputModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (text: string) => Promise<boolean | void> | boolean | void;
  maxLength: number;
  submitting: boolean;
  uploading: boolean;
  tryAcquireUpload: () => (() => void) | null;
  showToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
  title?: string;
  initialText?: string;
  helperText?: string;
  onCancelReply?: () => void;
  onDraftChange?: (text: string) => void;
}

type CommentInputHistoryState = Record<string, unknown> & {
  homeSecondaryOverlay?: 'comment-report' | 'comment-meme' | 'markdown-image';
  homeSecondaryOverlayId?: string;
};

const readCommentInputHistoryState = (): CommentInputHistoryState => (
  window.history.state && typeof window.history.state === 'object'
    ? window.history.state as CommentInputHistoryState
    : {}
);

const CommentInputModal: React.FC<CommentInputModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  maxLength,
  submitting,
  uploading,
  tryAcquireUpload,
  showToast,
  title = '写评论',
  initialText = '',
  helperText,
  onCancelReply,
  onDraftChange,
}) => {
  const [text, setText] = useState(initialText);
  const [memeOpen, setMemeOpen] = useState(false);
  const [mobileViewport, setMobileViewport] = useState<{ top: number; height: number } | null>(null);
  const isMobile = useMediaQuery('(max-width: 767px)');
  const memeButtonRef = useRef<HTMLButtonElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const uploadDraftVersionRef = useRef(0);
  const wasOpenRef = useRef(false);
  const syncedInitialTextRef = useRef(initialText);
  const textRef = useRef(initialText);
  const onDraftChangeRef = useRef(onDraftChange);

  useLayoutEffect(() => {
    onDraftChangeRef.current = onDraftChange;
  }, [onDraftChange]);

  const updateText = useCallback<React.Dispatch<React.SetStateAction<string>>>((nextValue) => {
    const nextText = typeof nextValue === 'function'
      ? nextValue(textRef.current)
      : nextValue;
    textRef.current = nextText;
    setText(nextText);
    onDraftChangeRef.current?.(nextText);
  }, []);

  const { textareaRef, insertMeme } = useMemeInsert(text, updateText);
  const { insertAtCursor } = useInsertAtCursor(text, updateText, textareaRef);

  useLayoutEffect(() => {
    // 弹窗关闭、重新打开或切换到另一份初始草稿后，使旧上传结果失效。
    uploadDraftVersionRef.current += 1;
    return () => {
      uploadDraftVersionRef.current += 1;
    };
  }, [isOpen]);

  const closeMemePicker = useCallback(() => {
    const currentState = readCommentInputHistoryState();
    if (
      currentState.homeSecondaryOverlay === 'comment-meme'
      && currentState.homeSecondaryOverlayId !== 'comment-inline'
    ) {
      requestOverlayHistoryBack();
      return;
    }
    setMemeOpen(false);
  }, [isMobile]);

  const openMemePicker = useCallback(() => {
    setMemeOpen(true);
    if (!isMobile) {
      return;
    }
    const currentState = readCommentInputHistoryState();
    if (
      currentState.homeSecondaryOverlay === 'comment-meme'
      && currentState.homeSecondaryOverlayId === 'comment-composer'
    ) {
      return;
    }
    window.history.pushState({
      ...currentState,
      homeSecondaryOverlay: 'comment-meme',
      homeSecondaryOverlayId: 'comment-composer',
    }, '', window.location.pathname + window.location.search);
  }, [isMobile]);

  const toggleMemePicker = useCallback(() => {
    if (memeOpen) {
      closeMemePicker();
      return;
    }
    openMemePicker();
  }, [closeMemePicker, memeOpen, openMemePicker]);

  const handleClose = () => {
    if (memeOpen) {
      closeMemePicker();
      return;
    }
    uploadDraftVersionRef.current += 1;
    onDraftChangeRef.current?.(textRef.current);
    onClose();
  };

  const handlePickUpload = () => {
    if (uploading || submitting) {
      return;
    }
    uploadInputRef.current?.click();
  };

  const handleUploadFile = async (file: File) => {
    if (!file) {
      return;
    }
    if (!isImageUploadFile(file)) {
      showToast('只支持上传图片文件', 'warning');
      return;
    }

    const releaseUpload = tryAcquireUpload();
    if (!releaseUpload) {
      showToast('图片上传或评论提交正在进行，请稍候', 'info');
      return;
    }

    const draftVersion = uploadDraftVersionRef.current;
    try {
      const markdown = await uploadImageAsMarkdown(file, { usage: 'comment' });
      if (uploadDraftVersionRef.current !== draftVersion) {
        return;
      }
      insertAtCursor(markdown);
      showToast('图片上传成功', 'success');
    } catch (error) {
      if (uploadDraftVersionRef.current !== draftVersion) {
        return;
      }
      const message = error instanceof Error ? error.message : '图片上传失败，请稍后重试';
      showToast(message, 'error');
    } finally {
      releaseUpload();
    }
  };

  useEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current) {
      return;
    }
    wasOpenRef.current = true;
    syncedInitialTextRef.current = initialText;
    updateText(initialText);
    setMemeOpen(false);
    setMobileViewport(null);
  }, [initialText, isOpen, updateText]);

  useEffect(() => {
    if (!isOpen) {
      syncedInitialTextRef.current = initialText;
      return;
    }
    const previousInitialText = syncedInitialTextRef.current;
    if (previousInitialText === initialText) {
      return;
    }
    syncedInitialTextRef.current = initialText;
    // 草稿异步恢复时仅覆盖尚未编辑的空初始值，避免抢走用户刚输入的内容。
    if (textRef.current === previousInitialText) {
      updateText(initialText);
    }
  }, [initialText, isOpen, updateText]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const focusFrame = requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
    return () => cancelAnimationFrame(focusFrame);
  }, [isOpen, textareaRef]);

  useEffect(() => {
    if (!isOpen || !isMobile) {
      return undefined;
    }
    const syncMemeOverlay = () => {
      const currentState = readCommentInputHistoryState();
      setMemeOpen(
        currentState.homeSecondaryOverlay === 'comment-meme'
        && currentState.homeSecondaryOverlayId !== 'comment-inline'
      );
    };
    syncMemeOverlay();
    window.addEventListener('popstate', syncMemeOverlay);
    return () => window.removeEventListener('popstate', syncMemeOverlay);
  }, [isMobile, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const vv = window.visualViewport;
    if (!vv) {
      if (isMobile) {
        setMobileViewport({ top: 0, height: Math.max(240, window.innerHeight) });
      }
      return;
    }
    let rafId: number | null = null;
    const update = () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      rafId = requestAnimationFrame(() => {
        if (!isMobile) {
          setMobileViewport(null);
          return;
        }
        // 编辑器直接绑定可视视口，避免同时使用顶部占位和高度压缩造成二次偏移。
        setMobileViewport({
          top: Math.max(0, Math.round(vv.offsetTop)),
          height: Math.max(240, Math.round(vv.height)),
        });
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
  }, [isMobile, isOpen]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (uploading) {
      showToast('图片上传完成后才能发布评论', 'warning');
      return;
    }
    const trimmed = text.trim();
    if (!trimmed) {
      const submitted = await onSubmit('');
      if (submitted === true) {
        updateText('');
      }
      return;
    }
    if (trimmed.length > maxLength) {
      const submitted = await onSubmit(text);
      if (submitted === true) {
        updateText('');
      }
      return;
    }
    const submitted = await onSubmit(trimmed);
    if (submitted === true) {
      // 历史返回事件可能晚于提交完成；先清空本地值，避免关闭阶段把旧稿写回。
      updateText('');
    }
  };

  // 通过 Portal 脱离评论面板的堆叠上下文，保持原有居中编辑弹窗。
  return createPortal(
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={title}
      titleClassName="mb-2"
      panelClassName="max-w-xl overflow-hidden p-4 sm:p-6"
      closeButtonClassName="top-2 right-2 z-10"
      overlayClassName="items-start pt-[calc(env(safe-area-inset-top)+72px)] sm:items-center sm:pt-4"
      panelStyle={mobileViewport ? { maxHeight: `${Math.max(240, mobileViewport.height - 12)}px` } : undefined}
    >
      <form className="flex h-full flex-col" onSubmit={handleSubmit}>
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
                  className="rounded-lg border-2 border-ink bg-white px-3 py-1 font-hand text-sm font-bold shadow-sketch transition-colors hover:bg-gray-50"
                >
                  取消回复
                </button>
              )}
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => updateText(e.target.value)}
            onPaste={(e) => {
              const items = e.clipboardData?.items;
              if (!items) return;
              for (let i = 0; i < items.length; i++) {
                const item = items[i];
                if (item.kind === 'file' && item.type.startsWith('image/')) {
                  const file = item.getAsFile();
                  if (file) {
                    e.preventDefault();
                    void handleUploadFile(file);
                    return;
                  }
                }
              }
            }}
            placeholder="留下你的评论..."
            maxLength={maxLength + 10}
            className="w-full flex-1 min-h-[72px] sm:min-h-[160px] p-3 border-2 border-ink rounded-lg resize-none font-sans bg-white focus:outline-none focus:shadow-sketch-sm transition-shadow"
          />
          <div className="flex items-center justify-between text-xs text-pencil">
            <span>{text.length} / {maxLength}</span>
            {text.length > maxLength && <span className="text-red-500">超出限制</span>}
          </div>
        </div>

        <div className="mt-2 pt-2 border-t border-gray-100 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
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
              disabled={uploading || submitting}
              label={uploading ? '上传中' : '上传图片'}
              icon={<Image className="w-4 h-4" />}
              variant="doodle"
              iconOnly
              className="h-10 w-10 px-0"
            />
            <div className="relative">
              <SketchIconButton
                ref={memeButtonRef}
                onClick={toggleMemePicker}
                label="表情"
                variant={memeOpen ? 'active' : 'doodle'}
                icon={<Smile className="w-4 h-4" />}
                iconOnly
                className="h-10 w-10 px-0"
              />
              <MemePicker
                open={memeOpen}
                onClose={closeMemePicker}
                anchorRef={memeButtonRef}
                onSelect={(packName, label) => {
                  insertMeme(packName, label);
                  closeMemePicker();
                }}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleClose}
              className="h-10 rounded-lg border-2 border-ink bg-white px-4 font-hand font-bold shadow-sketch transition-colors hover:bg-highlight"
            >
              取消
            </button>
            <SketchButton
              type="submit"
              className="flex h-10 items-center justify-center gap-2 px-4"
              disabled={submitting || uploading || !text.trim() || text.trim().length > maxLength}
            >
              <span>发布</span>
              <Send className="w-4 h-4" />
            </SketchButton>
          </div>
        </div>
      </form>
    </Modal>,
    document.body
  );
};

export default CommentInputModal;
