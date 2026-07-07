import type { WikiEntrySort } from '../../types';

export const PAGE_SIZE = 12;
export const WIKI_NARRATIVE_MAX_LENGTH = 8000;
export const WIKI_MOBILE_FEED_QUERY = '(max-width: 767px)';
export const WIKI_DETAIL_ENTER_MS = 320;
export const WIKI_DETAIL_EXIT_MS = 220;
export const WIKI_OVERLAY_MODAL_SELECTOR = '[data-wiki-overlay-modal="true"]';

export const WIKI_SORT_OPTIONS: Array<{ value: WikiEntrySort; label: string }> = [
  { value: 'updated', label: '更新时间' },
  { value: 'number', label: '编号' },
];
