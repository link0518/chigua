import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import express from 'express';
import session from 'express-session';
import BetterSqlite3Store from 'better-sqlite3-session-store';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import {
  db,
  formatDateKey,
  formatRelativeTime,
  incrementDailyStat,
  startOfDay,
  startOfWeek,
  trackDailyVisit,
} from './db.js';

const loadEnvFile = (filename) => {
  const filePath = path.resolve(process.cwd(), filename);
  if (!fs.existsSync(filePath)) {
    return;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return;
    }
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) {
      return;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  });
};

// 本地开发读取 .env.local / .env
loadEnvFile('.env.local');
loadEnvFile('.env');

const app = express();
const PORT = Number(process.env.PORT || 4395);
const TURNSTILE_SECRET_KEY = String(process.env.TURNSTILE_SECRET_KEY || '').trim();
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const FINGERPRINT_HEADER = 'x-client-fingerprint';
const SESSION_SECRET = String(process.env.SESSION_SECRET || '').trim();
const FINGERPRINT_SALT = String(process.env.FINGERPRINT_SALT || SESSION_SECRET || 'gossipsketch-fingerprint-salt').trim();
const adminUsername = String(process.env.ADMIN_USERNAME || '').trim();
const adminPassword = String(process.env.ADMIN_PASSWORD || '').trim();
const adminEnabled = Boolean(SESSION_SECRET && adminUsername && adminPassword);
const sessionSecret = SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!SESSION_SECRET) {
  console.warn('SESSION_SECRET 未配置，已生成临时密钥（后台将被禁用）');
}

const SETTINGS_KEY_TURNSTILE_ENABLED = 'turnstile_enabled';

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
    const fallback = Boolean(TURNSTILE_SECRET_KEY);
    upsertSetting(SETTINGS_KEY_TURNSTILE_ENABLED, fallback ? '1' : '0');
    return fallback;
  }
  return String(stored).trim() === '1';
};

let turnstileEnabled = resolveTurnstileEnabled();
const setTurnstileEnabled = (enabled) => {
  turnstileEnabled = Boolean(enabled);
  upsertSetting(SETTINGS_KEY_TURNSTILE_ENABLED, turnstileEnabled ? '1' : '0');
};

const PUBLIC_DIR = path.resolve(process.cwd(), 'public');
const DIST_DIR = path.resolve(process.cwd(), 'dist');
const SNAPSHOT_DIR = path.join(DIST_DIR, 'post');
const BOT_UA_REGEX = /(bot|crawler|spider|bingpreview|bingbot|baiduspider|yandex|duckduckbot|sogou|360spider|googlebot|slurp)/i;
const SITE_URL = String(process.env.SITE_URL || 'https://933211.xyz').replace(/\/+$/, '');
const isFilePath = (filePath) => {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
};
const SPA_INDEX = isFilePath(path.join(DIST_DIR, 'index.html'))
  ? path.join(DIST_DIR, 'index.html')
  : isFilePath(path.resolve(process.cwd(), 'index.html'))
    ? path.resolve(process.cwd(), 'index.html')
    : '';

app.use(express.json({ limit: '2mb' }));

const shouldServeSnapshot = (req) => {
  if (!['GET', 'HEAD'].includes(req.method)) return false;
  const userAgent = String(req.headers['user-agent'] || '').trim();
  if (!userAgent || !BOT_UA_REGEX.test(userAgent)) return false;
  const match = req.path.match(/^\/post\/([^/?#]+)\/?$/);
  if (!match) return false;
  const rawId = match[1];
  if (!rawId || rawId.includes('..') || rawId.includes('/')) return false;
  return rawId;
};

const generateSnapshotForPost = (post) => {
  if (!post?.id) return;
  const encodedId = encodeURIComponent(post.id);
  const postDir = path.join(SNAPSHOT_DIR, encodedId);
  fs.mkdirSync(postDir, { recursive: true });
  const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const snippet = normalize(post.content || '').slice(0, 120);
  const title = snippet ? `JX3瓜田｜剑网3吃瓜 - ${snippet}` : `JX3瓜田｜剑网3吃瓜 - ${post.id}`;
  const description = snippet
    ? `来自JX3瓜田的内容摘要：${snippet}`
    : 'JX3瓜田聚合剑网3吃瓜与818内容，关注最新爆料与热门话题。';
  const canonical = `${SITE_URL}/post/${encodedId}`;
  const publishedAt = post.created_at ? new Date(post.created_at).toISOString() : '';
  const escapeHtml = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${canonical}" />
    <meta name="robots" content="index,follow" />
    <script type="application/ld+json">
${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: title,
    datePublished: publishedAt || undefined,
    dateModified: publishedAt || undefined,
    mainEntityOfPage: canonical,
    author: { '@type': 'Person', name: '匿名' },
    publisher: { '@type': 'Organization', name: 'JX3瓜田', url: SITE_URL },
  }, null, 2)}
    </script>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(snippet || '')}</p>
      <p><a href="${canonical}">查看原帖</a></p>
    </main>
  </body>
</html>
`;
  fs.writeFileSync(path.join(postDir, 'index.html'), html, 'utf8');
};

const scheduleSitemapGenerate = () => {
  const child = spawn('node', ['server/seo-generate.js'], {
    cwd: process.cwd(),
    env: { ...process.env, SITE_URL },
    stdio: 'ignore',
    detached: true,
  });
  child.unref();
};

app.use((req, res, next) => {
  const postId = shouldServeSnapshot(req);
  if (!postId) return next();
  const snapshotPath = path.join(SNAPSHOT_DIR, postId, 'index.html');
  if (!snapshotPath.startsWith(SNAPSHOT_DIR) || !isFilePath(snapshotPath)) {
    return next();
  }
  return res.sendFile(snapshotPath);
});

app.get('/post/:id', (req, res, next) => {
  const postId = String(req.params.id || '').trim();
  if (!postId) return next();
  if (!SPA_INDEX) {
    return res.status(404).send('Not Found');
  }
  return res.sendFile(SPA_INDEX);
});

app.get('/robots.txt', (req, res) => {
  const filePath = path.join(PUBLIC_DIR, 'robots.txt');
  if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath)) {
    return res.status(404).send('Not Found');
  }
  return res.sendFile(filePath);
});

app.get('/sitemap.xml', (req, res) => {
  const filePath = path.join(PUBLIC_DIR, 'sitemap.xml');
  if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath)) {
    return res.status(404).send('Not Found');
  }
  return res.sendFile(filePath);
});

const SqliteStore = BetterSqlite3Store(session);
const sessionStore = new SqliteStore({
  client: db,
  expired: {
    clear: true,
    intervalMs: 15 * 60 * 1000,
  },
});

app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: true,
    store: sessionStore,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

const ensureAdminUser = () => {
  if (!adminEnabled) {
    return;
  }
  const username = adminUsername;
  const password = adminPassword;
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (!existing) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)')
      .run(username, hash, 'admin', Date.now());
  }
};

ensureAdminUser();

const vocabularyDir = path.resolve(process.cwd(), 'Vocabulary');
let cachedVocabulary = [];
let lastVocabularyReload = 0;
const VOCABULARY_TTL_MS = 5 * 1000;

const normalizeText = (text) => {
  return String(text || '')
    .replace(/\uFEFF/g, '')
    .replace(/[\u3000\s]+/g, '')
    .replace(/[.,/#!$%^&*;:{}=\\`"'~()<>?\-[\]_+|@，。！？；：“”‘’（）《》【】、·]/g, '')
    .replace(/[Ａ-Ｚ０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
    .replace(/[ａ-ｚ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
    .toLowerCase();
};

const buildVocabularyFromFiles = () => {
  if (!fs.existsSync(vocabularyDir)) {
    return [];
  }
  const entries = fs.readdirSync(vocabularyDir, { withFileTypes: true });
  const words = [];
  entries.forEach((entry) => {
    if (!entry.isFile() || !entry.name.endsWith('.txt')) {
      return;
    }
    const filePath = path.join(vocabularyDir, entry.name);
    const content = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .forEach((line) => {
        const normalized = normalizeText(line);
        if (normalized) {
          words.push({ word: line, normalized });
        }
      });
  });
  return words;
};

const reloadVocabulary = () => {
  const now = Date.now();
  try {
    const rows = db.prepare('SELECT normalized FROM vocabulary_words WHERE enabled = 1').all();
    cachedVocabulary = rows.map((row) => row.normalized).filter(Boolean);
  } catch (error) {
    console.error('Vocabulary load failed:', error);
    cachedVocabulary = [];
  }
  lastVocabularyReload = now;
  return cachedVocabulary;
};

const loadVocabulary = () => {
  const now = Date.now();
  if (now - lastVocabularyReload < VOCABULARY_TTL_MS && cachedVocabulary.length) {
    return cachedVocabulary;
  }
  return reloadVocabulary();
};

const seedVocabularyFromFiles = () => {
  const existing = db.prepare('SELECT COUNT(1) AS count FROM vocabulary_words').get();
  if (existing?.count > 0) {
    return 0;
  }
  const items = buildVocabularyFromFiles();
  if (!items.length) {
    return 0;
  }
  const now = Date.now();
  const insert = db.prepare(
    'INSERT OR IGNORE INTO vocabulary_words (word, normalized, enabled, created_at, updated_at) VALUES (?, ?, 1, ?, ?)'
  );
  let added = 0;
  const tx = db.transaction((entries) => {
    entries.forEach((entry) => {
      const result = insert.run(entry.word, entry.normalized, now, now);
      added += result.changes || 0;
    });
  });
  tx(items);
  reloadVocabulary();
  return added;
};

seedVocabularyFromFiles();

const importVocabularyFromFiles = () => {
  const items = buildVocabularyFromFiles();
  if (!items.length) {
    return { added: 0, total: 0 };
  }
  const now = Date.now();
  const insert = db.prepare(
    'INSERT OR IGNORE INTO vocabulary_words (word, normalized, enabled, created_at, updated_at) VALUES (?, ?, 1, ?, ?)'
  );
  let added = 0;
  const tx = db.transaction((entries) => {
    entries.forEach((entry) => {
      const result = insert.run(entry.word, entry.normalized, now, now);
      added += result.changes || 0;
    });
  });
  tx(items);
  reloadVocabulary();
  return { added, total: items.length };
};

const containsSensitiveWord = (text) => {
  const normalizedText = normalizeText(text);
  if (!normalizedText) {
    return false;
  }
  const words = loadVocabulary();
  if (!words.length) {
    return false;
  }
  return words.some((word) => normalizedText.includes(word));
};

const RATE_LIMITS = {
  post: { limit: 2, windowMs: 30 * 60 * 1000, message: '发帖过于频繁，请稍后再试' },
  comment: { limit: 1, windowMs: 10 * 1000, message: '评论过于频繁，请稍后再试' },
  report: { limit: 1, windowMs: 60 * 1000, message: '举报过于频繁，请稍后再试' },
};
const FEEDBACK_LIMIT_MS = 60 * 60 * 1000;
const ONLINE_WINDOW_MS = 2 * 60 * 1000;
const onlineSessions = new Map();

const rateBuckets = new Map();

const pruneOnlineSessions = (now) => {
  for (const [sessionId, lastSeen] of onlineSessions.entries()) {
    if (now - lastSeen > ONLINE_WINDOW_MS) {
      onlineSessions.delete(sessionId);
    }
  }
};

const touchOnlineSession = (sessionId) => {
  if (!sessionId) return;
  const now = Date.now();
  onlineSessions.set(sessionId, now);
  pruneOnlineSessions(now);
};

const getOnlineCount = () => {
  const now = Date.now();
  pruneOnlineSessions(now);
  return onlineSessions.size;
};

const normalizeIp = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const first = raw.split(',')[0].trim();
  if (!first) return '';
  if (first.startsWith('::ffff:')) {
    return first.slice(7);
  }
  if (first.includes('.') && first.includes(':')) {
    return first.replace(/:\d+$/, '');
  }
  return first;
};

const isValidIpv4 = (value) => {
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const num = Number(part);
    return num >= 0 && num <= 255;
  });
};

const getHeaderIp = (headerValue) => {
  const raw = Array.isArray(headerValue) ? headerValue.join(',') : String(headerValue || '');
  if (!raw.trim()) return '';
  const candidates = raw
    .split(',')
    .map((item) => normalizeIp(item))
    .filter(Boolean);
  const ipv4 = candidates.find((ip) => isValidIpv4(ip));
  return ipv4 || candidates[0] || '';
};

const getClientIp = (req) => {
  const cfIp = getHeaderIp(req.headers['cf-connecting-ip']);
  if (cfIp) return cfIp;
  const trueClientIp = getHeaderIp(req.headers['true-client-ip']);
  if (trueClientIp) return trueClientIp;
  const forwarded = getHeaderIp(req.headers['x-forwarded-for']);
  if (forwarded) return forwarded;
  return normalizeIp(req.socket?.remoteAddress) || normalizeIp(req.ip) || 'unknown';
};

const getFingerprintValue = (req) => {
  const headerValue = req.headers?.[FINGERPRINT_HEADER];
  if (Array.isArray(headerValue) && headerValue.length) {
    const first = String(headerValue[0] || '').trim();
    if (first) return first;
  }
  if (typeof headerValue === 'string' && headerValue.trim()) {
    return headerValue.trim();
  }
  const bodyValue = req.body?.fingerprint;
  if (typeof bodyValue === 'string' && bodyValue.trim()) {
    return bodyValue.trim();
  }
  return '';
};

const hashFingerprint = (value) => {
  if (!value) return '';
  return crypto.createHmac('sha256', FINGERPRINT_SALT).update(value).digest('hex');
};

const requireFingerprint = (req, res) => {
  const raw = getFingerprintValue(req);
  if (!raw) {
    res.status(400).json({ error: '浏览器指纹缺失，请刷新后重试' });
    return null;
  }
  return hashFingerprint(raw);
};

const getOptionalFingerprint = (req) => {
  const raw = getFingerprintValue(req);
  if (!raw) {
    return '';
  }
  return hashFingerprint(raw);
};

const trimPreview = (value, maxLength = 120) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) {
    return '';
  }
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
};

