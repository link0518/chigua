export const registerPublicCommentsRoutes = (app, deps) => {
  const {
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
  } = deps;

app.get('/api/posts/:id/comments', (req, res) => {
  if (!checkBanFor(req, res, 'view', '你已被限制浏览')) {
    return;
  }
  const postId = req.params.id;
  const limit = Math.min(Number(req.query.limit || 10), 200);
  const offset = Math.max(Number(req.query.offset || 0), 0);
  const viewerFingerprint = getOptionalFingerprint(req);

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
      `
      SELECT comments.*,
        COALESCE(cl.likes_count, 0) AS likes_count,
        viewer.comment_id IS NOT NULL AS viewer_liked
      FROM comments
      LEFT JOIN (
        SELECT comment_id, COUNT(1) AS likes_count
        FROM comment_likes
        GROUP BY comment_id
      ) cl ON cl.comment_id = comments.id
      LEFT JOIN comment_likes viewer
        ON viewer.comment_id = comments.id
        AND viewer.fingerprint = ?
      WHERE comments.post_id = ? AND comments.parent_id IS NULL
      ORDER BY comments.created_at ASC
      LIMIT ? OFFSET ?
      `
    )
    .all(viewerFingerprint, postId, limit, offset);

  if (rootRows.length === 0) {
    return res.json({ items: [], total });
  }

  const rootIds = rootRows.map((row) => row.id);
  const placeholders = rootIds.map(() => '?').join(', ');
  const replyRows = db
    .prepare(
      `
      SELECT comments.*,
        COALESCE(cl.likes_count, 0) AS likes_count,
        viewer.comment_id IS NOT NULL AS viewer_liked
      FROM comments
      LEFT JOIN (
        SELECT comment_id, COUNT(1) AS likes_count
        FROM comment_likes
        GROUP BY comment_id
      ) cl ON cl.comment_id = comments.id
      LEFT JOIN comment_likes viewer
        ON viewer.comment_id = comments.id
        AND viewer.fingerprint = ?
      WHERE comments.post_id = ? AND comments.parent_id IN (${placeholders})
      ORDER BY comments.created_at ASC
      `
    )
    .all(viewerFingerprint, postId, ...rootIds);

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
  const viewerFingerprint = getOptionalFingerprint(req);

  const commentRow = db
    .prepare('SELECT * FROM comments WHERE id = ?')
    .get(commentId);
  if (!commentRow || commentRow.post_id !== postId) {
    return res.status(404).json({ error: '评论不存在' });
  }

  const rootId = commentRow.parent_id || commentRow.id;
  const rootRow = db
    .prepare(
      `
      SELECT comments.*,
        COALESCE(cl.likes_count, 0) AS likes_count,
        viewer.comment_id IS NOT NULL AS viewer_liked
      FROM comments
      LEFT JOIN (
        SELECT comment_id, COUNT(1) AS likes_count
        FROM comment_likes
        GROUP BY comment_id
      ) cl ON cl.comment_id = comments.id
      LEFT JOIN comment_likes viewer
        ON viewer.comment_id = comments.id
        AND viewer.fingerprint = ?
      WHERE comments.id = ?
      `
    )
    .get(viewerFingerprint, rootId);
  if (!rootRow || rootRow.post_id !== postId) {
    return res.status(404).json({ error: '评论不存在' });
  }

  const replyRows = db
    .prepare(
      `
      SELECT comments.*,
        COALESCE(cl.likes_count, 0) AS likes_count,
        viewer.comment_id IS NOT NULL AS viewer_liked
      FROM comments
      LEFT JOIN (
        SELECT comment_id, COUNT(1) AS likes_count
        FROM comment_likes
        GROUP BY comment_id
      ) cl ON cl.comment_id = comments.id
      LEFT JOIN comment_likes viewer
        ON viewer.comment_id = comments.id
        AND viewer.fingerprint = ?
      WHERE comments.post_id = ? AND comments.parent_id = ?
      ORDER BY comments.created_at ASC
      `
    )
    .all(viewerFingerprint, postId, rootId);

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
      likes_count: 0,
      viewer_liked: 0,
    }),
  });
});

const toggleCommentLike = db.transaction((commentId, fingerprint) => {
  const comment = db.prepare('SELECT id, post_id FROM comments WHERE id = ? AND deleted = 0').get(commentId);
  if (!comment) {
    return { status: 404, error: '评论不存在' };
  }

  const existing = db
    .prepare('SELECT created_at FROM comment_likes WHERE comment_id = ? AND fingerprint = ?')
    .get(commentId, fingerprint);

  if (existing) {
    db.prepare('DELETE FROM comment_likes WHERE comment_id = ? AND fingerprint = ?').run(commentId, fingerprint);
  } else {
    db.prepare('INSERT INTO comment_likes (comment_id, fingerprint, created_at) VALUES (?, ?, ?)')
      .run(commentId, fingerprint, Date.now());
  }

  const likesRow = db.prepare('SELECT COUNT(1) AS count FROM comment_likes WHERE comment_id = ?').get(commentId);
  const likes = likesRow?.count ?? 0;
  const viewerLiked = !existing;
  return { status: 200, data: { commentId, postId: comment.post_id, likes, viewerLiked } };
});

app.post('/api/comments/:id/like', (req, res) => {
  const commentId = String(req.params.id || '').trim();
  if (!commentId) {
    return res.status(400).json({ error: '评论不存在' });
  }

  const fingerprint = requireFingerprint(req, res);
  if (!fingerprint) {
    return;
  }

  if (!checkBanFor(req, res, 'like', '你已被限制操作')) {
    return;
  }

  const result = toggleCommentLike(commentId, fingerprint);
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.json(result.data);
});


};
