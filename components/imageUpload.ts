import { api } from '../api';

export type ImageUploadUsage = 'post' | 'comment' | 'wiki';

export const IMAGE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_UPLOAD_ACCEPT = 'image/jpeg,image/png,image/gif,image/webp,.jpg,.jpeg,.png,.gif,.webp';

const ALLOWED_IMAGE_UPLOAD_TYPES = new Set([
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const NORMALIZED_IMAGE_UPLOAD_TYPES: Record<string, string> = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'image/x-png': 'image/png',
};

const IMAGE_UPLOAD_TYPE_BY_EXTENSION: Record<string, string> = {
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export const resolveImageUploadContentType = (file: File | null | undefined) => {
  if (!file) {
    return '';
  }

  const declaredType = String(file.type || '').split(';')[0].trim().toLowerCase();
  const normalizedType = NORMALIZED_IMAGE_UPLOAD_TYPES[declaredType] || declaredType;
  if (ALLOWED_IMAGE_UPLOAD_TYPES.has(normalizedType)) {
    return normalizedType;
  }

  // Windows 截图工具和部分图片软件可能不提供标准 MIME，使用扩展名补全后仍由服务端校验真实文件头。
  const extension = String(file.name || '').trim().toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
  return IMAGE_UPLOAD_TYPE_BY_EXTENSION[extension] || '';
};

export const isImageUploadFile = (file: File | null | undefined): file is File => (
  Boolean(file && resolveImageUploadContentType(file))
);

export const getImageUploadValidationError = (file: File | null | undefined) => {
  if (!file || !isImageUploadFile(file)) {
    return '仅支持 JPEG、PNG、GIF、WebP 图片';
  }
  if (file.size <= 0 || file.size > IMAGE_UPLOAD_MAX_BYTES) {
    return '单张图片不能超过 5MB';
  }
  return '';
};

export const uploadImageFile = async (
  file: File,
  options: { usage?: ImageUploadUsage } = {}
) => {
  const contentType = resolveImageUploadContentType(file);
  const normalizedFile = contentType && file.type !== contentType
    ? new File([file], file.name, { type: contentType, lastModified: file.lastModified })
    : file;

  return api.uploadImage(normalizedFile, {
    uploadChannel: 'telegram',
    usage: options.usage,
  });
};

export const uploadImageAsMarkdown = async (
  file: File,
  options: { usage?: ImageUploadUsage; trailingSpace?: boolean } = {}
) => {
  const result = await uploadImageFile(file, { usage: options.usage });
  return `![](${result.url})${options.trailingSpace === false ? '' : ' '}`;
};
