export const registerPublicPostsRoutes = (app, deps) => {
  const {
    db,
    hotScoreSql,
    mapPostRow,
    checkBanFor,
    formatDateKey,
    trackDailyVisit,
    getIdentityLookupHashes,
    getRequestIdentityContext,
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
  } = deps;

  const MAX_POST_TAGS = 2;
  const MAX_TAG_LENGTH = 6;
  const MAX_DEFAULT_TAGS = 50;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const MAX_SEARCH_RANGE_DAYS = 7;
  const DATE_INPUT_RE = /^\d{4}-\d{2}-\d{2}$/;

  const normalizeTag = (value) => String(value || '')
    .trim()
    .replace(/^#+/, '')
    .replace(/\s+/g, ' ');

  const sanitizeTagList = (input, maxCount = MAX_POST_TAGS) => {
    const source = Array.isArray(input) ? input : [];
    const unique = new Set();
    const result = [];
    for (const item of source) {
      const normalized = normalizeTag(item);
      if (!normalized) {
        continue;
      }
      if (normalized.length > MAX_TAG_LENGTH) {
        continue;
      }
      const key = normalized.toLowerCase();
      if (unique.has(key)) {
        continue;
      }
      unique.add(key);
      result.push(normalized);
      if (result.length >= maxCount) {
        break;
      }
    }
    return result;
  };

  const sanitizeTags = (input) => sanitizeTagList(input, MAX_POST_TAGS);

  const escapeLike = (value) => String(value).replace(/[\\%_]/g, (match) => `\\${match}`);
  const parsePositiveInt = (value, fallback) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    const normalized = Math.floor(parsed);
    return normalized >= 1 ? normalized : fallback;
  };
  const buildJsonTagLikePattern = (value) => `%${escapeLike(JSON.stringify(String(value || '')))}%`;
  const parseDateInput = (value) => {
    const normalized = String(value || '').trim();
    if (!DATE_INPUT_RE.test(normalized)) {
      return null;
    }
    const [year, month, day] = normalized.split('-').map((part) => Number(part));
    const date = new Date(year, month - 1, day);
    if (
      date.getFullYear() !== year
      || date.getMonth() !== month - 1
      || date.getDate() !== day
    ) {
      return null;
    }
    return date;
  };
  const resolveSearchDateRange = (startValue, endValue) => {
    const startDateRaw = String(startValue || '').trim();
    const endDateRaw = String(endValue || '').trim();
    if (!startDateRaw && !endDateRaw) {
      return { hasRange: false, startAt: null, endAt: null };
    }
    if (!startDateRaw || !endDateRaw) {
      return { error: '请完整选择开始和结束日期' };
    }

    const startDate = parseDateInput(startDateRaw);
    const endDate = parseDateInput(endDateRaw);
    if (!startDate || !endDate) {
      return { error: '日期格式无效' };
    }

    const startAt = startOfDay(startDate);
    const endAt = startOfDay(endDate);
    if (endAt < startAt) {
      return { error: '结束日期不能早于开始日期' };
    }

    const diffDays = Math.round((endAt - startAt) / DAY_MS);
    if (diffDays >= MAX_SEARCH_RANGE_DAYS) {
      return { error: `时间范围最多 ${MAX_SEARCH_RANGE_DAYS} 天` };
    }

    return {
      hasRange: true,
      startAt,
      endAt: endAt + DAY_MS,
    };
  };

  const buildIdentityMatch = (column, identityHashes) => {
    const values = Array.from(new Set(
      (Array.isArray(identityHashes) ? identityHashes : [identityHashes])
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    ));
    if (!values.length) {
      return { clause: '1 = 0', params: [] };
    }
    if (values.length === 1) {
      return { clause: `${column} = ?`, params: values };
    }
    return {
      clause: `${column} IN (${values.map(() => '?').join(', ')})`,
      params: values,
    };
  };

  const buildViewerSelect = (identityHashes) => {
    const reactionMatch = buildIdentityMatch('pr.fingerprint', identityHashes);
    const favoriteMatch = buildIdentityMatch('pf.fingerprint', identityHashes);
    return {
      sql: `
        (
          SELECT pr.reaction
          FROM post_reactions_fingerprint pr
          WHERE pr.post_id = posts.id AND ${reactionMatch.clause}
          ORDER BY pr.created_at DESC
          LIMIT 1
        ) AS viewer_reaction,
        EXISTS(
          SELECT 1
          FROM post_favorites pf
          WHERE pf.post_id = posts.id AND ${favoriteMatch.clause}
        ) AS viewer_favorited
      `,
      params: [...reactionMatch.params, ...favoriteMatch.params],
    };
  };

  const buildViewerReactionSelect = (identityHashes) => {
    const reactionMatch = buildIdentityMatch('pr.fingerprint', identityHashes);
    return {
      sql: `
        (
          SELECT pr.reaction
          FROM post_reactions_fingerprint pr
          WHERE pr.post_id = posts.id AND ${reactionMatch.clause}
          ORDER BY pr.created_at DESC
          LIMIT 1
        ) AS viewer_reaction
      `,
      params: reactionMatch.params,
    };
  };

  const findExistingReaction = (postId, identityHashes) => {
    const reactionMatch = buildIdentityMatch('fingerprint', identityHashes);
    return db
      .prepare(
        `
          SELECT fingerprint, reaction
          FROM post_reactions_fingerprint
          WHERE post_id = ? AND ${reactionMatch.clause}
          ORDER BY created_at DESC
          LIMIT 1
        `
      )
      .get(postId, ...reactionMatch.params);
  };

  const findExistingFavorite = (postId, identityHashes) => {
    const favoriteMatch = buildIdentityMatch('fingerprint', identityHashes);
    return db
      .prepare(
        `
          SELECT fingerprint, created_at
          FROM post_favorites
          WHERE post_id = ? AND ${favoriteMatch.clause}
          ORDER BY created_at DESC
          LIMIT 1
        `
      )
      .get(postId, ...favoriteMatch.params);
  };

app.get('/api/posts/home', (req, res) => {
  if (!checkBanFor(req, res, 'view', '你已被限制浏览')) {
    return;
  }
  const limit = Math.min(Number(req.query.limit || 10), 50);
  const offset = Math.max(Number(req.query.offset || 0), 0);
  const dateKey = formatDateKey();
  trackDailyVisit(dateKey, req.sessionID);
  const viewerIdentityHashes = getIdentityLookupHashes(req, res);
  const viewerSelect = buildViewerSelect(viewerIdentityHashes);

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
        SELECT posts.*, ${hotScoreSql} AS hot_score,
          ${viewerSelect.sql}
      FROM posts
        WHERE posts.deleted = 0
        ORDER BY posts.created_at DESC
        LIMIT ? OFFSET ?
        `
    )
    .all(...viewerSelect.params, limit, offset);

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
  const viewerIdentityHashes = getIdentityLookupHashes(req, res);
  const viewerSelect = buildViewerSelect(viewerIdentityHashes);

  const conditions = ['posts.deleted = 0'];
  const params = [...viewerSelect.params];

  if (filter === 'today') {
    conditions.push('posts.created_at >= ?');
    params.push(startOfDay());
  } else if (filter === 'week') {
    conditions.push('posts.created_at >= ?');
    params.push(Date.now() - 7 * 24 * 60 * 60 * 1000);
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
      SELECT posts.*, ${hotScoreSql} AS hot_score,
        ${viewerSelect.sql}
      FROM posts
      ${whereClause}
      ORDER BY hot_score DESC, posts.created_at DESC
      `
    )
    .all(...params);

  const posts = rows.map((row, index) => mapPostRow(row, index < 3));
  res.json({ items: posts, total: posts.length });
});

