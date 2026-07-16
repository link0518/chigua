import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle,
  ExternalLink,
  ImagePlus,
  Link2,
  Paperclip,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import { PhotoSlider } from 'react-photo-view';

import { api } from '../api';
import type { Toast } from '../store/AppContext';
import type { WikiAttachment, WikiEntry, WikiRelatedPost, WikiRevision } from '../types';
import MarkdownRenderer from './MarkdownRenderer';
import { Badge, SketchButton } from './SketchUI';
import {
  getImageUploadValidationError,
  IMAGE_UPLOAD_ACCEPT,
  isImageUploadFile,
  uploadImageFile,
} from './imageUpload';
import WikiMarkdownComposer from './WikiMarkdownComposer';
import { getWikiMarkdownExcerpt } from './wiki/wikiMarkdownPlainText';

type RevisionStatus = 'pending' | 'approved' | 'rejected';
type RevisionActionType = 'all' | 'create' | 'edit';
type EntryStatus = 'active' | 'deleted' | 'all';

interface AdminWikiPanelProps {
  showToast: (message: string, type?: Toast['type']) => void;
  onPendingCountChange?: () => void;
  canManage?: boolean;
}

const WIKI_PAGE_SIZE = 12;
const WIKI_NARRATIVE_MAX_LENGTH = 8000;
const WIKI_MAX_RELATED_POSTS = 5;
const WIKI_MAX_ATTACHMENTS = 5;
const WIKI_MAX_IMAGES_PER_ATTACHMENT = 3;
const WIKI_MAX_TOTAL_IMAGES = 10;
const WIKI_ATTACHMENT_TITLE_MAX_LENGTH = 60;
const WIKI_RELATED_POST_ID_MAX_LENGTH = 128;

type AdminWikiEntry = WikiEntry & { relatedPosts?: WikiRelatedPost[] };
type AdminWikiRevision = WikiRevision & { relatedPosts?: WikiRelatedPost[] };

interface AdminAttachmentImageDraft {
  clientId: string;
  previewUrl: string;
  remoteUrl?: string;
  file?: File;
  status: 'ready' | 'uploading' | 'uploaded' | 'error';
  error?: string;
}

interface AdminAttachmentDraft {
  clientId: string;
  title: string;
  images: AdminAttachmentImageDraft[];
}

interface AttachmentViewerState {
  title: string;
  imageUrls: string[];
  index: number;
}

let wikiAttachmentDraftSequence = 0;

const createDraftId = (prefix: string) => {
  wikiAttachmentDraftSequence += 1;
  return `${prefix}-${Date.now()}-${wikiAttachmentDraftSequence}`;
};

const createAttachmentDrafts = (attachments?: WikiAttachment[]): AdminAttachmentDraft[] => (
  Array.isArray(attachments) ? attachments : []
).map((attachment) => ({
  clientId: createDraftId('attachment'),
  title: String(attachment?.title || ''),
  images: (Array.isArray(attachment?.imageUrls) ? attachment.imageUrls : []).map((url) => ({
    clientId: createDraftId('image'),
    previewUrl: String(url || ''),
    remoteUrl: String(url || ''),
    status: 'uploaded',
  })),
}));

const getAttachmentImageCount = (attachments: AdminAttachmentDraft[]) => attachments.reduce(
  (total, attachment) => total + attachment.images.length,
  0
);

