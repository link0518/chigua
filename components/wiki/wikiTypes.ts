import type {
  WikiAttachment,
  WikiEntry,
  WikiEntrySort,
  WikiRelatedPost,
  WikiRevision,
} from '../../types';

export type WikiTagStat = {
  name: string;
  count: number;
};

export type WikiListResponse = {
  items?: WikiEntry[];
  total?: number;
  page?: number;
  limit?: number;
  tags?: WikiTagStat[];
};

export type WikiDetailResponse = {
  entry?: WikiEntry;
  history?: WikiRevision[];
};

export type WikiFormMode = 'create' | 'edit';

export type WikiFeedback = {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
  duration: number;
};

export type WikiListState = {
  query: string;
  tag: string;
  sortBy: WikiEntrySort;
  page: number;
};

export type {
  WikiAttachment,
  WikiEntry,
  WikiEntrySort,
  WikiRelatedPost,
  WikiRevision,
};