app.get('/api/posts/tags', (req, res) => {
  if (!checkBanFor(req, res, 'view', '你已被限制浏览')) {
    return;
  }

  const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
  const defaultTags = sanitizeTagList(getDefaultPostTags?.() || [], MAX_DEFAULT_TAGS).slice(0, limit);
  if (defaultTags.length === 0) {
    return res.json({ items: [] });
  }
  const defaultTagKeys = new Set(defaultTags.map((tag) => tag.toLowerCase()));
  const counter = new Map(defaultTags.map((tag) => [tag.toLowerCase(), 0]));
  const rows = db
    .prepare(
      `
      SELECT tags
      FROM posts
      WHERE deleted = 0
        AND tags IS NOT NULL
        AND tags != ''
      ORDER BY created_at DESC
      LIMIT 5000
      `
    )
    .all();
  for (const row of rows) {
    let parsed = [];
    try {
      parsed = JSON.parse(String(row.tags || '[]'));
    } catch {
      parsed = [];
    }
    if (!Array.isArray(parsed)) {
      continue;
    }
    for (const rawTag of sanitizeTagList(parsed, MAX_DEFAULT_TAGS)) {
      const key = normalizeTag(rawTag).toLowerCase();
      if (!key || !defaultTagKeys.has(key)) {
        continue;
      }
      counter.set(key, Number(counter.get(key) || 0) + 1);
    }
  }

  const items = defaultTags.map((tag) => ({
    name: tag,
    count: Number(counter.get(tag.toLowerCase()) || 0),
  }));

  return res.json({ items });
});

