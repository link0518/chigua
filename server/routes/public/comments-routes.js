export const registerPublicCommentsRoutes = (app, deps) => {
  const {
    db,
    checkBanFor,
    getIdentityLookupHashes,
    getRequestIdentityContext,
    resolveStoredIdentityHash,
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

  const buildViewerLikedSelect = (identityHashes) => {
    const match = buildIdentityMatch('viewer.fingerprint', identityHashes);
    return {
      sql: `
        EXISTS(
          SELECT 1
          FROM comment_likes viewer
          WHERE viewer.comment_id = comments.id AND ${match.clause}
        ) AS viewer_liked
      `,
      params: match.params,
    };
  };

  const findExistingCommentLike = (commentId, identityHashes) => {
    const match = buildIdentityMatch('fingerprint', identityHashes);
    return db
      .prepare(
        `
          SELECT fingerprint, created_at
          FROM comment_likes
          WHERE comment_id = ? AND ${match.clause}
          ORDER BY created_at DESC
          LIMIT 1
        `
      )
      .get(commentId, ...match.params);
  };

  const resolveIdentityKey = (value) => {
    const normalizedValue = String(value || '').trim();
    if (!normalizedValue) {
      return '';
    }
    if (typeof resolveStoredIdentityHash !== 'function') {
      return normalizedValue;
    }
    return String(resolveStoredIdentityHash(normalizedValue)?.identityKey || normalizedValue).trim();
  };

  const formatGuestLabel = (index) => `瓜友${String(index).padStart(2, '0')}`;

  const readStoredPostIdentity = (row) => {
    const key = String(row?.post_identity_key || '').trim();
    const label = String(row?.post_identity_label || '').trim();
    const role = row?.post_identity_role === 'op'
      ? 'op'
      : row?.post_identity_role === 'guest'
        ? 'guest'
        : '';
    if (!key || !label || !role) {
      return null;
    }
    return { key, label, role };
  };

  const buildGuestPostIdentity = (index) => ({
    key: `guest-${index}`,
    label: formatGuestLabel(index),
    role: 'guest',
  });

  const createCommentWithPostIdentity = db.transaction((payload) => {
    const {
      commentId,
      postId,
      postFingerprint,
      postIdentityEnabled,
      content,
      finalParentId,
      finalReplyToId,
      now,
      fingerprint,
      clientIp,
    } = payload;

    let postIdentity = null;

    if (postIdentityEnabled) {
      const actorIdentityKey = resolveIdentityKey(fingerprint) || String(fingerprint || '').trim();
      const postOwnerIdentityKey = resolveIdentityKey(postFingerprint);
      if (actorIdentityKey && postOwnerIdentityKey && actorIdentityKey === postOwnerIdentityKey) {
        postIdentity = { key: 'op', label: '楼主', role: 'op' };
      } else if (actorIdentityKey) {
        const existingIdentity = readStoredPostIdentity(
          db.prepare(
            `
            SELECT post_identity_key, post_identity_label, post_identity_role
            FROM comments
            WHERE post_id = ? AND post_identity_key = ?
            LIMIT 1
            `
          ).get(postId, actorIdentityKey)
        );
        if (existingIdentity) {
          postIdentity = existingIdentity;
        } else {
          const postRow = db
            .prepare('SELECT comment_identity_guest_seq FROM posts WHERE id = ?')
            .get(postId);
          const nextGuestIndex = Number(postRow?.comment_identity_guest_seq || 0) + 1;
          postIdentity = buildGuestPostIdentity(nextGuestIndex);
          db.prepare('UPDATE posts SET comment_identity_guest_seq = ? WHERE id = ?')
            .run(nextGuestIndex, postId);
        }
      }
    }

    db.prepare(
      `
      INSERT INTO comments (
        id,
        post_id,
        parent_id,
        reply_to_id,
        content,
        author,
        created_at,
        fingerprint,
        ip,
        post_identity_key,
        post_identity_label,
        post_identity_role
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      commentId,
      postId,
      finalParentId,
      finalReplyToId,
      content,
      '匿名',
      now,
      fingerprint,
      clientIp || null,
      postIdentity?.key || null,
      postIdentity?.label || null,
      postIdentity?.role || null
    );

    db.prepare('UPDATE posts SET comments_count = comments_count + 1 WHERE id = ?').run(postId);
    return postIdentity;
  });

  app.get('/api/posts/:id/comments', (req, res) => {
    if (!checkBanFor(req, res, 'view', '你已被限制浏览')) {
      return;
    }
    const postId = req.params.id;
    const limit = Math.min(Number(req.query.limit || 10), 200);
    const offset = Math.max(Number(req.query.offset || 0), 0);
    const visiblePost = db.prepare('SELECT id FROM posts WHERE id = ? AND deleted = 0 AND hidden = 0').get(postId);
    if (!visiblePost) {
      return res.status(404).json({ error: '内容不存在' });
    }

    const viewerIdentityHashes = getIdentityLookupHashes(req, res);
    const viewerLikedSelect = buildViewerLikedSelect(viewerIdentityHashes);

    const totalRow = db
      .prepare('SELECT COUNT(1) AS count FROM comments WHERE post_id = ? AND parent_id IS NULL')
      .get(postId);
    const total = totalRow?.count || 0;

    const rootRows = db
      .prepare(
        `
        SELECT comments.*,
          COALESCE(cl.likes_count, 0) AS likes_count,
          ${viewerLikedSelect.sql}
        FROM comments
        LEFT JOIN (
          SELECT comment_id, COUNT(1) AS likes_count
          FROM comment_likes
          GROUP BY comment_id
        ) cl ON cl.comment_id = comments.id
        WHERE comments.post_id = ? AND comments.parent_id IS NULL
        ORDER BY comments.created_at ASC
        LIMIT ? OFFSET ?
        `
      )
      .all(...viewerLikedSelect.params, postId, limit, offset);

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
          ${viewerLikedSelect.sql}
        FROM comments
        LEFT JOIN (
          SELECT comment_id, COUNT(1) AS likes_count
          FROM comment_likes
          GROUP BY comment_id
        ) cl ON cl.comment_id = comments.id
        WHERE comments.post_id = ? AND comments.parent_id IN (${placeholders})
        ORDER BY comments.created_at ASC
        `
      )
      .all(...viewerLikedSelect.params, postId, ...rootIds);

    const items = buildCommentTree([...rootRows, ...replyRows]);
    return res.json({ items, total });
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

    const viewerIdentityHashes = getIdentityLookupHashes(req, res);
    const viewerLikedSelect = buildViewerLikedSelect(viewerIdentityHashes);

    const post = db.prepare('SELECT id FROM posts WHERE id = ? AND deleted = 0 AND hidden = 0').get(postId);
    if (!post) {
      return res.status(404).json({ error: '内容不存在' });
    }
    const commentRow = db.prepare('SELECT * FROM comments WHERE id = ?').get(commentId);
    if (!commentRow || commentRow.post_id !== postId) {
      return res.status(404).json({ error: '评论不存在' });
    }

    const rootId = commentRow.parent_id || commentRow.id;
    const rootRow = db
      .prepare(
        `
        SELECT comments.*,
          COALESCE(cl.likes_count, 0) AS likes_count,
          ${viewerLikedSelect.sql}
        FROM comments
        LEFT JOIN (
          SELECT comment_id, COUNT(1) AS likes_count
          FROM comment_likes
          GROUP BY comment_id
        ) cl ON cl.comment_id = comments.id
        WHERE comments.id = ?
        `
      )
      .get(...viewerLikedSelect.params, rootId);
    if (!rootRow || rootRow.post_id !== postId) {
      return res.status(404).json({ error: '评论不存在' });
    }

    const replyRows = db
      .prepare(
        `
        SELECT comments.*,
          COALESCE(cl.likes_count, 0) AS likes_count,
          ${viewerLikedSelect.sql}
        FROM comments
        LEFT JOIN (
          SELECT comment_id, COUNT(1) AS likes_count
          FROM comment_likes
          GROUP BY comment_id
        ) cl ON cl.comment_id = comments.id
        WHERE comments.post_id = ? AND comments.parent_id = ?
        ORDER BY comments.created_at ASC
        `
      )
      .all(...viewerLikedSelect.params, postId, rootId);

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

    const post = db
      .prepare(
        'SELECT id, fingerprint, comment_identity_enabled FROM posts WHERE id = ? AND deleted = 0 AND hidden = 0'
      )
      .get(postId);
    if (!post) {
      return res.status(404).json({ error: '内容不存在' });
    }

    let parentRow = null;
    if (parentId) {
      parentRow = db
        .prepare('SELECT id, post_id, parent_id, created_at FROM comments WHERE id = ? AND deleted = 0 AND hidden = 0')
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

    const postIdentity = createCommentWithPostIdentity({
      commentId,
      postId,
      postFingerprint: post.fingerprint,
      postIdentityEnabled: Number(post.comment_identity_enabled || 0) === 1,
      content,
      finalParentId,
      finalReplyToId,
      now,
      fingerprint,
      clientIp,
    });

    const commentPreview = trimPreview(content);
    const actorIdentityContext = getRequestIdentityContext(req, res);
    const actorIdentityHashes = getIdentityLookupHashes(req, res);
    let replyRecipient = '';
    let replyRecipientIdentityKey = '';
    if (finalReplyToId) {
      const replyTarget = db.prepare('SELECT fingerprint FROM comments WHERE id = ?').get(finalReplyToId);
      replyRecipient = replyTarget?.fingerprint || '';
      replyRecipientIdentityKey = resolveIdentityKey(replyRecipient);
      const isReplyTargetSelf = replyRecipient && actorIdentityHashes.includes(replyRecipient);
      if (replyRecipient && !isReplyTargetSelf) {
        createNotification({
          recipientFingerprint: replyRecipient,
          type: 'comment_reply',
          postId,
          commentId,
          preview: commentPreview,
          actorIdentityContext,
        });
      }
    }

    const isPostOwnerSelf = post.fingerprint && actorIdentityHashes.includes(post.fingerprint);
    const postRecipientIdentityKey = resolveIdentityKey(post.fingerprint);
    if (
      post.fingerprint
      && !isPostOwnerSelf
      && postRecipientIdentityKey !== replyRecipientIdentityKey
    ) {
      createNotification({
        recipientFingerprint: post.fingerprint,
        type: 'post_comment',
        postId,
        commentId,
        preview: commentPreview,
        actorIdentityContext,
      });
    }

    const comment = mapCommentRow({
      id: commentId,
      post_id: postId,
      parent_id: finalParentId,
      reply_to_id: finalReplyToId,
      content,
      author: '匿名',
      created_at: now,
      likes_count: 0,
      viewer_liked: 0,
      post_identity_key: postIdentity?.key || null,
      post_identity_label: postIdentity?.label || null,
      post_identity_role: postIdentity?.role || null,
    });

    return res.status(201).json({ comment });
  });

  const toggleCommentLike = db.transaction((commentId, fingerprint, identityHashes) => {
    const comment = db.prepare(`
      SELECT comments.id, comments.post_id
      FROM comments
      INNER JOIN posts ON posts.id = comments.post_id
      WHERE comments.id = ?
        AND comments.deleted = 0
        AND comments.hidden = 0
        AND posts.deleted = 0
        AND posts.hidden = 0
    `).get(commentId);
    if (!comment) {
      return { status: 404, error: '评论不存在' };
    }

    const existing = findExistingCommentLike(commentId, identityHashes);
    const likeMatch = buildIdentityMatch('fingerprint', identityHashes);

    if (existing) {
      db.prepare(`DELETE FROM comment_likes WHERE comment_id = ? AND ${likeMatch.clause}`)
        .run(commentId, ...likeMatch.params);
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

    const identityHashes = getIdentityLookupHashes(req, res);
    const result = toggleCommentLike(commentId, fingerprint, identityHashes);
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    return res.json(result.data);
  });
};
