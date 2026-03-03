export const registerPublicPostsRoutes = (app, deps) => {
  const {
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
  } = deps;

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
        SELECT posts.*, ${hotScoreSql} AS hot_score,
          pr.reaction AS viewer_reaction,
          pf.post_id IS NOT NULL AS viewer_favorited
      FROM posts
      LEFT JOIN post_reactions_fingerprint pr
        ON pr.post_id = posts.id
        AND pr.fingerprint = ?
      LEFT JOIN post_favorites pf
        ON pf.post_id = posts.id
        AND pf.fingerprint = ?
        WHERE posts.deleted = 0
        ORDER BY posts.created_at DESC
        LIMIT ? OFFSET ?
        `
    )
    .all(viewerFingerprint, viewerFingerprint, limit, offset);

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
  const params = [viewerFingerprint, viewerFingerprint];

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
        pr.reaction AS viewer_reaction,
        pf.post_id IS NOT NULL AS viewer_favorited
      FROM posts
      LEFT JOIN post_reactions_fingerprint pr
        ON pr.post_id = posts.id
        AND pr.fingerprint = ?
      LEFT JOIN post_favorites pf
        ON pf.post_id = posts.id
        AND pf.fingerprint = ?
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
        SELECT posts.*, ${hotScoreSql} AS hot_score,
          pr.reaction AS viewer_reaction,
          pf.post_id IS NOT NULL AS viewer_favorited
        FROM posts
        LEFT JOIN post_reactions_fingerprint pr
          ON pr.post_id = posts.id
          AND pr.fingerprint = ?
        LEFT JOIN post_favorites pf
          ON pf.post_id = posts.id
          AND pf.fingerprint = ?
        WHERE posts.deleted = 0
          AND posts.content LIKE ? ESCAPE '\\'
        ORDER BY posts.created_at DESC
        LIMIT ? OFFSET ?
      `
    )
    .all(viewerFingerprint, viewerFingerprint, keyword, limit, offset);

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
      SELECT posts.*, ${hotScoreSql} AS hot_score,
        pr.reaction AS viewer_reaction,
        pf.post_id IS NOT NULL AS viewer_favorited
      FROM posts
      LEFT JOIN post_reactions_fingerprint pr
        ON pr.post_id = posts.id
        AND pr.fingerprint = ?
      LEFT JOIN post_favorites pf
        ON pf.post_id = posts.id
        AND pf.fingerprint = ?
      WHERE posts.id = ?
      `
    )
    .get(fingerprint, fingerprint, postId);

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
      SELECT posts.*, ${hotScoreSql} AS hot_score,
        pr.reaction AS viewer_reaction,
        pf.post_id IS NOT NULL AS viewer_favorited
      FROM posts
      LEFT JOIN post_reactions_fingerprint pr
        ON pr.post_id = posts.id
        AND pr.fingerprint = ?
      LEFT JOIN post_favorites pf
        ON pf.post_id = posts.id
        AND pf.fingerprint = ?
      WHERE posts.id = ?
        AND posts.deleted = 0
      `
    )
    .get(viewerFingerprint, viewerFingerprint, postId);

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

const toggleReaction = db.transaction((postId, identityKey, reaction) => {
  const existing = db
    .prepare('SELECT reaction FROM post_reactions_fingerprint WHERE post_id = ? AND fingerprint = ?')
    .get(postId, identityKey);

  let nextReaction = null;

  if (!existing) {
    db.prepare(
      'INSERT INTO post_reactions_fingerprint (post_id, fingerprint, reaction, created_at) VALUES (?, ?, ?, ?)'
    ).run(postId, identityKey, reaction, Date.now());
    nextReaction = reaction;
  } else if (existing.reaction === reaction) {
    db.prepare('DELETE FROM post_reactions_fingerprint WHERE post_id = ? AND fingerprint = ?').run(postId, identityKey);
    nextReaction = null;
  } else {
    db.prepare('UPDATE post_reactions_fingerprint SET reaction = ?, created_at = ? WHERE post_id = ? AND fingerprint = ?')
      .run(reaction, Date.now(), postId, identityKey);
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

const toggleFavorite = db.transaction((postId, fingerprint) => {
  const existing = db
    .prepare('SELECT created_at FROM post_favorites WHERE post_id = ? AND fingerprint = ?')
    .get(postId, fingerprint);

  if (existing) {
    db.prepare('DELETE FROM post_favorites WHERE post_id = ? AND fingerprint = ?').run(postId, fingerprint);
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

  if (!checkBanFor(req, res, 'like', '你已被限制操作')) {
    return;
  }

  const result = toggleFavorite(postId, fingerprint);
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

  const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 50);
  const offset = Math.max(Number(req.query.offset || 0), 0);

  const total = db
    .prepare('SELECT COUNT(1) AS count FROM post_favorites WHERE fingerprint = ?')
    .get(fingerprint)?.count ?? 0;

  const rows = db
    .prepare(
      `
      SELECT posts.*, ${hotScoreSql} AS hot_score,
        pr.reaction AS viewer_reaction,
        1 AS viewer_favorited,
        pf.created_at AS favorited_at
      FROM post_favorites pf
      JOIN posts ON posts.id = pf.post_id
      LEFT JOIN post_reactions_fingerprint pr
        ON pr.post_id = posts.id
        AND pr.fingerprint = ?
      WHERE pf.fingerprint = ?
        AND posts.deleted = 0
      ORDER BY pf.created_at DESC
      LIMIT ? OFFSET ?
      `
    )
    .all(fingerprint, fingerprint, limit, offset);

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