app.get('/api/posts/search', (req, res) => {
  if (!checkBanFor(req, res, 'view', '你已被限制浏览')) {
    return;
  }
  const keywordRaw = String(req.query.q || '').trim();
  const tag = normalizeTag(req.query.tag || '');
  const dateRange = resolveSearchDateRange(req.query.startDate, req.query.endDate);
  const page = parsePositiveInt(req.query.page, 1);
  const limit = Math.min(parsePositiveInt(req.query.limit, 20), 50);
  const offset = (page - 1) * limit;
  const dateKey = formatDateKey();
  trackDailyVisit(dateKey, req.sessionID);
  const viewerIdentityHashes = getIdentityLookupHashes(req, res);
  const viewerSelect = buildViewerSelect(viewerIdentityHashes);

  if (dateRange.error) {
    return res.status(400).json({ error: dateRange.error });
  }

  if (!keywordRaw && !tag && !dateRange.hasRange) {
    return res.json({ items: [], total: 0, page, limit });
  }

  // 标签/关键字搜索：把 LIKE 的通配符当作字面量，避免用户输入 %/_ 导致意外匹配。
  const conditions = ['posts.deleted = 0'];
  const params = [];
  if (keywordRaw) {
    const keyword = `%${escapeLike(keywordRaw)}%`;
    const keywordAsTag = normalizeTag(keywordRaw);
    if (keywordAsTag) {
      conditions.push("(posts.content LIKE ? ESCAPE '\\' OR posts.tags LIKE ? ESCAPE '\\')");
      params.push(keyword, buildJsonTagLikePattern(keywordAsTag));
    } else {
      conditions.push("posts.content LIKE ? ESCAPE '\\'");
      params.push(keyword);
    }
  }
  if (tag) {
    const tagKeyword = buildJsonTagLikePattern(tag);
    conditions.push("posts.tags LIKE ? ESCAPE '\\'");
    params.push(tagKeyword);
  }
  if (dateRange.hasRange) {
    conditions.push('posts.created_at >= ? AND posts.created_at < ?');
    params.push(dateRange.startAt, dateRange.endAt);
  }
  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  const total = db
    .prepare(
      `
        SELECT COUNT(1) AS count
        FROM posts
        ${whereClause}
      `
    )
    .get(...params)?.count ?? 0;

  const rows = db
    .prepare(
      `
        SELECT posts.*, ${hotScoreSql} AS hot_score,
          ${viewerSelect.sql}
        FROM posts
        ${whereClause}
        ORDER BY posts.created_at DESC
        LIMIT ? OFFSET ?
      `
    )
    .all(...viewerSelect.params, ...params, limit, offset);

  const items = rows.map((row) => mapPostRow(row, row.hot_score >= 20));
  return res.json({ items, total, page, limit });
});

