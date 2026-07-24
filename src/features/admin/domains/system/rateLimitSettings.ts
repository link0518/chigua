export type RateLimitAction =
  | 'post'
  | 'comment'
  | 'report'
  | 'feature'
  | 'feedback'
  | 'wiki'
  | 'upload'
  | 'recruitment_publish'
  | 'recruitment_apply'
  | 'recruitment_message'
  | 'recruitment_contact'
  | 'recruitment_report';
export type RateLimitItem = { limit: number; windowMs: number };
export type RateLimitSettings = Record<RateLimitAction, RateLimitItem>;

export const RATE_LIMIT_MAX_COUNT = 1000;
export const RATE_LIMIT_MAX_WINDOW_SECONDS = 30 * 24 * 60 * 60;
export const AUTO_HIDE_REPORT_THRESHOLD_DEFAULT = 10;
export const AUTO_HIDE_REPORT_THRESHOLD_MAX = 1000;

export const RATE_LIMIT_DEFAULTS: RateLimitSettings = {
  post: { limit: 2, windowMs: 30 * 60 * 1000 },
  comment: { limit: 1, windowMs: 10 * 1000 },
  report: { limit: 1, windowMs: 60 * 1000 },
  feature: { limit: 5, windowMs: 60 * 60 * 1000 },
  feedback: { limit: 1, windowMs: 60 * 60 * 1000 },
  wiki: { limit: 3, windowMs: 60 * 60 * 1000 },
  upload: { limit: 12, windowMs: 60 * 1000 },
  recruitment_publish: { limit: 3, windowMs: 30 * 60 * 1000 },
  recruitment_apply: { limit: 10, windowMs: 10 * 60 * 1000 },
  recruitment_message: { limit: 30, windowMs: 60 * 1000 },
  recruitment_contact: { limit: 5, windowMs: 60 * 60 * 1000 },
  recruitment_report: { limit: 3, windowMs: 60 * 60 * 1000 },
};

export const RATE_LIMIT_FIELDS: Array<{ key: RateLimitAction; label: string; hint: string }> = [
  { key: 'post', label: '发帖限流', hint: '限制普通用户发帖频率' },
  { key: 'comment', label: '评论限流', hint: '限制普通用户评论频率' },
  { key: 'report', label: '举报限流', hint: '限制普通用户举报频率' },
  { key: 'feature', label: '精华申请限流', hint: '限制普通用户申请帖子加精的频率' },
  { key: 'feedback', label: '留言限流', hint: '限制反馈留言提交频率' },
  { key: 'wiki', label: '瓜条提交限流', hint: '限制角色瓜条新建和编辑提交频率' },
  { key: 'upload', label: '图片上传限流', hint: '统一限制帖子、评论和瓜条附件的图片上传频率' },
  { key: 'recruitment_publish', label: '招募发布限流', hint: '限制匿名用户发布招募的频率' },
  { key: 'recruitment_apply', label: '招募申请限流', hint: '限制匿名用户发起招募密聊的频率' },
  { key: 'recruitment_message', label: '招募密聊限流', hint: '限制招募密聊消息的发送频率' },
  { key: 'recruitment_contact', label: '联系方式交换限流', hint: '限制发起或同意联系方式交换的频率' },
  { key: 'recruitment_report', label: '招募举报限流', hint: '限制招募及密聊举报的提交频率' },
];

export const normalizeRateLimitNumber = (value: unknown, fallback: number, min: number, max: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(Math.trunc(parsed), min), max);
};

export const normalizeAutoHideReportThreshold = (value: unknown) => normalizeRateLimitNumber(
  value,
  AUTO_HIDE_REPORT_THRESHOLD_DEFAULT,
  1,
  AUTO_HIDE_REPORT_THRESHOLD_MAX
);

export const normalizeRateLimits = (input: unknown): RateLimitSettings => {
  const source = input && typeof input === 'object'
    ? input as Partial<Record<RateLimitAction, Partial<RateLimitItem>>>
    : {};

  return Object.fromEntries(
    RATE_LIMIT_FIELDS.map(({ key }) => {
      const fallback = RATE_LIMIT_DEFAULTS[key];
      const current = source[key];
      return [
        key,
        {
          limit: normalizeRateLimitNumber(current?.limit, fallback.limit, 1, RATE_LIMIT_MAX_COUNT),
          windowMs: normalizeRateLimitNumber(
            current?.windowMs,
            fallback.windowMs,
            1000,
            RATE_LIMIT_MAX_WINDOW_SECONDS * 1000
          ),
        },
      ];
    })
  ) as RateLimitSettings;
};

export const formatRateLimitWindow = (windowMs: number) => {
  const seconds = Math.max(1, Math.round(windowMs / 1000));
  if (seconds % 3600 === 0) {
    return `${seconds / 3600} 小时`;
  }
  if (seconds % 60 === 0) {
    return `${seconds / 60} 分钟`;
  }
  return `${seconds} 秒`;
};
