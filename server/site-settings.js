import solarlunar from 'solarlunar';

const SETTINGS_KEY_TURNSTILE_ENABLED = 'turnstile_enabled';
const SETTINGS_KEY_CNY_THEME_ENABLED = 'cny_theme_enabled';
const SETTINGS_KEY_DEFAULT_POST_TAGS = 'default_post_tags';
const POST_TAG_MAX_LENGTH = 6;
const MAX_DEFAULT_POST_TAGS = 50;
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

  const getTurnstileEnabled = () => turnstileEnabled;
  const getCnyThemeEnabled = () => cnyThemeEnabled;
  const getDefaultPostTags = () => [...defaultPostTags];

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
    buildSettingsResponse,
    setTurnstileEnabled,
    setCnyThemeEnabled,
    setDefaultPostTags,
  };
};
