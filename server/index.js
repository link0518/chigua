import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import cookie from 'cookie';
import compression from 'compression';
import express from 'express';
import http from 'http';
import signature from 'cookie-signature';
import session from 'express-session';
import BetterSqlite3Store from 'better-sqlite3-session-store';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { initializeRuntimeEnv, createRuntimeConfig } from './runtime-config.js';
import { createSiteSettingsService } from './site-settings.js';
import { registerPublicSiteRoutes } from './routes/public/site-routes.js';
import { registerPublicPostsRoutes } from './routes/public/posts-routes.js';
import { registerPublicCommentsRoutes } from './routes/public/comments-routes.js';
import { registerPublicReportsRoutes } from './routes/public/reports-routes.js';
import { registerPublicSystemRoutes } from './routes/public/system-routes.js';
import { registerPublicChatRoutes } from './routes/public/chat-routes.js';
import { registerAdminAuthRoutes } from './routes/admin/auth-routes.js';
import { registerAdminAnnouncementRoutes } from './routes/admin/announcement-routes.js';
import { registerAdminReportsRoutes } from './routes/admin/reports-routes.js';
import { registerAdminSettingsRoutes } from './routes/admin/settings-routes.js';
import { registerAdminPostsRoutes } from './routes/admin/posts-routes.js';
import { registerAdminFeedbackRoutes } from './routes/admin/feedback-routes.js';
import { registerAdminBansRoutes } from './routes/admin/bans-routes.js';
import { registerAdminAuditRoutes } from './routes/admin/audit-routes.js';
import { registerAdminVocabularyRoutes } from './routes/admin/vocabulary-routes.js';
import { registerAdminStatsRoutes } from './routes/admin/stats-routes.js';
import { registerAdminChatRoutes } from './routes/admin/chat-routes.js';
import { createChatRealtimeService } from './chat-realtime-service.js';
import {
  db,
  formatDateKey,
  formatRelativeTime,
  incrementDailyStat,
  startOfDay,
  startOfWeek,
  trackDailyVisit,
} from './db.js';

initializeRuntimeEnv();

const {
  port: PORT,
  turnstileSecretKey: TURNSTILE_SECRET_KEY,
  turnstileVerifyUrl: TURNSTILE_VERIFY_URL,
  fingerprintHeader: FINGERPRINT_HEADER,
  fingerprintSalt: FINGERPRINT_SALT,
  sessionSecret,
  sessionSecretConfigured,
  adminUsername,
  adminPassword,
  adminEnabled,
  siteUrl: SITE_URL,
} = createRuntimeConfig();

if (!sessionSecretConfigured) {
  console.warn('SESSION_SECRET 未配置，已生成临时密钥（后台将被禁用）');
}

const app = express();
const httpServer = http.createServer(app);
const {
  getTurnstileEnabled,
  getCnyThemeEnabled,
  getDefaultPostTags,
  buildSettingsResponse,
  setTurnstileEnabled,
  setCnyThemeEnabled,
  setDefaultPostTags,
} = createSiteSettingsService({ db, turnstileSecretKey: TURNSTILE_SECRET_KEY });

const PUBLIC_DIR = path.resolve(process.cwd(), 'public');
const DIST_DIR = path.resolve(process.cwd(), 'dist');
const SNAPSHOT_DIR = path.join(DIST_DIR, 'post');
const BOT_UA_REGEX = /(bot|crawler|spider|bingpreview|bingbot|baiduspider|yandex|duckduckbot|sogou|360spider|googlebot|slurp)/i;
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

app.use(compression());
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
  const content = [
    'User-agent: *',
    'Allow: /',
    '',
    'Sitemap: https://jx3gua.com/sitemap.xml',
    'Sitemap: https://933211.xyz/sitemap.xml',
    '',
  ].join('\n');
  return res.type('text/plain').send(content);
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
const SESSION_COOKIE_NAME = 'connect.sid';

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

const parseSessionIdFromRequest = (request) => {
  const cookieHeader = String(request?.headers?.cookie || '').trim();
  if (!cookieHeader) {
    return '';
  }
  const parsedCookies = cookie.parse(cookieHeader);
  const rawValue = String(parsedCookies?.[SESSION_COOKIE_NAME] || '').trim();
  if (!rawValue) {
    return '';
  }
  if (!rawValue.startsWith('s:')) {
    return rawValue;
  }
  const unsigned = signature.unsign(rawValue.slice(2), sessionSecret);
  return unsigned || '';
};

const getAdminFromRequest = (request) => {
  const sessionId = parseSessionIdFromRequest(request);
  if (!sessionId) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    sessionStore.get(sessionId, (error, sessionData) => {
      if (error || !sessionData?.admin) {
        resolve(null);
        return;
      }
      const admin = sessionData.admin;
      resolve({
        id: typeof admin.id === 'number' ? admin.id : null,
        username: String(admin.username || ''),
        role: String(admin.role || ''),
      });
    });
  });
};

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

