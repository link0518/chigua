const buildPlaceholders = (values) => values.map(() => '?').join(',');

export const createModerationRepository = (db) => {
  const getPostsByIds = (ids) => {
    if (!ids.length) {
      return [];
    }
    const placeholders = buildPlaceholders(ids);
    return db
      .prepare(`SELECT id, content, deleted, session_id, ip, fingerprint, created_at FROM posts WHERE id IN (${placeholders})`)
      .all(...ids);
  };

  const setPostsDeletedState = (ids, deleted, deletedAt) => {
    if (!ids.length) {
      return;
    }
    const placeholders = buildPlaceholders(ids);
    db.prepare(`UPDATE posts SET deleted = ?, deleted_at = ? WHERE id IN (${placeholders})`)
      .run(deleted, deletedAt, ...ids);
  };

  const getReportById = (reportId) => db.prepare('SELECT * FROM reports WHERE id = ?').get(reportId);

  const setReportResolution = (reportId, status, action, resolvedAt) => {
    db.prepare('UPDATE reports SET status = ?, action = ?, resolved_at = ? WHERE id = ?')
      .run(status, action, resolvedAt, reportId);
  };

  const getCommentById = (commentId) => db
    .prepare('SELECT id, post_id, ip, fingerprint, deleted, created_at FROM comments WHERE id = ?')
    .get(commentId);

  const softDeleteComment = (commentId, deletedAt) => {
    db.prepare('UPDATE comments SET deleted = 1, deleted_at = ? WHERE id = ?')
      .run(deletedAt, commentId);
  };

  const decrementPostComments = (postId) => {
    db.prepare(
      'UPDATE posts SET comments_count = CASE WHEN comments_count - 1 < 0 THEN 0 ELSE comments_count - 1 END WHERE id = ?'
    ).run(postId);
  };

  const getPostIdentity = (postId) => db.prepare('SELECT ip, fingerprint, created_at FROM posts WHERE id = ?').get(postId);

  const softDeletePost = (postId, deletedAt) => {
    db.prepare('UPDATE posts SET deleted = 1, deleted_at = ? WHERE id = ?')
      .run(deletedAt, postId);
  };

  const getReportsByIds = (ids) => {
    if (!ids.length) {
      return [];
    }
    const placeholders = buildPlaceholders(ids);
    return db
      .prepare(`SELECT id, status, action FROM reports WHERE id IN (${placeholders})`)
      .all(...ids);
  };

  const resolvePendingReports = (ids, resolvedAt) => {
    if (!ids.length) {
      return { changes: 0 };
    }
    const placeholders = buildPlaceholders(ids);
    return db
      .prepare(`UPDATE reports SET status = 'resolved', action = 'reviewed', resolved_at = ? WHERE id IN (${placeholders}) AND status = 'pending'`)
      .run(resolvedAt, ...ids);
  };

  const ignorePendingReports = (ids, resolvedAt) => {
    if (!ids.length) {
      return { changes: 0 };
    }
    const placeholders = buildPlaceholders(ids);
    return db
      .prepare(`UPDATE reports SET status = 'ignored', action = 'ignore', resolved_at = ? WHERE id IN (${placeholders}) AND status = 'pending'`)
      .run(resolvedAt, ...ids);
  };

  const listBannedIps = () => db
    .prepare('SELECT ip, banned_at, expires_at, permissions, reason FROM banned_ips ORDER BY banned_at DESC')
    .all();

  const listBannedFingerprints = () => db
    .prepare('SELECT fingerprint, banned_at, expires_at, permissions, reason FROM banned_fingerprints ORDER BY banned_at DESC')
    .all();

  const listBannedIdentities = () => db
    .prepare('SELECT identity, banned_at, expires_at, permissions, reason FROM banned_identities ORDER BY banned_at DESC')
    .all();

  const unbanIp = (ip) => {
    db.prepare('DELETE FROM banned_ips WHERE ip = ?').run(ip);
  };

  const unbanFingerprint = (fingerprint) => {
    db.prepare('DELETE FROM banned_fingerprints WHERE fingerprint = ?').run(fingerprint);
  };

  const unbanIdentity = (identity) => {
    db.prepare('DELETE FROM banned_identities WHERE identity = ?').run(identity);
  };

  return {
    getPostsByIds,
    setPostsDeletedState,
    getReportById,
    setReportResolution,
    getCommentById,
    softDeleteComment,
    decrementPostComments,
    getPostIdentity,
    softDeletePost,
    getReportsByIds,
    resolvePendingReports,
    ignorePendingReports,
    listBannedIps,
    listBannedFingerprints,
    listBannedIdentities,
    unbanIp,
    unbanFingerprint,
    unbanIdentity,
  };
};