const createNotification = ({ recipientFingerprint, type, postId, commentId, preview, actorFingerprint }) => {
  if (!recipientFingerprint) {
    return;
  }
  if (actorFingerprint && recipientFingerprint === actorFingerprint) {
    return;
  }
  const now = Date.now();
  db.prepare(
    `
      INSERT INTO notifications (id, recipient_fingerprint, type, post_id, comment_id, preview, actor_fingerprint, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    crypto.randomUUID(),
    recipientFingerprint,
    type,
    postId || null,
    commentId || null,
    preview || null,
    actorFingerprint || null,
    now
  );
};

const verifyTurnstile = async (token, req, expectedAction) => {
  if (String(process.env.TURNSTILE_BYPASS || '').trim() === '1') {
    return { ok: true, bypass: true };
  }
  if (!turnstileEnabled) {
    return { ok: true, disabled: true };
  }
  if (!TURNSTILE_SECRET_KEY) {
    return { ok: false, status: 500, error: '安全验证未配置' };
  }

  const trimmed = String(token || '').trim();
  if (!trimmed) {
    return { ok: false, status: 400, error: '请完成安全验证' };
  }

  try {
    const params = new URLSearchParams();
    params.append('secret', TURNSTILE_SECRET_KEY);
    params.append('response', trimmed);
    const clientIp = getClientIp(req);
    if (clientIp && clientIp !== 'unknown') {
      params.append('remoteip', clientIp);
    }

    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      body: params,
    });
    const data = await response.json();

    if (!data?.success) {
      return { ok: false, status: 403, error: '安全验证失败，请重试' };
    }
    if (expectedAction && data?.action && data.action !== expectedAction) {
      return { ok: false, status: 403, error: '安全验证失败，请重试' };
    }

    return { ok: true };
  } catch (error) {
    console.error('Turnstile 验证失败:', error);
    return { ok: false, status: 502, error: '安全验证失败，请稍后重试' };
  }
};

const AUDIT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const logAdminAction = (req, payload) => {
  const admin = req.session?.admin;
  if (!admin) {
    return;
  }
  const now = Date.now();
  const beforeJson = payload.before ? JSON.stringify(payload.before) : null;
  const afterJson = payload.after ? JSON.stringify(payload.after) : null;
  db.prepare(
    `
    INSERT INTO admin_audit_logs (
      admin_id,
      admin_username,
      action,
      target_type,
      target_id,
      before_json,
      after_json,
      reason,
      ip,
      session_id,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    admin.id || null,
    admin.username || null,
    payload.action,
    payload.targetType,
    payload.targetId,
    beforeJson,
    afterJson,
    payload.reason || null,
    getClientIp(req),
    req.sessionID || null,
    now
  );
  db.prepare('DELETE FROM admin_audit_logs WHERE created_at < ?').run(now - AUDIT_RETENTION_MS);
};

const allowRate = (key, limit, windowMs) => {
  const now = Date.now();
  const bucket = rateBuckets.get(key) || [];
  const nextBucket = bucket.filter((timestamp) => now - timestamp < windowMs);
  if (nextBucket.length >= limit) {
    rateBuckets.set(key, nextBucket);
    return false;
  }
  nextBucket.push(now);
  rateBuckets.set(key, nextBucket);
  return true;
};

const enforceRateLimit = (req, res, action, fingerprint) => {
  const config = RATE_LIMITS[action];
  if (!config) {
    return true;
  }
  const sessionId = req.sessionID || 'unknown';
  const ip = getClientIp(req);
  const sessionKey = `${action}:session:${sessionId}`;
  const ipKey = `${action}:ip:${ip}`;
  const fingerprintKey = fingerprint ? `${action}:fingerprint:${fingerprint}` : null;
  const allowedBySession = allowRate(sessionKey, config.limit, config.windowMs);
  const allowedByIp = allowRate(ipKey, config.limit, config.windowMs);
  const allowedByFingerprint = fingerprintKey ? allowRate(fingerprintKey, config.limit, config.windowMs) : true;
  if (!allowedBySession || !allowedByIp || !allowedByFingerprint) {
    res.status(429).json({ error: config.message });
    return false;
  }
  return true;
};

const BAN_PERMISSIONS = ['post', 'comment', 'like', 'view', 'site'];

const parsePermissions = (value) => {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.filter((item) => typeof item === 'string' && item.trim());
    }
  } catch {
    return null;
  }
  return null;
};

const normalizePermissions = (value) => {
  const parsed = parsePermissions(value);
  if (parsed && parsed.length) {
    return Array.from(new Set(parsed));
  }
  return BAN_PERMISSIONS.slice();
};

const normalizeRequestedPermissions = (value) => {
  if (!Array.isArray(value)) {
    return null;
  }
  const cleaned = value
    .map((item) => String(item || '').trim())
    .filter((item) => BAN_PERMISSIONS.includes(item));
  return cleaned.length ? Array.from(new Set(cleaned)) : null;
};

const pruneExpiredBans = (table) => {
  const now = Date.now();
  db.prepare(`DELETE FROM ${table} WHERE expires_at IS NOT NULL AND expires_at <= ?`).run(now);
};

const getActiveBanRow = (table, column, value) => {
  if (!value) {
    return null;
  }
  const row = db
    .prepare(`SELECT ${column} AS value, banned_at, expires_at, permissions, reason FROM ${table} WHERE ${column} = ?`)
    .get(value);
  if (!row) {
    return null;
  }
  if (row.expires_at && row.expires_at <= Date.now()) {
    db.prepare(`DELETE FROM ${table} WHERE ${column} = ?`).run(value);
    return null;
  }
  return {
    ...row,
    permissions: normalizePermissions(row.permissions),
  };
};

const getActiveBans = (ip, fingerprint) => {
  const entries = [];
  const ipRow = getActiveBanRow('banned_ips', 'ip', ip);
  if (ipRow) {
    entries.push({ type: 'ip', ...ipRow });
  }
  const fingerprintRow = getActiveBanRow('banned_fingerprints', 'fingerprint', fingerprint);
  if (fingerprintRow) {
    entries.push({ type: 'fingerprint', ...fingerprintRow });
  }
  return entries;
};

const mergePermissions = (bans) => {
  const merged = new Set();
  bans.forEach((ban) => {
    ban.permissions.forEach((permission) => merged.add(permission));
  });
  return Array.from(merged);
};

const isBannedFor = (ip, fingerprint, permission) => {
  const bans = getActiveBans(ip, fingerprint);
  if (!bans.length) {
    return false;
  }
  return bans.some((ban) => ban.permissions.includes('site') || ban.permissions.includes(permission));
};

const checkBanFor = (req, res, permission, message, fingerprintOverride) => {
  const clientIp = getClientIp(req);
  const fingerprint = fingerprintOverride ?? getOptionalFingerprint(req);
  if (isBannedFor(clientIp, fingerprint, permission)) {
    res.status(403).json({ error: message });
    return false;
  }
  return true;
};

const upsertBan = (table, column, value, options = {}) => {
  if (!value) {
    return;
  }
  const now = Date.now();
  const permissions = normalizeRequestedPermissions(options.permissions) || BAN_PERMISSIONS;
  const expiresAt = typeof options.expiresAt === 'number' && options.expiresAt > now ? options.expiresAt : null;
  const reason = String(options.reason || '').trim() || null;
  db.prepare(
    `INSERT INTO ${table} (${column}, banned_at, expires_at, permissions, reason)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(${column}) DO UPDATE SET
       banned_at = excluded.banned_at,
       expires_at = excluded.expires_at,
       permissions = excluded.permissions,
       reason = excluded.reason`
  ).run(value, now, expiresAt, JSON.stringify(permissions), reason);
};

const resolveBanOptions = (req) => {
  const permissions = normalizeRequestedPermissions(req.body?.permissions);
  const expiresAt = typeof req.body?.expiresAt === 'number' ? req.body.expiresAt : null;
  const reason = String(req.body?.reason || '').trim();
  return {
    permissions: permissions || BAN_PERMISSIONS,
    expiresAt,
    reason,
  };
};

const seedSamplePosts = () => {
  const existing = db.prepare('SELECT COUNT(1) AS count FROM posts').get();
  if (existing?.count > 0) {
    return;
  }

  const now = Date.now();
  const samples = [
    {
      content: '有人注意到四楼那个“坏了”的咖啡机吗？每次副总在办公室的时候它就神奇地修好了。',
      tags: ['职场'],
      location: '办公室',
      likes: 248,
      comments: 42,
      views: 520,
      offset: 2 * 60 * 60 * 1000,
    },
    {
      content: '图书馆那个总是穿红色雨衣的人其实是在喂流浪猫。我昨天看见他从包里掏出一整条鱼。',
      tags: ['校园', '暖心'],
      location: '校园',
      imageUrl: 'https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?q=80&w=800&auto=format&fit=crop',
      likes: 512,
      comments: 89,
      views: 1200,
      offset: 5 * 60 * 60 * 1000,
    },
    {
      content: '设计部的实习生把 CEO 的肖像画成了辛普森风格，然后误发到了全员大群。',
      tags: ['职场', '爆料'],
      likes: 1024,
      comments: 156,
      views: 2200,
      offset: 15 * 60 * 1000,
    },
    {
      content: '我也没想到会在市中心的小破酒吧撞见 CEO 和竞争对手密会。',
      tags: ['爆料'],
      likes: 2100,
      comments: 342,
      views: 5200,
      offset: 2 * 60 * 60 * 1000,
    },
    {
      content: '那个咖啡师绝对在我的拿铁里吐口水了... 那天我只是因为牛奶不热让他重新做了一次。',
      tags: ['咖啡店'],
      likes: 1500,
      comments: 128,
      views: 4100,
      offset: 4 * 60 * 60 * 1000,
    },
  ];

  const insert = db.prepare(
    `\n    INSERT INTO posts (\n      id,\n      content,\n      author,\n      tags,\n      location,\n      image_url,\n      created_at,\n      likes_count,\n      comments_count,\n      views_count\n    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\n    `
  );

  samples.forEach((sample) => {
    insert.run(
      crypto.randomUUID(),
      sample.content,
      '匿名',
      JSON.stringify(sample.tags || []),
      sample.location || null,
      sample.imageUrl || null,
      now - sample.offset,
      sample.likes,
      sample.comments,
      sample.views
    );
  });

  incrementDailyStat(formatDateKey(), 'posts', samples.length);
};

