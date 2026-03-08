const toSafeInt = (value, fallback = 0) => {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return fallback;
  }
  return Math.trunc(num);
};

const buildChatSnippet = (row) => {
  const type = String(row?.msg_type || 'text');
  if (type === 'image') {
    const imageUrl = String(row?.image_url || '').trim();
    return imageUrl ? `[图片] ${imageUrl}` : '[图片]';
  }
  if (type === 'sticker') {
    return String(row?.sticker_shortcode || '').trim() || '[表情]';
  }
  return String(row?.text_content || '').trim() || '[消息]';
};

export const registerPublicChatRoutes = (app, deps) => {
  const {
    db,
    requireFingerprint,
    getIdentityLookupHashes,
    getRequestIdentityValueForCreatedAt,
    checkBanFor,
    enforceRateLimit,
    getClientIp,
    incrementDailyStat,
    formatDateKey,
    crypto,
    chatRealtime,
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

  const ensureChatEnabled = (res) => {
    const enabled = Boolean(chatRealtime?.getChatConfig?.().chatEnabled);
    if (enabled) {
      return true;
    }
    res.status(503).json({ error: '聊天室已关闭' });
    return false;
  };

  app.get('/api/chat/online', (req, res) => {
    if (!ensureChatEnabled(res)) {
      return;
    }
    const fingerprint = requireFingerprint(req, res);
    if (!fingerprint) {
      return;
    }
    if (!checkBanFor(req, res, 'chat', '账号已被封禁，无法进入聊天室', fingerprint)) {
      return;
    }
    return res.json(chatRealtime.getPublicOnlineSnapshot());
  });

  app.get('/api/chat/history', (req, res) => {
    if (!ensureChatEnabled(res)) {
      return;
    }
    const fingerprint = requireFingerprint(req, res);
    if (!fingerprint) {
      return;
    }
    if (!checkBanFor(req, res, 'chat', '账号已被封禁，无法进入聊天室', fingerprint)) {
      return;
    }

    const beforeId = toSafeInt(req.query.beforeId, 0);
    const limit = toSafeInt(req.query.limit, 50);
    const items = chatRealtime.getPublicHistory({ beforeId, limit });
    return res.json({ items, hasMore: items.length >= Math.min(Math.max(limit, 1), 100) });
  });

  app.post('/api/chat/messages/:id/report', (req, res) => {
    if (!ensureChatEnabled(res)) {
      return;
    }
    const reason = String(req.body?.reason || '').trim();
    const messageId = toSafeInt(req.params.id, 0);

    if (messageId <= 0) {
      return res.status(400).json({ error: '消息 ID 无效' });
    }

    if (!reason) {
      return res.status(400).json({ error: '举报理由不能为空' });
    }
    if (reason.length > 200) {
      return res.status(400).json({ error: '举报理由过长' });
    }

    const fingerprint = requireFingerprint(req, res);
    if (!fingerprint) {
      return;
    }

    if (!checkBanFor(req, res, 'view', '账号已被封禁，无法举报', fingerprint)) {
      return;
    }
    const identityHashes = getIdentityLookupHashes(req, res);
    if (!enforceRateLimit(req, res, 'report', fingerprint)) {
      return;
    }

    const row = db.prepare(
      `
        SELECT id, session_id, fingerprint_hash, msg_type, text_content, image_url, sticker_shortcode, deleted, created_at
        FROM chat_messages
        WHERE id = ?
      `
    ).get(messageId);

    if (!row || row.deleted === 1) {
      return res.status(404).json({ error: '消息不存在或已删除' });
    }

    if (getRequestIdentityValueForCreatedAt(req, res, row.created_at) === String(row.fingerprint_hash || '')) {
      return res.status(400).json({ error: '不能举报自己的消息' });
    }

    const reportTargetId = `chat:${messageId}`;
    const reporterMatch = buildIdentityMatch('fingerprint', identityHashes);
    const duplicated = db.prepare(
      `
        SELECT 1
        FROM reports
        WHERE target_type = 'chat' AND post_id = ? AND ${reporterMatch.clause}
        LIMIT 1
      `
    ).get(reportTargetId, ...reporterMatch.params);

    if (duplicated) {
      return res.status(409).json({ error: '你已举报过该消息' });
    }

    const reportId = crypto.randomUUID();
    const now = Date.now();
    const snippet = buildChatSnippet(row).slice(0, 100);
    const reporterIp = getClientIp(req);

    db.prepare(
      `
        INSERT INTO reports (
          id,
          post_id,
          comment_id,
          target_type,
          reason,
          content_snippet,
          created_at,
          status,
          risk_level,
          fingerprint,
          reporter_ip
        ) VALUES (?, ?, NULL, 'chat', ?, ?, ?, 'pending', 'medium', ?, ?)
      `
    ).run(
      reportId,
      reportTargetId,
      reason,
      snippet,
      now,
      fingerprint,
      reporterIp || null,
    );

    incrementDailyStat(formatDateKey(), 'reports', 1);
    return res.status(201).json({ id: reportId });
  });
};
