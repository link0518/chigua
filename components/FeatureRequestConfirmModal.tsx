import React, { useEffect, useState } from 'react';
import { Star } from 'lucide-react';

import { useApp } from '../store/AppContext';
import type { Post } from '../types';
import Modal from './Modal';
import { SketchButton } from './SketchUI';

interface FeatureRequestConfirmModalProps {
  post: Post | null;
  onClose: () => void;
}

const FeatureRequestConfirmModal: React.FC<FeatureRequestConfirmModalProps> = ({ post, onClose }) => {
  const { requestPostFeature, showToast } = useApp();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!post) {
      setSubmitting(false);
    }
  }, [post]);

  const handleConfirm = async () => {
    if (!post || submitting) {
      return;
    }
    setSubmitting(true);
    try {
      await requestPostFeature(post.id);
      showToast('加精申请已提交，请等待管理员审核', 'success');
      onClose();
    } catch (error) {
      showToast(error instanceof Error ? error.message : '加精申请提交失败', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen={Boolean(post)} onClose={onClose} title="申请加精">
      <div className="flex flex-col gap-5">
        <div className="flex items-start gap-3 rounded-xl border-2 border-dashed border-ink/20 bg-highlight/35 p-4">
          <Star className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div className="min-w-0">
            <p className="font-hand text-lg font-bold text-ink">确认申请将这条帖子设为精华吗？</p>
            <p className="mt-1 text-sm text-pencil">提交后将由管理员审核，同一身份对该帖子只能申请一次。</p>
          </div>
        </div>
        {post && (
          <p className="line-clamp-4 whitespace-pre-wrap break-words rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-pencil">
            {post.content}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <SketchButton type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            取消
          </SketchButton>
          <SketchButton type="button" onClick={handleConfirm} disabled={submitting}>
            {submitting ? '提交中...' : '确认申请'}
          </SketchButton>
        </div>
      </div>
    </Modal>
  );
};

export default FeatureRequestConfirmModal;