// 示例数据已改为手动执行 init-data 脚本

const requireAdmin = (req, res, next) => {
  if (!adminEnabled) {
    return res.status(503).json({ error: '后台未启用，请配置管理员与会话密钥' });
  }
  if (!req.session?.admin) {
    return res.status(401).json({ error: '未登录' });
  }
  return next();
};

const requireAdminCsrf = (req, res, next) => {
  const token = String(req.headers['x-csrf-token'] || '').trim();
  const sessionToken = String(req.session?.admin?.csrfToken || '').trim();
  if (!token || !sessionToken || token !== sessionToken) {
    return res.status(403).json({ error: 'CSRF 验证失败' });
  }
  return next();
};

const parseTags = (tags) => {
  if (!tags) return [];
  try {
    const parsed = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const mapPostRow = (row, isHot) => ({
  id: row.id,
  content: row.content,
  author: row.author || '匿名',
  timestamp: formatRelativeTime(row.created_at),
  location: row.location || undefined,
  likes: row.likes_count,
  comments: row.comments_count,
  tags: parseTags(row.tags),
  isHot,
  imageUrl: row.image_url || '',
  createdAt: row.created_at,
  viewerReaction: row.viewer_reaction || null,
});

const mapCommentRow = (row) => {
  const deleted = row.deleted === 1;
  return {
    id: row.id,
    postId: row.post_id,
    parentId: row.parent_id || null,
    replyToId: row.reply_to_id || null,
    content: deleted ? '该评论违规已处理' : row.content,
    author: row.author || '匿名',
    timestamp: formatRelativeTime(row.created_at),
    createdAt: row.created_at,
    deleted,
  };
};

const mapAdminCommentRow = (row) => ({
  id: row.id,
  postId: row.post_id,
  parentId: row.parent_id || null,
  replyToId: row.reply_to_id || null,
  content: row.content,
  author: row.author || '匿名',
  timestamp: formatRelativeTime(row.created_at),
  createdAt: row.created_at,
  deleted: row.deleted === 1,
  deletedAt: row.deleted_at || null,
  ip: row.ip || null,
  fingerprint: row.fingerprint || null,
});

const getAnnouncement = () => {
  return db.prepare('SELECT content, updated_at FROM announcements WHERE id = ?').get('current');
};

const buildCommentTree = (rows) => {
  const nodes = new Map();
  rows.forEach((row) => {
    const node = { ...mapCommentRow(row), replies: [] };
    nodes.set(node.id, node);
  });

  nodes.forEach((node) => {
    if (!node.parentId) {
      return;
    }
    const parent = nodes.get(node.parentId);
    if (parent?.parentId) {
      node.parentId = parent.parentId;
    }
  });

  const roots = [];
  nodes.forEach((node) => {
    if (node.parentId && nodes.has(node.parentId)) {
      nodes.get(node.parentId).replies.push(node);
    } else {
      roots.push(node);
    }
  });

  const sortByCreatedAtDesc = (a, b) => (b.createdAt || 0) - (a.createdAt || 0);
  const sortTree = (list) => {
    list.sort(sortByCreatedAtDesc);
    list.forEach((item) => {
      if (item.replies?.length) {
        sortTree(item.replies);
      }
    });
  };

  sortTree(roots);
  return roots;
};

const hotScoreSql = '(views_count * 0.2 + likes_count * 3 + comments_count * 2)';

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/access', (req, res) => {
  const clientIp = getClientIp(req);
  const fingerprint = getOptionalFingerprint(req);
  const bans = getActiveBans(clientIp, fingerprint);
  const permissions = mergePermissions(bans);
  const blocked = bans.some((ban) => ban.permissions.includes('site'));
  const viewBlocked = bans.some((ban) => ban.permissions.includes('view'));
  const hasPermanent = bans.some((ban) => !ban.expires_at);
  const expiring = bans.map((ban) => ban.expires_at).filter((value) => typeof value === 'number');
  const expiresAt = hasPermanent || expiring.length === 0 ? null : Math.min(...expiring);
  return res.json({
    banned: bans.length > 0,
    blocked,
    viewBlocked,
    permissions,
    expiresAt,
  });
});

app.get('/api/settings', (req, res) => {
  return res.json({
    turnstileEnabled,
  });
});

app.get('/api/announcement', (req, res) => {
  const row = getAnnouncement();
  if (!row) {
    return res.json({ content: '', updatedAt: null });
  }
  return res.json({ content: row.content, updatedAt: row.updated_at });
});

app.post('/api/online/heartbeat', (req, res) => {
  touchOnlineSession(req.sessionID);
  return res.json({ onlineCount: getOnlineCount() });
});

app.get('/api/notifications', (req, res) => {
  const fingerprint = requireFingerprint(req, res);
  if (!fingerprint) {
    return;
  }
  if (!checkBanFor(req, res, 'like', '账号已被封禁，无法点赞', fingerprint)) {
    return;
  }
  if (!checkBanFor(req, res, 'view', '你已被限制浏览', fingerprint)) {
    return;
  }

  const status = String(req.query.status || 'all').trim();
  const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 50);
  const offset = Math.max(Number(req.query.offset || 0), 0);

  const conditions = ['recipient_fingerprint = ?'];
  const params = [fingerprint];

  if (status === 'unread') {
    conditions.push('read_at IS NULL');
  } else if (status === 'read') {
    conditions.push('read_at IS NOT NULL');
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `
        SELECT id, type, post_id, comment_id, preview, created_at, read_at
        FROM notifications
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `
    )
    .all(...params, limit, offset);

  const unreadCount = db
    .prepare('SELECT COUNT(1) AS count FROM notifications WHERE recipient_fingerprint = ? AND read_at IS NULL')
    .get(fingerprint)?.count ?? 0;

  const total = db
    .prepare('SELECT COUNT(1) AS count FROM notifications WHERE recipient_fingerprint = ?')
    .get(fingerprint)?.count ?? 0;

  const items = rows.map((row) => ({
    id: row.id,
    type: row.type,
    postId: row.post_id || null,
    commentId: row.comment_id || null,
    preview: row.preview || '',
    createdAt: row.created_at,
    readAt: row.read_at || null,
  }));

  return res.json({ items, unreadCount, total });
});

app.post('/api/notifications/read', (req, res) => {
  const fingerprint = requireFingerprint(req, res);
  if (!fingerprint) {
    return;
  }
  if (!checkBanFor(req, res, 'like', '账号已被封禁，无法点踩', fingerprint)) {
    return;
  }
  if (!checkBanFor(req, res, 'view', '你已被限制浏览', fingerprint)) {
    return;
  }
  const now = Date.now();
  const result = db
    .prepare('UPDATE notifications SET read_at = ? WHERE recipient_fingerprint = ? AND read_at IS NULL')
    .run(now, fingerprint);
  return res.json({ updated: result.changes || 0, readAt: now });
});

