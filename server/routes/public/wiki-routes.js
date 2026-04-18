import {
  mapWikiEntryRow,
  mapWikiRevisionRow,
  parseWikiTags,
  sanitizeWikiPayload,
} from '../../wiki-utils.js';

export const registerPublicWikiRoutes = (app, deps) => {
  const {
    db,
    requireFingerprint,
    checkBanFor,
    enforceRateLimit,
    getClientIp,
    verifyTurnstile,
    crypto,
    wecomWebhookService,
  } = deps;

  const escapeLike = (value) => String(value).replace(/[\\%_]/g, (match) => `\\${match}`);
  const parsePositiveInt = (value, fallback) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    const normalized = Math.floor(parsed);
    return normalized >= 1 ? normalized : fallback;
  };
  const buildJsonTagLikePattern = (value) => `%${escapeLike(JSON.stringify(String(value || '')))}%`;
  const notifyWikiPendingReview = (payload = {}) => {
    try {
      void Promise.resolve(wecomWebhookService?.notifyWikiRevision?.(payload)).catch(() => { });
    } catch {
      // Webhook 提醒失败不能影响用户提交。
    }
  };

  const getApprovedHistory = (entryId) => {
    const rows = db
      .prepare(
        `
        SELECT wiki_entry_revisions.*, wiki_entries.name AS entry_name, wiki_entries.slug AS entry_slug
        FROM wiki_entry_revisions
        LEFT JOIN wiki_entries ON wiki_entries.id = wiki_entry_revisions.entry_id
        WHERE wiki_entry_revisions.entry_id = ?
          AND wiki_entry_revisions.status = 'approved'
        ORDER BY COALESCE(wiki_entry_revisions.reviewed_at, wiki_entry_revisions.created_at) ASC,
          wiki_entry_revisions.created_at ASC
        `
      )
      .all(entryId);

    return rows
      .map((row, index) => {
        const revision = mapWikiRevisionRow(row, index + 1);
        return {
          id: revision.id,
          actionType: revision.actionType,
          data: revision.data,
          editSummary: revision.editSummary,
          status: revision.status,
          createdAt: revision.createdAt,
          reviewedAt: revision.reviewedAt,
          versionNumber: revision.versionNumber,
        };
      })
      .reverse();
  };

  const validateSubmission = async (req, res, options = {}) => {
    const payload = sanitizeWikiPayload(req.body || {});
    if (!payload.ok) {
      res.status(400).json({ error: payload.error });
      return null;
    }
    if (options.requireEditSummary && !payload.data.editSummary) {
      res.status(400).json({ error: '请填写修改原因' });
      return null;
    }
    const fingerprint = requireFingerprint(req, res);
    if (!fingerprint) {
      return null;
    }
    if (!checkBanFor(req, res, 'post', '账号已被限制，无法提交 Wiki', fingerprint)) {
      return null;
    }
    if (!enforceRateLimit(req, res, 'wiki', fingerprint)) {
      return null;
    }
    const verification = await verifyTurnstile(req.body?.turnstileToken, req, 'wiki');
    if (!verification.ok) {
      res.status(verification.status).json({ error: verification.error });
      return null;
    }
    return { ...payload.data, fingerprint };
  };

  app.get('/api/wiki/entries', (req, res) => {
    if (!checkBanFor(req, res, 'view', '你已被限制浏览')) {
      return;
    }
    const q = String(req.query.q || '').trim();
    const tag = String(req.query.tag || '').trim();
    const sort = String(req.query.sort || 'updated').trim();
    const normalizedSort = sort === 'number' ? 'number' : 'updated';
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(parsePositiveInt(req.query.limit, 12), 50);
    const offset = (page - 1) * limit;
    const publicConditions = ["status = 'approved'", 'deleted = 0'];
    const filterConditions = [];
    const params = [];

    if (q) {
      const keyword = `%${escapeLike(q)}%`;
      filterConditions.push("(name LIKE ? ESCAPE '\\' OR narrative LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\')");
      params.push(keyword, keyword, keyword);
    }

    if (tag) {
      filterConditions.push("tags LIKE ? ESCAPE '\\'");
      params.push(buildJsonTagLikePattern(tag));
    }

    const totalWhereClause = `WHERE ${publicConditions.concat(filterConditions).join(' AND ')}`;
    const orderClause = normalizedSort === 'number'
      ? 'display_order ASC, rowid ASC'
      : 'updated_at DESC, created_at DESC';
    const total = db
      .prepare(`SELECT COUNT(1) AS count FROM wiki_entries ${totalWhereClause}`)
      .get(...params)?.count ?? 0;
    const rows = db
      .prepare(
        `
        SELECT *
        FROM wiki_entries
        ${totalWhereClause}
        ORDER BY ${orderClause}
        LIMIT ? OFFSET ?
        `
      )
      .all(...params, limit, offset);

    const tagCounter = new Map();
    const tagRows = db
      .prepare(
        `
        SELECT tags
        FROM wiki_entries
        WHERE status = 'approved' AND deleted = 0
        ORDER BY updated_at DESC
        LIMIT 500
        `
      )
      .all();
    tagRows.forEach((row) => {
      parseWikiTags(row.tags).forEach((item) => {
        tagCounter.set(item, Number(tagCounter.get(item) || 0) + 1);
      });
    });

    return res.json({
      items: rows.map(mapWikiEntryRow),
      total,
      page,
      limit,
      tags: Array.from(tagCounter.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN')),
    });
  });

  app.get('/api/wiki/entries/:slug', (req, res) => {
    if (!checkBanFor(req, res, 'view', '你已被限制浏览')) {
      return;
    }
    const slug = String(req.params.slug || '').trim();
    const row = db
      .prepare(
        `
        SELECT *
        FROM wiki_entries
        WHERE slug = ?
          AND status = 'approved'
          AND deleted = 0
        `
      )
      .get(slug);
    if (!row) {
      return res.status(404).json({ error: '瓜条不存在或尚未公开' });
    }
    return res.json({
      entry: mapWikiEntryRow(row),
      history: getApprovedHistory(row.id),
    });
  });

  app.post('/api/wiki/submissions', async (req, res) => {
    const data = await validateSubmission(req, res);
    if (!data) {
      return;
    }
    const now = Date.now();
    const revisionId = crypto.randomUUID();
    db.prepare(
      `
      INSERT INTO wiki_entry_revisions (
        id,
        entry_id,
        action_type,
        base_revision_id,
        base_version_number,
        data_json,
        edit_summary,
        status,
        submitter_fingerprint,
        submitter_ip,
        created_at
      ) VALUES (?, NULL, 'create', NULL, 0, ?, ?, 'pending', ?, ?, ?)
      `
    ).run(
      revisionId,
      JSON.stringify({ name: data.name, narrative: data.narrative, tags: data.tags }),
      data.editSummary || '',
      data.fingerprint,
      getClientIp(req) || null,
      now
    );

    notifyWikiPendingReview({
      actionType: 'create',
      name: data.name,
      narrative: data.narrative,
      tags: data.tags,
      editSummary: data.editSummary || '',
      createdAt: now,
    });

    return res.status(201).json({ id: revisionId, status: 'pending' });
  });

  app.post('/api/wiki/entries/:slug/edits', async (req, res) => {
    const slug = String(req.params.slug || '').trim();
    const entry = db
      .prepare("SELECT * FROM wiki_entries WHERE slug = ? AND status = 'approved' AND deleted = 0")
      .get(slug);
    if (!entry) {
      return res.status(404).json({ error: '瓜条不存在或尚未公开' });
    }

    const data = await validateSubmission(req, res, { requireEditSummary: true });
    if (!data) {
      return;
    }
    const now = Date.now();
    const revisionId = crypto.randomUUID();
    db.prepare(
      `
      INSERT INTO wiki_entry_revisions (
        id,
        entry_id,
        action_type,
        base_revision_id,
        base_version_number,
        data_json,
        edit_summary,
        status,
        submitter_fingerprint,
        submitter_ip,
        created_at
      ) VALUES (?, ?, 'edit', ?, ?, ?, ?, 'pending', ?, ?, ?)
      `
    ).run(
      revisionId,
      entry.id,
      entry.current_revision_id || null,
      Number(entry.version_number || 1),
      JSON.stringify({ name: data.name, narrative: data.narrative, tags: data.tags }),
      data.editSummary || '',
      data.fingerprint,
      getClientIp(req) || null,
      now
    );

    notifyWikiPendingReview({
      actionType: 'edit',
      name: data.name,
      narrative: data.narrative,
      tags: data.tags,
      editSummary: data.editSummary || '',
      createdAt: now,
    });

    return res.status(201).json({ id: revisionId, status: 'pending' });
  });
};
