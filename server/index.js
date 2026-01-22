import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import express from 'express';
import session from 'express-session';
import BetterSqlite3Store from 'better-sqlite3-session-store';
import fs from 'fs';
import path from 'path';
import {
  db,
  formatDateKey,
  formatRelativeTime,
  incrementDailyStat,
  startOfDay,
  startOfWeek,
  trackDailyVisit,
} from './db.js';

const app = express();
const PORT = Number(process.env.PORT || 4395);

app.use(express.json({ limit: '2mb' }));

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
    secret: process.env.SESSION_SECRET || 'gossipsketch-secret',
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
  const username = process.env.ADMIN_USERNAME || 'tiancai';
  const password = process.env.ADMIN_PASSWORD || 'tiancai0528';
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

const loadVocabulary = () => {
  const now = Date.now();
  if (now - lastVocabularyReload < VOCABULARY_TTL_MS && cachedVocabulary.length) {
    return cachedVocabulary;
  }

  try {
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
            words.push(normalized);
          }
        });
    });

    cachedVocabulary = Array.from(new Set(words));
    lastVocabularyReload = now;
    return cachedVocabulary;
  } catch (error) {
    console.error('Vocabulary load failed:', error);
    cachedVocabulary = [];
    lastVocabularyReload = now;
    return cachedVocabulary;
  }
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

const rateBuckets = new Map();

const getClientIp = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length) {
    return forwarded[0].trim();
  }
  return req.socket?.remoteAddress || req.ip || 'unknown';
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

