import React, { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { SketchButton } from './SketchUI';
import { api } from '../api';
import { Comment } from '../types';
import { useApp } from '../store/AppContext';
import MarkdownRenderer from './MarkdownRenderer';
import Turnstile, { TurnstileHandle } from './Turnstile';

interface CommentModalProps {
  isOpen: boolean;
  onClose: () => void;
  postId: string;
  contentPreview?: string;
}

const MAX_LENGTH = 300;

const CommentModal: React.FC<CommentModalProps> = ({
  isOpen,
  onClose,
  postId,
  contentPreview,
}) => {
  const { addComment, showToast } = useApp();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [text, setText] = useState('');
  const turnstileRef = useRef<TurnstileHandle | null>(null);

  useEffect(() => {
    if (!isOpen || !postId) return;
    setComments([]);
    setLoading(true);
    api
      .getComments(postId)
      .then((data) => {
        setComments(data.items || []);
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : '评论加载失败';
        showToast(message, 'error');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [isOpen, postId, showToast]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) {
      showToast('评论不能为空', 'warning');
      return;
    }
    if (trimmed.length > MAX_LENGTH) {
      showToast('评论长度不能超过 300 字', 'error');
      return;
    }

    setSubmitting(true);
    try {
      if (!turnstileRef.current) {
        throw new Error('安全验证加载中，请稍后再试');
      }
      const turnstileToken = await turnstileRef.current.execute();
      const comment = await addComment(postId, trimmed, turnstileToken);
      setComments((prev) => [comment, ...prev]);
      setText('');
      showToast('评论已发布', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '评论失败，请稍后重试';
      showToast(message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="mt-4 border-2 border-ink rounded-lg bg-white p-4 shadow-sketch-sm font-sans">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-sans font-semibold text-lg text-ink">评论区</h3>
        <button
          type="button"
          onClick={onClose}
          className="text-xs font-sans text-pencil hover:text-ink transition-colors"
        >
          收起
        </button>
      </div>

      {contentPreview && (
        <div className="p-3 bg-gray-50 border border-dashed border-ink rounded-lg mb-3">
          <p className="text-sm text-pencil line-clamp-2">"{contentPreview}"</p>
        </div>
      )}

      <div className="max-h-64 overflow-y-auto flex flex-col gap-3 pr-1">
        {loading ? (
          <div className="text-center text-pencil">评论加载中...</div>
        ) : comments.length === 0 ? (
          <div className="text-center text-pencil">还没有评论，来当第一个吃瓜群众吧！</div>
        ) : (
          comments.map((comment) => (
            <div key={comment.id} className="border-2 border-ink rounded-lg p-3 bg-white">
              <div className="flex items-center justify-between text-xs text-pencil font-sans mb-2">
                <span>匿名用户</span>
                <span>{comment.timestamp}</span>
              </div>
              <div className="text-sm text-ink">
                <MarkdownRenderer content={comment.content} />
              </div>
            </div>
          ))
        )}
      </div>

      <form className="flex flex-col gap-3 mt-4" onSubmit={handleSubmit}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="留下你的评论..."
          maxLength={MAX_LENGTH + 10}
          className="w-full h-20 p-3 border-2 border-ink rounded-lg resize-none font-sans focus:outline-none focus:shadow-sketch-sm transition-shadow"
        />
        <div className="flex items-center justify-between text-xs text-pencil">
          <span>{text.length} / {MAX_LENGTH}</span>
          {text.length > MAX_LENGTH && <span className="text-red-500">超出限制</span>}
        </div>
        <SketchButton
          type="submit"
          className="flex items-center justify-center gap-2 font-sans"
          disabled={submitting}
        >
          <Send className="w-4 h-4" />
          {submitting ? '发布中...' : '发布评论'}
        </SketchButton>
      </form>

      <Turnstile ref={turnstileRef} action="comment" enabled={isOpen} />
    </div>
  );
};

export default CommentModal;
