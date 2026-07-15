import { api } from '../api';

export type ImageUploadUsage = 'post' | 'comment' | 'wiki';

export const IMAGE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_UPLOAD_ACCEPT = 'image/jpeg,image/png,image/gif,image/webp';

const ALLOWED_IMAGE_UPLOAD_TYPES = new Set([
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export const isImageUploadFile = (file: File | null | undefined): file is File => (
  Boolean(file && ALLOWED_IMAGE_UPLOAD_TYPES.has(file.type))
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
) => api.uploadImage(file, {
  uploadChannel: 'telegram',
  usage: options.usage,
});

export const uploadImageAsMarkdown = async (
  file: File,
  options: { usage?: ImageUploadUsage; trailingSpace?: boolean } = {}
) => {
  const result = await uploadImageFile(file, { usage: options.usage });
  return `![](${result.url})${options.trailingSpace === false ? '' : ' '}`;
};
