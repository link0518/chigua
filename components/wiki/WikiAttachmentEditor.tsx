import React from 'react';
import { Badge, Button, Input, LayerCard } from '@cloudflare/kumo';
import {
  CheckCircle,
  CircleNotch,
  ImageSquare,
  Plus,
  Trash,
  UploadSimple,
  WarningCircle,
  X,
} from '@phosphor-icons/react';

import {
  getImageUploadValidationError,
  IMAGE_UPLOAD_ACCEPT,
  isImageUploadFile,
} from '../imageUpload';
import {
  WIKI_ATTACHMENT_MAX_GROUPS,
  WIKI_ATTACHMENT_MAX_IMAGES_PER_GROUP,
  WIKI_ATTACHMENT_MAX_TOTAL_IMAGES,
  WIKI_ATTACHMENT_TITLE_MAX_LENGTH,
} from './wikiConstants';
import type { WikiAttachment } from './wikiTypes';

export type WikiAttachmentImageStatus = 'ready' | 'uploading' | 'uploaded' | 'error';

export interface WikiAttachmentImageDraft {
  clientId: string;
  file?: File;
  previewUrl: string;
  remoteUrl?: string;
  status: WikiAttachmentImageStatus;
  error?: string;
}

export interface WikiAttachmentDraft {
  clientId: string;
  title: string;
  images: WikiAttachmentImageDraft[];
}

export interface WikiAttachmentUploadProgress {
  completed: number;
  total: number;
}

let clientIdSeed = 0;

