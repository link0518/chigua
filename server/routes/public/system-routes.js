export const registerPublicSystemRoutes = (app, deps) => {
  const {
    db,
    requireFingerprint,
    checkBanFor,
    touchOnlineSession,
    getOnlineCount,
    formatDateKey,
    verifyTurnstile,
    getClientIp,
    getRateLimitConfig,
    crypto,
  } = deps;

  const EASTER_EGG_STREAK7_KEY = 'streak7_confetti_v1';

  const resolveConsecutiveLoginDays = (fingerprint, maxDays = 30) => {
    if (!fingerprint) {
      return 0;
    }
    const today = new Date();
    const keys = [];
    for (let i = 0; i < maxDays; i += 1) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      keys.push(formatDateKey(date));
    }
    const placeholders = keys.map(() => '?').join(',');
    const rows = db
      .prepare(`SELECT date FROM fingerprint_login_days WHERE fingerprint = ? AND date IN (${placeholders})`)
      .all(fingerprint, ...keys);
    const set = new Set(rows.map((row) => row.date));
    let streak = 0;
    for (const key of keys) {
      if (!set.has(key)) {
        break;
      }
      streak += 1;
    }
    return streak;
  };

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.post('/api/online/heartbeat', (req, res) => {
    touchOnlineSession(req.sessionID);
    return res.json({ onlineCount: getOnlineCount() });
  });

  app.get('/api/notifications', (req, res) => {
    const fingerprint = requireFingerprint(req, res);
    if (!fingerprint) {
      return;
    }
    if (!checkBanFor(req, res, 'like', '账号已被封禁，无法点赞', fingerprint)) {
      return;
    }
    if (!checkBanFor(req, res, 'view', '你已被限制浏览', fingerprint)) {
      return;
    }

    const status = String(req.query.status || 'all').trim();
    const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 50);
    const offset = Math.max(Number(req.query.offset || 0), 0);

    const conditions = ['recipient_fingerprint = ?'];
    const params = [fingerprint];

    if (status === 'unread') {
      conditions.push('read_at IS NULL');
    } else if (status === 'read') {
      conditions.push('read_at IS NOT NULL');
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = db
      .prepare(
        `
          SELECT id, type, post_id, comment_id, preview, created_at, read_at
          FROM notifications
          ${whereClause}
          ORDER BY created_at DESC
          LIMIT ? OFFSET ?
        `
      )
      .all(...params, limit, offset);

    const unreadCount = db
      .prepare('SELECT COUNT(1) AS count FROM notifications WHERE recipient_fingerprint = ? AND read_at IS NULL')
      .get(fingerprint)?.count ?? 0;

    const total = db
      .prepare('SELECT COUNT(1) AS count FROM notifications WHERE recipient_fingerprint = ?')
      .get(fingerprint)?.count ?? 0;

    const items = rows.map((row) => ({
      id: row.id,
      type: row.type,
      postId: row.post_id || null,
      commentId: row.comment_id || null,
      preview: row.preview || '',
      createdAt: row.created_at,
      readAt: row.read_at || null,
    }));

    return res.json({ items, unreadCount, total });
  });

  app.post('/api/notifications/read', (req, res) => {
    const fingerprint = requireFingerprint(req, res);
    if (!fingerprint) {
      return;
    }
    if (!checkBanFor(req, res, 'like', '账号已被封禁，无法点踩', fingerprint)) {
      return;
    }
    if (!checkBanFor(req, res, 'view', '你已被限制浏览', fingerprint)) {
      return;
    }
    const now = Date.now();
    const result = db
      .prepare('UPDATE notifications SET read_at = ? WHERE recipient_fingerprint = ? AND read_at IS NULL')
      .run(now, fingerprint);
    return res.json({ updated: result.changes || 0, readAt: now });
  });

  app.get('/api/easter-eggs/streak7', (req, res) => {
    if (!checkBanFor(req, res, 'view', '你已被限制浏览')) {
      return;
    }
    res.set('Cache-Control', 'no-store');
    res.set('Vary', 'X-Client-Fingerprint');
    const fingerprint = requireFingerprint(req, res);
    if (!fingerprint) {
      return;
    }
    const todayKey = formatDateKey();
    db.prepare('INSERT OR IGNORE INTO fingerprint_login_days (date, fingerprint) VALUES (?, ?)')
      .run(todayKey, fingerprint);

    const streakDays = resolveConsecutiveLoginDays(fingerprint, 30);
    const unlocked = streakDays >= 7;
    const alreadyShown = unlocked
      ? Boolean(db.prepare('SELECT 1 FROM easter_egg_seen WHERE fingerprint = ? AND egg_key = ?')
        .get(fingerprint, EASTER_EGG_STREAK7_KEY))
      : false;

    return res.json({ streakDays, unlocked, alreadyShown });
  });

  app.post('/api/easter-eggs/streak7/seen', (req, res) => {
    if (!checkBanFor(req, res, 'view', '你已被限制浏览')) {
      return;
    }
    const fingerprint = requireFingerprint(req, res);
    if (!fingerprint) {
      return;
    }
    const now = Date.now();
    db.prepare('INSERT OR REPLACE INTO easter_egg_seen (fingerprint, egg_key, seen_at) VALUES (?, ?, ?)')
      .run(fingerprint, EASTER_EGG_STREAK7_KEY, now);
    return res.json({ ok: true, seenAt: now });
  });

  app.post('/api/feedback', async (req, res) => {
    const content = String(req.body?.content || '').trim();
    const email = String(req.body?.email || '').trim();
    const wechat = String(req.body?.wechat || '').trim();
    const qq = String(req.body?.qq || '').trim();

    if (!content) {
      return res.status(400).json({ error: '内容不能为空' });
    }

    if (content.length > 2000) {
      return res.status(400).json({ error: '内容超过字数限制' });
    }

    if (email.length > 200 || wechat.length > 100 || qq.length > 50) {
      return res.status(400).json({ error: '联系方式过长' });
    }

    if (email && !email.includes('@')) {
      return res.status(400).json({ error: '邮箱格式不正确' });
    }

    const fingerprint = requireFingerprint(req, res);
    if (!fingerprint) {
      return;
    }

    const clientIp = getClientIp(req);
    if (!checkBanFor(req, res, 'site', '账号已被封禁，无法留言', fingerprint)) {
      return;
    }

    const now = Date.now();
    const feedbackRateLimit = getRateLimitConfig?.('feedback');
    const feedbackLimit = typeof feedbackRateLimit?.limit === 'number'
      ? feedbackRateLimit.limit
      : 1;
    const feedbackWindowMs = typeof feedbackRateLimit?.windowMs === 'number'
      ? feedbackRateLimit.windowMs
      : 60 * 60 * 1000;
    const feedbackWindowStart = now - feedbackWindowMs;
    if (req.sessionID) {
      const sessionCount = db
        .prepare('SELECT COUNT(1) AS count FROM feedback_messages WHERE session_id = ? AND created_at >= ?')
        .get(req.sessionID, feedbackWindowStart)?.count ?? 0;
      if (sessionCount >= feedbackLimit) {
        return res.status(429).json({ error: '留言过于频繁，请稍后再试' });
      }
    }
    if (clientIp) {
      const ipCount = db
        .prepare('SELECT COUNT(1) AS count FROM feedback_messages WHERE ip = ? AND created_at >= ?')
        .get(clientIp, feedbackWindowStart)?.count ?? 0;
      if (ipCount >= feedbackLimit) {
        return res.status(429).json({ error: '留言过于频繁，请稍后再试' });
      }
    }
    if (fingerprint) {
      const fingerprintCount = db
        .prepare('SELECT COUNT(1) AS count FROM feedback_messages WHERE fingerprint = ? AND created_at >= ?')
        .get(fingerprint, feedbackWindowStart)?.count ?? 0;
      if (fingerprintCount >= feedbackLimit) {
        return res.status(429).json({ error: '留言过于频繁，请稍后再试' });
      }
    }
    const feedbackVerification = await verifyTurnstile(req.body?.turnstileToken, req, 'feedback');
    if (!feedbackVerification.ok) {
      return res.status(feedbackVerification.status).json({ error: feedbackVerification.error });
    }

    const feedbackId = crypto.randomUUID();
    db.prepare(
      `
      INSERT INTO feedback_messages (
        id,
        content,
        email,
        wechat,
        qq,
        created_at,
        session_id,
        ip,
        fingerprint
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      feedbackId,
      content,
      email,
      wechat || null,
      qq || null,
      now,
      req.sessionID || null,
      clientIp || null,
      fingerprint
    );

    return res.status(201).json({ ok: true });
  });
};