app.post('/api/feedback', async (req, res) => {
  const content = String(req.body?.content || '').trim();
  const email = String(req.body?.email || '').trim();
  const wechat = String(req.body?.wechat || '').trim();
  const qq = String(req.body?.qq || '').trim();

  if (!content) {
    return res.status(400).json({ error: '内容不能为空' });
  }

  if (content.length > 2000) {
    return res.status(400).json({ error: '内容超过字数限制' });
  }

  if (email.length > 200 || wechat.length > 100 || qq.length > 50) {
    return res.status(400).json({ error: '联系方式过长' });
  }

  if (email && !email.includes('@')) {
    return res.status(400).json({ error: '邮箱格式不正确' });
  }

  const fingerprint = requireFingerprint(req, res);
  if (!fingerprint) {
    return;
  }

  const clientIp = getClientIp(req);
  if (!checkBanFor(req, res, 'site', '账号已被封禁，无法留言', fingerprint)) {
    return;
  }

  const now = Date.now();
  let lastCreatedAt = 0;
  if (req.sessionID) {
    const lastBySession = db
      .prepare('SELECT created_at FROM feedback_messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(req.sessionID);
    if (lastBySession?.created_at) {
      lastCreatedAt = Math.max(lastCreatedAt, lastBySession.created_at);
    }
  }
  if (clientIp) {
    const lastByIp = db
      .prepare('SELECT created_at FROM feedback_messages WHERE ip = ? ORDER BY created_at DESC LIMIT 1')
      .get(clientIp);
    if (lastByIp?.created_at) {
      lastCreatedAt = Math.max(lastCreatedAt, lastByIp.created_at);
    }
  }
  if (fingerprint) {
    const lastByFingerprint = db
      .prepare('SELECT created_at FROM feedback_messages WHERE fingerprint = ? ORDER BY created_at DESC LIMIT 1')
      .get(fingerprint);
    if (lastByFingerprint?.created_at) {
      lastCreatedAt = Math.max(lastCreatedAt, lastByFingerprint.created_at);
    }
  }
  if (lastCreatedAt && now - lastCreatedAt < FEEDBACK_LIMIT_MS) {
    return res.status(429).json({ error: '留言过于频繁，请稍后再试' });
  }

  const feedbackVerification = await verifyTurnstile(req.body?.turnstileToken, req, 'feedback');
  if (!feedbackVerification.ok) {
    return res.status(feedbackVerification.status).json({ error: feedbackVerification.error });
  }

  const feedbackId = crypto.randomUUID();
  db.prepare(
    `
    INSERT INTO feedback_messages (
      id,
      content,
      email,
      wechat,
      qq,
      created_at,
      session_id,
      ip,
      fingerprint
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    feedbackId,
    content,
    email,
    wechat || null,
    qq || null,
    now,
    req.sessionID || null,
    clientIp || null,
    fingerprint
  );

  return res.status(201).json({ ok: true });
});

app.get('/api/posts/home', (req, res) => {
  if (!checkBanFor(req, res, 'view', '你已被限制浏览')) {
    return;
  }
  const limit = Math.min(Number(req.query.limit || 10), 50);
  const offset = Math.max(Number(req.query.offset || 0), 0);
  const dateKey = formatDateKey();
  trackDailyVisit(dateKey, req.sessionID);
  const viewerFingerprint = getOptionalFingerprint(req);

  const total = db
    .prepare(
      `
        SELECT COUNT(*) as count
        FROM posts
        WHERE deleted = 0
      `
    )
    .get()?.count ?? 0;

  const rows = db
    .prepare(
      `
        SELECT posts.*, ${hotScoreSql} AS hot_score, pr.reaction AS viewer_reaction
      FROM posts
      LEFT JOIN post_reactions pr
        ON pr.post_id = posts.id
        AND pr.session_id = ?
        WHERE posts.deleted = 0
        ORDER BY posts.created_at DESC
        LIMIT ? OFFSET ?
        `
    )
    .all(viewerFingerprint, limit, offset);

  const posts = rows.map((row) => mapPostRow(row, row.hot_score >= 20));
  res.json({ items: posts, total });
});

app.get('/api/posts/feed', (req, res) => {
  if (!checkBanFor(req, res, 'view', '你已被限制浏览')) {
    return;
  }
  const filter = String(req.query.filter || 'week');
  const search = String(req.query.search || '').trim();
  const dateKey = formatDateKey();
  trackDailyVisit(dateKey, req.sessionID);
  const viewerFingerprint = getOptionalFingerprint(req);

  const conditions = ['posts.deleted = 0'];
  const params = [viewerFingerprint];

  if (filter === 'today') {
    conditions.push('posts.created_at >= ?');
    params.push(startOfDay());
  } else if (filter === 'week') {
    conditions.push('posts.created_at >= ?');
    params.push(startOfWeek());
  }

  if (search) {
    conditions.push('(posts.id LIKE ? OR posts.content LIKE ? OR posts.ip LIKE ? OR posts.fingerprint LIKE ?)');
    const keyword = `%${search}%`;
    params.push(keyword, keyword, keyword, keyword);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = db
    .prepare(
      `
      SELECT posts.*, ${hotScoreSql} AS hot_score, pr.reaction AS viewer_reaction
      FROM posts
      LEFT JOIN post_reactions pr
        ON pr.post_id = posts.id
        AND pr.session_id = ?
      ${whereClause}
      ORDER BY hot_score DESC, posts.created_at DESC
      `
    )
    .all(...params);

  const posts = rows.map((row, index) => mapPostRow(row, index < 3));
  res.json({ items: posts, total: posts.length });
});

app.get('/api/posts/search', (req, res) => {
  if (!checkBanFor(req, res, 'view', '你已被限制浏览')) {
    return;
  }
  const keywordRaw = String(req.query.q || '').trim();
  const page = Math.max(Number(req.query.page || 1), 1);
  const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 50);
  const offset = (page - 1) * limit;
  const dateKey = formatDateKey();
  trackDailyVisit(dateKey, req.sessionID);
  const viewerFingerprint = getOptionalFingerprint(req);

  if (!keywordRaw) {
    return res.json({ items: [], total: 0, page, limit });
  }

  // 仅做内容关键字搜索：把 LIKE 的通配符当作字面量，避免用户输入 %/_ 导致意外匹配。
  const escapeLike = (value) => String(value).replace(/[\\%_]/g, (match) => `\\${match}`);
  const keyword = `%${escapeLike(keywordRaw)}%`;

  const total = db
    .prepare(
      `
        SELECT COUNT(1) AS count
        FROM posts
        WHERE deleted = 0
          AND content LIKE ? ESCAPE '\\'
      `
    )
    .get(keyword)?.count ?? 0;

  const rows = db
    .prepare(
      `
        SELECT posts.*, ${hotScoreSql} AS hot_score, pr.reaction AS viewer_reaction
        FROM posts
        LEFT JOIN post_reactions pr
          ON pr.post_id = posts.id
          AND pr.session_id = ?
        WHERE posts.deleted = 0
          AND posts.content LIKE ? ESCAPE '\\'
        ORDER BY posts.created_at DESC
        LIMIT ? OFFSET ?
      `
    )
    .all(viewerFingerprint, keyword, limit, offset);

  const items = rows.map((row) => mapPostRow(row, row.hot_score >= 20));
  return res.json({ items, total, page, limit });
});

app.post('/api/posts', async (req, res) => {
  const content = String(req.body?.content || '').trim();
  const tags = Array.isArray(req.body?.tags) ? req.body.tags : [];

  if (!content) {
    return res.status(400).json({ error: '内容不能为空' });
  }

  if (content.length > 2000) {
    return res.status(400).json({ error: '内容超过字数限制' });
  }

  if (containsSensitiveWord(content)) {
    return res.status(400).json({ error: '内容包含敏感词，请修改后再提交' });
  }

  const fingerprint = requireFingerprint(req, res);
  if (!fingerprint) {
    return;
  }

  if (!enforceRateLimit(req, res, 'post', fingerprint)) {
    return;
  }

  const clientIp = getClientIp(req);
  if (!checkBanFor(req, res, 'post', '账号已被封禁，无法投稿', fingerprint)) {
    return;
  }

  const postVerification = await verifyTurnstile(req.body?.turnstileToken, req, 'post');
  if (!postVerification.ok) {
    return res.status(postVerification.status).json({ error: postVerification.error });
  }

  const now = Date.now();
  const postId = crypto.randomUUID();

  db.prepare(
    `
    INSERT INTO posts (id, content, author, tags, created_at, session_id, ip, fingerprint)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(postId, content, '匿名', JSON.stringify(tags), now, req.sessionID, clientIp, fingerprint);

  incrementDailyStat(formatDateKey(), 'posts', 1);

  const row = db
    .prepare(
      `
      SELECT posts.*, ${hotScoreSql} AS hot_score, pr.reaction AS viewer_reaction
      FROM posts
      LEFT JOIN post_reactions pr
        ON pr.post_id = posts.id
        AND pr.session_id = ?
      WHERE posts.id = ?
      `
    )
    .get(fingerprint, postId);

  generateSnapshotForPost({ id: postId, content, created_at: now });
  scheduleSitemapGenerate();

  return res.status(201).json({ post: mapPostRow(row, false) });
});

app.get('/api/posts/:id', (req, res) => {
  if (!checkBanFor(req, res, 'view', '你已被限制浏览')) {
    return;
  }
  const postId = String(req.params.id || '').trim();
  if (!postId) {
    return res.status(400).json({ error: '帖子不存在' });
  }
  const viewerFingerprint = getOptionalFingerprint(req);

  const row = db
    .prepare(
      `
      SELECT posts.*, ${hotScoreSql} AS hot_score, pr.reaction AS viewer_reaction
      FROM posts
      LEFT JOIN post_reactions pr
        ON pr.post_id = posts.id
        AND pr.session_id = ?
      WHERE posts.id = ?
        AND posts.deleted = 0
      `
    )
    .get(viewerFingerprint, postId);

  if (!row) {
    return res.status(404).json({ error: '帖子不存在或已删除' });
  }

  return res.json({ post: mapPostRow(row, row.hot_score >= 20) });
});

const toggleReaction = db.transaction((postId, identityKey, reaction) => {
  const existing = db
    .prepare('SELECT reaction FROM post_reactions WHERE post_id = ? AND session_id = ?')
    .get(postId, identityKey);

  let likesDelta = 0;
  let dislikesDelta = 0;
  let nextReaction = null;

  if (!existing) {
    db.prepare(
      'INSERT INTO post_reactions (post_id, session_id, reaction, created_at) VALUES (?, ?, ?, ?)'
    ).run(postId, identityKey, reaction, Date.now());
    if (reaction === 'like') likesDelta += 1;
    if (reaction === 'dislike') dislikesDelta += 1;
    nextReaction = reaction;
  } else if (existing.reaction === reaction) {
    db.prepare('DELETE FROM post_reactions WHERE post_id = ? AND session_id = ?').run(postId, identityKey);
    if (reaction === 'like') likesDelta -= 1;
    if (reaction === 'dislike') dislikesDelta -= 1;
    nextReaction = null;
  } else {
    db.prepare('UPDATE post_reactions SET reaction = ?, created_at = ? WHERE post_id = ? AND session_id = ?')
      .run(reaction, Date.now(), postId, identityKey);
    if (reaction === 'like') {
      likesDelta += 1;
      dislikesDelta -= 1;
    } else {
      likesDelta -= 1;
      dislikesDelta += 1;
    }
    nextReaction = reaction;
  }

  db.prepare(
    `
    UPDATE posts
    SET likes_count = MAX(likes_count + ?, 0),
        dislikes_count = MAX(dislikes_count + ?, 0)
    WHERE id = ?
    `
  ).run(likesDelta, dislikesDelta, postId);

  const counts = db.prepare('SELECT likes_count, dislikes_count FROM posts WHERE id = ?').get(postId);
  return { ...counts, reaction: nextReaction };
});

app.post('/api/posts/:id/like', (req, res) => {
  const postId = req.params.id;
  const post = db.prepare('SELECT id, fingerprint, content FROM posts WHERE id = ? AND deleted = 0').get(postId);
  if (!post) {
    return res.status(404).json({ error: '内容不存在' });
  }

  const fingerprint = requireFingerprint(req, res);
  if (!fingerprint) {
    return;
  }

  const result = toggleReaction(postId, fingerprint, 'like');
  if (result.reaction === 'like') {
    createNotification({
      recipientFingerprint: post.fingerprint,
      type: 'post_like',
      postId,
      preview: trimPreview(post.content),
      actorFingerprint: fingerprint,
    });
  }
  return res.json({
    likes: result.likes_count,
    dislikes: result.dislikes_count,
    reaction: result.reaction,
  });
});

app.post('/api/posts/:id/dislike', (req, res) => {
  const postId = req.params.id;
  const post = db.prepare('SELECT id, fingerprint FROM posts WHERE id = ? AND deleted = 0').get(postId);
  if (!post) {
    return res.status(404).json({ error: '内容不存在' });
  }

  const fingerprint = requireFingerprint(req, res);
  if (!fingerprint) {
    return;
  }

  const result = toggleReaction(postId, fingerprint, 'dislike');
  return res.json({
    likes: result.likes_count,
    dislikes: result.dislikes_count,
    reaction: result.reaction,
  });
});

app.post('/api/posts/:id/view', (req, res) => {
  if (!checkBanFor(req, res, 'view', '你已被限制浏览')) {
    return;
  }
  const postId = req.params.id;
  const post = db.prepare('SELECT id, views_count FROM posts WHERE id = ? AND deleted = 0').get(postId);
  if (!post) {
    return res.status(404).json({ error: '内容不存在' });
  }

  const result = db
    .prepare('INSERT OR IGNORE INTO post_views (post_id, session_id, created_at) VALUES (?, ?, ?)')
    .run(postId, req.sessionID, Date.now());

  if (result.changes > 0) {
    db.prepare('UPDATE posts SET views_count = views_count + 1 WHERE id = ?').run(postId);
  }

  const updated = db.prepare('SELECT views_count FROM posts WHERE id = ?').get(postId);
  return res.json({ views: updated.views_count });
});

app.get('/api/posts/:id/comments', (req, res) => {
  if (!checkBanFor(req, res, 'view', '你已被限制浏览')) {
    return;
  }
  const postId = req.params.id;
  const limit = Math.min(Number(req.query.limit || 10), 200);
  const offset = Math.max(Number(req.query.offset || 0), 0);

  const post = db.prepare('SELECT id, fingerprint FROM posts WHERE id = ? AND deleted = 0').get(postId);
  if (!post) {
    return res.status(404).json({ error: '内容不存在' });
  }

  const totalRow = db
    .prepare('SELECT COUNT(1) AS count FROM comments WHERE post_id = ? AND parent_id IS NULL')
    .get(postId);
  const total = totalRow?.count || 0;

  const rootRows = db
    .prepare(
      `\n      SELECT *\n      FROM comments\n      WHERE post_id = ? AND parent_id IS NULL\n      ORDER BY created_at ASC\n      LIMIT ? OFFSET ?\n      `
    )
    .all(postId, limit, offset);

  if (rootRows.length === 0) {
    return res.json({ items: [], total });
  }

  const rootIds = rootRows.map((row) => row.id);
  const placeholders = rootIds.map(() => '?').join(', ');
  const replyRows = db
    .prepare(
      `\n      SELECT *\n      FROM comments\n      WHERE post_id = ? AND parent_id IN (${placeholders})\n      ORDER BY created_at ASC\n      `
    )
    .all(postId, ...rootIds);

  return res.json({ items: buildCommentTree([...rootRows, ...replyRows]), total });
});

app.get('/api/posts/:id/comment-thread', (req, res) => {
  if (!checkBanFor(req, res, 'view', '你已被限制浏览')) {
    return;
  }
  const postId = req.params.id;
  const commentId = String(req.query.commentId || '').trim();
  if (!commentId) {
    return res.status(400).json({ error: '缺少 commentId' });
  }

  const commentRow = db
    .prepare('SELECT * FROM comments WHERE id = ?')
    .get(commentId);
  if (!commentRow || commentRow.post_id !== postId) {
    return res.status(404).json({ error: '评论不存在' });
  }

  const rootId = commentRow.parent_id || commentRow.id;
  const rootRow = db
    .prepare('SELECT * FROM comments WHERE id = ?')
    .get(rootId);
  if (!rootRow || rootRow.post_id !== postId) {
    return res.status(404).json({ error: '评论不存在' });
  }

  const replyRows = db
    .prepare(
      `
      SELECT *
      FROM comments
      WHERE post_id = ? AND parent_id = ?
      ORDER BY created_at ASC
      `
    )
    .all(postId, rootId);

  const replies = replyRows
    .filter((row) => row.id !== rootId)
    .map((row) => mapCommentRow(row));

  const thread = { ...mapCommentRow(rootRow), replies };
  return res.json({ thread });
});

app.post('/api/posts/:id/comments', async (req, res) => {
  const postId = req.params.id;
  const content = String(req.body?.content || '').trim();
  const parentId = String(req.body?.parentId || '').trim();
  const replyToId = String(req.body?.replyToId || '').trim();

  if (!content) {
    return res.status(400).json({ error: '评论不能为空' });
  }

  if (content.length > 300) {
    return res.status(400).json({ error: '评论长度不能超过 300 字' });
  }

  if (containsSensitiveWord(content)) {
    return res.status(400).json({ error: '评论包含敏感词，请修改后再提交' });
  }

  const fingerprint = requireFingerprint(req, res);
  if (!fingerprint) {
    return;
  }

  if (!enforceRateLimit(req, res, 'comment', fingerprint)) {
    return;
  }

  const clientIp = getClientIp(req);
  if (!checkBanFor(req, res, 'comment', '账号已被封禁，无法评论', fingerprint)) {
    return;
  }

  const post = db.prepare('SELECT id, fingerprint FROM posts WHERE id = ? AND deleted = 0').get(postId);
  if (!post) {
    return res.status(404).json({ error: '内容不存在' });
  }

  let parentRow = null;
  if (parentId) {
    parentRow = db
      .prepare('SELECT id, post_id, parent_id FROM comments WHERE id = ? AND deleted = 0')
      .get(parentId);
    if (!parentRow) {
      return res.status(400).json({ error: '回复的评论不存在' });
    }
    if (parentRow.post_id !== postId) {
      return res.status(400).json({ error: '回复内容不匹配' });
    }
  }

  const commentVerification = await verifyTurnstile(req.body?.turnstileToken, req, 'comment');
  if (!commentVerification.ok) {
    return res.status(commentVerification.status).json({ error: commentVerification.error });
  }

  const now = Date.now();
  const commentId = crypto.randomUUID();

  const finalParentId = parentRow?.parent_id ? parentRow.parent_id : parentId || null;
  const finalReplyToId = replyToId || parentId || null;

  db.prepare(
    `\n    INSERT INTO comments (id, post_id, parent_id, reply_to_id, content, author, created_at, fingerprint, ip)\n    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)\n    `
  ).run(commentId, postId, finalParentId, finalReplyToId, content, '匿名', now, fingerprint, clientIp || null);

  db.prepare('UPDATE posts SET comments_count = comments_count + 1 WHERE id = ?').run(postId);

  const commentPreview = trimPreview(content);
  let replyRecipient = '';
  if (finalReplyToId) {
    const replyTarget = db.prepare('SELECT fingerprint FROM comments WHERE id = ?').get(finalReplyToId);
    replyRecipient = replyTarget?.fingerprint || '';
    if (replyRecipient && replyRecipient !== fingerprint) {
      createNotification({
        recipientFingerprint: replyRecipient,
        type: 'comment_reply',
        postId,
        commentId: commentId,
        preview: commentPreview,
        actorFingerprint: fingerprint,
      });
    }
  }

  if (post.fingerprint && post.fingerprint !== fingerprint && post.fingerprint !== replyRecipient) {
    createNotification({
      recipientFingerprint: post.fingerprint,
      type: 'post_comment',
      postId,
      commentId: commentId,
      preview: commentPreview,
      actorFingerprint: fingerprint,
    });
  }

  return res.status(201).json({
    comment: mapCommentRow({
      id: commentId,
      post_id: postId,
      parent_id: finalParentId,
      reply_to_id: finalReplyToId,
      content,
      author: '匿名',
      created_at: now,
    }),
  });
});

const resolveRiskLevel = (reason) => {
  if (reason.includes('隐私')) return 'high';
  if (reason.includes('骚扰')) return 'medium';
  if (reason.includes('虚假')) return 'medium';
  if (reason.includes('广告')) return 'low';
  return 'low';
};

app.post('/api/reports', (req, res) => {
  const postId = String(req.body?.postId || '').trim();
  const commentId = String(req.body?.commentId || '').trim();
  const reason = String(req.body?.reason || '').trim();

  if (!reason || (!postId && !commentId)) {
    return res.status(400).json({ error: '参数不完整' });
  }

  const fingerprint = requireFingerprint(req, res);
  if (!fingerprint) {
    return;
  }

  if (!enforceRateLimit(req, res, 'report', fingerprint)) {
    return;
  }

  if (!checkBanFor(req, res, 'view', '账号已被封禁，无法举报', fingerprint)) {
    return;
  }

  const reporterIp = getClientIp(req);

  let targetType = 'post';
  let targetPostId = postId;
  let targetCommentId = '';
  let snippet = '';

  if (commentId) {
    const commentRow = db
      .prepare('SELECT id, post_id, content FROM comments WHERE id = ? AND deleted = 0')
      .get(commentId);
    if (!commentRow) {
      return res.status(404).json({ error: '评论不存在' });
    }
    targetType = 'comment';
    targetPostId = commentRow.post_id;
    targetCommentId = commentRow.id;
    snippet = String(commentRow.content || '').slice(0, 100);
  } else {
    const post = db.prepare('SELECT content FROM posts WHERE id = ? AND deleted = 0').get(postId);
    if (!post) {
      return res.status(404).json({ error: '内容不存在' });
    }
    snippet = String(post.content || '').slice(0, 100);
  }

  const reportId = crypto.randomUUID();
  const now = Date.now();

  const sessionId = req.sessionID || 'unknown';
  if (targetType === 'comment') {
    if (sessionId) {
      const existingSession = db
        .prepare('SELECT 1 FROM comment_report_sessions WHERE comment_id = ? AND session_id = ?')
        .get(targetCommentId, sessionId);
      if (existingSession) {
        return res.status(409).json({ error: '你已举报过该内容' });
      }
    }
    const existingFingerprint = db
      .prepare('SELECT 1 FROM comment_report_fingerprints WHERE comment_id = ? AND fingerprint = ?')
      .get(targetCommentId, fingerprint);
    if (existingFingerprint) {
      return res.status(409).json({ error: '你已举报过该内容' });
    }
    if (sessionId) {
      db.prepare('INSERT OR IGNORE INTO comment_report_sessions (comment_id, session_id, created_at) VALUES (?, ?, ?)')
        .run(targetCommentId, sessionId, now);
    }
    db.prepare('INSERT OR IGNORE INTO comment_report_fingerprints (comment_id, fingerprint, created_at) VALUES (?, ?, ?)')
      .run(targetCommentId, fingerprint, now);
  } else {
    if (sessionId) {
      const existingSession = db
        .prepare('SELECT 1 FROM report_sessions WHERE post_id = ? AND session_id = ?')
        .get(targetPostId, sessionId);
      if (existingSession) {
        return res.status(409).json({ error: '你已举报过该内容' });
      }
    }
    const existingFingerprint = db
      .prepare('SELECT 1 FROM report_fingerprints WHERE post_id = ? AND fingerprint = ?')
      .get(targetPostId, fingerprint);
    if (existingFingerprint) {
      return res.status(409).json({ error: '你已举报过该内容' });
    }
    if (sessionId) {
      db.prepare('INSERT OR IGNORE INTO report_sessions (post_id, session_id, created_at) VALUES (?, ?, ?)')
        .run(targetPostId, sessionId, now);
    }
    db.prepare('INSERT OR IGNORE INTO report_fingerprints (post_id, fingerprint, created_at) VALUES (?, ?, ?)')
      .run(targetPostId, fingerprint, now);
  }

  db.prepare(
    `
      INSERT INTO reports (id, post_id, comment_id, target_type, reason, content_snippet, created_at, status, risk_level, fingerprint, reporter_ip)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
    `
  ).run(reportId, targetPostId, targetCommentId || null, targetType, reason, snippet, now, resolveRiskLevel(reason), fingerprint, reporterIp);

  incrementDailyStat(formatDateKey(), 'reports', 1);

  return res.status(201).json({ id: reportId });
});

app.get('/api/reports', requireAdmin, (req, res) => {
  const status = String(req.query.status || '').trim();
  const search = String(req.query.search || '').trim();

  const conditions = [];
  const params = [];

  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }

  if (search) {
    conditions.push(
      '(reports.id LIKE ? OR reports.content_snippet LIKE ? OR reports.reason LIKE ? OR reports.post_id LIKE ? OR reports.comment_id LIKE ? OR posts.content LIKE ? OR comments.content LIKE ? OR posts.ip LIKE ? OR comments.ip LIKE ? OR posts.fingerprint LIKE ? OR comments.fingerprint LIKE ?)'
    );
    const keyword = `%${search}%`;
    params.push(keyword, keyword, keyword, keyword, keyword, keyword, keyword, keyword, keyword, keyword, keyword);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = db
    .prepare(
      `
      SELECT reports.*,
        posts.content AS post_content,
        posts.ip AS post_ip,
        posts.fingerprint AS post_fingerprint,
        comments.content AS comment_content,
        comments.ip AS comment_ip,
        comments.fingerprint AS comment_fingerprint,
        reporter_stats.reporter_count AS reporter_count
      FROM reports
      LEFT JOIN posts ON posts.id = reports.post_id
      LEFT JOIN comments ON comments.id = reports.comment_id
      LEFT JOIN (
        SELECT fingerprint, COUNT(1) AS reporter_count
        FROM reports
        GROUP BY fingerprint
      ) reporter_stats ON reporter_stats.fingerprint = reports.fingerprint
      ${whereClause}
      ORDER BY reports.created_at DESC
      `
    )
    .all(...params);

  const reports = rows.map((row) => {
    const isComment = row.target_type === 'comment';
    const postContent = row.post_content || '';
    const commentContent = row.comment_content || '';
    return {
      id: row.id,
      targetId: isComment ? row.comment_id : row.post_id,
      targetType: row.target_type || 'post',
      postId: row.post_id,
      reason: row.reason,
      contentSnippet: row.content_snippet,
      postContent,
      commentContent,
      targetContent: isComment ? commentContent : postContent,
      targetIp: isComment ? row.comment_ip || null : row.post_ip || null,
      targetFingerprint: isComment ? row.comment_fingerprint || null : row.post_fingerprint || null,
      reporterIp: row.reporter_ip || null,
      reporterFingerprint: row.fingerprint || null,
      reporterCount: row.reporter_count ? Number(row.reporter_count) : 0,
      timestamp: formatRelativeTime(row.created_at),
      status: row.status,
      riskLevel: row.risk_level,
    };
  });

  return res.json({ items: reports });
});

app.post('/api/reports/:id/action', requireAdmin, requireAdminCsrf, (req, res) => {
  const reportId = req.params.id;
  const action = String(req.body?.action || '').trim();
  const reason = String(req.body?.reason || '').trim();

  if (!['ignore', 'delete', 'ban'].includes(action)) {
    return res.status(400).json({ error: '无效操作' });
  }

  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(reportId);
  if (!report) {
    return res.status(404).json({ error: '举报不存在' });
  }

  const now = Date.now();
  const banOptions = action === 'ban' ? resolveBanOptions(req) : null;
  const nextStatus = action === 'ignore' ? 'ignored' : 'resolved';

  db.prepare(
    'UPDATE reports SET status = ?, action = ?, resolved_at = ? WHERE id = ?'
  ).run(nextStatus, action, now, reportId);

  if (action === 'delete' || action === 'ban') {
    if (report.target_type === 'comment' && report.comment_id) {
      const commentRow = db
        .prepare('SELECT id, post_id, ip, fingerprint FROM comments WHERE id = ?')
        .get(report.comment_id);
      if (commentRow) {
        const removedCount = commentRow.deleted === 1 ? 0 : 1;
        if (removedCount > 0) {
          db.prepare('UPDATE comments SET deleted = 1, deleted_at = ? WHERE id = ?')
            .run(now, report.comment_id);
          db.prepare(
            'UPDATE posts SET comments_count = CASE WHEN comments_count - 1 < 0 THEN 0 ELSE comments_count - 1 END WHERE id = ?'
          ).run(report.post_id);
        }
      }

      if (action === 'ban' && banOptions) {
        if (commentRow?.ip) {
          upsertBan('banned_ips', 'ip', commentRow.ip, banOptions);
        }
        if (commentRow?.fingerprint) {
          upsertBan('banned_fingerprints', 'fingerprint', commentRow.fingerprint, banOptions);
        }
      }
    } else {
      const post = db.prepare('SELECT ip, fingerprint FROM posts WHERE id = ?').get(report.post_id);
      db.prepare('UPDATE posts SET deleted = 1, deleted_at = ? WHERE id = ?').run(now, report.post_id);

      if (action === 'ban' && banOptions) {
        if (post?.ip) {
          upsertBan('banned_ips', 'ip', post.ip, banOptions);
        }
        if (post?.fingerprint) {
          upsertBan('banned_fingerprints', 'fingerprint', post.fingerprint, banOptions);
        }
      }
    }
  }

  logAdminAction(req, {
    action: `report_${action}`,
    targetType: 'report',
    targetId: reportId,
    before: { status: report.status, action: report.action || null },
    after: { status: nextStatus, action },
    reason,
  });

  if (action === 'ban') {
    const post = report.target_type === 'comment'
      ? db.prepare('SELECT ip, fingerprint FROM comments WHERE id = ?').get(report.comment_id)
      : db.prepare('SELECT ip, fingerprint FROM posts WHERE id = ?').get(report.post_id);
    if (post?.ip) {
      logAdminAction(req, {
        action: 'ban_ip',
        targetType: 'ip',
        targetId: post.ip,
        before: null,
        after: { banned: true, permissions: banOptions?.permissions || BAN_PERMISSIONS, expiresAt: banOptions?.expiresAt || null },
        reason,
      });
    }
    if (post?.fingerprint) {
      logAdminAction(req, {
        action: 'ban_fingerprint',
        targetType: 'fingerprint',
        targetId: post.fingerprint,
        before: null,
        after: { banned: true, permissions: banOptions?.permissions || BAN_PERMISSIONS, expiresAt: banOptions?.expiresAt || null },
        reason,
      });
    }
  }

  return res.json({ status: nextStatus, action });
});

app.post('/api/admin/reports/batch', requireAdmin, requireAdminCsrf, (req, res) => {
  const action = String(req.body?.action || '').trim();
  const reason = String(req.body?.reason || '').trim();
  const reportIds = Array.isArray(req.body?.reportIds) ? req.body.reportIds : [];

  if (action !== 'resolve') {
    return res.status(400).json({ error: '无效操作' });
  }

  const ids = Array.from(new Set(reportIds.map((id) => String(id || '').trim()).filter(Boolean)));
  if (!ids.length) {
    return res.status(400).json({ error: '未选择举报' });
  }
  if (ids.length > 200) {
    return res.status(400).json({ error: '批量操作数量过多' });
  }

  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT id, status, action FROM reports WHERE id IN (${placeholders})`)
    .all(...ids);

  const now = Date.now();
  const result = db
    .prepare(`UPDATE reports SET status = 'resolved', action = 'reviewed', resolved_at = ? WHERE id IN (${placeholders}) AND status = 'pending'`)
    .run(now, ...ids);

  rows
    .filter((row) => row.status === 'pending')
    .forEach((row) => {
      logAdminAction(req, {
        action: 'report_resolve',
        targetType: 'report',
        targetId: row.id,
        before: { status: row.status, action: row.action || null },
        after: { status: 'resolved', action: 'reviewed' },
        reason,
      });
    });

  return res.json({ updated: result.changes || 0 });
});

app.post('/api/admin/posts', requireAdmin, requireAdminCsrf, (req, res) => {
  const content = String(req.body?.content || '').trim();
  const tags = Array.isArray(req.body?.tags) ? req.body.tags : [];
  const reason = String(req.body?.reason || '').trim();
  const includeDeveloper = Boolean(req.body?.includeDeveloper);

  if (!content) {
    return res.status(400).json({ error: '内容不能为空' });
  }

  if (content.length > 2000) {
    return res.status(400).json({ error: '内容超过字数限制' });
  }

  if (containsSensitiveWord(content)) {
    return res.status(400).json({ error: '内容包含敏感词，请修改后再提交' });
  }

  const clientIp = getClientIp(req);
  if (!checkBanFor(req, res, 'post', '账号已被封禁，无法投稿')) {
    return;
  }

  const now = Date.now();
  const postId = crypto.randomUUID();
  const viewerFingerprint = getOptionalFingerprint(req);
  const author = includeDeveloper ? 'admin' : '匿名';

  db.prepare(
    `
    INSERT INTO posts (id, content, author, tags, created_at, session_id, ip, fingerprint)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(postId, content, author, JSON.stringify(tags), now, req.sessionID, clientIp, viewerFingerprint || null);

  incrementDailyStat(formatDateKey(), 'posts', 1);

  const row = db
    .prepare(
      `
      SELECT posts.*, ${hotScoreSql} AS hot_score, pr.reaction AS viewer_reaction
      FROM posts
      LEFT JOIN post_reactions pr
        ON pr.post_id = posts.id
        AND pr.session_id = ?
      WHERE posts.id = ?
      `
    )
    .get(viewerFingerprint, postId);

  logAdminAction(req, {
    action: 'post_create',
    targetType: 'post',
    targetId: postId,
    before: null,
    after: { content },
    reason,
  });

  return res.status(201).json({ post: mapPostRow(row, false) });
});

app.post('/api/admin/posts/:id/edit', requireAdmin, requireAdminCsrf, (req, res) => {
  const postId = String(req.params.id || '').trim();
  const content = String(req.body?.content || '').trim();
  const reason = String(req.body?.reason || '').trim();

  if (!postId) {
    return res.status(400).json({ error: '帖子不存在' });
  }

  if (!content) {
    return res.status(400).json({ error: '内容不能为空' });
  }

  if (content.length > 2000) {
    return res.status(400).json({ error: '内容超过字数限制' });
  }

  if (containsSensitiveWord(content)) {
    return res.status(400).json({ error: '内容包含敏感词，请修改后再提交' });
  }

  const existing = db.prepare('SELECT id, content, deleted FROM posts WHERE id = ?').get(postId);
  if (!existing) {
    return res.status(404).json({ error: '帖子不存在' });
  }

  if (existing.content === content) {
    return res.json({ id: postId, content });
  }

  const now = Date.now();
  const editId = crypto.randomUUID();
  const admin = req.session?.admin;

  db.prepare('UPDATE posts SET content = ?, updated_at = ? WHERE id = ?')
    .run(content, now, postId);

  db.prepare(
    `
    INSERT INTO post_edits (
      id,
      post_id,
      editor_id,
      editor_username,
      before_content,
      after_content,
      created_at,
      reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    editId,
    postId,
    admin?.id || null,
    admin?.username || null,
    existing.content,
    content,
    now,
    reason || null
  );

  logAdminAction(req, {
    action: 'post_edit',
    targetType: 'post',
    targetId: postId,
    before: { content: existing.content },
    after: { content },
    reason,
  });

  return res.json({ id: postId, content });
});

app.post('/api/admin/posts/batch', requireAdmin, requireAdminCsrf, (req, res) => {
  const action = String(req.body?.action || '').trim();
  const reason = String(req.body?.reason || '').trim();
  const postIds = Array.isArray(req.body?.postIds) ? req.body.postIds : [];

  if (!['delete', 'restore', 'ban', 'unban'].includes(action)) {
    return res.status(400).json({ error: '无效操作' });
  }

  const ids = Array.from(new Set(postIds.map((id) => String(id || '').trim()).filter(Boolean)));
  if (!ids.length) {
    return res.status(400).json({ error: '未选择帖子' });
  }
  if (ids.length > 100) {
    return res.status(400).json({ error: '批量操作数量过多' });
  }

  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT id, content, deleted, session_id, ip, fingerprint FROM posts WHERE id IN (${placeholders})`)
    .all(...ids);

  const now = Date.now();
  const banOptions = action === 'ban' ? resolveBanOptions(req) : null;

  if (action === 'delete' || action === 'restore') {
    const deleted = action === 'delete' ? 1 : 0;
    const deletedAt = action === 'delete' ? now : null;
    db.prepare(`UPDATE posts SET deleted = ?, deleted_at = ? WHERE id IN (${placeholders})`)
      .run(deleted, deletedAt, ...ids);

    rows.forEach((row) => {
      logAdminAction(req, {
        action: action === 'delete' ? 'post_delete' : 'post_restore',
        targetType: 'post',
        targetId: row.id,
        before: { deleted: row.deleted === 1 },
        after: { deleted: action === 'delete' },
        reason,
      });
    });

    return res.json({ updated: rows.length });
  }

  const ips = Array.from(new Set(rows.map((row) => row.ip).filter(Boolean)));
  const fingerprints = Array.from(new Set(rows.map((row) => row.fingerprint).filter(Boolean)));

  if (action === 'ban') {
    ips.forEach((ip) => {
      upsertBan('banned_ips', 'ip', ip, banOptions || {});
      logAdminAction(req, {
        action: 'ban_ip',
        targetType: 'ip',
        targetId: ip,
        before: null,
        after: { banned: true, permissions: banOptions?.permissions || BAN_PERMISSIONS, expiresAt: banOptions?.expiresAt || null },
        reason,
      });
    });
    fingerprints.forEach((fingerprint) => {
      upsertBan('banned_fingerprints', 'fingerprint', fingerprint, banOptions || {});
      logAdminAction(req, {
        action: 'ban_fingerprint',
        targetType: 'fingerprint',
        targetId: fingerprint,
        before: null,
        after: { banned: true, permissions: banOptions?.permissions || BAN_PERMISSIONS, expiresAt: banOptions?.expiresAt || null },
        reason,
      });
    });
    logAdminAction(req, {
      action: 'post_batch_ban',
      targetType: 'post_batch',
      targetId: ids.join(','),
      before: null,
      after: { posts: ids.length, ips: ips.length, fingerprints: fingerprints.length },
      reason,
    });
    return res.json({ updated: ids.length, ips: ips.length, fingerprints: fingerprints.length });
  }

  ips.forEach((ip) => {
    db.prepare('DELETE FROM banned_ips WHERE ip = ?').run(ip);
    logAdminAction(req, {
      action: 'unban_ip',
      targetType: 'ip',
      targetId: ip,
      before: { banned: true },
      after: { banned: false },
      reason,
    });
  });
  fingerprints.forEach((fingerprint) => {
    db.prepare('DELETE FROM banned_fingerprints WHERE fingerprint = ?').run(fingerprint);
    logAdminAction(req, {
      action: 'unban_fingerprint',
      targetType: 'fingerprint',
      targetId: fingerprint,
      before: { banned: true },
      after: { banned: false },
      reason,
    });
  });
  logAdminAction(req, {
    action: 'post_batch_unban',
    targetType: 'post_batch',
    targetId: ids.join(','),
    before: null,
    after: { posts: ids.length, ips: ips.length, fingerprints: fingerprints.length },
    reason,
  });
  return res.json({ updated: ids.length, ips: ips.length, fingerprints: fingerprints.length });
});

app.get('/api/admin/posts', requireAdmin, (req, res) => {
  const status = String(req.query.status || 'active').trim();
  const sort = String(req.query.sort || 'time').trim();
  const search = String(req.query.search || '').trim();
  const page = Math.max(Number(req.query.page || 1), 1);
  const limit = Math.min(Math.max(Number(req.query.limit || 10), 1), 50);
  const offset = (page - 1) * limit;

  const conditions = [];
  const params = [];

  if (status === 'active') {
    conditions.push('posts.deleted = 0');
  } else if (status === 'deleted') {
    conditions.push('posts.deleted = 1');
  }

  if (search) {
    conditions.push('(posts.id LIKE ? OR posts.content LIKE ? OR posts.ip LIKE ? OR posts.fingerprint LIKE ?)');
    const likeValue = `%${search}%`;
    params.push(likeValue, likeValue, likeValue, likeValue);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  let orderClause = 'posts.created_at DESC';
  if (sort === 'hot') {
    orderClause = 'hot_score DESC, posts.created_at DESC';
  } else if (sort === 'reports') {
    orderClause = 'report_count DESC, posts.created_at DESC';
  }

  const rows = db
    .prepare(
      `
      SELECT posts.*, ${hotScoreSql} AS hot_score,
        (
          SELECT COUNT(1)
          FROM reports
          WHERE reports.post_id = posts.id
        ) AS report_count
      FROM posts
      ${whereClause}
      ORDER BY ${orderClause}
      LIMIT ? OFFSET ?
      `
    )
    .all(...params, limit, offset);

  const totalRow = db
    .prepare(`SELECT COUNT(1) AS count FROM posts ${whereClause}`)
    .get(...params);

  const items = rows.map((row) => ({
    id: row.id,
    content: row.content,
    author: row.author || '匿名',
    timestamp: formatRelativeTime(row.created_at),
    createdAt: row.created_at,
    likes: row.likes_count,
    comments: row.comments_count,
    reports: row.report_count || 0,
    deleted: row.deleted === 1,
    deletedAt: row.deleted_at || null,
    hotScore: row.hot_score,
    sessionId: row.session_id || null,
    ip: row.ip || null,
    fingerprint: row.fingerprint || null,
  }));

  return res.json({
    items,
    total: totalRow?.count || 0,
    page,
    limit,
  });
});

app.get('/api/admin/feedback', requireAdmin, (req, res) => {
  const status = String(req.query.status || 'unread').trim();
  const search = String(req.query.search || '').trim();
  const page = Math.max(Number(req.query.page || 1), 1);
  const limit = Math.min(Math.max(Number(req.query.limit || 10), 1), 50);
  const offset = (page - 1) * limit;

  const conditions = [];
  const params = [];

  if (status === 'unread') {
    conditions.push('read_at IS NULL');
  } else if (status === 'read') {
    conditions.push('read_at IS NOT NULL');
  }

  if (search) {
    conditions.push('(content LIKE ? OR email LIKE ? OR wechat LIKE ? OR qq LIKE ? OR session_id LIKE ? OR ip LIKE ? OR fingerprint LIKE ?)');
    const keyword = `%${search}%`;
    params.push(keyword, keyword, keyword, keyword, keyword, keyword, keyword);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = db
    .prepare(
      `
      SELECT *
      FROM feedback_messages
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
      `
    )
    .all(...params, limit, offset);

  const totalRow = db
    .prepare(`SELECT COUNT(1) AS count FROM feedback_messages ${whereClause}`)
    .get(...params);

  const items = rows.map((row) => ({
    id: row.id,
    content: row.content,
    email: row.email,
    wechat: row.wechat,
    qq: row.qq,
    createdAt: row.created_at,
    readAt: row.read_at,
    sessionId: row.session_id || null,
    ip: row.ip || null,
    fingerprint: row.fingerprint || null,
  }));

  return res.json({
    items,
    total: totalRow?.count || 0,
    page,
    limit,
  });
});

app.post('/api/admin/feedback/:id/action', requireAdmin, requireAdminCsrf, (req, res) => {
  const feedbackId = String(req.params.id || '').trim();
  const action = String(req.body?.action || '').trim();
  const reason = String(req.body?.reason || '').trim();

  if (!feedbackId) {
    return res.status(400).json({ error: '留言不存在' });
  }

  if (!['read', 'delete', 'ban'].includes(action)) {
    return res.status(400).json({ error: '无效操作' });
  }

  const row = db.prepare('SELECT * FROM feedback_messages WHERE id = ?').get(feedbackId);
  if (!row) {
    return res.status(404).json({ error: '留言不存在' });
  }

  const now = Date.now();

  if (action === 'read') {
    if (!row.read_at) {
      db.prepare('UPDATE feedback_messages SET read_at = ? WHERE id = ?').run(now, feedbackId);
    }
    logAdminAction(req, {
      action: 'feedback_read',
      targetType: 'feedback',
      targetId: feedbackId,
      before: { readAt: row.read_at || null },
      after: { readAt: row.read_at || now },
      reason,
    });
    return res.json({ id: feedbackId, readAt: row.read_at || now });
  }

  if (action === 'delete') {
    db.prepare('DELETE FROM feedback_messages WHERE id = ?').run(feedbackId);
    logAdminAction(req, {
      action: 'feedback_delete',
      targetType: 'feedback',
      targetId: feedbackId,
      before: {
        content: row.content,
        email: row.email,
        wechat: row.wechat,
        qq: row.qq,
        readAt: row.read_at || null,
      },
      after: null,
      reason,
    });
    return res.json({ id: feedbackId, deleted: true });
  }

  const ip = row.ip;
  const fingerprint = row.fingerprint;
  if (!ip && !fingerprint) {
    return res.status(400).json({ error: '无法获取封禁标识（IP/指纹）' });
  }

  if (ip) {
    upsertBan('banned_ips', 'ip', ip, banOptions || {});
    logAdminAction(req, {
      action: 'ban_ip',
      targetType: 'ip',
      targetId: ip,
      before: null,
      after: { banned: true, permissions: banOptions?.permissions || BAN_PERMISSIONS, expiresAt: banOptions?.expiresAt || null },
      reason,
    });
  }
  if (fingerprint) {
    upsertBan('banned_fingerprints', 'fingerprint', fingerprint, banOptions || {});
    logAdminAction(req, {
      action: 'ban_fingerprint',
      targetType: 'fingerprint',
      targetId: fingerprint,
      before: null,
      after: { banned: true, permissions: banOptions?.permissions || BAN_PERMISSIONS, expiresAt: banOptions?.expiresAt || null },
      reason,
    });
  }
  logAdminAction(req, {
    action: 'feedback_ban',
    targetType: 'feedback',
    targetId: feedbackId,
    before: null,
    after: { ip: ip || null, fingerprint: fingerprint || null },
    reason,
  });

  return res.json({
    id: feedbackId,
    ipBanned: Boolean(ip),
    fingerprintBanned: Boolean(fingerprint),
  });
});

app.get('/api/admin/bans', requireAdmin, (req, res) => {
  pruneExpiredBans('banned_ips');
  pruneExpiredBans('banned_fingerprints');
  const ips = db
    .prepare('SELECT ip, banned_at, expires_at, permissions, reason FROM banned_ips ORDER BY banned_at DESC')
    .all()
    .map((row) => ({
      ip: row.ip,
      bannedAt: row.banned_at,
      expiresAt: row.expires_at || null,
      permissions: normalizePermissions(row.permissions),
      reason: row.reason || null,
    }));

  const fingerprints = db
    .prepare('SELECT fingerprint, banned_at, expires_at, permissions, reason FROM banned_fingerprints ORDER BY banned_at DESC')
    .all()
    .map((row) => ({
      fingerprint: row.fingerprint,
      bannedAt: row.banned_at,
      expiresAt: row.expires_at || null,
      permissions: normalizePermissions(row.permissions),
      reason: row.reason || null,
    }));

  return res.json({ ips, fingerprints });
});

app.post('/api/admin/bans/action', requireAdmin, requireAdminCsrf, (req, res) => {
  const action = String(req.body?.action || '').trim();
  const type = String(req.body?.type || '').trim();
  const value = String(req.body?.value || '').trim();
  const reason = String(req.body?.reason || '').trim();
  const banOptions = action === 'ban' ? resolveBanOptions(req) : null;

  if (!['ban', 'unban'].includes(action) || !['ip', 'fingerprint'].includes(type) || !value) {
    return res.status(400).json({ error: '无效操作' });
  }

  const now = Date.now();
  if (type === 'ip') {
    if (action === 'ban') {
      upsertBan('banned_ips', 'ip', value, banOptions || {});
      logAdminAction(req, {
        action: 'ban_ip',
        targetType: 'ip',
        targetId: value,
        before: null,
        after: { banned: true, permissions: banOptions?.permissions || BAN_PERMISSIONS, expiresAt: banOptions?.expiresAt || null },
        reason,
      });
    } else {
      db.prepare('DELETE FROM banned_ips WHERE ip = ?').run(value);
      logAdminAction(req, {
        action: 'unban_ip',
        targetType: 'ip',
        targetId: value,
        before: { banned: true },
        after: { banned: false },
        reason,
      });
    }
  } else {
    if (action === 'ban') {
      upsertBan('banned_fingerprints', 'fingerprint', value, banOptions || {});
      logAdminAction(req, {
        action: 'ban_fingerprint',
        targetType: 'fingerprint',
        targetId: value,
        before: null,
        after: { banned: true, permissions: banOptions?.permissions || BAN_PERMISSIONS, expiresAt: banOptions?.expiresAt || null },
        reason,
      });
    } else {
      db.prepare('DELETE FROM banned_fingerprints WHERE fingerprint = ?').run(value);
      logAdminAction(req, {
        action: 'unban_fingerprint',
        targetType: 'fingerprint',
        targetId: value,
        before: { banned: true },
        after: { banned: false },
        reason,
      });
    }
  }

  return res.json({ ok: true });
});

app.get('/api/admin/audit-logs', requireAdmin, (req, res) => {
  const search = String(req.query.search || '').trim();
  const page = Math.max(Number(req.query.page || 1), 1);
  const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);
  const offset = (page - 1) * limit;
  const now = Date.now();
  db.prepare('DELETE FROM admin_audit_logs WHERE created_at < ?').run(now - AUDIT_RETENTION_MS);

  const conditions = [];
  const params = [];

  if (search) {
    conditions.push('(admin_username LIKE ? OR action LIKE ? OR target_id LIKE ? OR target_type LIKE ?)');
    const keyword = `%${search}%`;
    params.push(keyword, keyword, keyword, keyword);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = db
    .prepare(
      `
      SELECT *
      FROM admin_audit_logs
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
      `
    )
    .all(...params, limit, offset);

  const totalRow = db
    .prepare(`SELECT COUNT(1) AS count FROM admin_audit_logs ${whereClause}`)
    .get(...params);

  const items = rows.map((row) => ({
    id: row.id,
    adminId: row.admin_id,
    adminUsername: row.admin_username,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    before: row.before_json,
    after: row.after_json,
    reason: row.reason,
    ip: row.ip,
    sessionId: row.session_id,
    createdAt: row.created_at,
  }));

  return res.json({
    items,
    total: totalRow?.count || 0,
    page,
    limit,
  });
});

app.post('/api/admin/posts/:id/action', requireAdmin, requireAdminCsrf, (req, res) => {
  const postId = String(req.params.id || '').trim();
  const action = String(req.body?.action || '').trim();
  const reason = String(req.body?.reason || '').trim();

  if (!postId) {
    return res.status(400).json({ error: '帖子不存在' });
  }

  if (!['delete', 'restore'].includes(action)) {
    return res.status(400).json({ error: '无效操作' });
  }

  const existing = db.prepare('SELECT id, deleted FROM posts WHERE id = ?').get(postId);
  if (!existing) {
    return res.status(404).json({ error: '帖子不存在' });
  }

  const now = Date.now();
  if (action === 'delete') {
    db.prepare('UPDATE posts SET deleted = 1, deleted_at = ? WHERE id = ?')
      .run(now, postId);
  } else {
    db.prepare('UPDATE posts SET deleted = 0, deleted_at = NULL WHERE id = ?')
      .run(postId);
  }

  logAdminAction(req, {
    action: action === 'delete' ? 'post_delete' : 'post_restore',
    targetType: 'post',
    targetId: postId,
    before: { deleted: existing.deleted === 1 },
    after: { deleted: action === 'delete' },
    reason,
  });

  return res.json({ id: postId, deleted: action === 'delete' });
});

app.get('/api/admin/posts/:id/comments', requireAdmin, (req, res) => {
  const postId = String(req.params.id || '').trim();
  const page = Math.max(Number(req.query.page || 1), 1);
  const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
  const offset = (page - 1) * limit;

  if (!postId) {
    return res.status(400).json({ error: '帖子不存在' });
  }

  const totalRow = db
    .prepare('SELECT COUNT(1) AS count FROM comments WHERE post_id = ?')
    .get(postId);

  const rows = db
    .prepare(
      `
      SELECT *
      FROM comments
      WHERE post_id = ?
      ORDER BY created_at ASC
      LIMIT ? OFFSET ?
      `
    )
    .all(postId, limit, offset);

  return res.json({
    items: rows.map((row) => mapAdminCommentRow(row)),
    total: totalRow?.count || 0,
    page,
    limit,
  });
});

app.post('/api/admin/comments/:id/action', requireAdmin, requireAdminCsrf, (req, res) => {
  const commentId = String(req.params.id || '').trim();
  const action = String(req.body?.action || '').trim();
  const reason = String(req.body?.reason || '').trim();

  if (!commentId) {
    return res.status(400).json({ error: '评论不存在' });
  }

  if (!['delete', 'ban'].includes(action)) {
    return res.status(400).json({ error: '无效操作' });
  }

  const row = db.prepare('SELECT * FROM comments WHERE id = ?').get(commentId);
  if (!row) {
    return res.status(404).json({ error: '评论不存在' });
  }

  const now = Date.now();
  const banOptions = action === 'ban' ? resolveBanOptions(req) : null;

  const removedCount = row.deleted === 1 ? 0 : 1;

  if (removedCount > 0) {
    db.prepare('UPDATE comments SET deleted = 1, deleted_at = ? WHERE id = ?')
      .run(now, commentId);
    db.prepare(
      'UPDATE posts SET comments_count = CASE WHEN comments_count - 1 < 0 THEN 0 ELSE comments_count - 1 END WHERE id = ?'
    ).run(row.post_id);
  }

  logAdminAction(req, {
    action: action === 'ban' ? 'comment_ban' : 'comment_delete',
    targetType: 'comment',
    targetId: commentId,
    before: { deleted: row.deleted === 1 },
    after: { deleted: true, removed: removedCount },
    reason,
  });

  let ipBanned = false;
  let fingerprintBanned = false;

  if (action === 'ban' && banOptions) {
    if (row.ip) {
      upsertBan('banned_ips', 'ip', row.ip, banOptions || {});
      ipBanned = true;
      logAdminAction(req, {
        action: 'ban_ip',
        targetType: 'ip',
        targetId: row.ip,
        before: null,
        after: { banned: true, permissions: banOptions?.permissions || BAN_PERMISSIONS, expiresAt: banOptions?.expiresAt || null },
        reason,
      });
    }
    if (row.fingerprint) {
      upsertBan('banned_fingerprints', 'fingerprint', row.fingerprint, banOptions || {});
      fingerprintBanned = true;
      logAdminAction(req, {
        action: 'ban_fingerprint',
        targetType: 'fingerprint',
        targetId: row.fingerprint,
        before: null,
        after: { banned: true, permissions: banOptions?.permissions || BAN_PERMISSIONS, expiresAt: banOptions?.expiresAt || null },
        reason,
      });
    }
  }

  return res.json({ id: commentId, deleted: true, removed: removedCount, ipBanned, fingerprintBanned });
});

app.get('/api/admin/session', (req, res) => {
  if (!adminEnabled) {
    return res.json({ loggedIn: false, disabled: true });
  }
  if (req.session?.admin) {
    return res.json({
      loggedIn: true,
      username: req.session.admin.username,
      csrfToken: req.session.admin.csrfToken || null,
    });
  }
  return res.json({ loggedIn: false, disabled: false });
});

app.post('/api/admin/login', (req, res) => {
  if (!adminEnabled) {
    return res.status(503).json({ error: '后台未启用，请配置管理员与会话密钥' });
  }
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '').trim();

  if (!username || !password) {
    return res.status(400).json({ error: '请输入账号和密码' });
  }

  const user = db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: '账号或密码错误' });
  }

  const csrfToken = crypto.randomBytes(32).toString('hex');
  req.session.admin = { id: user.id, username: user.username, role: 'admin', csrfToken };
  return res.json({ loggedIn: true, username: user.username, csrfToken });
});

