const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const CHINA_TIMEZONE_OFFSET_MS = 8 * HOUR_MS;
const MIN_HOT_INTERACTION_IDENTITIES = 3;

export const DEFAULT_HOT_CACHE_TTL_MS = Object.freeze({
  today: 15 * 60 * 1000,
  week: 30 * 60 * 1000,
  all: 60 * 60 * 1000,
});

const HOT_FILTER_CONFIG = {
  today: {
    halfLifeMs: 12 * HOUR_MS,
  },
  week: {
    windowMs: 7 * DAY_MS,
    halfLifeMs: 72 * HOUR_MS,
  },
  all: {
    windowMs: null,
    halfLifeMs: null,
  },
};

export const normalizeHotFilter = (value) => (
  Object.prototype.hasOwnProperty.call(HOT_FILTER_CONFIG, value) ? value : 'week'
);

const resolveWindowStart = (filter, now) => {
  if (filter === 'today') {
    // “今日”按北京时间自然日计算，避免凌晨仍混入前一日的大部分互动。
    return Math.floor((now + CHINA_TIMEZONE_OFFSET_MS) / DAY_MS) * DAY_MS
      - CHINA_TIMEZONE_OFFSET_MS;
  }
  const windowMs = HOT_FILTER_CONFIG[filter].windowMs;
  return windowMs === null ? null : now - windowMs;
};

/**
 * 互动热度使用对数压缩，避免单项互动量过大后长期霸榜。
 * 点踩只扣分，不计入有效互动人数，也不刷新正向互动时间。
 */
export const calculateInteractionHotScore = ({
  likes = 0,
  dislikes = 0,
  favorites = 0,
  commenters = 0,
  extraComments = 0,
} = {}) => (
  3 * Math.log1p(Math.max(0, likes))
  + 5 * Math.log1p(Math.max(0, favorites))
  + 4 * Math.log1p(Math.max(0, commenters))
  + Math.log1p(Math.max(0, extraComments))
  - Math.log1p(Math.max(0, dislikes))
);