app.post('/api/posts', async (req, res) => {
  const content = String(req.body?.content || '').trim();
  const tags = sanitizeTags(req.body?.tags);

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

  const viewerSelect = buildViewerSelect([fingerprint]);
  const row = db
    .prepare(
      `
      SELECT posts.*, ${hotScoreSql} AS hot_score,
        ${viewerSelect.sql}
      FROM posts
      WHERE posts.id = ?
      `
    )
    .get(...viewerSelect.params, postId);

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
  const viewerIdentityHashes = getIdentityLookupHashes(req, res);
  const viewerSelect = buildViewerSelect(viewerIdentityHashes);

  const row = db
    .prepare(
      `
      SELECT posts.*, ${hotScoreSql} AS hot_score,
        ${viewerSelect.sql}
      FROM posts
      WHERE posts.id = ?
        AND posts.deleted = 0
      `
    )
    .get(...viewerSelect.params, postId);

  if (!row) {
    return res.status(404).json({ error: '帖子不存在或已删除' });
  }

  return res.json({ post: mapPostRow(row, row.hot_score >= 20) });
});

const sumReactionCounts = (postId) => {
  const base = db
    .prepare(
      `
      SELECT
        COALESCE(SUM(CASE WHEN reaction = 'like' THEN 1 ELSE 0 END), 0) AS likes_count,
        COALESCE(SUM(CASE WHEN reaction = 'dislike' THEN 1 ELSE 0 END), 0) AS dislikes_count
      FROM (
        SELECT reaction FROM post_reactions WHERE post_id = ?
        UNION ALL
        SELECT reaction FROM post_reactions_fingerprint WHERE post_id = ?
      )
      `
    )
    .get(postId, postId);

  return {
    likes_count: Number(base?.likes_count || 0),
    dislikes_count: Number(base?.dislikes_count || 0),
  };
};

const toggleReaction = db.transaction((postId, identityKey, identityHashes, reaction) => {
  const existing = findExistingReaction(postId, identityHashes);
  const reactionMatch = buildIdentityMatch('fingerprint', identityHashes);

  let nextReaction = null;

  if (!existing) {
    db.prepare(
      'INSERT INTO post_reactions_fingerprint (post_id, fingerprint, reaction, created_at) VALUES (?, ?, ?, ?)'
    ).run(postId, identityKey, reaction, Date.now());
    nextReaction = reaction;
  } else if (existing.reaction === reaction) {
    db.prepare(`DELETE FROM post_reactions_fingerprint WHERE post_id = ? AND ${reactionMatch.clause}`)
      .run(postId, ...reactionMatch.params);
    nextReaction = null;
  } else if (existing.fingerprint === identityKey) {
    db.prepare('UPDATE post_reactions_fingerprint SET reaction = ?, created_at = ? WHERE post_id = ? AND fingerprint = ?')
      .run(reaction, Date.now(), postId, identityKey);
    nextReaction = reaction;
  } else {
    db.prepare(`DELETE FROM post_reactions_fingerprint WHERE post_id = ? AND ${reactionMatch.clause}`)
      .run(postId, ...reactionMatch.params);
    db.prepare(
      'INSERT INTO post_reactions_fingerprint (post_id, fingerprint, reaction, created_at) VALUES (?, ?, ?, ?)'
    ).run(postId, identityKey, reaction, Date.now());
    nextReaction = reaction;
  }

  // 旧数据（post_reactions:session_id）需要继续可用，因此这里不再做增量更新，
  // 而是从“旧表 + 新表”汇总计数，保证展示与返回稳定正确。
  const counts = sumReactionCounts(postId);
  db.prepare('UPDATE posts SET likes_count = ?, dislikes_count = ? WHERE id = ?')
    .run(counts.likes_count, counts.dislikes_count, postId);

  return { ...counts, reaction: nextReaction };
});