const enforceRateLimit = (req, res, action) => {
  const config = RATE_LIMITS[action];
  if (!config) {
    return true;
  }
  const sessionId = req.sessionID || 'unknown';
  const ip = getClientIp(req);
  const sessionKey = `${action}:session:${sessionId}`;
  const ipKey = `${action}:ip:${ip}`;
  const allowedBySession = allowRate(sessionKey, config.limit, config.windowMs);
  const allowedByIp = allowRate(ipKey, config.limit, config.windowMs);
  if (!allowedBySession || !allowedByIp) {
    res.status(429).json({ error: config.message });
    return false;
  }
  return true;
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
  if (!req.session?.admin) {
    return res.status(401).json({ error: '未登录' });
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

const mapCommentRow = (row) => ({
  id: row.id,
  postId: row.post_id,
  content: row.content,
  author: row.author || '匿名',
  timestamp: formatRelativeTime(row.created_at),
  createdAt: row.created_at,
});

const hotScoreSql = '(views_count * 0.2 + likes_count * 3 + comments_count * 2)';

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/posts/home', (req, res) => {
  const limit = Math.min(Number(req.query.limit || 10), 50);
  const dateKey = formatDateKey();
  trackDailyVisit(dateKey, req.sessionID);

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
      LIMIT ?
      `
    )
    .all(req.sessionID, limit);

  const posts = rows.map((row) => mapPostRow(row, row.hot_score >= 20));
  res.json({ items: posts });
});

app.get('/api/posts/feed', (req, res) => {
  const filter = String(req.query.filter || 'week');
  const search = String(req.query.search || '').trim();
  const dateKey = formatDateKey();
  trackDailyVisit(dateKey, req.sessionID);

  const conditions = ['posts.deleted = 0'];
  const params = [req.sessionID];

  if (filter === 'today') {
    conditions.push('posts.created_at >= ?');
    params.push(startOfDay());
  } else if (filter === 'week') {
    conditions.push('posts.created_at >= ?');
    params.push(startOfWeek());
  }

  if (search) {
    conditions.push('posts.content LIKE ?');
    params.push(`%${search}%`);
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

app.post('/api/posts', (req, res) => {
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

  if (!enforceRateLimit(req, res, 'post')) {
    return;
  }

  const banned = db.prepare('SELECT 1 FROM banned_sessions WHERE session_id = ?').get(req.sessionID);
  if (banned) {
    return res.status(403).json({ error: '账号已被封禁，无法投稿' });
  }

  const now = Date.now();
  const postId = crypto.randomUUID();

  db.prepare(
    `
    INSERT INTO posts (id, content, author, tags, created_at, session_id)
    VALUES (?, ?, ?, ?, ?, ?)
    `
  ).run(postId, content, '匿名', JSON.stringify(tags), now, req.sessionID);

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
      .get(req.sessionID, postId);

  return res.status(201).json({ post: mapPostRow(row, false) });
});

app.get('/api/posts/:id', (req, res) => {
  const postId = String(req.params.id || '').trim();
  if (!postId) {
    return res.status(400).json({ error: '帖子不存在' });
  }

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
    .get(req.sessionID, postId);

  if (!row) {
    return res.status(404).json({ error: '帖子不存在或已删除' });
  }

  return res.json({ post: mapPostRow(row, row.hot_score >= 20) });
});

const toggleReaction = db.transaction((postId, sessionId, reaction) => {
  const existing = db
    .prepare('SELECT reaction FROM post_reactions WHERE post_id = ? AND session_id = ?')
    .get(postId, sessionId);

  let likesDelta = 0;
  let dislikesDelta = 0;
  let nextReaction = null;

  if (!existing) {
    db.prepare(
      'INSERT INTO post_reactions (post_id, session_id, reaction, created_at) VALUES (?, ?, ?, ?)'
    ).run(postId, sessionId, reaction, Date.now());
    if (reaction === 'like') likesDelta += 1;
    if (reaction === 'dislike') dislikesDelta += 1;
    nextReaction = reaction;
  } else if (existing.reaction === reaction) {
    db.prepare('DELETE FROM post_reactions WHERE post_id = ? AND session_id = ?').run(postId, sessionId);
    if (reaction === 'like') likesDelta -= 1;
    if (reaction === 'dislike') dislikesDelta -= 1;
    nextReaction = null;
  } else {
    db.prepare('UPDATE post_reactions SET reaction = ?, created_at = ? WHERE post_id = ? AND session_id = ?')
      .run(reaction, Date.now(), postId, sessionId);
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
  const post = db.prepare('SELECT id FROM posts WHERE id = ? AND deleted = 0').get(postId);
  if (!post) {
    return res.status(404).json({ error: '内容不存在' });
  }

  const result = toggleReaction(postId, req.sessionID, 'like');
  return res.json({
    likes: result.likes_count,
    dislikes: result.dislikes_count,
    reaction: result.reaction,
  });
});

app.post('/api/posts/:id/dislike', (req, res) => {
  const postId = req.params.id;
  const post = db.prepare('SELECT id FROM posts WHERE id = ? AND deleted = 0').get(postId);
  if (!post) {
    return res.status(404).json({ error: '内容不存在' });
  }

  const result = toggleReaction(postId, req.sessionID, 'dislike');
  return res.json({
    likes: result.likes_count,
    dislikes: result.dislikes_count,
    reaction: result.reaction,
  });
});

app.post('/api/posts/:id/view', (req, res) => {
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
  const postId = req.params.id;
  const limit = Math.min(Number(req.query.limit || 50), 200);

  const post = db.prepare('SELECT id FROM posts WHERE id = ? AND deleted = 0').get(postId);
  if (!post) {
    return res.status(404).json({ error: '内容不存在' });
  }

  const rows = db
    .prepare(
      `\n      SELECT *\n      FROM comments\n      WHERE post_id = ? AND deleted = 0\n      ORDER BY created_at DESC\n      LIMIT ?\n      `
    )
    .all(postId, limit);

  return res.json({ items: rows.map(mapCommentRow) });
});

app.post('/api/posts/:id/comments', (req, res) => {
  const postId = req.params.id;
  const content = String(req.body?.content || '').trim();

  if (!content) {
    return res.status(400).json({ error: '评论不能为空' });
  }

  if (content.length > 300) {
    return res.status(400).json({ error: '评论长度不能超过 300 字' });
  }

  if (containsSensitiveWord(content)) {
    return res.status(400).json({ error: '评论包含敏感词，请修改后再提交' });
  }

  if (!enforceRateLimit(req, res, 'comment')) {
    return;
  }

  const banned = db.prepare('SELECT 1 FROM banned_sessions WHERE session_id = ?').get(req.sessionID);
  if (banned) {
    return res.status(403).json({ error: '账号已被封禁，无法评论' });
  }

  const post = db.prepare('SELECT id FROM posts WHERE id = ? AND deleted = 0').get(postId);
  if (!post) {
    return res.status(404).json({ error: '内容不存在' });
  }

  const now = Date.now();
  const commentId = crypto.randomUUID();

  db.prepare(
    `\n    INSERT INTO comments (id, post_id, content, author, created_at)\n    VALUES (?, ?, ?, ?, ?)\n    `
  ).run(commentId, postId, content, '匿名', now);

  db.prepare('UPDATE posts SET comments_count = comments_count + 1 WHERE id = ?').run(postId);

  return res.status(201).json({
    comment: mapCommentRow({
      id: commentId,
      post_id: postId,
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
  const reason = String(req.body?.reason || '').trim();

  if (!postId || !reason) {
    return res.status(400).json({ error: '参数不完整' });
  }

  if (!enforceRateLimit(req, res, 'report')) {
    return;
  }

  const post = db.prepare('SELECT content FROM posts WHERE id = ? AND deleted = 0').get(postId);
  if (!post) {
    return res.status(404).json({ error: '内容不存在' });
  }

  const snippet = post.content.slice(0, 100);
  const reportId = crypto.randomUUID();
  const now = Date.now();

  const sessionId = req.sessionID || 'unknown';
  const reportSessionResult = db
    .prepare('INSERT OR IGNORE INTO report_sessions (post_id, session_id, created_at) VALUES (?, ?, ?)')
    .run(postId, sessionId, now);
  if (reportSessionResult.changes === 0) {
    return res.status(409).json({ error: '你已举报过该内容' });
  }

  db.prepare(
    `
      INSERT INTO reports (id, post_id, reason, content_snippet, created_at, status, risk_level)
      VALUES (?, ?, ?, ?, ?, 'pending', ?)
    `
  ).run(reportId, postId, reason, snippet, now, resolveRiskLevel(reason));

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
    conditions.push('(id LIKE ? OR content_snippet LIKE ? OR reason LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = db
    .prepare(
      `
      SELECT *
      FROM reports
      ${whereClause}
      ORDER BY created_at DESC
      `
    )
    .all(...params);

  const reports = rows.map((row) => ({
    id: row.id,
    targetId: row.post_id,
    reason: row.reason,
    contentSnippet: row.content_snippet,
    timestamp: formatRelativeTime(row.created_at),
    status: row.status,
    riskLevel: row.risk_level,
  }));

  return res.json({ items: reports });
});

app.post('/api/reports/:id/action', requireAdmin, (req, res) => {
  const reportId = req.params.id;
  const action = String(req.body?.action || '').trim();

  if (!['ignore', 'delete', 'ban'].includes(action)) {
    return res.status(400).json({ error: '无效操作' });
  }

  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(reportId);
  if (!report) {
    return res.status(404).json({ error: '举报不存在' });
  }

  const now = Date.now();
  const nextStatus = action === 'ignore' ? 'ignored' : 'resolved';

  db.prepare(
    'UPDATE reports SET status = ?, action = ?, resolved_at = ? WHERE id = ?'
  ).run(nextStatus, action, now, reportId);

  if (action === 'delete' || action === 'ban') {
    const post = db.prepare('SELECT session_id FROM posts WHERE id = ?').get(report.post_id);
    db.prepare('UPDATE posts SET deleted = 1, deleted_at = ? WHERE id = ?').run(now, report.post_id);

    if (action === 'ban' && post?.session_id) {
      db.prepare('INSERT OR IGNORE INTO banned_sessions (session_id, banned_at) VALUES (?, ?)')
        .run(post.session_id, now);
    }
  }

  return res.json({ status: nextStatus, action });
});

app.post('/api/admin/posts', requireAdmin, (req, res) => {
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

  const banned = db.prepare('SELECT 1 FROM banned_sessions WHERE session_id = ?').get(req.sessionID);
  if (banned) {
    return res.status(403).json({ error: '账号已被封禁，无法投稿' });
  }

  const now = Date.now();
  const postId = crypto.randomUUID();

  db.prepare(
    `
    INSERT INTO posts (id, content, author, tags, created_at, session_id)
    VALUES (?, ?, ?, ?, ?, ?)
    `
  ).run(postId, content, '匿名', JSON.stringify(tags), now, req.sessionID);

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
    .get(req.sessionID, postId);

  return res.status(201).json({ post: mapPostRow(row, false) });
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
    conditions.push('posts.content LIKE ?');
    params.push(`%${search}%`);
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
  }));

  return res.json({
    items,
    total: totalRow?.count || 0,
    page,
    limit,
  });
});

app.post('/api/admin/posts/:id/action', requireAdmin, (req, res) => {
  const postId = String(req.params.id || '').trim();
  const action = String(req.body?.action || '').trim();

  if (!postId) {
    return res.status(400).json({ error: '帖子不存在' });
  }

  if (!['delete', 'restore'].includes(action)) {
    return res.status(400).json({ error: '无效操作' });
  }

  const existing = db.prepare('SELECT id FROM posts WHERE id = ?').get(postId);
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

  return res.json({ id: postId, deleted: action === 'delete' });
});

app.get('/api/admin/session', (req, res) => {
  if (req.session?.admin) {
    return res.json({ loggedIn: true, username: req.session.admin.username });
  }
  return res.json({ loggedIn: false });
});

app.post('/api/admin/login', (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '').trim();

  if (!username || !password) {
    return res.status(400).json({ error: '请输入账号和密码' });
  }

  const user = db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: '账号或密码错误' });
  }

  req.session.admin = { id: user.id, username: user.username, role: 'admin' };
  return res.json({ loggedIn: true, username: user.username });
});

app.post('/api/admin/logout', requireAdmin, (req, res) => {
  req.session.destroy(() => {
    res.json({ loggedIn: false });
  });
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
  const bannedUsers = db.prepare('SELECT COUNT(1) AS count FROM banned_sessions').get().count;

  return res.json({
    todayReports: todayStats?.reports || 0,
    bannedUsers,
    weeklyVisits,
    weeklyPosts,
    totalPosts,
  });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: '服务器错误' });
});

app.listen(PORT, () => {
  console.log(`API server running on ${PORT}`);
});
