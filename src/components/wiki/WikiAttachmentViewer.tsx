import React, { useMemo, useState } from 'react';
import { Badge, Empty, LayerCard } from '@cloudflare/kumo';
import {
  CaretRight,
  ImageBroken,
  ImageSquare,
  Paperclip,
} from '@phosphor-icons/react';
import { PhotoSlider } from 'react-photo-view';

import type { WikiAttachment } from './wikiTypes';

interface WikiAttachmentListProps {
  attachments?: WikiAttachment[] | null;
  title?: string;
  className?: string;
  onViewerVisibleChange?: (visible: boolean) => void;
  compact?: boolean;
  showEmpty?: boolean;
}

export const WikiAttachmentList: React.FC<WikiAttachmentListProps> = ({
  attachments,
  title = '附件',
  className = '',
  onViewerVisibleChange,
  compact = false,
  showEmpty = false,
}) => {
  const normalizedAttachments = useMemo(() => (
    (Array.isArray(attachments) ? attachments : [])
      .map((attachment) => ({
        title: String(attachment?.title || '').trim(),
        imageUrls: (Array.isArray(attachment?.imageUrls) ? attachment.imageUrls : [])
          .map((imageUrl) => String(imageUrl || '').trim())
          .filter(Boolean),
      }))
      .filter((attachment) => attachment.title && attachment.imageUrls.length > 0)
  ), [attachments]);
  const [selectedAttachmentIndex, setSelectedAttachmentIndex] = useState(0);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [viewerVisible, setViewerVisible] = useState(false);
  const activeTriggerRef = React.useRef<HTMLButtonElement | null>(null);

  const selectedAttachment = normalizedAttachments[selectedAttachmentIndex] || null;
  const totalImages = normalizedAttachments.reduce(
    (total, attachment) => total + attachment.imageUrls.length,
    0
  );

  const openAttachment = (attachmentIndex: number, trigger: HTMLButtonElement) => {
    activeTriggerRef.current = trigger;
    setSelectedAttachmentIndex(attachmentIndex);
    setViewerIndex(0);
    setViewerVisible(true);
    onViewerVisibleChange?.(true);
  };

  const closeViewer = () => {
    setViewerVisible(false);
    onViewerVisibleChange?.(false);
  };

  const handleViewerAfterClose = () => {
    setViewerIndex(0);
    const trigger = activeTriggerRef.current;
    activeTriggerRef.current = null;
    window.requestAnimationFrame(() => {
      if (trigger?.isConnected) {
        trigger.focus();
      }
    });
  };

  React.useEffect(() => {
    if (selectedAttachmentIndex >= normalizedAttachments.length) {
      setSelectedAttachmentIndex(Math.max(normalizedAttachments.length - 1, 0));
      setViewerIndex(0);
      if (viewerVisible) {
        setViewerVisible(false);
        onViewerVisibleChange?.(false);
      }
    }
  }, [normalizedAttachments.length, onViewerVisibleChange, selectedAttachmentIndex, viewerVisible]);

  if (normalizedAttachments.length === 0 && !showEmpty) {
    return null;
  }

  return (
    <>
      <LayerCard className={`wiki-surface-soft flex min-h-0 flex-col overflow-hidden p-0 shadow-sm ${compact ? 'wiki-sidebar-card' : ''} ${className}`}>
        <LayerCard.Secondary className={`flex shrink-0 items-center justify-between gap-3 ${compact ? 'wiki-sidebar-card-header' : ''}`}>
          <div className="flex items-center gap-2 text-sm font-semibold text-kumo-strong">
            <Paperclip size={18} />
            {title}
          </div>
          <div className="flex items-center gap-2">
            {compact ? (
              <Badge variant="outline">{normalizedAttachments.length} 组 · {totalImages} 张</Badge>
            ) : (
              <>
                <Badge variant="outline">{normalizedAttachments.length} 项</Badge>
                <Badge variant="secondary">{totalImages} 张</Badge>
              </>
            )}
          </div>
        </LayerCard.Secondary>

        <LayerCard.Primary className={`min-h-0 p-0 ${compact ? 'wiki-attachment-body flex-1 overflow-hidden' : ''}`}>
          {normalizedAttachments.length === 0 ? (
            <div className="flex h-full min-h-24 items-center justify-center">
              <Empty
                size="sm"
                icon={<Paperclip size={28} />}
                title="无"
                description="当前瓜条暂无附件"
              />
            </div>
          ) : (
            <ul className="divide-y divide-kumo-line">
              {normalizedAttachments.map((attachment, attachmentIndex) => (
                <li key={`${attachment.title}-${attachmentIndex}`}>
                  <button
                    type="button"
                    className={`wiki-motion-button wiki-focus-ring group flex w-full items-center text-left transition-colors hover:bg-kumo-tint ${compact ? 'min-h-10 gap-2.5 px-4 py-1.5' : 'gap-3 px-4 py-3 md:px-5'}`}
                    onClick={(event) => openAttachment(attachmentIndex, event.currentTarget)}
                  >
                    <span className={`flex min-w-0 flex-1 items-center ${compact ? 'gap-2.5' : 'gap-3'}`}>
                      <span className={`flex shrink-0 items-center justify-center overflow-hidden border border-kumo-line bg-kumo-overlay ${compact ? 'size-7 rounded-lg' : 'size-10 rounded-lg'}`}>
                        <img
                          src={attachment.imageUrls[0]}
                          alt=""
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      </span>
                      <span className="min-w-0">
                        <span className={`block truncate font-semibold text-kumo-strong ${compact ? 'text-xs' : 'text-sm'}`}>{attachment.title}</span>
                        <span className={`text-kumo-subtle ${compact ? 'hidden' : 'mt-1 block text-xs'}`}>
                          {attachment.imageUrls.length} 张图片 · 点击查看
                        </span>
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {compact ? (
                        <span className="text-[11px] tabular-nums text-kumo-subtle">{attachment.imageUrls.length} 张</span>
                      ) : (
                        <span className="hidden -space-x-2 sm:flex" aria-hidden="true">
                          {attachment.imageUrls.slice(0, 3).map((imageUrl, imageIndex) => (
                            <span key={`${imageUrl}-${imageIndex}`} className="size-8 overflow-hidden rounded-full border-2 border-kumo-base bg-kumo-overlay">
                              <img src={imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                            </span>
                          ))}
                        </span>
                      )}
                      <CaretRight size={compact ? 15 : 17} className="text-kumo-subtle transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </LayerCard.Primary>
      </LayerCard>

      {selectedAttachment ? (
        <PhotoSlider
          images={selectedAttachment.imageUrls.map((imageUrl, imageIndex) => ({
            src: imageUrl,
            key: `${selectedAttachment.title}-${imageIndex}`,
          }))}
          visible={viewerVisible}
          index={viewerIndex}
          onIndexChange={setViewerIndex}
          onClose={closeViewer}
          afterClose={handleViewerAfterClose}
          loop={false}
          maskClosable
          pullClosable
          bannerVisible
          maskOpacity={0.94}
          speed={(type) => (type === 3 ? 520 : 280)}
          easing={() => 'cubic-bezier(0.22, 1, 0.36, 1)'}
          className="markdown-photo-slider wiki-attachment-photo-slider"
          maskClassName="markdown-photo-slider-mask"
          photoWrapClassName="markdown-photo-slider-wrap"
          photoClassName="markdown-photo-slider-photo"
          loadingElement={(
            <span className="flex flex-col items-center gap-2 text-sm text-white">
              <ImageSquare size={28} className="animate-pulse" />
              图片加载中
            </span>
          )}
          brokenElement={(
            <span className="flex flex-col items-center gap-2 text-sm text-white">
              <ImageBroken size={30} />
              图片加载失败
            </span>
          )}
          overlayRender={({ index }) => (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
              <div className="max-w-[min(90vw,42rem)] rounded-full bg-black/55 px-4 py-2 text-center text-sm font-semibold text-white shadow-lg backdrop-blur-md">
                {selectedAttachment.title} · {index + 1} / {selectedAttachment.imageUrls.length}
              </div>
            </div>
          )}
        />
      ) : null}
    </>
  );
};

export default WikiAttachmentList;