app.post('/api/admin/logout', requireAdmin, requireAdminCsrf, (req, res) => {
  req.session.destroy(() => {
    res.json({ loggedIn: false });
  });
});

app.get('/api/admin/announcement', requireAdmin, (req, res) => {
  const row = getAnnouncement();
  if (!row) {
    return res.json({ content: '', updatedAt: null });
  }
  return res.json({ content: row.content, updatedAt: row.updated_at });
});

app.post('/api/admin/announcement', requireAdmin, requireAdminCsrf, (req, res) => {
  const content = String(req.body?.content || '').trim();
  if (!content) {
    return res.status(400).json({ error: '公告内容不能为空' });
  }
  if (content.length > 5000) {
    return res.status(400).json({ error: '公告内容过长' });
  }
  const now = Date.now();
  db.prepare(
    `
    INSERT INTO announcements (id, content, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at
    `
  ).run('current', content, now);
  logAdminAction(req, {
    action: 'announcement_update',
    targetType: 'announcement',
    targetId: 'current',
    before: null,
    after: { updatedAt: now },
    reason: null,
  });
  return res.json({ content, updatedAt: now });
});

app.post('/api/admin/announcement/clear', requireAdmin, requireAdminCsrf, (req, res) => {
  db.prepare('DELETE FROM announcements WHERE id = ?').run('current');
  logAdminAction(req, {
    action: 'announcement_clear',
    targetType: 'announcement',
    targetId: 'current',
    before: null,
    after: null,
    reason: null,
  });
  return res.json({ content: '', updatedAt: null });
});

