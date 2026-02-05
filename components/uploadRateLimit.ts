export type UploadRateLimitPolicy = {
  /**
   * 时间窗口（毫秒）
   */
  windowMs: number;
  /**
   * 窗口内最多允许次数
   */
  max: number;
};

export type UploadQuotaAllowed = {
  allowed: true;
  retryAfterMs?: never;
};

export type UploadQuotaLimited = {
  allowed: false;
  retryAfterMs: number;
};

export type UploadQuotaResult = UploadQuotaAllowed | UploadQuotaLimited;

type UploadRateLimitState = {
  /**
   * 最近上传时间戳（毫秒）
   */
  timestamps: number[];
};

const STORAGE_KEY = 'img_upload_rate_limit:v1';

const loadState = (): UploadRateLimitState => {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { timestamps: [] };
    }
    const parsed = JSON.parse(raw) as Partial<UploadRateLimitState>;
    if (!parsed.timestamps || !Array.isArray(parsed.timestamps)) {
      return { timestamps: [] };
    }
    return { timestamps: parsed.timestamps.filter((x) => typeof x === 'number') };
  } catch {
    return { timestamps: [] };
  }
};

const saveState = (state: UploadRateLimitState) => {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
};

/**
 * 轻量前端限频（防刷）：只在本次会话内生效（sessionStorage），避免干扰正常用户。
 *
 * 返回：
 * - allowed=true 代表允许继续上传，并会记录一次额度消耗
 * - allowed=false 代表被限流，retryAfterMs 为建议等待时间
 */
export const consumeUploadQuota = (policy: UploadRateLimitPolicy): UploadQuotaResult => {
  const now = Date.now();
  const windowStart = now - policy.windowMs;

  const state = loadState();
  const timestamps = state.timestamps.filter((t) => t >= windowStart && t <= now);

  if (timestamps.length >= policy.max) {
    const earliest = Math.min(...timestamps);
    const retryAfterMs = Math.max(0, earliest + policy.windowMs - now);
    return { allowed: false, retryAfterMs };
  }

  timestamps.push(now);
  saveState({ timestamps });
  return { allowed: true };
};
