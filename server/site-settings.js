import solarlunar from 'solarlunar';

const SETTINGS_KEY_TURNSTILE_ENABLED = 'turnstile_enabled';
const SETTINGS_KEY_CNY_THEME_ENABLED = 'cny_theme_enabled';
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

  const setTurnstileEnabled = (enabled) => {
    turnstileEnabled = Boolean(enabled);
    upsertSetting(SETTINGS_KEY_TURNSTILE_ENABLED, turnstileEnabled ? '1' : '0');
  };

  const setCnyThemeEnabled = (enabled) => {
    cnyThemeEnabled = Boolean(enabled);
    upsertSetting(SETTINGS_KEY_CNY_THEME_ENABLED, cnyThemeEnabled ? '1' : '0');
  };

  const getTurnstileEnabled = () => turnstileEnabled;
  const getCnyThemeEnabled = () => cnyThemeEnabled;

  const buildSettingsResponse = () => {
    const cnyThemeAutoActive = isCnyThemeAutoActive();
    return {
      turnstileEnabled,
      cnyThemeEnabled,
      cnyThemeAutoActive,
      cnyThemeActive: cnyThemeEnabled && cnyThemeAutoActive,
    };
  };

  return {
    getTurnstileEnabled,
    getCnyThemeEnabled,
    buildSettingsResponse,
    setTurnstileEnabled,
    setCnyThemeEnabled,
  };
};
