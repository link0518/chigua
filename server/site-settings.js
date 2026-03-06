import solarlunar from 'solarlunar';

const SETTINGS_KEY_TURNSTILE_ENABLED = 'turnstile_enabled';
const SETTINGS_KEY_CNY_THEME_ENABLED = 'cny_theme_enabled';
const SETTINGS_KEY_DEFAULT_POST_TAGS = 'default_post_tags';
const SETTINGS_KEY_RATE_LIMITS = 'rate_limits';
const POST_TAG_MAX_LENGTH = 6;
const MAX_DEFAULT_POST_TAGS = 50;
const RATE_LIMIT_MAX_COUNT = 1000;
const RATE_LIMIT_MAX_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_RATE_LIMITS = Object.freeze({
  post: { limit: 2, windowMs: 30 * 60 * 1000 },
  comment: { limit: 1, windowMs: 10 * 1000 },
  report: { limit: 1, windowMs: 60 * 1000 },
  feedback: { limit: 1, windowMs: 60 * 60 * 1000 },
});
const RATE_LIMIT_ACTIONS = Object.freeze(Object.keys(DEFAULT_RATE_LIMITS));
const CNY_TIMEZONE = 'Asia/Shanghai';
const CHINA_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: CNY_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export const createSiteSettingsService = ({ db, turnstileSecretKey }) => {
  if (!db) {
    throw new Error('db is required for site settings service');
  }

  const normalizeTag = (value) => String(value || '')
    .trim()
    .replace(/^#+/, '')
    .replace(/\s+/g, ' ');

  const parseTagText = (rawValue) => String(rawValue || '')
    .split(/[\r\n,，、;；|]+/g)
    .map((item) => item.trim())
    .filter(Boolean);

  const toTagArray = (input) => {
    if (Array.isArray(input)) {
      return input;
    }
    if (typeof input === 'string') {
      const raw = input.trim();
      if (!raw) {
        return [];
      }
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      } catch {
        // ignore parse error and fallback to plain text split
      }
      return parseTagText(raw);
    }
    return [];
  };

  const sanitizeTagList = (input, maxCount = MAX_DEFAULT_POST_TAGS) => {
    const source = toTagArray(input);
    const result = [];
    const seen = new Set();
    for (const item of source) {
      const normalized = normalizeTag(item);
      if (!normalized) {
        continue;
      }
      if (normalized.length > POST_TAG_MAX_LENGTH) {
        continue;
      }
      const key = normalized.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push(normalized);
      if (result.length >= maxCount) {
        break;
      }
    }
    return result;
  };

  const toSafeInt = (value, fallback) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.trunc(parsed);
  };

  const sanitizeRateLimitItem = (input, fallback) => {
    const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const limit = Math.min(
      Math.max(toSafeInt(source.limit, fallback.limit), 1),
      RATE_LIMIT_MAX_COUNT
    );
    const windowMs = Math.min(
      Math.max(toSafeInt(source.windowMs, fallback.windowMs), 1000),
      RATE_LIMIT_MAX_WINDOW_MS
    );
    return { limit, windowMs };
  };

  const sanitizeRateLimits = (input) => {
    let source = input;
    if (typeof source === 'string') {
      const raw = source.trim();
      if (!raw) {
        source = {};
      } else {
        try {
          source = JSON.parse(raw);
        } catch {
          source = {};
        }
      }
    }
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      source = {};
    }
    const result = {};
    for (const action of RATE_LIMIT_ACTIONS) {
      result[action] = sanitizeRateLimitItem(source[action], DEFAULT_RATE_LIMITS[action]);
    }
    return result;
  };

  const getSetting = (key) => {
    const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
    return row?.value ?? null;
  };

  const upsertSetting = (key, value) => {
    const now = Date.now();
    db.prepare(
      `
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `
    ).run(key, value, now);
  };

  const resolveTurnstileEnabled = () => {
    const stored = getSetting(SETTINGS_KEY_TURNSTILE_ENABLED);
    if (stored === null || stored === undefined) {
      const fallback = Boolean(turnstileSecretKey);
      upsertSetting(SETTINGS_KEY_TURNSTILE_ENABLED, fallback ? '1' : '0');
      return fallback;
    }
    return String(stored).trim() === '1';
  };

  const resolveCnyThemeEnabled = () => {
    const stored = getSetting(SETTINGS_KEY_CNY_THEME_ENABLED);
    if (stored === null || stored === undefined) {
      upsertSetting(SETTINGS_KEY_CNY_THEME_ENABLED, '0');
      return false;
    }
    return String(stored).trim() === '1';
  };

  const resolveDefaultPostTags = () => {
    const stored = getSetting(SETTINGS_KEY_DEFAULT_POST_TAGS);
    if (stored === null || stored === undefined) {
      upsertSetting(SETTINGS_KEY_DEFAULT_POST_TAGS, '[]');
      return [];
    }
    const normalized = sanitizeTagList(stored, MAX_DEFAULT_POST_TAGS);
    return normalized;
  };

  const resolveRateLimits = () => {
    const stored = getSetting(SETTINGS_KEY_RATE_LIMITS);
    if (stored === null || stored === undefined) {
      const initial = sanitizeRateLimits(DEFAULT_RATE_LIMITS);
      upsertSetting(SETTINGS_KEY_RATE_LIMITS, JSON.stringify(initial));
      return initial;
    }
    return sanitizeRateLimits(stored);
  };

  const getChinaDateParts = (input = new Date()) => {
    const parts = CHINA_DATE_FORMATTER.formatToParts(input);
    const year = Number(parts.find((part) => part.type === 'year')?.value || 0);
    const month = Number(parts.find((part) => part.type === 'month')?.value || 0);
    const day = Number(parts.find((part) => part.type === 'day')?.value || 0);
    return { year, month, day };
  };

  const isCnyThemeAutoActive = (input = new Date()) => {
    const { year, month, day } = getChinaDateParts(input);
    if (!year || !month || !day) {
      return false;
    }
    const lunarDate = solarlunar.solar2lunar(year, month, day);
    if (!lunarDate || typeof lunarDate.lMonth !== 'number' || typeof lunarDate.lDay !== 'number') {
      return false;
    }
    if (lunarDate.isLeap) {
      return false;
    }
    if (lunarDate.lMonth === 12 && lunarDate.lDay >= 16) {
      return true;
    }
    if (lunarDate.lMonth === 1 && lunarDate.lDay <= 15) {
      return true;
    }
    return false;
  };

  let turnstileEnabled = resolveTurnstileEnabled();
  let cnyThemeEnabled = resolveCnyThemeEnabled();
  let defaultPostTags = resolveDefaultPostTags();
  let rateLimits = resolveRateLimits();

  const setTurnstileEnabled = (enabled) => {
    turnstileEnabled = Boolean(enabled);
    upsertSetting(SETTINGS_KEY_TURNSTILE_ENABLED, turnstileEnabled ? '1' : '0');
  };

  const setCnyThemeEnabled = (enabled) => {
    cnyThemeEnabled = Boolean(enabled);
    upsertSetting(SETTINGS_KEY_CNY_THEME_ENABLED, cnyThemeEnabled ? '1' : '0');
  };

  const setDefaultPostTags = (tags) => {
    defaultPostTags = sanitizeTagList(tags, MAX_DEFAULT_POST_TAGS);
    upsertSetting(SETTINGS_KEY_DEFAULT_POST_TAGS, JSON.stringify(defaultPostTags));
  };

  const setRateLimits = (limits) => {
    rateLimits = sanitizeRateLimits(limits);
    upsertSetting(SETTINGS_KEY_RATE_LIMITS, JSON.stringify(rateLimits));
  };

  const getTurnstileEnabled = () => turnstileEnabled;
  const getCnyThemeEnabled = () => cnyThemeEnabled;
  const getDefaultPostTags = () => [...defaultPostTags];
  const getRateLimits = () => sanitizeRateLimits(rateLimits);
  const getRateLimitConfig = (action) => {
    const key = String(action || '').trim();
    if (!RATE_LIMIT_ACTIONS.includes(key)) {
      return null;
    }
    const config = rateLimits[key];
    return config ? { ...config } : null;
  };

  const buildSettingsResponse = () => {
    const cnyThemeAutoActive = isCnyThemeAutoActive();
    return {
      turnstileEnabled,
      cnyThemeEnabled,
      defaultPostTags: getDefaultPostTags(),
      cnyThemeAutoActive,
      cnyThemeActive: cnyThemeEnabled && cnyThemeAutoActive,
    };
  };

  return {
    getTurnstileEnabled,
    getCnyThemeEnabled,
    getDefaultPostTags,
    getRateLimits,
    getRateLimitConfig,
    buildSettingsResponse,
    setTurnstileEnabled,
    setCnyThemeEnabled,
    setDefaultPostTags,
    setRateLimits,
  };
};