const createClientId = (prefix: string) => {
  clientIdSeed += 1;
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${clientIdSeed}`;
};

const revokeImagePreview = (image: WikiAttachmentImageDraft) => {
  // 远端 URL 不需要释放，只有本次选择生成的 blob URL 由表单负责回收。
  if (image.file && image.previewUrl.startsWith('blob:')) {
    URL.revokeObjectURL(image.previewUrl);
  }
};

export const revokeWikiAttachmentDraftUrls = (drafts: WikiAttachmentDraft[]) => {
  drafts.forEach((draft) => draft.images.forEach(revokeImagePreview));
};

export const createWikiAttachmentDrafts = (attachments?: WikiAttachment[] | null): WikiAttachmentDraft[] => (
  (Array.isArray(attachments) ? attachments : [])
    .slice(0, WIKI_ATTACHMENT_MAX_GROUPS)
    .map((attachment) => ({
      clientId: createClientId('attachment'),
      title: String(attachment?.title || ''),
      images: (Array.isArray(attachment?.imageUrls) ? attachment.imageUrls : [])
        .map((imageUrl) => String(imageUrl || '').trim())
        .filter(Boolean)
        .slice(0, WIKI_ATTACHMENT_MAX_IMAGES_PER_GROUP)
        .map((imageUrl) => ({
          clientId: createClientId('attachment-image'),
          previewUrl: imageUrl,
          remoteUrl: imageUrl,
          status: 'uploaded' as const,
        })),
    }))
);

export const getWikiAttachmentDraftValidationError = (drafts: WikiAttachmentDraft[]) => {
  if (drafts.length > WIKI_ATTACHMENT_MAX_GROUPS) {
    return `附件最多添加 ${WIKI_ATTACHMENT_MAX_GROUPS} 组`;
  }

  let totalImages = 0;
  const seenUrls = new Set<string>();
  for (let index = 0; index < drafts.length; index += 1) {
    const draft = drafts[index];
    const title = draft.title.trim();
    if (!title) {
      return `请填写附件 ${index + 1} 的标题`;
    }
    if (title.length > WIKI_ATTACHMENT_TITLE_MAX_LENGTH) {
      return `附件 ${index + 1} 的标题不能超过 ${WIKI_ATTACHMENT_TITLE_MAX_LENGTH} 个字符`;
    }
    if (draft.images.length === 0) {
      return `附件「${title}」至少需要 1 张图片`;
    }
    if (draft.images.length > WIKI_ATTACHMENT_MAX_IMAGES_PER_GROUP) {
      return `附件「${title}」最多添加 ${WIKI_ATTACHMENT_MAX_IMAGES_PER_GROUP} 张图片`;
    }

    totalImages += draft.images.length;
    for (const image of draft.images) {
      if (!image.file && !image.remoteUrl) {
        return `附件「${title}」中存在无法上传的图片，请移除后重试`;
      }
      if (image.remoteUrl) {
        if (seenUrls.has(image.remoteUrl)) {
          return '同一条瓜条中不能重复添加相同图片';
        }
        seenUrls.add(image.remoteUrl);
      }
    }
  }

  if (totalImages > WIKI_ATTACHMENT_MAX_TOTAL_IMAGES) {
    return `每条瓜条最多添加 ${WIKI_ATTACHMENT_MAX_TOTAL_IMAGES} 张图片`;
  }
  return '';
};

export const serializeWikiAttachmentDrafts = (drafts: WikiAttachmentDraft[]): WikiAttachment[] => (
  drafts.map((draft) => ({
    title: draft.title.trim(),
    imageUrls: draft.images.map((image) => String(image.remoteUrl || '').trim()).filter(Boolean),
  }))
);

interface WikiAttachmentEditorProps {
  drafts: WikiAttachmentDraft[];
  onChange: (drafts: WikiAttachmentDraft[]) => void;
  onError: (message: string) => void;
  disabled?: boolean;
  uploadProgress?: WikiAttachmentUploadProgress | null;
}

export const WikiAttachmentEditor: React.FC<WikiAttachmentEditorProps> = ({
  drafts,
  onChange,
  onError,
  disabled = false,
  uploadProgress = null,
}) => {
  const totalImages = drafts.reduce((total, draft) => total + draft.images.length, 0);

  const handleAddGroup = () => {
    if (disabled || drafts.length >= WIKI_ATTACHMENT_MAX_GROUPS) {
      return;
    }
    onError('');
    onChange([
      ...drafts,
      {
        clientId: createClientId('attachment'),
        title: '',
        images: [],
      },
    ]);
  };

  const handleRemoveGroup = (groupId: string) => {
    const removed = drafts.find((draft) => draft.clientId === groupId);
    if (removed) {
      removed.images.forEach(revokeImagePreview);
    }
    onChange(drafts.filter((draft) => draft.clientId !== groupId));
  };

  const handleRemoveImage = (groupId: string, imageId: string) => {
    const image = drafts
      .find((draft) => draft.clientId === groupId)
      ?.images.find((item) => item.clientId === imageId);
    if (image) {
      revokeImagePreview(image);
    }
    onChange(drafts.map((draft) => (
      draft.clientId === groupId
        ? { ...draft, images: draft.images.filter((item) => item.clientId !== imageId) }
        : draft
    )));
  };

  const handleFilesSelected = (groupId: string, selectedFiles: File[]) => {
    if (disabled || selectedFiles.length === 0) {
      return;
    }
    const group = drafts.find((draft) => draft.clientId === groupId);
    if (!group) {
      return;
    }

    const groupSlots = WIKI_ATTACHMENT_MAX_IMAGES_PER_GROUP - group.images.length;
    const totalSlots = WIKI_ATTACHMENT_MAX_TOTAL_IMAGES - totalImages;
    const availableSlots = Math.min(groupSlots, totalSlots);
    if (selectedFiles.length > availableSlots) {
      onError(availableSlots > 0
        ? `该附件本次最多还可添加 ${availableSlots} 张图片`
        : `每组最多 ${WIKI_ATTACHMENT_MAX_IMAGES_PER_GROUP} 张、每条瓜条最多 ${WIKI_ATTACHMENT_MAX_TOTAL_IMAGES} 张图片`);
      return;
    }

    for (const file of selectedFiles) {
      const validationError = getImageUploadValidationError(file);
      if (validationError) {
        onError(`${file.name || '所选图片'}：${validationError}`);
        return;
      }
    }

    const nextImages: WikiAttachmentImageDraft[] = [];
    try {
      selectedFiles.forEach((file) => {
        nextImages.push({
          clientId: createClientId('attachment-image'),
          file,
          previewUrl: URL.createObjectURL(file),
          status: 'ready',
        });
      });
    } catch {
      nextImages.forEach(revokeImagePreview);
      onError('图片预览创建失败，请重新选择');
      return;
    }

    onError('');
    onChange(drafts.map((draft) => (
      draft.clientId === groupId
        ? { ...draft, images: [...draft.images, ...nextImages] }
        : draft
    )));
  };

  const handlePasteImages = (event: React.ClipboardEvent<HTMLElement>, groupId: string) => {
    if (disabled) {
      return;
    }

    const pastedFiles = Array.from<DataTransferItem>(event.clipboardData.items).flatMap((item) => {
      if (item.kind !== 'file') {
        return [];
      }
      const file = item.getAsFile();
      if (!file || (!file.type.startsWith('image/') && !isImageUploadFile(file))) {
        return [];
      }
      return [file];
    });
    if (pastedFiles.length === 0) {
      return;
    }

    event.preventDefault();
    handleFilesSelected(groupId, pastedFiles);
  };

  return (
    <LayerCard className="wiki-surface-soft overflow-hidden p-0 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-kumo-line px-4 py-4 md:px-5">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-kumo-strong">
            <ImageSquare size={19} weight="duotone" />
            图片附件（选填）
          </div>
          <p className="mt-1 text-xs leading-5 text-kumo-subtle">
            每组设置一个标题，可放 1 至 {WIKI_ATTACHMENT_MAX_IMAGES_PER_GROUP} 张图片。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{drafts.length} / {WIKI_ATTACHMENT_MAX_GROUPS} 组</Badge>
          <Badge variant="secondary">{totalImages} / {WIKI_ATTACHMENT_MAX_TOTAL_IMAGES} 张</Badge>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="wiki-motion-button"
            disabled={disabled || drafts.length >= WIKI_ATTACHMENT_MAX_GROUPS}
            onClick={handleAddGroup}
            icon={<Plus size={15} />}
          >
            新增附件
          </Button>
        </div>
      </div>

      {uploadProgress && uploadProgress.total > 0 ? (
        <div className="flex items-center gap-2 border-b border-kumo-line bg-kumo-tint px-4 py-3 text-sm text-kumo-default md:px-5">
          <CircleNotch size={17} className="animate-spin text-kumo-brand" />
          正在上传图片 {uploadProgress.completed} / {uploadProgress.total}
        </div>
      ) : null}

      {drafts.length === 0 ? (
        <div className="flex flex-col items-center px-5 py-8 text-center">
          <span className="flex size-11 items-center justify-center rounded-xl bg-kumo-tint text-kumo-brand">
            <ImageSquare size={23} weight="duotone" />
          </span>
          <p className="mt-3 text-sm font-semibold text-kumo-strong">暂无附件</p>
          <p className="mt-1 max-w-sm text-xs leading-5 text-kumo-subtle">需要补充截图、聊天记录或其他图片资料时，再新增附件组。</p>
        </div>
      ) : (
        <div className="space-y-4 p-4 md:p-5">
          {drafts.map((draft, groupIndex) => {
            const canAddImages = draft.images.length < WIKI_ATTACHMENT_MAX_IMAGES_PER_GROUP
              && totalImages < WIKI_ATTACHMENT_MAX_TOTAL_IMAGES;
            return (
              <section
                key={draft.clientId}
                tabIndex={disabled ? -1 : 0}
                aria-label={`附件 ${groupIndex + 1}，可粘贴图片`}
                onPaste={(event) => handlePasteImages(event, draft.clientId)}
                className="wiki-focus-ring rounded-xl border border-kumo-line bg-kumo-base p-4 shadow-sm"
              >
                <div className="flex items-start gap-3">
                  <span className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-lg bg-kumo-tint text-xs font-semibold tabular-nums text-kumo-brand">
                    {String(groupIndex + 1).padStart(2, '0')}
                  </span>
                  <div className="min-w-0 flex-1">
                    <Input
                      label="附件标题"
                      value={draft.title}
                      onChange={(event) => {
                        onError('');
                        onChange(drafts.map((item) => (
                          item.clientId === draft.clientId
                            ? { ...item, title: event.currentTarget.value }
                            : item
                        )));
                      }}
                      placeholder="例如：聊天记录截图"
                      maxLength={WIKI_ATTACHMENT_TITLE_MAX_LENGTH}
                      className="w-full"
                      disabled={disabled}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    shape="square"
                    size="sm"
                    className="wiki-motion-button mt-5 shrink-0 text-kumo-subtle hover:text-kumo-danger"
                    aria-label={`删除附件 ${groupIndex + 1}`}
                    disabled={disabled}
                    onClick={() => handleRemoveGroup(draft.clientId)}
                    icon={<Trash size={16} />}
                  />
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {draft.images.map((image, imageIndex) => (
                    <figure key={image.clientId} className="group relative aspect-square overflow-hidden rounded-xl border border-kumo-line bg-kumo-overlay">
                      <img
                        src={image.previewUrl}
                        alt={`${draft.title || `附件 ${groupIndex + 1}`}图片 ${imageIndex + 1}`}
                        className="h-full w-full object-cover"
                      />
                      <button
                        type="button"
                        className="wiki-focus-ring absolute right-2 top-2 flex size-7 items-center justify-center rounded-full bg-kumo-scrim/70 text-white shadow-sm backdrop-blur transition-transform hover:scale-105 disabled:opacity-50"
                        aria-label={`移除第 ${imageIndex + 1} 张图片`}
                        disabled={disabled || image.status === 'uploading'}
                        onClick={() => handleRemoveImage(draft.clientId, image.clientId)}
                      >
                        <X size={14} weight="bold" />
                      </button>

                      {image.status === 'uploading' ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-kumo-scrim/65 text-xs font-semibold text-white backdrop-blur-[1px]">
                          <CircleNotch size={22} className="animate-spin" />
                          上传中
                        </div>
                      ) : (
                        <figcaption className="absolute inset-x-2 bottom-2 flex justify-start">
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold shadow-sm backdrop-blur ${image.status === 'error' ? 'bg-kumo-danger text-white' : image.status === 'uploaded' ? 'bg-kumo-success text-white' : 'bg-kumo-scrim/70 text-white'}`}>
                            {image.status === 'error' ? <WarningCircle size={13} /> : image.status === 'uploaded' ? <CheckCircle size={13} /> : <UploadSimple size={13} />}
                            {image.status === 'error' ? '上传失败' : image.status === 'uploaded' ? '已上传' : '待上传'}
                          </span>
                        </figcaption>
                      )}
                    </figure>
                  ))}

                  {canAddImages ? (
                    <label className={`wiki-motion-button wiki-focus-ring flex aspect-square cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-kumo-line bg-kumo-overlay text-center focus-within:border-kumo-brand focus-within:ring-2 focus-within:ring-kumo-focus focus-within:ring-offset-2 focus-within:ring-offset-kumo-base ${disabled ? 'pointer-events-none opacity-50' : 'hover:border-kumo-brand hover:bg-kumo-tint'}`}>
                      <input
                        type="file"
                        accept={IMAGE_UPLOAD_ACCEPT}
                        multiple
                        className="sr-only"
                        disabled={disabled}
                        onChange={(event) => {
                          handleFilesSelected(draft.clientId, Array.from(event.currentTarget.files || []));
                          event.currentTarget.value = '';
                        }}
                      />
                      <UploadSimple size={22} className="text-kumo-brand" />
                      <span className="mt-2 text-xs font-semibold text-kumo-strong">上传图片</span>
                      <span className="mt-1 px-2 text-[11px] leading-4 text-kumo-subtle">选择文件或 Ctrl+V 粘贴</span>
                    </label>
                  ) : null}
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-kumo-subtle">
                  <span>JPEG / PNG / GIF / WebP，单图不超过 5MB</span>
                  <span className="tabular-nums">{draft.images.length} / {WIKI_ATTACHMENT_MAX_IMAGES_PER_GROUP} 张</span>
                </div>

                {draft.images.some((image) => image.status === 'error') ? (
                  <ul className="mt-3 space-y-1 rounded-lg bg-kumo-danger-tint/60 px-3 py-2 text-xs text-kumo-danger">
                    {draft.images.filter((image) => image.status === 'error').map((image) => (
                      <li key={image.clientId}>{image.error || '图片上传失败，请再次提交重试。'}</li>
                    ))}
                  </ul>
                ) : null}
              </section>
            );
          })}
        </div>
      )}
    </LayerCard>
  );
};

export default WikiAttachmentEditor;