app.post('/api/posts/:id/like', (req, res) => {
  const postId = req.params.id;
  const post = db.prepare('SELECT id, fingerprint, content, created_at FROM posts WHERE id = ? AND deleted = 0').get(postId);
  if (!post) {
    return res.status(404).json({ error: '内容不存在' });
  }

  const fingerprint = requireFingerprint(req, res);
  if (!fingerprint) {
    return;
  }
  const identityHashes = getIdentityLookupHashes(req, res);

  const result = toggleReaction(postId, fingerprint, identityHashes, 'like');
  if (result.reaction === 'like') {
    createNotification({
      recipientFingerprint: post.fingerprint,
      recipientCreatedAt: post.created_at,
      type: 'post_like',
      postId,
      preview: trimPreview(post.content),
      actorIdentityContext: getRequestIdentityContext(req, res),
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
  const identityHashes = getIdentityLookupHashes(req, res);

  const result = toggleReaction(postId, fingerprint, identityHashes, 'dislike');
  return res.json({
    likes: result.likes_count,
    dislikes: result.dislikes_count,
    reaction: result.reaction,
  });
});

const toggleFavorite = db.transaction((postId, fingerprint, identityHashes) => {
  const existing = findExistingFavorite(postId, identityHashes);
  const favoriteMatch = buildIdentityMatch('fingerprint', identityHashes);

  if (existing) {
    db.prepare(`DELETE FROM post_favorites WHERE post_id = ? AND ${favoriteMatch.clause}`)
      .run(postId, ...favoriteMatch.params);
    return { favorited: false };
  }

  db.prepare('INSERT INTO post_favorites (post_id, fingerprint, created_at) VALUES (?, ?, ?)')
    .run(postId, fingerprint, Date.now());
  return { favorited: true };
});

app.post('/api/posts/:id/favorite', (req, res) => {
  const postId = String(req.params.id || '').trim();
  if (!postId) {
    return res.status(400).json({ error: '帖子不存在' });
  }

  const post = db.prepare('SELECT id FROM posts WHERE id = ? AND deleted = 0').get(postId);
  if (!post) {
    return res.status(404).json({ error: '内容不存在' });
  }

  const fingerprint = requireFingerprint(req, res);
  if (!fingerprint) {
    return;
  }
  const identityHashes = getIdentityLookupHashes(req, res);

  if (!checkBanFor(req, res, 'like', '你已被限制操作')) {
    return;
  }

  const result = toggleFavorite(postId, fingerprint, identityHashes);
  return res.json(result);
});

app.get('/api/favorites', (req, res) => {
  if (!checkBanFor(req, res, 'view', '你已被限制浏览')) {
    return;
  }
  const fingerprint = requireFingerprint(req, res);
  if (!fingerprint) {
    return;
  }
  const identityHashes = getIdentityLookupHashes(req, res);
  const favoriteMatch = buildIdentityMatch('fingerprint', identityHashes);
  const viewerReaction = buildViewerReactionSelect(identityHashes);

  const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 50);
  const offset = Math.max(Number(req.query.offset || 0), 0);

  const total = db
    .prepare(`SELECT COUNT(1) AS count FROM (
      SELECT post_id
      FROM post_favorites
      WHERE ${favoriteMatch.clause}
      GROUP BY post_id
    ) favorite_posts`)
    .get(...favoriteMatch.params)?.count ?? 0;

  const rows = db
    .prepare(
      `
      SELECT posts.*, ${hotScoreSql} AS hot_score,
        ${viewerReaction.sql},
        1 AS viewer_favorited,
        pf.created_at AS favorited_at
      FROM (
        SELECT post_id, MAX(created_at) AS created_at
        FROM post_favorites
        WHERE ${favoriteMatch.clause}
        GROUP BY post_id
      ) pf
      JOIN posts ON posts.id = pf.post_id
      WHERE posts.deleted = 0
      ORDER BY pf.created_at DESC
      LIMIT ? OFFSET ?
      `
    )
    .all(...viewerReaction.params, ...favoriteMatch.params, limit, offset);

  const items = rows.map((row) => mapPostRow(row, row.hot_score >= 20));
  return res.json({ items, total });
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


};