app.get('/api/admin/settings', requireAdmin, (req, res) => {
  return res.json({
    turnstileEnabled,
  });
});

app.post('/api/admin/settings', requireAdmin, requireAdminCsrf, (req, res) => {
  const raw = req.body?.turnstileEnabled;
  if (typeof raw !== 'boolean') {
    return res.status(400).json({ error: '参数格式错误' });
  }
  const before = turnstileEnabled;
  setTurnstileEnabled(raw);
  logAdminAction(req, {
    action: 'settings_update',
    targetType: 'settings',
    targetId: SETTINGS_KEY_TURNSTILE_ENABLED,
    before: { turnstileEnabled: before },
    after: { turnstileEnabled },
  });
  return res.json({ turnstileEnabled });
});

app.get('/api/admin/vocabulary', requireAdmin, (req, res) => {
  const search = String(req.query.search || '').trim();
  const page = Math.max(Number(req.query.page || 1), 1);
  const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 200);
  const offset = (page - 1) * limit;
  const conditions = [];
  const params = [];
  const normalizedSearch = search ? normalizeText(search) : '';
  if (search) {
    conditions.push('(word LIKE ? OR normalized LIKE ?)');
    const keyword = `%${search}%`;
    params.push(keyword, keyword);
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const orderBy = search
    ? 'ORDER BY CASE WHEN word = ? OR normalized = ? THEN 0 ELSE 1 END, updated_at DESC'
    : 'ORDER BY updated_at DESC';
  const orderParams = search ? [search, normalizedSearch] : [];
  const rows = db
    .prepare(
      `
      SELECT id, word, normalized, enabled, created_at, updated_at
      FROM vocabulary_words
      ${whereClause}
      ${orderBy}
      LIMIT ? OFFSET ?
      `
    )
    .all(...params, ...orderParams, limit, offset);
  const totalRow = db
    .prepare(`SELECT COUNT(1) AS count FROM vocabulary_words ${whereClause}`)
    .get(...params);
  return res.json({
    items: rows.map((row) => ({
      id: row.id,
      word: row.word,
      normalized: row.normalized,
      enabled: Boolean(row.enabled),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    total: totalRow?.count || 0,
    page,
    limit,
  });
});

app.post('/api/admin/vocabulary', requireAdmin, requireAdminCsrf, (req, res) => {
  const word = String(req.body?.word || '').trim();
  if (!word) {
    return res.status(400).json({ error: '词不能为空' });
  }
  const normalized = normalizeText(word);
  if (!normalized) {
    return res.status(400).json({ error: '词格式不正确' });
  }
  const now = Date.now();
  const existing = db.prepare('SELECT id, enabled, word FROM vocabulary_words WHERE normalized = ?').get(normalized);
  let id = existing?.id || null;
  let before = null;
  if (existing) {
    before = { word: existing.word, enabled: Boolean(existing.enabled) };
    db.prepare('UPDATE vocabulary_words SET word = ?, enabled = 1, updated_at = ? WHERE id = ?')
      .run(word, now, existing.id);
    id = existing.id;
  } else {
    const result = db
      .prepare('INSERT INTO vocabulary_words (word, normalized, enabled, created_at, updated_at) VALUES (?, ?, 1, ?, ?)')
      .run(word, normalized, now, now);
    id = Number(result.lastInsertRowid);
  }
  reloadVocabulary();
  logAdminAction(req, {
    action: existing ? 'vocabulary_update' : 'vocabulary_add',
    targetType: 'vocabulary',
    targetId: String(id),
    before,
    after: { word, enabled: true },
  });
  return res.json({ id, word, normalized, enabled: true, updatedAt: now });
});

app.post('/api/admin/vocabulary/:id/toggle', requireAdmin, requireAdminCsrf, (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    return res.status(400).json({ error: '参数错误' });
  }
  const enabled = Boolean(req.body?.enabled);
  const row = db.prepare('SELECT id, word, enabled FROM vocabulary_words WHERE id = ?').get(id);
  if (!row) {
    return res.status(404).json({ error: '词不存在' });
  }
  const now = Date.now();
  db.prepare('UPDATE vocabulary_words SET enabled = ?, updated_at = ? WHERE id = ?')
    .run(enabled ? 1 : 0, now, id);
  reloadVocabulary();
  logAdminAction(req, {
    action: 'vocabulary_toggle',
    targetType: 'vocabulary',
    targetId: String(id),
    before: { word: row.word, enabled: Boolean(row.enabled) },
    after: { word: row.word, enabled },
  });
  return res.json({ id, enabled });
});

app.post('/api/admin/vocabulary/:id/delete', requireAdmin, requireAdminCsrf, (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    return res.status(400).json({ error: '参数错误' });
  }
  const row = db.prepare('SELECT id, word, enabled FROM vocabulary_words WHERE id = ?').get(id);
  if (!row) {
    return res.status(404).json({ error: '词不存在' });
  }
  db.prepare('DELETE FROM vocabulary_words WHERE id = ?').run(id);
  reloadVocabulary();
  logAdminAction(req, {
    action: 'vocabulary_delete',
    targetType: 'vocabulary',
    targetId: String(id),
    before: { word: row.word, enabled: Boolean(row.enabled) },
    after: null,
  });
  return res.json({ id });
});

app.post('/api/admin/vocabulary/import', requireAdmin, requireAdminCsrf, (req, res) => {
  const result = importVocabularyFromFiles();
  logAdminAction(req, {
    action: 'vocabulary_import',
    targetType: 'vocabulary',
    targetId: 'files',
    before: null,
    after: { added: result.added, total: result.total },
  });
  return res.json(result);
});

app.get('/api/admin/vocabulary/export', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT word FROM vocabulary_words WHERE enabled = 1 ORDER BY word ASC').all();
  const content = rows.map((row) => row.word).join('\n');
  return res.json({ content });
});

