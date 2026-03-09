import { createModerationRepository } from '../../repositories/moderation-repository.js';
import { createAdminModerationService } from '../../services/admin-moderation-service.js';
import {
  buildAdminIdentity,
  buildAdminIdentitySearchValues,
  matchesAdminSearch,
} from '../../admin-identity-utils.js';

export const registerAdminPostsRoutes = (app, deps) => {
  const {
    db,
    requireAdmin,
    requireAdminCsrf,
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
    resolveStoredIdentityHash,
  } = deps;

  const moderationRepository = createModerationRepository(db);
  const moderationService = createAdminModerationService({
    repository: moderationRepository,
    upsertBan,
    BAN_PERMISSIONS,
    logAdminAction,
    resolveStoredIdentityHash,
  });

  const resolveAdminIdentity = ({ fingerprint, sessionId = '', ip = '' }) => buildAdminIdentity({
    fingerprint,
    sessionId,
    ip,
    resolveStoredIdentityHash,
  });

  const mapAdminCommentWithIdentity = (row) => ({
    ...mapAdminCommentRow(row),
    ...resolveAdminIdentity({
      fingerprint: row.fingerprint || '',
      ip: row.ip || '',
    }),
  });

  const buildAdminPostItem = (row, extra = {}) => ({
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
    ...resolveAdminIdentity({
      fingerprint: row.fingerprint || '',
      sessionId: row.session_id || '',
      ip: row.ip || '',
    }),
    ...extra,
  });

  const buildPostSearchValues = (item) => [
    item.id,
    item.content,
    item.author,
    item.ip || '',
    item.sessionId || '',
    ...buildAdminIdentitySearchValues(item),
  ];

  const buildCommentSearchValues = (item) => [
    item.id,
    item.content,
    item.author,
    item.ip || '',
    ...buildAdminIdentitySearchValues(item),
  ];

  const MAX_POST_TAGS = 2;
  const MAX_TAG_LENGTH = 6;
  const normalizeTag = (value) => String(value || '')
    .trim()
    .replace(/^#+/, '')
    .replace(/\s+/g, ' ');
  const sanitizeTags = (input) => {
    const source = Array.isArray(input) ? input : [];
    const seen = new Set();
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
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push(normalized);
      if (result.length >= MAX_POST_TAGS) {
        break;
      }
    }
    return result;
  };

app.post('/api/admin/posts', requireAdmin, requireAdminCsrf, (req, res) => {
  const content = String(req.body?.content || '').trim();
  const tags = sanitizeTags(req.body?.tags);
  const reason = String(req.body?.reason || '').trim();
  const includeDeveloper = Boolean(req.body?.includeDeveloper);

  if (!content) {
    return res.status(400).json({ error: '内容不能为空' });
  }

  if (content.length > 2000) {
    return res.status(400).json({ error: '内容超过字数限制' });
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
      LEFT JOIN post_reactions_fingerprint pr
        ON pr.post_id = posts.id
        AND pr.fingerprint = ?
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

  const banOptions = action === 'ban' ? resolveBanOptions(req) : null;
  return res.json(
    moderationService.executePostBatchAction({
      req,
      action,
      ids,
      reason,
      banOptions,
    })
  );
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
      ${search ? '' : 'LIMIT ? OFFSET ?'}
      `
    )
    .all(...params, ...(search ? [] : [limit, offset]));

  let matchedCommentsByPost = new Map();
  let matchedCommentCounts = new Map();
  if (search && rows.length > 0) {
    const postIds = rows.map((row) => row.id);
    const placeholders = postIds.map(() => '?').join(',');

    const commentRows = db
      .prepare(
        `
        SELECT *
        FROM comments
        WHERE post_id IN (${placeholders})
        ORDER BY created_at ASC
        `
      )
      .all(...postIds);
    matchedCommentsByPost = new Map();
    matchedCommentCounts = new Map();
    commentRows.forEach((row) => {
      const mapped = mapAdminCommentWithIdentity(row);
      if (!matchesAdminSearch(search, buildCommentSearchValues(mapped))) {
        return;
      }
      const currentCount = matchedCommentCounts.get(row.post_id) || 0;
      matchedCommentCounts.set(row.post_id, currentCount + 1);
      if (!matchedCommentsByPost.has(row.post_id)) {
        matchedCommentsByPost.set(row.post_id, []);
      }
      const list = matchedCommentsByPost.get(row.post_id);
      if (list.length < 3) {
        list.push(mapped);
      }
    });
  }

  let items = rows.map((row) => buildAdminPostItem(row, {
    matchedComments: search ? matchedCommentsByPost.get(row.id) || [] : undefined,
    matchedCommentCount: search ? matchedCommentCounts.get(row.id) || 0 : undefined,
  }));
  let total = search
    ? items.length
    : (db.prepare(`SELECT COUNT(1) AS count FROM posts ${whereClause}`).get(...params)?.count || 0);

  if (search) {
    items = items.filter((item) => (
      matchesAdminSearch(search, buildPostSearchValues(item))
      || Boolean(item.matchedCommentCount)
    ));
    const keyword = search.toLowerCase();
    items.sort((a, b) => {
      const aMatchesPost = [
        a.id,
        a.content,
        a.author,
        a.ip || '',
        a.sessionId || '',
        ...buildAdminIdentitySearchValues(a),
      ].some((value) => String(value).toLowerCase().includes(keyword));
      const bMatchesPost = [
        b.id,
        b.content,
        b.author,
        b.ip || '',
        b.sessionId || '',
        ...buildAdminIdentitySearchValues(b),
      ].some((value) => String(value).toLowerCase().includes(keyword));
      if (aMatchesPost !== bMatchesPost) {
        return aMatchesPost ? -1 : 1;
      }
      const aCommentMatches = a.matchedCommentCount || 0;
      const bCommentMatches = b.matchedCommentCount || 0;
      if (aCommentMatches !== bCommentMatches) {
        return bCommentMatches - aCommentMatches;
      }
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
    total = items.length;
    items = items.slice(offset, offset + limit);
  }

  return res.json({
    items,
    total,
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
  const search = String(req.query.search || '').trim();

  if (!postId) {
    return res.status(400).json({ error: '帖子不存在' });
  }

  const conditions = ['post_id = ?'];
  const params = [postId];
  const whereClause = `WHERE ${conditions.join(' AND ' )}`;

  let rows;
  let total = 0;

  if (search) {
    rows = db
      .prepare(
        `
        SELECT *
        FROM comments
        ${whereClause}
        ORDER BY created_at ASC
        `
      )
      .all(...params);
  } else {
    total = db
      .prepare(
        `
        SELECT COUNT(1) AS count
        FROM comments
        ${whereClause}
        `
      )
      .get(...params)?.count || 0;

    rows = db
      .prepare(
        `
        SELECT *
        FROM comments
        ${whereClause}
        ORDER BY created_at ASC
        LIMIT ? OFFSET ?
        `
      )
      .all(...params, limit, offset);
  }

  let items = rows.map((row) => mapAdminCommentWithIdentity(row));
  if (search) {
    items = items.filter((item) => matchesAdminSearch(search, buildCommentSearchValues(item)));
    total = items.length;
    items = items.slice(offset, offset + limit);
  }

  return res.json({
    items,
    total,
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
  let identityBanned = false;
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
    const identityValue = String(row.fingerprint || '').trim();
    if (identityValue) {
      const resolvedIdentity = resolveStoredIdentityHash(identityValue);
      const isIdentityRecord = resolvedIdentity?.type === 'identity';
      const banTargetValue = String(resolvedIdentity?.identityKey || identityValue).trim();
      if (isIdentityRecord) {
        upsertBan('banned_identities', 'identity', banTargetValue, banOptions || {});
        identityBanned = true;
      } else {
        upsertBan('banned_fingerprints', 'fingerprint', banTargetValue, banOptions || {});
        fingerprintBanned = true;
      }
      logAdminAction(req, {
        action: isIdentityRecord ? 'ban_identity' : 'ban_fingerprint',
        targetType: isIdentityRecord ? 'identity' : 'fingerprint',
        targetId: banTargetValue,
        before: null,
        after: { banned: true, permissions: banOptions?.permissions || BAN_PERMISSIONS, expiresAt: banOptions?.expiresAt || null },
        reason,
      });
    }
  }

  return res.json({
    id: commentId,
    deleted: true,
    removed: removedCount,
    ipBanned,
    identityBanned,
    fingerprintBanned,
  });
});


};