export const createPostHotScoreService = ({
  db,
  nowProvider = () => Date.now(),
  cacheTtlMs = DEFAULT_HOT_CACHE_TTL_MS,
}) => {
  const cache = new Map();
  let readCandidateRows = null;

  const resolveCacheTtlMs = (filter) => {
    // 兼容旧调用传入单个数值；默认按榜单时效性使用分级 TTL。
    const configured = typeof cacheTtlMs === 'number'
      ? cacheTtlMs
      : cacheTtlMs?.[filter];
    const fallback = DEFAULT_HOT_CACHE_TTL_MS[filter];
    const normalized = Number(configured ?? fallback);
    return Number.isFinite(normalized) ? Math.max(0, normalized) : fallback;
  };

  const resolveCacheBoundary = (filter, now) => (
    filter === 'today' ? resolveWindowStart(filter, now) : null
  );

  const readCachedEntry = (filter, now) => {
    const ttlMs = resolveCacheTtlMs(filter);
    const boundary = resolveCacheBoundary(filter, now);
    const cached = cache.get(filter);
    if (
      ttlMs > 0
      && cached
      && cached.boundary === boundary
      && now - cached.createdAt < ttlMs
    ) {
      return cached;
    }
    return null;
  };

  const writeCacheEntry = (filter, now, snapshot) => {
    const entry = {
      boundary: resolveCacheBoundary(filter, now),
      createdAt: now,
      snapshot,
      ranking: null,
    };
    if (resolveCacheTtlMs(filter) > 0) {
      cache.set(filter, entry);
    }
    return entry;
  };
  const buildSnapshotRowsSql = (windowed) => {
    // 时间窗口必须直接作用于 created_at，避免可空 OR 条件让 SQLite 放弃时间索引。
    const windowCondition = windowed ? 'AND created_at >= @windowStart' : '';
    return `
    WITH
    config(now_ms, half_life_ms) AS (
      VALUES (@nowMs, @halfLifeMs)
    ),
    reaction_source AS (
      SELECT
        post_id,
        'fingerprint:' || fingerprint AS identity_key,
        reaction AS event_type,
        created_at
      FROM post_reactions_fingerprint
      WHERE fingerprint IS NOT NULL
        AND fingerprint != ''
        AND reaction IN ('like', 'dislike')
        ${windowCondition}

      UNION ALL

      SELECT
        post_id,
        'session:' || session_id AS identity_key,
        reaction AS event_type,
        created_at
      FROM post_reactions
      WHERE session_id IS NOT NULL
        AND session_id != ''
        AND reaction IN ('like', 'dislike')
        ${windowCondition}
    ),
    favorite_source AS (
      SELECT
        post_id,
        'fingerprint:' || fingerprint AS identity_key,
        created_at
      FROM post_favorites
      WHERE fingerprint IS NOT NULL
        AND fingerprint != ''
        ${windowCondition}
    ),
    comment_source AS (
      SELECT
        post_id,
        CASE
          WHEN TRIM(COALESCE(fingerprint, '')) != ''
            THEN 'fingerprint:' || TRIM(fingerprint)
          WHEN TRIM(COALESCE(post_identity_key, '')) != ''
            THEN 'post-identity:' || TRIM(post_identity_key)
          WHEN TRIM(COALESCE(ip, '')) != ''
            THEN 'ip:' || TRIM(ip)
        END AS identity_key,
        created_at
      FROM comments
      WHERE deleted = 0
        AND hidden = 0
        AND (
          TRIM(COALESCE(fingerprint, '')) != ''
          OR TRIM(COALESCE(post_identity_key, '')) != ''
          OR TRIM(COALESCE(ip, '')) != ''
        )
        ${windowCondition}
    ),
    ranked_comments AS (
      SELECT
        post_id,
        identity_key,
        created_at,
        ROW_NUMBER() OVER (
          PARTITION BY post_id, identity_key
          ORDER BY created_at DESC
        ) AS comment_rank
      FROM comment_source
    ),
    event_metrics AS (
      SELECT
        post_id,
        identity_key,
        CASE WHEN event_type = 'like' THEN 1.0 ELSE 0.0 END AS likes_unit,
        CASE WHEN event_type = 'dislike' THEN 1.0 ELSE 0.0 END AS dislikes_unit,
        0.0 AS favorites_unit,
        0.0 AS commenters_unit,
        0.0 AS extra_comments_unit,
        CASE WHEN event_type = 'like' THEN 1 ELSE 0 END AS positive_identity,
        created_at
      FROM reaction_source

      UNION ALL

      SELECT
        post_id,
        identity_key,
        0.0,
        0.0,
        1.0,
        0.0,
        0.0,
        1,
        created_at
      FROM favorite_source

      UNION ALL

      SELECT
        post_id,
        identity_key,
        0.0,
        0.0,
        0.0,
        CASE WHEN comment_rank = 1 THEN 1.0 ELSE 0.0 END,
        CASE WHEN comment_rank BETWEEN 2 AND 3 THEN 1.0 ELSE 0.0 END,
        1,
        created_at
      FROM ranked_comments
      WHERE comment_rank <= 3
    ),
    weighted_events AS (
      SELECT
        event_metrics.*,
        CASE
          WHEN config.half_life_ms IS NULL THEN 1.0
          ELSE pow(
            2.0,
            -MAX(0.0, config.now_ms - event_metrics.created_at) / config.half_life_ms
          )
        END AS decay
      FROM event_metrics
      CROSS JOIN config
    ),
    per_identity AS (
      SELECT
        post_id,
        identity_key,
        SUM(likes_unit * decay) AS likes,
        SUM(dislikes_unit * decay) AS dislikes,
        SUM(favorites_unit * decay) AS favorites,
        SUM(commenters_unit * decay) AS commenters,
        SUM(extra_comments_unit * decay) AS extra_comments,
        MAX(positive_identity) AS positive_identity,
        MAX(CASE WHEN positive_identity = 1 THEN created_at ELSE 0 END) AS last_positive_at
      FROM weighted_events
      GROUP BY post_id, identity_key
    )
    SELECT
      post_id,
      SUM(likes) AS likes,
      SUM(dislikes) AS dislikes,
      SUM(favorites) AS favorites,
      SUM(commenters) AS commenters,
      SUM(extra_comments) AS extra_comments,
      SUM(positive_identity) AS interaction_identity_count,
      MAX(last_positive_at) AS last_positive_at
    FROM per_identity
    GROUP BY post_id
  `;
  };
  const readWindowedSnapshotRows = db.prepare(buildSnapshotRowsSql(true));
  const readAllSnapshotRows = db.prepare(buildSnapshotRowsSql(false));

  const buildSnapshot = (filter, now) => {
    const normalizedFilter = normalizeHotFilter(filter);
    const config = HOT_FILTER_CONFIG[normalizedFilter];
    const windowStart = resolveWindowStart(normalizedFilter, now);
    const rows = windowStart === null
      ? readAllSnapshotRows.all({
        nowMs: now,
        halfLifeMs: config.halfLifeMs,
      })
      : readWindowedSnapshotRows.all({
        nowMs: now,
        halfLifeMs: config.halfLifeMs,
        windowStart,
      });
    const snapshot = new Map();

    rows.forEach((row) => {
      const metrics = {
        likes: Number(row.likes || 0),
        dislikes: Number(row.dislikes || 0),
        favorites: Number(row.favorites || 0),
        commenters: Number(row.commenters || 0),
        extraComments: Number(row.extra_comments || 0),
      };
      snapshot.set(row.post_id, {
        score: calculateInteractionHotScore(metrics),
        interactionIdentityCount: Number(row.interaction_identity_count || 0),
        lastInteractionAt: Number(row.last_positive_at || 0),
      });
    });

    return snapshot;
  };

  const buildRanking = (snapshot) => {
    const hotPostIds = [];
    snapshot.forEach((metrics, postId) => {
      if (Number(metrics?.interactionIdentityCount || 0) > 0) {
        hotPostIds.push(postId);
      }
    });
    if (!hotPostIds.length) {
      return [];
    }

    if (!readCandidateRows) {
      // 排行缓存只保存排序字段；公开可见性和用户态字段都在每次分页请求时实时补全。
      readCandidateRows = db.prepare(`
        SELECT posts.id, posts.created_at
        FROM json_each(?) AS hot_posts
        CROSS JOIN posts ON posts.id = hot_posts.value
        ORDER BY posts.created_at DESC
      `);
    }

    return readCandidateRows
      .all(JSON.stringify(hotPostIds))
      .map((row) => {
        const metrics = snapshot.get(row.id);
        return {
          id: row.id,
          score: metrics.score,
          interactionIdentityCount: metrics.interactionIdentityCount,
          lastInteractionAt: metrics.lastInteractionAt,
          createdAt: Number(row.created_at || 0),
          eligible: metrics.interactionIdentityCount >= MIN_HOT_INTERACTION_IDENTITIES,
        };
      })
      .sort((left, right) => (
        Number(right.eligible) - Number(left.eligible)
        || right.score - left.score
        || right.lastInteractionAt - left.lastInteractionAt
        || right.createdAt - left.createdAt
      ));
  };

  const getOrCreateEntry = (filter) => {
    const normalizedFilter = normalizeHotFilter(filter);
    const now = Number(nowProvider());
    const cached = readCachedEntry(normalizedFilter, now);
    if (cached) {
      return cached;
    }
    return writeCacheEntry(
      normalizedFilter,
      now,
      buildSnapshot(normalizedFilter, now)
    );
  };

  const getOrBuildRankingEntry = (filter) => {
    const normalizedFilter = normalizeHotFilter(filter);
    const entry = getOrCreateEntry(normalizedFilter);
    if (!entry.ranking) {
      entry.ranking = buildRanking(entry.snapshot);
    }
    const ttlExpiresAt = entry.createdAt + resolveCacheTtlMs(normalizedFilter);
    const boundaryExpiresAt = normalizedFilter === 'today'
      ? entry.boundary + DAY_MS
      : Number.POSITIVE_INFINITY;
    return {
      entry,
      normalizedFilter,
      expiresAt: Math.min(ttlExpiresAt, boundaryExpiresAt),
    };
  };

  return {
    getSnapshot(filter) {
      return getOrCreateEntry(filter).snapshot;
    },
    getRanking(filter) {
      return getOrBuildRankingEntry(filter).entry.ranking;
    },
    getRankingState(filter) {
      const { entry, expiresAt } = getOrBuildRankingEntry(filter);
      const currentTime = Number(nowProvider());
      return {
        ranking: entry.ranking,
        updatedAt: entry.createdAt,
        expiresAt,
        expiresInMs: Math.max(0, expiresAt - currentTime),
      };
    },
    invalidate() {
      cache.clear();
    },
  };
};
