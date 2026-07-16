import { buildIdentityMatch } from '../sql-utils.js';

const buildSearchClause = (search, columns) => {
  const normalized = String(search || '').trim();
  if (!normalized) {
    return { clause: '', params: [] };
  }
  const keyword = `%${normalized}%`;
  return {
    clause: ` AND (${columns.map((column) => `${column} LIKE ?`).join(' OR ')})`,
    params: columns.map(() => keyword),
  };
};

export const createPostFeatureRepository = (db) => {
  const getPost = (postId) => db.prepare(`
    SELECT id, content, created_at, deleted, hidden, featured, featured_at
    FROM posts
    WHERE id = ?
  `).get(postId);

  const findRequestForIdentity = (postId, identityHashes) => {
    // canonical 用于同 Cookie 下识别，legacy 用于 Cookie 轮换后继续识别同一浏览器。
    const identityMatch = buildIdentityMatch('requester_identity_key', identityHashes);
    const legacyMatch = buildIdentityMatch('requester_legacy_fingerprint', identityHashes);
    return db.prepare(`
      SELECT *
      FROM post_feature_requests
      WHERE post_id = ?
        AND (${identityMatch.clause} OR ${legacyMatch.clause})
      ORDER BY created_at DESC
      LIMIT 1
    `).get(postId, ...identityMatch.params, ...legacyMatch.params);
  };

  const insertRequest = ({
    id,
    postId,
    identityKey,
    legacyFingerprint,
    requesterIp,
    createdAt,
  }) => db.prepare(`
    INSERT INTO post_feature_requests (
      id,
      post_id,
      requester_identity_key,
      requester_legacy_fingerprint,
      requester_ip,
      status,
      created_at
    ) VALUES (?, ?, ?, ?, ?, 'pending', ?)
  `).run(
    id,
    postId,
    identityKey,
    legacyFingerprint || null,
    requesterIp || null,
    createdAt
  );

  const getPendingRequests = (postId) => db.prepare(`
    SELECT *
    FROM post_feature_requests
    WHERE post_id = ? AND status = 'pending'
    ORDER BY created_at ASC
  `).all(postId);

  const updatePendingRequests = ({ postId, status, reviewedAt, reviewedBy, reviewedByUsername, reviewReason }) => db.prepare(`
    UPDATE post_feature_requests
    SET status = ?,
        reviewed_at = ?,
        reviewed_by = ?,
        reviewed_by_username = ?,
        review_reason = ?
    WHERE post_id = ? AND status = 'pending'
  `).run(
    status,
    reviewedAt,
    reviewedBy,
    reviewedByUsername,
    reviewReason || null,
    postId
  );

  const setPostFeatured = (postId, featured, featuredAt) => db.prepare(`
    UPDATE posts
    SET featured = ?, featured_at = ?
    WHERE id = ?
  `).run(featured ? 1 : 0, featured ? featuredAt : null, postId);

  const listPending = ({ search = '', page = 1, limit = 10 }) => {
    const offset = (page - 1) * limit;
    const searchSql = buildSearchClause(search, ['posts.id', 'posts.content']);
    const total = Number(db.prepare(`
      SELECT COUNT(DISTINCT pfr.post_id) AS count
      FROM post_feature_requests pfr
      JOIN posts ON posts.id = pfr.post_id
      WHERE pfr.status = 'pending'
      ${searchSql.clause}
    `).get(...searchSql.params)?.count || 0);

    const items = db.prepare(`
      SELECT
        posts.id AS post_id,
        posts.content AS post_content,
        posts.created_at AS post_created_at,
        posts.deleted AS post_deleted,
        posts.hidden AS post_hidden,
        posts.featured AS post_featured,
        posts.featured_at AS post_featured_at,
        COUNT(pfr.id) AS request_count,
        COUNT(DISTINCT COALESCE(
          NULLIF(pfr.requester_legacy_fingerprint, ''),
          pfr.requester_identity_key
        )) AS requester_count,
        MIN(pfr.created_at) AS first_requested_at,
        MAX(pfr.created_at) AS latest_requested_at
      FROM post_feature_requests pfr
      JOIN posts ON posts.id = pfr.post_id
      WHERE pfr.status = 'pending'
      ${searchSql.clause}
      GROUP BY pfr.post_id
      ORDER BY latest_requested_at DESC
      LIMIT ? OFFSET ?
    `).all(...searchSql.params, limit, offset);

    return { items, total, page, limit };
  };

  const listFeatured = ({ search = '', page = 1, limit = 10 }) => {
    const offset = (page - 1) * limit;
    const searchSql = buildSearchClause(search, ['posts.id', 'posts.content']);
    const where = `posts.featured = 1 AND posts.deleted = 0 AND posts.hidden = 0${searchSql.clause}`;
    const total = Number(db.prepare(`SELECT COUNT(1) AS count FROM posts WHERE ${where}`)
      .get(...searchSql.params)?.count || 0);
    const items = db.prepare(`
      SELECT posts.*
      FROM posts
      WHERE ${where}
      ORDER BY posts.featured_at DESC, posts.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...searchSql.params, limit, offset);
    return { items, total, page, limit };
  };

  const listProcessed = ({ search = '', page = 1, limit = 10 }) => {
    const offset = (page - 1) * limit;
    const searchSql = buildSearchClause(search, [
      'posts.id',
      'posts.content',
      'pfr.reviewed_by_username',
      'pfr.review_reason',
    ]);
    const where = `pfr.status IN ('approved', 'rejected')${searchSql.clause}`;
    const total = Number(db.prepare(`
      SELECT COUNT(1) AS count
      FROM post_feature_requests pfr
      LEFT JOIN posts ON posts.id = pfr.post_id
      WHERE ${where}
    `).get(...searchSql.params)?.count || 0);
    const items = db.prepare(`
      SELECT
        pfr.*,
        posts.content AS post_content,
        posts.deleted AS post_deleted,
        posts.hidden AS post_hidden,
        posts.featured AS post_featured,
        posts.featured_at AS post_featured_at
      FROM post_feature_requests pfr
      LEFT JOIN posts ON posts.id = pfr.post_id
      WHERE ${where}
      ORDER BY COALESCE(pfr.reviewed_at, pfr.created_at) DESC
      LIMIT ? OFFSET ?
    `).all(...searchSql.params, limit, offset);
    return { items, total, page, limit };
  };

  return {
    getPost,
    findRequestForIdentity,
    insertRequest,
    getPendingRequests,
    updatePendingRequests,
    setPostFeatured,
    listPending,
    listFeatured,
    listProcessed,
    runInTransaction: (operation) => db.transaction(operation)(),
  };
};
