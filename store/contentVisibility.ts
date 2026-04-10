import type { ReportSubmissionResult } from '../types';

export const AUTO_HIDDEN_EVENT = 'gossip:auto-hidden';
export const HIDDEN_COMMENT_PLACEHOLDER = '该评论因举报过多暂时隐藏';

export type AutoHiddenEventDetail = ReportSubmissionResult;

export const dispatchAutoHiddenEvent = (detail: AutoHiddenEventDetail) => {
  if (typeof window === 'undefined' || !detail?.autoHidden) {
    return;
  }
  window.dispatchEvent(new CustomEvent(AUTO_HIDDEN_EVENT, { detail }));
};
