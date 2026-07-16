import { buildIdentityMatch } from '../../sql-utils.js';

export const registerPublicPostsRoutes = (app, deps) => {
  const {
    db,
    hotScoreSql,
    postHotScoreService,
    mapPostRow,
    mapCommentRow,
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
    getEquippedFrameIdForIdentity,
    getEquippedNameStyleIdForIdentity,
    wecomWebhookService,
  } = deps;

  const MAX_POST_TAGS = 2;
  const MAX_TAG_LENGTH = 6;
  const MAX_DEFAULT_TAGS = 50;
  const MAX_FEED_SEARCH_LENGTH = 80;
  const MIN_FEED_RESULT_VERSION = 1_000_000_000_000n;
  const FEED_RESULT_VERSION_RANGE = BigInt(Number.MAX_SAFE_INTEGER)
    - MIN_FEED_RESULT_VERSION
    + 1n;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const MAX_SEARCH_RANGE_DAYS = 30;
  const DATE_INPUT_RE = /^\d{4}-\d{2}-\d{2}$/;
  const FEED_FILTERS = new Set(['today', 'week', 'all']);
  let readVisibleFeedCandidateRows = null;
  let readSearchedFeedCandidateRows = null;

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
  const parseNonNegativeInt = (value, fallback = 0) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.max(0, Math.floor(parsed));
  };
  const resolveFeedResultVersion = ({ filter, search, rankingUpdatedAt, candidates }) => {
    const payload = JSON.stringify({
      filter,
      search,
      rankingUpdatedAt,
      candidateIds: candidates.map((candidate) => candidate.id),
    });
    const digest = crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
    const hashValue = BigInt(`0x${digest}`);
    // 保持在 JS 安全整数和客户端“毫秒时间戳”归一化区间内，但语义上仅作为不透明版本号。
    return Number(
      MIN_FEED_RESULT_VERSION + (hashValue % FEED_RESULT_VERSION_RANGE)
    );
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


  const buildViewerSelect = (identityHashes) => {
    const reactionMatch = buildIdentityMatch('pr.fingerprint', identityHashes);
    const favoriteMatch = buildIdentityMatch('pf.fingerprint', identityHashes);
    const featureRequestMatch = buildIdentityMatch('pfr.requester_identity_key', identityHashes);
    const featureLegacyMatch = buildIdentityMatch('pfr.requester_legacy_fingerprint', identityHashes);
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
        ) AS viewer_favorited,
        (
          SELECT pfr.status
          FROM post_feature_requests pfr
          WHERE pfr.post_id = posts.id
            AND (${featureRequestMatch.clause} OR ${featureLegacyMatch.clause})
          ORDER BY pfr.created_at DESC
          LIMIT 1
        ) AS viewer_feature_request_status
      `,
      params: [
        ...reactionMatch.params,
        ...favoriteMatch.params,
        ...featureRequestMatch.params,
        ...featureLegacyMatch.params,
      ],
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

  const buildViewerAuthorSelect = (identityHashes) => {
    const authorMatch = buildIdentityMatch('posts.fingerprint', identityHashes);
    return {
      sql: `
        CASE WHEN ${authorMatch.clause} THEN 1 ELSE 0 END AS viewer_is_author,
        CASE WHEN ${authorMatch.clause} THEN (
          SELECT pdr.status
          FROM post_delete_requests pdr
          WHERE pdr.post_id = posts.id
            AND pdr.status = 'pending'
          ORDER BY pdr.created_at DESC, pdr.id DESC
          LIMIT 1
        ) ELSE NULL END AS viewer_delete_request_status
      `,
      params: [...authorMatch.params, ...authorMatch.params],
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

  const notifyPostDeleteRequestPending = (payload = {}) => {
    try {
      void Promise.resolve(wecomWebhookService?.notifyPostDeleteRequest?.(payload)).catch(() => { });
    } catch {
      // Webhook 提醒失败不能影响发帖人提交删除申请。
    }
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
  const viewerAuthorSelect = buildViewerAuthorSelect(viewerIdentityHashes);

  const total = db
    .prepare(
      `
        SELECT COUNT(*) as count
        FROM posts
        WHERE deleted = 0 AND hidden = 0
      `
    )
    .get()?.count ?? 0;

  const rows = db
    .prepare(
      `
        SELECT posts.*, ${hotScoreSql} AS hot_score,
          ${viewerSelect.sql},
          ${viewerAuthorSelect.sql}
      FROM posts
        WHERE posts.deleted = 0 AND posts.hidden = 0
        ORDER BY posts.created_at DESC
        LIMIT ? OFFSET ?
        `
    )
    .all(...viewerSelect.params, ...viewerAuthorSelect.params, limit, offset);

  const posts = rows.map((row) => mapPostRow(row, false));
  res.json({ items: posts, total });
});

app.get('/api/posts/feed', (req, res) => {
  if (!checkBanFor(req, res, 'view', '你已被限制浏览')) {
    return;
  }
  const requestedFilter = String(req.query.filter || 'week');
  const filter = FEED_FILTERS.has(requestedFilter) ? requestedFilter : 'week';
  const search = String(req.query.search || '').trim();
  if (search.length > MAX_FEED_SEARCH_LENGTH) {
    return res.status(400).json({
      error: `热门搜索关键词不能超过 ${MAX_FEED_SEARCH_LENGTH} 个字符`,
    });
  }
  const limit = Math.min(parsePositiveInt(req.query.limit, 30), 50);
  const offset = parseNonNegativeInt(req.query.offset);
  const expectedRankingUpdatedAt = parseNonNegativeInt(req.query.rankingUpdatedAt);
  const dateKey = formatDateKey();
  trackDailyVisit(dateKey, req.sessionID);
  const viewerIdentityHashes = getIdentityLookupHashes(req, res);
  const viewerSelect = buildViewerSelect(viewerIdentityHashes);
  const viewerAuthorSelect = buildViewerAuthorSelect(viewerIdentityHashes);

  const rankingState = postHotScoreService.getRankingState(filter);
  let rankedCandidates = [];
  if (rankingState.ranking.length) {
    const rankingById = new Map(
      rankingState.ranking.map((candidate) => [candidate.id, candidate])
    );
    const rankingIdsJson = JSON.stringify(rankingState.ranking.map((candidate) => candidate.id));
    let publicCandidateRows;
    if (search) {
      const keyword = `%${escapeLike(search)}%`;
      // 一次集合查询完成公开状态校验和搜索匹配，不按候选逐条访问数据库。
      if (!readSearchedFeedCandidateRows) {
        readSearchedFeedCandidateRows = db.prepare(`
          SELECT posts.id
          FROM json_each(?) AS hot_posts
          CROSS JOIN posts ON posts.id = hot_posts.value
          WHERE posts.deleted = 0
            AND posts.hidden = 0
            AND (
              posts.id LIKE ? ESCAPE '\\'
              OR posts.content LIKE ? ESCAPE '\\'
              OR posts.ip LIKE ? ESCAPE '\\'
              OR posts.fingerprint LIKE ? ESCAPE '\\'
            )
          ORDER BY CAST(hot_posts.key AS INTEGER) ASC
        `);
      }
      publicCandidateRows = readSearchedFeedCandidateRows
        .all(rankingIdsJson, keyword, keyword, keyword, keyword);
    } else {
      if (!readVisibleFeedCandidateRows) {
        readVisibleFeedCandidateRows = db.prepare(`
          SELECT posts.id
          FROM json_each(?) AS hot_posts
          CROSS JOIN posts ON posts.id = hot_posts.value
          WHERE posts.deleted = 0 AND posts.hidden = 0
          ORDER BY CAST(hot_posts.key AS INTEGER) ASC
        `);
      }
      publicCandidateRows = readVisibleFeedCandidateRows.all(rankingIdsJson);
    }
    rankedCandidates = publicCandidateRows
      .map((row) => rankingById.get(row.id))
      .filter(Boolean);
  }

  const total = rankedCandidates.length;
  const rankingVersion = resolveFeedResultVersion({
    filter,
    search,
    rankingUpdatedAt: rankingState.updatedAt,
    candidates: rankedCandidates,
  });
  if (
    offset > 0
    && expectedRankingUpdatedAt > 0
    && expectedRankingUpdatedAt !== rankingVersion
  ) {
    return res.json({
      items: [],
      total,
      nextOffset: 0,
      hasMore: total > 0,
      resetRequired: true,
      rankingUpdatedAt: rankingVersion,
      rankingExpiresAt: rankingState.expiresAt,
      rankingExpiresInMs: rankingState.expiresInMs,
    });
  }
  const pageCandidates = rankedCandidates.slice(offset, offset + limit);
  const nextOffset = offset + pageCandidates.length;
  const responseMeta = {
    total,
    nextOffset,
    hasMore: nextOffset < total,
    rankingUpdatedAt: rankingVersion,
    rankingExpiresAt: rankingState.expiresAt,
    rankingExpiresInMs: rankingState.expiresInMs,
  };
  if (!pageCandidates.length) {
    return res.json({ items: [], ...responseMeta });
  }

  // 只 hydrate 当前候选页；缓存期内被隐藏或删除的 ID 会在这里再次被拦截。
  const rows = db
    .prepare(
      `
      SELECT posts.*,
        ${viewerSelect.sql},
        ${viewerAuthorSelect.sql}
      FROM json_each(?) AS hot_posts
      CROSS JOIN posts ON posts.id = hot_posts.value
      WHERE posts.deleted = 0 AND posts.hidden = 0
      ORDER BY CAST(hot_posts.key AS INTEGER) ASC
      `
    )
    .all(
      ...viewerSelect.params,
      ...viewerAuthorSelect.params,
      JSON.stringify(pageCandidates.map((candidate) => candidate.id))
    );

  const rowById = new Map(rows.map((row) => [row.id, row]));
  const posts = [];
  pageCandidates.forEach((candidate, pageIndex) => {
    const row = rowById.get(candidate.id);
    if (!row) {
      return;
    }
    posts.push(mapPostRow(
      { ...row, hot_score: candidate.score },
      offset + pageIndex < 3 && candidate.eligible
    ));
  });
  res.json({ items: posts, ...responseMeta });
});

app.get('/api/posts/featured', (req, res) => {
  if (!checkBanFor(req, res, 'view', '你已被限制浏览')) {
    return;
  }
  const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 50);
  const offset = Math.max(Number(req.query.offset || 0), 0);
  const dateKey = formatDateKey();
  trackDailyVisit(dateKey, req.sessionID);
  const viewerIdentityHashes = getIdentityLookupHashes(req, res);
  const viewerSelect = buildViewerSelect(viewerIdentityHashes);
  const viewerAuthorSelect = buildViewerAuthorSelect(viewerIdentityHashes);

  const total = Number(db.prepare(`
    SELECT COUNT(1) AS count
    FROM posts
    WHERE deleted = 0 AND hidden = 0 AND featured = 1
  `).get()?.count || 0);
  const rows = db.prepare(`
    SELECT posts.*, ${hotScoreSql} AS hot_score,
      ${viewerSelect.sql},
      ${viewerAuthorSelect.sql}
    FROM posts
    WHERE posts.deleted = 0
      AND posts.hidden = 0
      AND posts.featured = 1
    ORDER BY posts.featured_at DESC, posts.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...viewerSelect.params, ...viewerAuthorSelect.params, limit, offset);

  return res.json({
    items: rows.map((row) => mapPostRow(row, false)),
    total,
  });
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
      WHERE deleted = 0 AND hidden = 0
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
  const viewerAuthorSelect = buildViewerAuthorSelect(viewerIdentityHashes);

  if (dateRange.error) {
    return res.status(400).json({ error: dateRange.error });
  }

  if (!keywordRaw && !tag && !dateRange.hasRange) {
    return res.json({ items: [], total: 0, page, limit });
  }

  // 标签/关键字搜索：把 LIKE 的通配符当作字面量，避免用户输入 %/_ 导致意外匹配。
  // 评论先聚合为命中的帖子 ID，避免对每条帖子重复扫描评论表。
  const conditions = ['posts.deleted = 0', 'posts.hidden = 0'];
  const params = [];
  let commentKeyword = '';
  if (keywordRaw) {
    const keyword = `%${escapeLike(keywordRaw)}%`;
    commentKeyword = keyword;
    const commentMatchCondition = `
      posts.id IN (
        SELECT comments.post_id
        FROM comments
        WHERE comments.deleted = 0
          AND comments.hidden = 0
          AND comments.content LIKE ? ESCAPE '\\'
      )
    `;
    const keywordAsTag = normalizeTag(keywordRaw);
    if (keywordAsTag) {
      conditions.push(`
        (
          posts.content LIKE ? ESCAPE '\\'
          OR posts.tags LIKE ? ESCAPE '\\'
          OR ${commentMatchCondition}
        )
      `);
      params.push(keyword, buildJsonTagLikePattern(keywordAsTag), keyword);
    } else {
      conditions.push(`
        (
          posts.content LIKE ? ESCAPE '\\'
          OR ${commentMatchCondition}
        )
      `);
      params.push(keyword, keyword);
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
          ${viewerSelect.sql},
          ${viewerAuthorSelect.sql}
        FROM posts
        ${whereClause}
        ORDER BY posts.created_at DESC
        LIMIT ? OFFSET ?
      `
    )
    .all(...viewerSelect.params, ...viewerAuthorSelect.params, ...params, limit, offset);

  const matchedCommentsByPost = new Map();
  const matchedCommentCounts = new Map();
  if (commentKeyword && rows.length > 0) {
    const postIds = rows.map((row) => row.id);
    const placeholders = postIds.map(() => '?').join(',');
    const commentRows = db
      .prepare(
        `
          SELECT *
          FROM (
            SELECT comments.*,
              COUNT(1) OVER (PARTITION BY comments.post_id) AS matched_comment_count,
              ROW_NUMBER() OVER (
                PARTITION BY comments.post_id
                ORDER BY comments.created_at DESC, comments.id DESC
              ) AS matched_comment_rank
            FROM comments INDEXED BY idx_comments_post_id
            WHERE comments.post_id IN (${placeholders})
              AND comments.deleted = 0
              AND comments.hidden = 0
              AND comments.content LIKE ? ESCAPE '\\'
          ) matched_comments
          WHERE matched_comment_rank <= 3
          ORDER BY created_at DESC, id DESC
        `
      )
      .all(...postIds, commentKeyword);

    commentRows.forEach((row) => {
      if (!matchedCommentsByPost.has(row.post_id)) {
        matchedCommentsByPost.set(row.post_id, []);
      }
      matchedCommentsByPost.get(row.post_id).push(mapCommentRow(row));
      matchedCommentCounts.set(row.post_id, Number(row.matched_comment_count || 0));
    });
  }

  const items = rows.map((row) => ({
    ...mapPostRow(row, false),
    ...(keywordRaw
      ? {
        matchedComments: matchedCommentsByPost.get(row.id) || [],
        matchedCommentCount: matchedCommentCounts.get(row.id) || 0,
      }
      : {}),
  }));
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
  // 发帖时快照当前装备的昵称框 / 炫彩昵称；仅本帖生效，不影响历史帖
  const authorFrameId = typeof getEquippedFrameIdForIdentity === 'function'
    ? getEquippedFrameIdForIdentity(fingerprint)
    : null;
  const authorNameStyleId = typeof getEquippedNameStyleIdForIdentity === 'function'
    ? getEquippedNameStyleIdForIdentity(fingerprint)
    : null;

  db.prepare(
    `
    INSERT INTO posts (
      id,
      content,
      author,
      tags,
      created_at,
      session_id,
      ip,
      fingerprint,
      comment_identity_enabled,
      comment_identity_guest_seq,
      author_frame_id,
      author_name_style_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    postId,
    content,
    '匿名',
    JSON.stringify(tags),
    now,
    req.sessionID,
    clientIp,
    fingerprint,
    1,
    0,
    authorFrameId,
    authorNameStyleId
  );

  incrementDailyStat(formatDateKey(), 'posts', 1);

  const viewerSelect = buildViewerSelect([fingerprint]);
  const viewerAuthorSelect = buildViewerAuthorSelect([fingerprint]);
  const row = db
    .prepare(
      `
      SELECT posts.*, ${hotScoreSql} AS hot_score,
        ${viewerSelect.sql},
        ${viewerAuthorSelect.sql}
      FROM posts
      WHERE posts.id = ?
      `
    )
    .get(...viewerSelect.params, ...viewerAuthorSelect.params, postId);

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
  const viewerAuthorSelect = buildViewerAuthorSelect(viewerIdentityHashes);

  const row = db
    .prepare(
      `
      SELECT posts.*, ${hotScoreSql} AS hot_score,
        ${viewerSelect.sql},
        ${viewerAuthorSelect.sql}
      FROM posts
      WHERE posts.id = ?
        AND posts.deleted = 0
        AND posts.hidden = 0
      `
    )
    .get(...viewerSelect.params, ...viewerAuthorSelect.params, postId);

  if (!row) {
    return res.status(404).json({ error: '帖子不存在或已删除' });
  }

  return res.json({ post: mapPostRow(row, false) });
});