const stripUrlsForSensitiveCheck = (value) => {
  const input = String(value || '');
  if (!input) return '';

  // 避免图床/链接域名触发误判（例如域名包含被词库命中的子串）。
  return input
    .replace(/\bhttps?:\/\/[^\s)]+/gi, '')
    .replace(/\/meme\/[^\s)]+/gi, '')
    .replace(/\[:[^\]\n]{1,40}:\]/g, '')
    .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?/gi, '');
};

const sensitiveWordSegmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter('zh-CN', { granularity: 'word' })
  : null;

const tokenizeSensitiveText = (value) => {
  const input = String(value || '');
  if (!input) {
    return [];
  }

  if (sensitiveWordSegmenter) {
    const tokens = [];
    for (const segment of sensitiveWordSegmenter.segment(input)) {
      if (segment?.isWordLike === false) {
        continue;
      }
      const normalized = normalizeText(segment?.segment || '');
      if (normalized) {
        tokens.push(normalized);
      }
    }
    if (tokens.length) {
      return tokens;
    }
  }

  return input
    .split(/[^\p{L}\p{N}]+/u)
    .map((item) => normalizeText(item))
    .filter(Boolean);
};

const containsSensitiveWord = (text) => {
  const words = loadVocabulary().filter(Boolean);
  if (!words.length) {
    return false;
  }

  const tokens = tokenizeSensitiveText(stripUrlsForSensitiveCheck(text));
  if (!tokens.length) {
    return false;
  }

  const maxWordLength = words.reduce((max, word) => Math.max(max, word.length), 0);
  if (maxWordLength <= 0) {
    return false;
  }

  for (const token of tokens) {
    for (const word of words) {
      if (token.includes(word)) {
        return true;
      }
    }
  }

  const candidates = new Set();
  for (let i = 0; i < tokens.length; i += 1) {
    let merged = '';
    for (let j = i; j < tokens.length; j += 1) {
      merged += tokens[j];
      if (merged.length > maxWordLength) {
        break;
      }
      candidates.add(merged);
    }
  }

  return words.some((word) => candidates.has(word));
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
  let raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.includes(',')) {
    raw = raw.split(',')[0].trim();
  }
  if (!raw) return '';
  raw = raw.replace(/^for=/i, '').trim();
  raw = raw.replace(/^"+|"+$/g, '').trim();
  if (!raw || raw.toLowerCase() === 'unknown') return '';
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']');
    if (end > 1) {
      raw = raw.slice(1, end);
    }
  }
  raw = raw.replace(/%[0-9a-z_.-]+$/i, '');
  if (raw.startsWith('::ffff:')) {
    return raw.slice(7);
  }
  if (raw.includes('.') && raw.includes(':')) {
    return raw.replace(/:\d+$/, '');
  }
  return raw;
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

const getForwardedHeaderIp = (headerValue) => {
  const raw = Array.isArray(headerValue) ? headerValue.join(',') : String(headerValue || '');
  if (!raw.trim()) return '';
  const parts = raw.split(',');
  const candidates = parts
    .map((part) => {
      const forToken = String(part || '')
        .split(';')
        .map((token) => token.trim())
        .find((token) => /^for=/i.test(token));
      if (!forToken) return '';
      const parsed = forToken.split('=').slice(1).join('=').trim();
      return normalizeIp(parsed);
    })
    .filter(Boolean);
  const ipv4 = candidates.find((ip) => isValidIpv4(ip));
  return ipv4 || candidates[0] || '';
};

