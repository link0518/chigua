import type { WikiEntrySort } from '../../types';

export const PAGE_SIZE = 12;
export const WIKI_NARRATIVE_MAX_LENGTH = 8000;
export const WIKI_RELATED_POST_MAX_COUNT = 5;
export const WIKI_ATTACHMENT_MAX_GROUPS = 5;
export const WIKI_ATTACHMENT_MAX_IMAGES_PER_GROUP = 3;
export const WIKI_ATTACHMENT_MAX_TOTAL_IMAGES = 10;
export const WIKI_ATTACHMENT_TITLE_MAX_LENGTH = 60;
export const WIKI_MOBILE_FEED_QUERY = '(max-width: 767px)';
export const WIKI_DETAIL_ENTER_MS = 320;
export const WIKI_DETAIL_EXIT_MS = 220;
export const WIKI_OVERLAY_MODAL_SELECTOR = '[data-wiki-overlay-modal="true"]';
export const WIKI_PHOTO_VIEWER_SELECTOR = '.PhotoView-Portal';

export const WIKI_SORT_OPTIONS: Array<{ value: WikiEntrySort; label: string }> = [
  { value: 'updated', label: '更新时间' },
  { value: 'number', label: '编号' },
];
