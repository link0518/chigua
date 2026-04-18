const REPORT_REASON_LABELS = {
  privacy: '隐私风险',
  harassment: '骚扰辱骂',
  spam: '垃圾广告',
  misinformation: '虚假信息',
  rumor: '举报谣言',
};

const RUMOR_REASON_LABEL = REPORT_REASON_LABELS.rumor;
const RUMOR_REASON_SQL = "(reason_code = 'rumor' OR (reason_code IS NULL AND reason = '举报谣言'))";

const normalizeReasonCode = (value) => {
  const code = String(value || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(REPORT_REASON_LABELS, code) ? code : '';
};

export const registerPublicReportsRoutes = (app, deps) => {
  const {
    db,
    requireFingerprint,
    getIdentityLookupHashes,
    enforceRateLimit,
    checkBanFor,
    getClientIp,
    crypto,
    incrementDailyStat,
    formatDateKey,
    hiddenContentService,
    wecomWebhookService,
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

  const resolveRiskLevel = (reasonCode, reasonLabel) => {
    if (reasonCode === 'privacy') return 'high';
    if (reasonCode === 'harassment') return 'medium';
    if (reasonCode === 'misinformation') return 'medium';
    if (reasonCode === 'rumor') return 'medium';
    if (reasonCode === 'spam') return 'low';

    const reason = String(reasonLabel || '');
    if (reason.includes('隐私')) return 'high';
    if (reason.includes('骚扰')) return 'medium';
    if (reason.includes('虚假')) return 'medium';
    if (reason.includes('广告')) return 'low';
    return 'low';
  };

  const countPendingRumorReports = (targetType, targetId) => {
    const targetWhereClause = targetType === 'comment'
      ? "target_type = 'comment' AND comment_id = ?"
      : "target_type = 'post' AND post_id = ?";
    const row = db.prepare(`
      SELECT COUNT(1) AS count
      FROM reports
      WHERE ${targetWhereClause}
        AND ${RUMOR_REASON_SQL}
        AND status = 'pending'
    `).get(targetId);
    return Number(row?.count || 0);
  };

  app.post('/api/reports', (req, res) => {
    const postId = String(req.body?.postId || '').trim();
    const commentId = String(req.body?.commentId || '').trim();
    const reasonCode = normalizeReasonCode(req.body?.reasonCode);
    const fallbackReason = String(req.body?.reason || '').trim();
    const reason = reasonCode ? REPORT_REASON_LABELS[reasonCode] : fallbackReason;
    const evidence = String(req.body?.evidence || '').trim().slice(0, 500);

    if (!reason || (!postId && !commentId)) {
      return res.status(400).json({ error: '参数不完整' });
    }
    if (reasonCode === 'rumor' && !evidence) {
      return res.status(400).json({ error: '请填写判断为谣言的原因或证据' });
    }

    const fingerprint = requireFingerprint(req, res);
    if (!fingerprint) {
      return;
    }
    const identityHashes = getIdentityLookupHashes(req, res);

    if (!enforceRateLimit(req, res, 'report', fingerprint)) {
      return;
    }

    if (!checkBanFor(req, res, 'view', '账号已被封禁，无法举报', fingerprint)) {
      return;
    }

    const reporterIp = getClientIp(req);

    let targetType = 'post';
    let targetPostId = postId;
    let targetCommentId = '';
    let snippet = '';

    if (commentId) {
      const commentRow = db
        .prepare(`
          SELECT comments.id, comments.post_id, comments.content
          FROM comments
          INNER JOIN posts ON posts.id = comments.post_id
          WHERE comments.id = ?
            AND comments.deleted = 0
            AND comments.hidden = 0
            AND posts.deleted = 0
            AND posts.hidden = 0
        `)
        .get(commentId);
      if (!commentRow) {
        return res.status(404).json({ error: '评论不存在' });
      }
      targetType = 'comment';
      targetPostId = commentRow.post_id;
      targetCommentId = commentRow.id;
      snippet = String(commentRow.content || '').slice(0, 100);
    } else {
      const post = db.prepare('SELECT content FROM posts WHERE id = ? AND deleted = 0 AND hidden = 0').get(postId);
      if (!post) {
        return res.status(404).json({ error: '内容不存在' });
      }
      snippet = String(post.content || '').slice(0, 100);
    }

    const reportId = crypto.randomUUID();
    const now = Date.now();
    const sessionId = req.sessionID || 'unknown';
    const isRumorReport = reasonCode === 'rumor' || reason === RUMOR_REASON_LABEL;

    if (targetType === 'comment') {
      if (sessionId) {
        const existingSession = db
          .prepare('SELECT 1 FROM comment_report_sessions WHERE comment_id = ? AND session_id = ?')
          .get(targetCommentId, sessionId);
        if (existingSession) {
          return res.status(409).json({ error: '你已举报过该内容' });
        }
      }
      const commentReporterMatch = buildIdentityMatch('fingerprint', identityHashes);
      const existingFingerprint = db
        .prepare(`SELECT 1 FROM comment_report_fingerprints WHERE comment_id = ? AND ${commentReporterMatch.clause}`)
        .get(targetCommentId, ...commentReporterMatch.params);
      if (existingFingerprint) {
        return res.status(409).json({ error: '你已举报过该内容' });
      }
      if (sessionId) {
        db.prepare('INSERT OR IGNORE INTO comment_report_sessions (comment_id, session_id, created_at) VALUES (?, ?, ?)')
          .run(targetCommentId, sessionId, now);
      }
      db.prepare('INSERT OR IGNORE INTO comment_report_fingerprints (comment_id, fingerprint, created_at) VALUES (?, ?, ?)')
        .run(targetCommentId, fingerprint, now);
    } else {
      if (sessionId) {
        const existingSession = db
          .prepare('SELECT 1 FROM report_sessions WHERE post_id = ? AND session_id = ?')
          .get(targetPostId, sessionId);
        if (existingSession) {
          return res.status(409).json({ error: '你已举报过该内容' });
        }
      }
      const postReporterMatch = buildIdentityMatch('fingerprint', identityHashes);
      const existingFingerprint = db
        .prepare(`SELECT 1 FROM report_fingerprints WHERE post_id = ? AND ${postReporterMatch.clause}`)
        .get(targetPostId, ...postReporterMatch.params);
      if (existingFingerprint) {
        return res.status(409).json({ error: '你已举报过该内容' });
      }
      if (sessionId) {
        db.prepare('INSERT OR IGNORE INTO report_sessions (post_id, session_id, created_at) VALUES (?, ?, ?)')
          .run(targetPostId, sessionId, now);
      }
      db.prepare('INSERT OR IGNORE INTO report_fingerprints (post_id, fingerprint, created_at) VALUES (?, ?, ?)')
        .run(targetPostId, fingerprint, now);
    }

    const rumorTargetId = targetType === 'comment' ? targetCommentId : targetPostId;

    db.prepare(
      `
        INSERT INTO reports (
          id,
          post_id,
          comment_id,
          target_type,
          reason,
          reason_code,
          evidence,
          content_snippet,
          created_at,
          status,
          risk_level,
          fingerprint,
          reporter_ip
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
      `
    ).run(
      reportId,
      targetPostId,
      targetCommentId || null,
      targetType,
      reason,
      reasonCode || null,
      evidence || null,
      snippet,
      now,
      resolveRiskLevel(reasonCode, reason),
      fingerprint,
      reporterIp || null
    );

    incrementDailyStat(formatDateKey(), 'reports', 1);

    if (isRumorReport) {
      const pendingReportCount = countPendingRumorReports(targetType, rumorTargetId);
      void wecomWebhookService?.notifyRumorPending?.({
        targetType,
        pendingReportCount,
        contentSnippet: snippet,
        evidence,
        createdAt: now,
      });
    }

    const autoHideResult = hiddenContentService?.maybeAutoHideTarget({
      targetType,
      targetId: rumorTargetId,
      now,
    }) || { autoHidden: false };

    if (autoHideResult.autoHidden) {
      void wecomWebhookService?.notifyHiddenContent({
        targetType,
        targetId: rumorTargetId,
        postId: targetPostId,
        contentSnippet: snippet,
        pendingReportCount: autoHideResult.pendingCount,
        hiddenAt: now,
      });
    }

    return res.status(201).json({
      id: reportId,
      autoHidden: Boolean(autoHideResult.autoHidden),
      targetType,
      targetId: rumorTargetId,
    });
  });
};
