import { api } from '../api';

export type ImageUploadUsage = 'post' | 'comment';

export const isImageUploadFile = (file: File | null | undefined): file is File => (
  Boolean(file?.type?.startsWith('image/'))
);

export const uploadImageAsMarkdown = async (
  file: File,
  options: { usage?: ImageUploadUsage; trailingSpace?: boolean } = {}
) => {
  const result = await api.uploadImage(file, {
    uploadChannel: 'telegram',
    usage: options.usage,
  });
  return `![](${result.url})${options.trailingSpace === false ? '' : ' '}`;
};