const getClientIp = (req) => {
  const headers = req?.headers || {};
  const cfIp = getHeaderIp(headers['cf-connecting-ip']);
  if (cfIp) return cfIp;
  const trueClientIp = getHeaderIp(headers['true-client-ip']);
  if (trueClientIp) return trueClientIp;
  const realIp = getHeaderIp(headers['x-real-ip']);
  if (realIp) return realIp;
  const clientIp = getHeaderIp(headers['x-client-ip']);
  if (clientIp) return clientIp;
  const forwardedFor = getHeaderIp(headers['x-forwarded-for']);
  if (forwardedFor) return forwardedFor;
  const forwarded = getForwardedHeaderIp(headers.forwarded);
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
  if (!getTurnstileEnabled()) {
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

const BAN_PERMISSIONS = ['post', 'comment', 'like', 'view', 'site', 'chat'];

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
  dislikes: row.dislikes_count,
  comments: row.comments_count,
  tags: parseTags(row.tags),
  isHot,
  imageUrl: row.image_url || '',
  createdAt: row.created_at,
  viewerReaction: row.viewer_reaction || null,
  viewerFavorited: Boolean(row.viewer_favorited),
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
    likes: Number(row.likes_count || 0),
    viewerLiked: Boolean(row.viewer_liked),
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
const chatRealtime = createChatRealtimeService({
  server: httpServer,
  db,
  hashFingerprint,
  getClientIp,
  containsSensitiveWord,
  isBannedFor,
  upsertBan,
  BAN_PERMISSIONS,
  logAdminAction,
  getAdminFromRequest,
  adminNickname: '闰土',
});

registerPublicSystemRoutes(app, {
  db,
  requireFingerprint,
  checkBanFor,
  touchOnlineSession,
  getOnlineCount,
  formatDateKey,
  verifyTurnstile,
  getClientIp,
  FEEDBACK_LIMIT_MS,
  crypto,
});
registerPublicChatRoutes(app, {
  db,
  requireFingerprint,
  checkBanFor,
  enforceRateLimit,
  getClientIp,
  incrementDailyStat,
  formatDateKey,
  crypto,
  chatRealtime,
});

registerPublicSiteRoutes(app, {
  getClientIp,
  getOptionalFingerprint,
  getActiveBans,
  mergePermissions,
  buildSettingsResponse,
  getAnnouncement,
  chatRealtime,
});
registerPublicPostsRoutes(app, {
  db,
  hotScoreSql,
  mapPostRow,
  checkBanFor,
  formatDateKey,
  trackDailyVisit,
  getOptionalFingerprint,
  startOfDay,
  containsSensitiveWord,
  requireFingerprint,
  enforceRateLimit,
  getClientIp,
  verifyTurnstile,
  incrementDailyStat,
  generateSnapshotForPost,
  scheduleSitemapGenerate,
  createNotification,
  trimPreview,
  crypto,
  getDefaultPostTags,
});

registerPublicCommentsRoutes(app, {
  db,
  checkBanFor,
  getOptionalFingerprint,
  requireFingerprint,
  enforceRateLimit,
  getClientIp,
  containsSensitiveWord,
  verifyTurnstile,
  createNotification,
  trimPreview,
  mapCommentRow,
  buildCommentTree,
  crypto,
});

registerPublicReportsRoutes(app, {
  db,
  requireFingerprint,
  enforceRateLimit,
  checkBanFor,
  getClientIp,
  crypto,
  incrementDailyStat,
  formatDateKey,
});

registerAdminReportsRoutes(app, {
  db,
  requireAdmin,
  requireAdminCsrf,
  formatRelativeTime,
  logAdminAction,
  resolveBanOptions,
  upsertBan,
  BAN_PERMISSIONS,
  chatRealtime,
});

registerAdminPostsRoutes(app, {
  db,
  requireAdmin,
  requireAdminCsrf,
  containsSensitiveWord,
  getClientIp,
  checkBanFor,
  crypto,
  getOptionalFingerprint,
  incrementDailyStat,
  formatDateKey,
  hotScoreSql,
  mapPostRow,
  logAdminAction,
  resolveBanOptions,
  upsertBan,
  BAN_PERMISSIONS,
  mapAdminCommentRow,
  formatRelativeTime,
});
registerAdminFeedbackRoutes(app, {
  db,
  requireAdmin,
  requireAdminCsrf,
  logAdminAction,
  resolveBanOptions,
  upsertBan,
  BAN_PERMISSIONS,
});

registerAdminBansRoutes(app, {
  db,
  requireAdmin,
  requireAdminCsrf,
  pruneExpiredBans,
  normalizePermissions,
  resolveBanOptions,
  upsertBan,
  BAN_PERMISSIONS,
  logAdminAction,
});
registerAdminChatRoutes(app, {
  db,
  requireAdmin,
  requireAdminCsrf,
  chatRealtime,
});
registerAdminAuditRoutes(app, {
  db,
  requireAdmin,
  AUDIT_RETENTION_MS,
});
registerAdminAuthRoutes(app, {
  adminEnabled,
  requireAdmin,
  requireAdminCsrf,
  db,
  bcrypt,
  crypto,
});

registerAdminAnnouncementRoutes(app, {
  requireAdmin,
  requireAdminCsrf,
  db,
  getAnnouncement,
  logAdminAction,
});

registerAdminSettingsRoutes(app, {
  requireAdmin,
  requireAdminCsrf,
  buildSettingsResponse,
  setTurnstileEnabled,
  setCnyThemeEnabled,
  setDefaultPostTags,
  getTurnstileEnabled,
  getCnyThemeEnabled,
  getDefaultPostTags,
  logAdminAction,
});

registerAdminVocabularyRoutes(app, {
  db,
  requireAdmin,
  requireAdminCsrf,
  normalizeText,
  reloadVocabulary,
  importVocabularyFromFiles,
  logAdminAction,
});

registerAdminStatsRoutes(app, {
  db,
  requireAdmin,
  formatDateKey,
  startOfWeek,
  getOnlineCount,
});
// 生产环境：提供 dist 静态资源（/assets/*、favicon 等），方便本地预览与 Lighthouse 测量
app.use(express.static(DIST_DIR, { index: false }));

app.use((req, res, next) => {
  if (!['GET', 'HEAD'].includes(req.method)) return next();
  if (req.path.startsWith('/api')) return next();
  if (req.path === '/robots.txt' || req.path === '/sitemap.xml') return next();
  if (!SPA_INDEX || !isFilePath(SPA_INDEX)) {
    return res.status(404).send('Not Found');
  }
  return res.sendFile(SPA_INDEX);
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: '服务器错误' });
});

httpServer.listen(PORT, () => {
  console.log(`API server running on ${PORT}`);
});