const parseRelatedPostId = (value: string) => {
  const input = String(value || '').trim();
  if (!input) {
    return '';
  }

  const pathMatch = input.match(/(?:^|\/)post\/([^/?#]+)/i);
  if (pathMatch?.[1]) {
    try {
      return decodeURIComponent(pathMatch[1]).trim();
    } catch {
      return pathMatch[1].trim();
    }
  }
  return input;
};

const normalizeRelatedPostRows = (
  relatedPostIds?: string[],
  relatedPosts?: WikiRelatedPost[]
): Array<WikiRelatedPost & { available?: boolean }> => {
  const metadata = new Map(
    (Array.isArray(relatedPosts) ? relatedPosts : []).map((post) => [String(post.id), post])
  );
  return (Array.isArray(relatedPostIds) ? relatedPostIds : []).map((id) => {
    const postId = String(id || '').trim();
    return metadata.get(postId) || { id: postId, available: undefined };
  }).filter((post) => post.id);
};

const WikiRelatedPostsDisplay: React.FC<{
  relatedPostIds?: string[];
  relatedPosts?: WikiRelatedPost[];
}> = ({ relatedPostIds, relatedPosts }) => {
  const rows = normalizeRelatedPostRows(relatedPostIds, relatedPosts);
  if (rows.length === 0) {
    return null;
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50/70 p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-bold text-ink">
        <Link2 className="h-4 w-4" /> 相关帖子（{rows.length}）
      </div>
      <div className="space-y-2">
        {rows.map((post) => (
          <div key={post.id} className="flex flex-wrap items-start justify-between gap-2 rounded-md bg-white px-3 py-2 text-xs">
            <div className="min-w-0 flex-1">
              <div className="break-all font-mono text-ink">{post.id}</div>
              {post.excerpt && <p className="mt-1 line-clamp-2 break-words text-pencil">{post.excerpt}</p>}
            </div>
            {post.available === false ? (
              <span className="shrink-0 rounded-full bg-alert px-2 py-0.5 font-bold text-ink">不可用</span>
            ) : (
              <a
                href={`/post/${encodeURIComponent(post.id)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-0.5 font-bold text-blue-700 hover:border-ink"
              >
                {post.available === true ? '打开帖子' : '尝试打开'} <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

const WikiAttachmentsDisplay: React.FC<{
  attachments?: WikiAttachment[];
  onOpen: (viewer: AttachmentViewerState) => void;
}> = ({ attachments, onOpen }) => {
  const groups = Array.isArray(attachments) ? attachments.filter((item) => item?.imageUrls?.length) : [];
  if (groups.length === 0) {
    return null;
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50/70 p-3">
      <div className="mb-3 flex items-center gap-2 text-xs font-bold text-ink">
        <Paperclip className="h-4 w-4" /> 附件（{groups.length} 组，共 {groups.reduce((total, item) => total + item.imageUrls.length, 0)} 张）
      </div>
      <div className="space-y-3">
        {groups.map((attachment, groupIndex) => (
          <div key={`${attachment.title}-${groupIndex}`} className="rounded-md bg-white p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="min-w-0 break-words text-sm font-bold text-ink">{attachment.title}</span>
              <span className="shrink-0 text-xs text-pencil">{attachment.imageUrls.length} 张</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {attachment.imageUrls.map((url, imageIndex) => (
                <button
                  key={`${url}-${imageIndex}`}
                  type="button"
                  onClick={() => onOpen({ title: attachment.title, imageUrls: attachment.imageUrls, index: imageIndex })}
                  className="group relative h-20 w-20 overflow-hidden rounded-md border-2 border-gray-200 bg-gray-100 hover:border-ink focus:outline-none focus:ring-2 focus:ring-highlight"
                  aria-label={`查看附件“${attachment.title}”第 ${imageIndex + 1} 张图片`}
                >
                  <img src={url} alt="" className="h-full w-full object-cover transition-transform group-hover:scale-105" loading="lazy" />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const AttachmentPhotoViewer: React.FC<{
  viewer: AttachmentViewerState | null;
  onChange: (viewer: AttachmentViewerState | null) => void;
}> = ({ viewer, onChange }) => {
  if (!viewer || viewer.imageUrls.length === 0) {
    return null;
  }

  return (
    <PhotoSlider
      images={viewer.imageUrls.map((src, index) => ({ src, key: `${index}-${src}` }))}
      visible
      index={viewer.index}
      onIndexChange={(index) => onChange({ ...viewer, index })}
      onClose={() => onChange(null)}
      loop={false}
      maskClosable
      pullClosable
      bannerVisible
      maskOpacity={0.94}
      overlayRender={({ index }) => (
        <div className="pointer-events-none absolute left-4 top-4 max-w-[calc(100%-7rem)] rounded-full bg-black/65 px-3 py-1.5 text-sm font-bold text-white">
          <span className="break-words">{viewer.title}</span>
          <span className="ml-2 text-white/75">{index + 1} / {viewer.imageUrls.length}</span>
        </div>
      )}
      className="markdown-photo-slider"
      maskClassName="markdown-photo-slider-mask"
      photoWrapClassName="markdown-photo-slider-wrap"
      photoClassName="markdown-photo-slider-photo"
    />
  );
};

const formatTime = (value?: number | null) => {
  if (!value) {
    return '-';
  }
  return new Date(value).toLocaleString('zh-CN');
};

const parseTagsInput = (value: string) => String(value || '')
  .split(/[\r\n,，、;；|]+/g)
  .map((item) => item.trim().replace(/^#+/, '').replace(/\s+/g, ' '))
  .filter(Boolean)
  .slice(0, 6);

const formatTagsInput = (tags: string[]) => (Array.isArray(tags) ? tags : []).join('\n');

const WikiEntryEditor: React.FC<{
  open: boolean;
  entry?: WikiEntry | null;
  revision?: WikiRevision | null;
  onClose: () => void;
  onSaved: () => void;
  showToast: AdminWikiPanelProps['showToast'];
  canManage: boolean;
}> = ({ open, entry, revision, onClose, onSaved, showToast, canManage }) => {
  const [name, setName] = useState('');
  const [narrative, setNarrative] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [relatedPostIds, setRelatedPostIds] = useState<string[]>([]);
  const [relatedPostInput, setRelatedPostInput] = useState('');
  const [attachmentDrafts, setAttachmentDrafts] = useState<AdminAttachmentDraft[]>([]);
  const [uploadProgress, setUploadProgress] = useState<{ completed: number; total: number } | null>(null);
  const [attachmentViewer, setAttachmentViewer] = useState<AttachmentViewerState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const objectUrlsRef = useRef<Set<string>>(new Set());
  const initialAttachmentUrlsRef = useRef<Set<string>>(new Set());

  const releaseObjectUrl = useCallback((url: string) => {
    if (!objectUrlsRef.current.has(url)) {
      return;
    }
    URL.revokeObjectURL(url);
    objectUrlsRef.current.delete(url);
  }, []);

  const releaseAllObjectUrls = useCallback(() => {
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current.clear();
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    const source = revision?.data || entry;
    releaseAllObjectUrls();
    setName(source?.name || '');
    setNarrative(source?.narrative || '');
    setTagsInput(formatTagsInput(source?.tags || []));
    setRelatedPostIds(Array.isArray(source?.relatedPostIds) ? source.relatedPostIds : []);
    setRelatedPostInput('');
    const nextAttachmentDrafts = createAttachmentDrafts(source?.attachments);
    setAttachmentDrafts(nextAttachmentDrafts);
    initialAttachmentUrlsRef.current = new Set(
      nextAttachmentDrafts.flatMap((attachment) => (
        attachment.images.map((image) => image.remoteUrl).filter((url): url is string => Boolean(url))
      ))
    );
    setUploadProgress(null);
    setAttachmentViewer(null);
    setSubmitting(false);
  }, [entry, open, releaseAllObjectUrls, revision]);

  useEffect(() => () => releaseAllObjectUrls(), [releaseAllObjectUrls]);

  if (!open) {
    return null;
  }

  const totalAttachmentImages = getAttachmentImageCount(attachmentDrafts);

  const handleClose = () => {
    if (submitting) {
      return;
    }
    const hasUnsubmittedImages = attachmentDrafts.some((attachment) => (
      attachment.images.some((image) => (
        Boolean(image.file)
        || Boolean(image.remoteUrl && !initialAttachmentUrlsRef.current.has(image.remoteUrl))
      ))
    ));
    if (hasUnsubmittedImages && !window.confirm('有尚未保存的附件图片，关闭后将不会写入瓜条，仍要关闭吗？')) {
      return;
    }
    releaseAllObjectUrls();
    setAttachmentViewer(null);
    onClose();
  };

  const handleAddRelatedPost = () => {
    const postId = parseRelatedPostId(relatedPostInput);
    if (!postId) {
      showToast('请输入帖子链接或帖子 ID', 'warning');
      return;
    }
    if (postId.length > WIKI_RELATED_POST_ID_MAX_LENGTH) {
      showToast('帖子 ID 过长，请检查输入内容', 'warning');
      return;
    }
    if (relatedPostIds.includes(postId)) {
      showToast('该帖子已关联', 'warning');
      return;
    }
    if (relatedPostIds.length >= WIKI_MAX_RELATED_POSTS) {
      showToast(`每条瓜条最多关联 ${WIKI_MAX_RELATED_POSTS} 个帖子`, 'warning');
      return;
    }
    setRelatedPostIds((current) => [...current, postId]);
    setRelatedPostInput('');
  };

  const handleAddAttachment = () => {
    if (attachmentDrafts.length >= WIKI_MAX_ATTACHMENTS) {
      showToast(`每条瓜条最多添加 ${WIKI_MAX_ATTACHMENTS} 个附件标题`, 'warning');
      return;
    }
    setAttachmentDrafts((current) => [
      ...current,
      { clientId: createDraftId('attachment'), title: '', images: [] },
    ]);
  };

  const handleRemoveAttachment = (attachmentId: string) => {
    const target = attachmentDrafts.find((attachment) => attachment.clientId === attachmentId);
    target?.images.forEach((image) => releaseObjectUrl(image.previewUrl));
    setAttachmentDrafts((current) => current.filter((attachment) => attachment.clientId !== attachmentId));
  };

  const handleRemoveAttachmentImage = (attachmentId: string, imageId: string) => {
    const target = attachmentDrafts.find((attachment) => attachment.clientId === attachmentId);
    const image = target?.images.find((item) => item.clientId === imageId);
    if (image) {
      releaseObjectUrl(image.previewUrl);
    }
    setAttachmentDrafts((current) => current.map((attachment) => (
      attachment.clientId === attachmentId
        ? { ...attachment, images: attachment.images.filter((item) => item.clientId !== imageId) }
        : attachment
    )));
  };

  const handleSelectAttachmentImages = (attachmentId: string, files: File[]) => {
    const target = attachmentDrafts.find((attachment) => attachment.clientId === attachmentId);
    if (!target || files.length === 0) {
      return;
    }

    const validFiles: File[] = [];
    let invalidTypeCount = 0;
    let oversizedCount = 0;
    files.forEach((file) => {
      if (!isImageUploadFile(file)) {
        invalidTypeCount += 1;
        return;
      }
      if (getImageUploadValidationError(file)) {
        oversizedCount += 1;
        return;
      }
      validFiles.push(file);
    });

    const groupCapacity = WIKI_MAX_IMAGES_PER_ATTACHMENT - target.images.length;
    const totalCapacity = WIKI_MAX_TOTAL_IMAGES - totalAttachmentImages;
    const capacity = Math.max(0, Math.min(groupCapacity, totalCapacity));
    const selectedFiles = validFiles.slice(0, capacity);

    if (invalidTypeCount > 0) {
      showToast(`有 ${invalidTypeCount} 张图片格式不支持，仅允许 JPEG、PNG、GIF、WebP`, 'warning');
    } else if (oversizedCount > 0) {
      showToast(`有 ${oversizedCount} 张图片超过 5MB`, 'warning');
    } else if (validFiles.length > capacity) {
      showToast('已达到当前附件或瓜条的图片数量上限', 'warning');
    }

    if (selectedFiles.length === 0) {
      return;
    }

    const newImages = selectedFiles.map((file) => {
      const previewUrl = URL.createObjectURL(file);
      objectUrlsRef.current.add(previewUrl);
      return {
        clientId: createDraftId('image'),
        previewUrl,
        file,
        status: 'ready' as const,
      };
    });

    setAttachmentDrafts((current) => current.map((attachment) => (
      attachment.clientId === attachmentId
        ? { ...attachment, images: [...attachment.images, ...newImages] }
        : attachment
    )));
  };

  const handlePasteAttachmentImages = (
    event: React.ClipboardEvent<HTMLDivElement>,
    attachmentId: string
  ) => {
    if (!canManage || submitting) {
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
    handleSelectAttachmentImages(attachmentId, pastedFiles);
  };

  const validateAttachments = () => {
    if (attachmentDrafts.length > WIKI_MAX_ATTACHMENTS) {
      return `每条瓜条最多添加 ${WIKI_MAX_ATTACHMENTS} 个附件标题`;
    }
    if (totalAttachmentImages > WIKI_MAX_TOTAL_IMAGES) {
      return `每条瓜条最多上传 ${WIKI_MAX_TOTAL_IMAGES} 张图片`;
    }
    for (let index = 0; index < attachmentDrafts.length; index += 1) {
      const attachment = attachmentDrafts[index];
      if (!attachment.title.trim()) {
        return `请填写附件 ${index + 1} 的标题`;
      }
      if (attachment.title.trim().length > WIKI_ATTACHMENT_TITLE_MAX_LENGTH) {
        return `附件 ${index + 1} 的标题不能超过 ${WIKI_ATTACHMENT_TITLE_MAX_LENGTH} 个字符`;
      }
      if (attachment.images.length === 0) {
        return `附件“${attachment.title.trim()}”至少需要一张图片`;
      }
      if (attachment.images.length > WIKI_MAX_IMAGES_PER_ATTACHMENT) {
        return `附件“${attachment.title.trim()}”最多包含 ${WIKI_MAX_IMAGES_PER_ATTACHMENT} 张图片`;
      }
    }
    return '';
  };

  const uploadPendingAttachmentImages = async () => {
    const nextDrafts = attachmentDrafts.map((attachment) => ({
      ...attachment,
      images: attachment.images.map((image) => ({ ...image })),
    }));
    const pendingTotal = nextDrafts.reduce(
      (total, attachment) => total + attachment.images.filter((image) => !image.remoteUrl).length,
      0
    );
    let completed = 0;

    const syncDrafts = () => {
      setAttachmentDrafts(nextDrafts.map((attachment) => ({
        ...attachment,
        images: attachment.images.map((image) => ({ ...image })),
      })));
    };

    if (pendingTotal > 0) {
      setUploadProgress({ completed: 0, total: pendingTotal });
    }

    for (const attachment of nextDrafts) {
      for (const image of attachment.images) {
        if (image.remoteUrl) {
          continue;
        }
        if (!image.file) {
          image.status = 'error';
          image.error = '图片文件已失效，请删除后重新选择';
          syncDrafts();
          throw new Error(image.error);
        }

        image.status = 'uploading';
        image.error = undefined;
        syncDrafts();
        try {
          const result = await uploadImageFile(image.file, { usage: 'wiki' });
          const remoteUrl = String(result?.url || result?.src || '').trim();
          if (!remoteUrl) {
            throw new Error('图片上传成功但未返回地址');
          }
          const localPreviewUrl = image.previewUrl;
          image.remoteUrl = remoteUrl;
          image.previewUrl = remoteUrl;
          image.file = undefined;
          image.status = 'uploaded';
          image.error = undefined;
          completed += 1;
          setUploadProgress({ completed, total: pendingTotal });
          syncDrafts();
          releaseObjectUrl(localPreviewUrl);
        } catch (error) {
          image.status = 'error';
          image.error = error instanceof Error ? error.message : '图片上传失败';
          syncDrafts();
          throw error;
        }
      }
    }

    return nextDrafts.map((attachment) => ({
      title: attachment.title.trim(),
      imageUrls: attachment.images.map((image) => String(image.remoteUrl || '').trim()),
    }));
  };

  const validateRelatedPostsBeforeSave = async () => {
    for (const postId of relatedPostIds) {
      const result = await api.getPostById(postId) as { post?: { id?: string } };
      if (String(result?.post?.id || '') !== postId) {
        throw new Error(`相关帖子不存在或已不可用：${postId}`);
      }
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManage) {
      showToast('当前账号只有查看权限，不能保存瓜条', 'warning');
      return;
    }
    const normalizedName = name.trim();
    const normalizedNarrative = narrative.trim();
    if (!normalizedName || !normalizedNarrative) {
      showToast('请填写名字和记录叙述', 'warning');
      return;
    }
    if (normalizedNarrative.length > WIKI_NARRATIVE_MAX_LENGTH) {
      showToast(`记录叙述不能超过 ${WIKI_NARRATIVE_MAX_LENGTH} 个字符`, 'warning');
      return;
    }
    const attachmentError = validateAttachments();
    if (attachmentError) {
      showToast(attachmentError, 'warning');
      return;
    }
    setSubmitting(true);
    try {
      // 先确认关联帖子仍公开可用，再上传图片，减少校验失败产生孤儿图片的概率。
      await validateRelatedPostsBeforeSave();
      const attachments = await uploadPendingAttachmentImages();
      const payload = {
        name: normalizedName,
        narrative: normalizedNarrative,
        tags: parseTagsInput(tagsInput),
        relatedPostIds,
        attachments,
        editSummary: revision ? revision.editSummary : entry ? '管理员直接编辑' : '管理员创建',
      };
      if (revision) {
        await api.updateAdminWikiRevision(revision.id, payload);
      } else if (entry) {
        await api.updateAdminWikiEntry(entry.id, payload);
      } else {
        await api.createAdminWikiEntry(payload);
      }
      showToast(revision ? '待审核稿件已更新' : entry ? '瓜条已更新' : '瓜条已创建', 'success');
      onSaved();
      releaseAllObjectUrls();
      onClose();
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存失败', 'error');
    } finally {
      setUploadProgress(null);
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="关闭编辑窗口" onClick={handleClose} disabled={submitting} />
      <form onSubmit={handleSubmit} className="relative z-10 max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-lg border-2 border-ink bg-white p-6 shadow-sketch-lg">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h3 className="font-display text-2xl text-ink">{revision ? '编辑待审核稿件' : entry ? '编辑瓜条' : '新建瓜条'}</h3>
          <button type="button" onClick={handleClose} disabled={submitting} className="rounded-full p-2 text-pencil hover:bg-gray-100 hover:text-ink" aria-label="关闭编辑窗口">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="grid gap-4">
          <label className="space-y-1">
            <span className="text-sm font-bold text-ink">名字</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-lg border-2 border-gray-200 px-3 py-2 font-sans text-sm outline-none focus:border-ink"
            />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-bold text-ink">标签（一行或逗号分隔）</span>
            <textarea
              value={tagsInput}
              onChange={(event) => setTagsInput(event.target.value)}
              rows={3}
              className="w-full resize-none rounded-lg border-2 border-gray-200 px-3 py-2 font-sans text-sm outline-none focus:border-ink"
            />
          </label>
          <div className="space-y-1">
            <span className="text-sm font-bold text-ink">记录叙述</span>
            <WikiMarkdownComposer
              value={narrative}
              onChange={setNarrative}
              placeholder="请输入记录叙述，支持 Markdown。"
              maxLength={WIKI_NARRATIVE_MAX_LENGTH}
              minHeight="240px"
              ariaLabel={revision ? '后台编辑待审核瓜条 Markdown 编辑器' : entry ? '后台编辑瓜条 Markdown 编辑器' : '后台新建瓜条 Markdown 编辑器'}
              toolbarLabel="记录叙述"
              emptyPreviewText="预览区为空，请先填写记录叙述。"
              renderClassName="font-sans text-sm leading-relaxed text-ink [&_p]:mb-4 [&_blockquote]:my-4 [&_ol]:my-4 [&_ul]:my-4 [&_pre]:my-4"
              readOnly={!canManage}
              theme="admin"
            />
          </div>

          <section className="rounded-lg border-2 border-gray-200 bg-gray-50/70 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="flex items-center gap-2 text-sm font-bold text-ink"><Link2 className="h-4 w-4" /> 相关帖子</h4>
                <p className="mt-1 text-xs text-pencil">可粘贴帖子链接或帖子 ID，最多 {WIKI_MAX_RELATED_POSTS} 个；保存时由服务端再次校验。</p>
              </div>
              <span className="text-xs font-bold text-pencil">{relatedPostIds.length} / {WIKI_MAX_RELATED_POSTS}</span>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={relatedPostInput}
                onChange={(event) => setRelatedPostInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    handleAddRelatedPost();
                  }
                }}
                placeholder="https://example.com/post/... 或帖子 ID"
                disabled={!canManage || submitting || relatedPostIds.length >= WIKI_MAX_RELATED_POSTS}
                className="min-w-0 flex-1 rounded-lg border-2 border-gray-200 bg-white px-3 py-2 font-sans text-sm outline-none focus:border-ink disabled:bg-gray-100"
              />
              <SketchButton
                type="button"
                variant="secondary"
                className="h-10 px-4 text-sm"
                onClick={handleAddRelatedPost}
                disabled={!canManage || submitting || relatedPostIds.length >= WIKI_MAX_RELATED_POSTS}
              >
                <Plus className="mr-1 inline h-4 w-4" /> 添加
              </SketchButton>
            </div>
            {relatedPostIds.length > 0 && (
              <div className="mt-3 space-y-2">
                {relatedPostIds.map((postId, index) => (
                  <div key={postId} className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2">
                    <span className="shrink-0 text-xs font-bold text-pencil">{index + 1}</span>
                    <a href={`/post/${encodeURIComponent(postId)}`} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 break-all font-mono text-xs text-blue-700 hover:underline">
                      {postId}
                    </a>
                    <button
                      type="button"
                      onClick={() => setRelatedPostIds((current) => current.filter((id) => id !== postId))}
                      disabled={!canManage || submitting}
                      className="shrink-0 rounded-full p-1 text-pencil hover:bg-alert hover:text-ink disabled:opacity-50"
                      aria-label={`移除相关帖子 ${postId}`}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-lg border-2 border-gray-200 bg-gray-50/70 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="flex items-center gap-2 text-sm font-bold text-ink"><Paperclip className="h-4 w-4" /> 图片附件</h4>
                <p className="mt-1 text-xs text-pencil">最多 {WIKI_MAX_ATTACHMENTS} 组、每组 {WIKI_MAX_IMAGES_PER_ATTACHMENT} 张、总计 {WIKI_MAX_TOTAL_IMAGES} 张；单图不超过 5MB。</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold text-pencil">{attachmentDrafts.length} 组 · {totalAttachmentImages} 张</span>
                <SketchButton
                  type="button"
                  variant="secondary"
                  className="h-9 px-3 text-xs"
                  onClick={handleAddAttachment}
                  disabled={!canManage || submitting || attachmentDrafts.length >= WIKI_MAX_ATTACHMENTS}
                >
                  <Plus className="mr-1 inline h-4 w-4" /> 新增附件
                </SketchButton>
              </div>
            </div>

            {attachmentDrafts.length === 0 ? (
              <div className="rounded-lg border-2 border-dashed border-gray-200 bg-white px-4 py-8 text-center text-sm text-pencil">暂未添加附件</div>
            ) : (
              <div className="space-y-3">
                {attachmentDrafts.map((attachment, attachmentIndex) => (
                  <div
                    key={attachment.clientId}
                    tabIndex={canManage && !submitting ? 0 : -1}
                    aria-label={`附件 ${attachmentIndex + 1}，可粘贴图片`}
                    onPaste={(event) => handlePasteAttachmentImages(event, attachment.clientId)}
                    className="rounded-lg border-2 border-gray-200 bg-white p-4 outline-none focus:border-ink"
                  >
                    <div className="mb-3 flex items-start gap-3">
                      <label className="min-w-0 flex-1 space-y-1">
                        <span className="text-xs font-bold text-ink">附件 {attachmentIndex + 1} 标题</span>
                        <input
                          value={attachment.title}
                          onChange={(event) => setAttachmentDrafts((current) => current.map((item) => (
                            item.clientId === attachment.clientId ? { ...item, title: event.target.value } : item
                          )))}
                          maxLength={WIKI_ATTACHMENT_TITLE_MAX_LENGTH}
                          placeholder="例如：聊天记录截图"
                          disabled={!canManage || submitting}
                          className="w-full rounded-lg border-2 border-gray-200 px-3 py-2 font-sans text-sm outline-none focus:border-ink disabled:bg-gray-100"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => handleRemoveAttachment(attachment.clientId)}
                        disabled={!canManage || submitting}
                        className="mt-5 rounded-full p-2 text-pencil hover:bg-alert hover:text-ink disabled:opacity-50"
                        aria-label={`删除附件 ${attachmentIndex + 1}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      {attachment.images.map((image, imageIndex) => (
                        <div key={image.clientId} className="w-24">
                          <div className="group relative h-24 w-24 overflow-hidden rounded-md border-2 border-gray-200 bg-gray-100">
                            <button
                              type="button"
                              onClick={() => setAttachmentViewer({
                                title: attachment.title.trim() || `附件 ${attachmentIndex + 1}`,
                                imageUrls: attachment.images.map((item) => item.previewUrl),
                                index: imageIndex,
                              })}
                              className="h-full w-full"
                              aria-label={`查看附件 ${attachmentIndex + 1} 第 ${imageIndex + 1} 张图片`}
                            >
                              <img src={image.previewUrl} alt="" className="h-full w-full object-cover" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveAttachmentImage(attachment.clientId, image.clientId)}
                              disabled={!canManage || submitting || image.status === 'uploading'}
                              className="absolute right-1 top-1 rounded-full bg-black/65 p-1 text-white opacity-100 hover:bg-red-600 disabled:opacity-40 sm:opacity-0 sm:group-hover:opacity-100"
                              aria-label={`删除第 ${imageIndex + 1} 张图片`}
                            >
                              <X className="h-3 w-3" />
                            </button>
                            {image.status === 'uploading' && <div className="absolute inset-0 flex items-center justify-center bg-black/55 text-xs font-bold text-white">上传中</div>}
                          </div>
                          {image.status === 'error' && <p className="mt-1 break-words text-[10px] leading-tight text-red-600">{image.error || '上传失败'}</p>}
                        </div>
                      ))}
                      {attachment.images.length < WIKI_MAX_IMAGES_PER_ATTACHMENT && totalAttachmentImages < WIKI_MAX_TOTAL_IMAGES && (
                        <label className="flex h-24 w-24 cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed border-gray-300 bg-gray-50 text-xs font-bold text-pencil hover:border-ink hover:text-ink">
                          <ImagePlus className="mb-1 h-5 w-5" /> 上传图片
                          <input
                            type="file"
                            accept={IMAGE_UPLOAD_ACCEPT}
                            multiple
                            disabled={!canManage || submitting}
                            className="hidden"
                            onChange={(event) => {
                              handleSelectAttachmentImages(
                                attachment.clientId,
                                Array.from(event.currentTarget.files || [])
                              );
                              event.currentTarget.value = '';
                            }}
                          />
                        </label>
                      )}
                    </div>
                    <p className="mt-2 text-xs text-pencil">
                      选择文件或 Ctrl+V 粘贴 · 当前 {attachment.images.length} / {WIKI_MAX_IMAGES_PER_ATTACHMENT} 张
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
        {uploadProgress && (
          <div className="mt-4 rounded-lg bg-marker-blue/30 px-4 py-2 text-sm font-bold text-ink">
            正在上传附件图片 {uploadProgress.completed} / {uploadProgress.total}
          </div>
        )}
        <div className="mt-6 flex justify-end gap-3">
          <SketchButton type="button" variant="secondary" onClick={handleClose} disabled={submitting}>
            取消
          </SketchButton>
          <SketchButton type="submit" disabled={submitting || !canManage}>
            {submitting ? (uploadProgress ? '上传并保存中...' : '保存中...') : '保存'}
          </SketchButton>
        </div>
      </form>
      <AttachmentPhotoViewer viewer={attachmentViewer} onChange={setAttachmentViewer} />
    </div>
  );
};

const AdminWikiPanel: React.FC<AdminWikiPanelProps> = ({ showToast, onPendingCountChange, canManage = true }) => {
  const [tab, setTab] = useState<'revisions' | 'entries'>('revisions');
  const [revisionStatus, setRevisionStatus] = useState<RevisionStatus>('pending');
  const [revisionActionType, setRevisionActionType] = useState<RevisionActionType>('all');
  const [revisionSearch, setRevisionSearch] = useState('');
  const [revisionPage, setRevisionPage] = useState(1);
  const [revisions, setRevisions] = useState<WikiRevision[]>([]);
  const [revisionTotal, setRevisionTotal] = useState(0);
  const [revisionLoading, setRevisionLoading] = useState(false);
  const [entryStatus, setEntryStatus] = useState<EntryStatus>('active');
  const [entrySearch, setEntrySearch] = useState('');
  const [entryPage, setEntryPage] = useState(1);
  const [entries, setEntries] = useState<WikiEntry[]>([]);
  const [entryTotal, setEntryTotal] = useState(0);
  const [entryLoading, setEntryLoading] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<WikiEntry | null>(null);
  const [editingRevision, setEditingRevision] = useState<WikiRevision | null>(null);
  const [attachmentViewer, setAttachmentViewer] = useState<AttachmentViewerState | null>(null);

  const revisionPages = Math.max(Math.ceil(revisionTotal / WIKI_PAGE_SIZE), 1);
  const entryPages = Math.max(Math.ceil(entryTotal / WIKI_PAGE_SIZE), 1);

  const loadRevisions = useCallback(async () => {
    setRevisionLoading(true);
    try {
      const data = await api.getAdminWikiRevisions({
        status: revisionStatus,
        actionType: revisionActionType,
        q: revisionSearch,
        page: revisionPage,
        limit: WIKI_PAGE_SIZE,
      });
      setRevisions(Array.isArray(data?.items) ? data.items : []);
      setRevisionTotal(Number(data?.total || 0));
    } catch (error) {
      showToast(error instanceof Error ? error.message : '瓜条审核记录加载失败', 'error');
      setRevisions([]);
      setRevisionTotal(0);
    } finally {
      setRevisionLoading(false);
    }
  }, [revisionActionType, revisionPage, revisionSearch, revisionStatus, showToast]);

  const loadEntries = useCallback(async () => {
    setEntryLoading(true);
    try {
      const data = await api.getAdminWikiEntries({
        status: entryStatus,
        q: entrySearch,
        page: entryPage,
        limit: WIKI_PAGE_SIZE,
      });
      setEntries(Array.isArray(data?.items) ? data.items : []);
      setEntryTotal(Number(data?.total || 0));
    } catch (error) {
      showToast(error instanceof Error ? error.message : '瓜条加载失败', 'error');
      setEntries([]);
      setEntryTotal(0);
    } finally {
      setEntryLoading(false);
    }
  }, [entryPage, entrySearch, entryStatus, showToast]);

  useEffect(() => {
    if (tab === 'revisions') {
      loadRevisions();
    }
  }, [loadRevisions, tab]);

  useEffect(() => {
    if (tab === 'entries') {
      loadEntries();
    }
  }, [loadEntries, tab]);

  const pendingCount = useMemo(() => (
    revisionStatus === 'pending' ? revisionTotal : revisions.filter((item) => item.status === 'pending').length
  ), [revisionStatus, revisionTotal, revisions]);

  const handleRevisionAction = async (revision: WikiRevision, action: 'approve' | 'reject') => {
    if (!canManage) {
      showToast('当前账号只有查看权限，不能处理瓜条审核', 'warning');
      return;
    }
    const reason = action === 'reject'
      ? window.prompt('请输入拒绝原因（可留空）') || ''
      : '';
    try {
      await api.handleAdminWikiRevision(revision.id, action, reason);
      showToast(action === 'approve' ? '瓜条审核已通过' : '瓜条审核已拒绝', 'success');
      await loadRevisions();
      onPendingCountChange?.();
      if (tab === 'entries') {
        await loadEntries();
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : '操作失败', 'error');
    }
  };

  const handleEntryAction = async (entry: WikiEntry, action: 'delete' | 'restore') => {
    if (!canManage) {
      showToast('当前账号只有查看权限，不能处理瓜条', 'warning');
      return;
    }
    const confirmed = window.confirm(action === 'delete' ? '确认删除该瓜条？' : '确认恢复该瓜条？');
    if (!confirmed) {
      return;
    }
    try {
      await api.handleAdminWikiEntry(entry.id, action, action === 'delete' ? '管理员删除' : '管理员恢复');
      showToast(action === 'delete' ? '瓜条已删除' : '瓜条已恢复', 'success');
      await loadEntries();
    } catch (error) {
      showToast(error instanceof Error ? error.message : '操作失败', 'error');
    }
  };

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 rounded-lg border-2 border-ink bg-white p-5 shadow-sketch-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-2xl text-ink">瓜条审核</h3>
            <p className="font-sans text-sm text-pencil">审核新瓜条投稿和瓜条编辑，公开页只展示已通过版本。</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setTab('revisions')}
              className={`rounded-full border-2 px-4 py-2 text-sm font-bold ${tab === 'revisions' ? 'border-ink bg-highlight' : 'border-gray-200 bg-white'}`}
            >
              审核记录
            </button>
            <button
              type="button"
              onClick={() => setTab('entries')}
              className={`rounded-full border-2 px-4 py-2 text-sm font-bold ${tab === 'entries' ? 'border-ink bg-highlight' : 'border-gray-200 bg-white'}`}
            >
              瓜条管理
            </button>
          </div>
        </div>
        {pendingCount > 0 && (
          <div className="rounded-lg bg-highlight/50 px-4 py-2 text-sm font-bold text-ink">
            当前有 {pendingCount} 条瓜条内容等待审核。
          </div>
        )}
      </div>

      {tab === 'revisions' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            {(['pending', 'approved', 'rejected'] as RevisionStatus[]).map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => {
                  setRevisionStatus(status);
                  setRevisionPage(1);
                }}
                className={`rounded-full border-2 px-3 py-1 text-xs font-bold ${revisionStatus === status ? 'border-ink bg-highlight' : 'border-transparent bg-white hover:border-ink'}`}
              >
                {status === 'pending' ? '待审核' : status === 'approved' ? '已通过' : '已拒绝'}
              </button>
            ))}
            {(['all', 'create', 'edit'] as RevisionActionType[]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => {
                  setRevisionActionType(type);
                  setRevisionPage(1);
                }}
                className={`rounded-full border-2 px-3 py-1 text-xs font-bold ${revisionActionType === type ? 'border-ink bg-marker-blue' : 'border-transparent bg-white hover:border-ink'}`}
              >
                {type === 'all' ? '全部类型' : type === 'create' ? '新瓜条' : '编辑'}
              </button>
            ))}
            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-pencil" />
              <input
                value={revisionSearch}
                onChange={(event) => {
                  setRevisionSearch(event.target.value);
                  setRevisionPage(1);
                }}
                placeholder="搜索名字、内容、ID..."
                className="w-full rounded-full border-2 border-ink bg-white py-2 pl-9 pr-4 text-sm outline-none"
              />
            </div>
          </div>

          {revisionLoading ? (
            <div className="rounded-lg border-2 border-dashed border-gray-200 bg-white p-10 text-center text-pencil">正在加载瓜条审核记录...</div>
          ) : revisions.length === 0 ? (
            <div className="rounded-lg border-2 border-dashed border-gray-200 bg-white p-10 text-center text-pencil">暂无匹配记录</div>
          ) : (
            <div className="flex flex-col gap-4">
              {revisions.map((revision) => (
                <article key={revision.id} className="rounded-lg border-2 border-ink bg-white p-5 shadow-sketch-sm">
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0 flex-1 space-y-3">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <Badge color={revision.actionType === 'create' ? 'bg-marker-green' : 'bg-marker-blue'}>
                          {revision.actionType === 'create' ? '新瓜条' : '编辑'}
                        </Badge>
                        <Badge color={revision.status === 'pending' ? 'bg-highlight' : revision.status === 'approved' ? 'bg-marker-green' : 'bg-alert'}>
                          {revision.status === 'pending' ? '待审核' : revision.status === 'approved' ? '已通过' : '已拒绝'}
                        </Badge>
                        <span className="text-pencil">提交：{formatTime(revision.createdAt)}</span>
                        {revision.reviewedAt && <span className="text-pencil">审核：{formatTime(revision.reviewedAt)}</span>}
                      </div>
                      <div>
                        <h4 className="font-sans text-lg font-bold text-ink">{revision.data.name}</h4>
                        <div className="mt-1 flex flex-wrap gap-2">
                          {revision.data.tags.map((tag) => (
                            <span key={tag} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-pencil">#{tag}</span>
                          ))}
                        </div>
                      </div>
                      {revision.editSummary && (
                        <div className="rounded-lg border border-[#546354]/15 bg-[#f7faf7] px-4 py-3">
                          <div className="text-[10px] font-bold tracking-widest text-[#546354]">
                            {revision.actionType === 'edit' ? '编辑原因' : '提交说明'}
                          </div>
                          <p className="mt-1 whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-ink">
                            {revision.editSummary}
                          </p>
                        </div>
                      )}
                      <MarkdownRenderer
                        content={revision.data.narrative}
                        className="font-sans text-sm leading-relaxed text-ink [&_p]:mb-4 [&_blockquote]:my-4 [&_ol]:my-4 [&_ul]:my-4 [&_pre]:my-4"
                      />
                      <WikiRelatedPostsDisplay
                        relatedPostIds={revision.data.relatedPostIds}
                        relatedPosts={(revision as AdminWikiRevision).relatedPosts}
                      />
                      <WikiAttachmentsDisplay
                        attachments={revision.data.attachments}
                        onOpen={setAttachmentViewer}
                      />
                      <div className="flex flex-wrap gap-3 text-xs text-pencil">
                        <span>ID：{revision.id}</span>
                        {revision.entrySlug && <span>瓜条：{revision.entrySlug}</span>}
                        {revision.submitterIp && <span>IP：{revision.submitterIp}</span>}
                      </div>
                      {revision.reviewReason && <p className="text-xs text-red-600">拒绝原因：{revision.reviewReason}</p>}
                    </div>
                    {revision.status === 'pending' && canManage && (
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <SketchButton
                          type="button"
                          variant="secondary"
                          className="h-10 px-3 text-xs"
                          onClick={() => {
                            setEditingEntry(null);
                            setEditingRevision(revision);
                            setEditorOpen(true);
                          }}
                        >
                          <Pencil className="mr-1 inline h-4 w-4" /> 编辑稿件
                        </SketchButton>
                        <SketchButton
                          type="button"
                          variant="secondary"
                          className="h-10 px-3 text-xs"
                          onClick={() => handleRevisionAction(revision, 'approve')}
                        >
                          <CheckCircle className="mr-1 inline h-4 w-4" /> 通过
                        </SketchButton>
                        <SketchButton
                          type="button"
                          variant="danger"
                          className="h-10 px-3 text-xs"
                          onClick={() => handleRevisionAction(revision, 'reject')}
                        >
                          <XCircle className="mr-1 inline h-4 w-4" /> 拒绝
                        </SketchButton>
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}

          <div className="flex items-center justify-center gap-4 text-xs text-pencil">
            <SketchButton type="button" variant="secondary" className="px-4 py-2 text-sm" disabled={revisionPage <= 1} onClick={() => setRevisionPage((prev) => Math.max(prev - 1, 1))}>
              上一页
            </SketchButton>
            <span>第 {revisionPage} / {revisionPages} 页</span>
            <SketchButton type="button" variant="secondary" className="px-4 py-2 text-sm" disabled={revisionPage >= revisionPages} onClick={() => setRevisionPage((prev) => Math.min(prev + 1, revisionPages))}>
              下一页
            </SketchButton>
          </div>
        </div>
      )}

      {tab === 'entries' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            {(['active', 'deleted', 'all'] as EntryStatus[]).map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => {
                  setEntryStatus(status);
                  setEntryPage(1);
                }}
                className={`rounded-full border-2 px-3 py-1 text-xs font-bold ${entryStatus === status ? 'border-ink bg-highlight' : 'border-transparent bg-white hover:border-ink'}`}
              >
                {status === 'active' ? '公开中' : status === 'deleted' ? '已删除' : '全部'}
              </button>
            ))}
            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-pencil" />
              <input
                value={entrySearch}
                onChange={(event) => {
                  setEntrySearch(event.target.value);
                  setEntryPage(1);
                }}
                placeholder="搜索瓜条..."
                className="w-full rounded-full border-2 border-ink bg-white py-2 pl-9 pr-4 text-sm outline-none"
              />
            </div>
            <SketchButton
              type="button"
              className="h-10 px-4 text-sm"
              disabled={!canManage}
              onClick={() => {
                setEditingRevision(null);
                setEditingEntry(null);
                setEditorOpen(true);
              }}
            >
              新建公开瓜条
            </SketchButton>
          </div>

          {entryLoading ? (
            <div className="rounded-lg border-2 border-dashed border-gray-200 bg-white p-10 text-center text-pencil">正在加载瓜条...</div>
          ) : entries.length === 0 ? (
            <div className="rounded-lg border-2 border-dashed border-gray-200 bg-white p-10 text-center text-pencil">暂无匹配瓜条</div>
          ) : (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {entries.map((entry) => (
                <article key={entry.id} className="rounded-lg border-2 border-ink bg-white p-5 shadow-sketch-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="font-sans text-lg font-bold text-ink">{entry.name}</h4>
                        <Badge color={entry.deleted ? 'bg-alert' : 'bg-marker-green'}>{entry.deleted ? '已删除' : '公开'}</Badge>
                        <Badge color="bg-gray-100">v{entry.versionNumber}</Badge>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {entry.tags.map((tag) => (
                          <span key={tag} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-pencil">#{tag}</span>
                        ))}
                      </div>
                      <p className="line-clamp-4 break-words font-sans text-sm leading-relaxed text-pencil">
                        {getWikiMarkdownExcerpt(entry.narrative, 140)}
                      </p>
                      <WikiRelatedPostsDisplay
                        relatedPostIds={entry.relatedPostIds}
                        relatedPosts={(entry as AdminWikiEntry).relatedPosts}
                      />
                      <WikiAttachmentsDisplay
                        attachments={entry.attachments}
                        onOpen={setAttachmentViewer}
                      />
                      <p className="text-xs text-pencil">更新：{formatTime(entry.updatedAt)} · slug：{entry.slug}</p>
                    </div>
                    {canManage && <div className="flex shrink-0 flex-col gap-2">
                      <SketchButton
                        type="button"
                        variant="secondary"
                        className="h-9 px-3 text-xs"
                        onClick={() => {
                          setEditingRevision(null);
                          setEditingEntry(entry);
                          setEditorOpen(true);
                        }}
                      >
                        <Pencil className="mr-1 inline h-4 w-4" /> 编辑
                      </SketchButton>
                      {entry.deleted ? (
                        <SketchButton type="button" variant="secondary" className="h-9 px-3 text-xs" onClick={() => handleEntryAction(entry, 'restore')}>
                          <RotateCcw className="mr-1 inline h-4 w-4" /> 恢复
                        </SketchButton>
                      ) : (
                        <SketchButton type="button" variant="danger" className="h-9 px-3 text-xs" onClick={() => handleEntryAction(entry, 'delete')}>
                          <Trash2 className="mr-1 inline h-4 w-4" /> 删除
                        </SketchButton>
                      )}
                    </div>}
                  </div>
                </article>
              ))}
            </div>
          )}

          <div className="flex items-center justify-center gap-4 text-xs text-pencil">
            <SketchButton type="button" variant="secondary" className="px-4 py-2 text-sm" disabled={entryPage <= 1} onClick={() => setEntryPage((prev) => Math.max(prev - 1, 1))}>
              上一页
            </SketchButton>
            <span>第 {entryPage} / {entryPages} 页</span>
            <SketchButton type="button" variant="secondary" className="px-4 py-2 text-sm" disabled={entryPage >= entryPages} onClick={() => setEntryPage((prev) => Math.min(prev + 1, entryPages))}>
              下一页
            </SketchButton>
          </div>
        </div>
      )}

      <AttachmentPhotoViewer viewer={attachmentViewer} onChange={setAttachmentViewer} />

      <WikiEntryEditor
        open={editorOpen}
        entry={editingEntry}
        revision={editingRevision}
        onClose={() => {
          setEditorOpen(false);
          setEditingEntry(null);
          setEditingRevision(null);
        }}
        onSaved={() => {
          loadEntries();
          loadRevisions();
        }}
        showToast={showToast}
        canManage={canManage}
      />
    </section>
  );
};

export default AdminWikiPanel;