app.post('/api/posts/:id/delete-requests', (req, res) => {
  const postId = String(req.params.id || '').trim();
  const reason = String(req.body?.reason || '').trim();

  if (!postId) {
    return res.status(400).json({ error: '帖子不存在' });
  }

  if (!reason) {
    return res.status(400).json({ error: '请填写删除原因' });
  }

  if (reason.length > 1000) {
    return res.status(400).json({ error: '删除原因不能超过 1000 字' });
  }

  const requesterFingerprint = requireFingerprint(req, res);
  if (!requesterFingerprint) {
    return;
  }

  if (!checkBanFor(req, res, 'post', '你已被限制操作', requesterFingerprint)) {
    return;
  }

  const post = db
    .prepare(
      `
      SELECT id, content, fingerprint, deleted, hidden
      FROM posts
      WHERE id = ?
      `
    )
    .get(postId);

  if (!post || post.deleted === 1 || post.hidden === 1) {
    return res.status(404).json({ error: '帖子不存在或当前不可申请删除' });
  }

  const identityHashes = getIdentityLookupHashes(req, res);
  const normalizedHashes = new Set(
    [...identityHashes, requesterFingerprint]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  );
  const postFingerprint = String(post.fingerprint || '').trim();
  if (!postFingerprint || !normalizedHashes.has(postFingerprint)) {
    return res.status(403).json({ error: '只有发帖人可以申请删除' });
  }

  const existingPending = db
    .prepare(
      `
      SELECT id
      FROM post_delete_requests
      WHERE post_id = ?
        AND status = 'pending'
      LIMIT 1
      `
    )
    .get(postId);
  if (existingPending) {
    return res.status(409).json({ error: '删除申请正在审核中' });
  }

  const now = Date.now();
  const requestId = crypto.randomUUID();
  db.prepare(
    `
    INSERT INTO post_delete_requests (
      id,
      post_id,
      requester_fingerprint,
      requester_ip,
      reason,
      status,
      created_at
    ) VALUES (?, ?, ?, ?, ?, 'pending', ?)
    `
  ).run(requestId, postId, requesterFingerprint, getClientIp(req) || null, reason, now);

  notifyPostDeleteRequestPending({
    postId,
    requestId,
    contentSnippet: post.content,
    reason,
    createdAt: now,
  });

  return res.status(201).json({
    item: {
      id: requestId,
      postId,
      reason,
      status: 'pending',
      createdAt: now,
    },
  });
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
  const post = db.prepare('SELECT id, fingerprint, content FROM posts WHERE id = ? AND deleted = 0 AND hidden = 0').get(postId);
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
  const post = db.prepare('SELECT id, fingerprint FROM posts WHERE id = ? AND deleted = 0 AND hidden = 0').get(postId);
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

  const post = db.prepare('SELECT id FROM posts WHERE id = ? AND deleted = 0 AND hidden = 0').get(postId);
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
        AND posts.hidden = 0
      ORDER BY pf.created_at DESC
      LIMIT ? OFFSET ?
      `
    )
    .all(...viewerReaction.params, ...favoriteMatch.params, limit, offset);

  const items = rows.map((row) => mapPostRow(row, false));
  return res.json({ items, total });
});

app.post('/api/posts/:id/view', (req, res) => {
  if (!checkBanFor(req, res, 'view', '你已被限制浏览')) {
    return;
  }
  const postId = req.params.id;
  const post = db.prepare('SELECT id, views_count FROM posts WHERE id = ? AND deleted = 0 AND hidden = 0').get(postId);
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