app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const todayKey = formatDateKey();
  const todayStats = db.prepare('SELECT reports FROM stats_daily WHERE date = ?').get(todayKey);

  const weekStart = startOfWeek();
  const weekDates = [];
  for (let i = 0; i < 7; i += 1) {
    const date = new Date(weekStart + i * 24 * 60 * 60 * 1000);
    weekDates.push(formatDateKey(date));
  }

  const weeklyRows = db
    .prepare('SELECT date, visits, posts FROM stats_daily WHERE date IN (' + weekDates.map(() => '?').join(',') + ')')
    .all(...weekDates);

  const weeklyVisits = weekDates.map((date) => {
    const row = weeklyRows.find((item) => item.date === date);
    return row ? row.visits : 0;
  });

  const weeklyPosts = weekDates.map((date) => {
    const row = weeklyRows.find((item) => item.date === date);
    return row ? row.posts : 0;
  });

  const totalPosts = db.prepare('SELECT COUNT(1) AS count FROM posts WHERE deleted = 0').get().count;
  const totalVisits = db.prepare('SELECT COALESCE(SUM(visits), 0) AS count FROM stats_daily').get().count;
  const now = Date.now();
  const bannedIps = db
    .prepare('SELECT COUNT(1) AS count FROM banned_ips WHERE expires_at IS NULL OR expires_at > ?')
    .get(now).count;
  const bannedFingerprints = db
    .prepare('SELECT COUNT(1) AS count FROM banned_fingerprints WHERE expires_at IS NULL OR expires_at > ?')
    .get(now).count;
  const bannedUsers = bannedIps + bannedFingerprints;

  return res.json({
    todayReports: todayStats?.reports || 0,
    bannedUsers,
    weeklyVisits,
    weeklyPosts,
    totalPosts,
    totalVisits,
    onlineCount: getOnlineCount(),
  });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: '服务器错误' });
});

app.use((req, res, next) => {
  if (!['GET', 'HEAD'].includes(req.method)) return next();
  if (req.path.startsWith('/api')) return next();
  if (req.path === '/robots.txt' || req.path === '/sitemap.xml') return next();
  if (!SPA_INDEX || !isFilePath(SPA_INDEX)) {
    return res.status(404).send('Not Found');
  }
  return res.sendFile(SPA_INDEX);
});

app.listen(PORT, () => {
  console.log(`API server running on ${PORT}`);
});
