export const registerAdminVocabularyRoutes = (app, deps) => {
  const {
    db,
    requireAdmin,
    requireAdminCsrf,
    normalizeText,
    reloadVocabulary,
    importVocabularyFromFiles,
    logAdminAction,
  } = deps;

  app.get('/api/admin/vocabulary', requireAdmin, (req, res) => {
    const search = String(req.query.search || '').trim();
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 200);
    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];
    const normalizedSearch = search ? normalizeText(search) : '';
    if (search) {
      conditions.push('(word LIKE ? OR normalized LIKE ?)');
      const keyword = `%${search}%`;
      params.push(keyword, keyword);
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const orderBy = search
      ? 'ORDER BY CASE WHEN word = ? OR normalized = ? THEN 0 ELSE 1 END, updated_at DESC'
      : 'ORDER BY updated_at DESC';
    const orderParams = search ? [search, normalizedSearch] : [];
    const rows = db
      .prepare(
        `
        SELECT id, word, normalized, enabled, created_at, updated_at
        FROM vocabulary_words
        ${whereClause}
        ${orderBy}
        LIMIT ? OFFSET ?
        `
      )
      .all(...params, ...orderParams, limit, offset);
    const totalRow = db
      .prepare(`SELECT COUNT(1) AS count FROM vocabulary_words ${whereClause}`)
      .get(...params);
    return res.json({
      items: rows.map((row) => ({
        id: row.id,
        word: row.word,
        normalized: row.normalized,
        enabled: Boolean(row.enabled),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      total: totalRow?.count || 0,
      page,
      limit,
    });
  });

  app.post('/api/admin/vocabulary', requireAdmin, requireAdminCsrf, (req, res) => {
    const word = String(req.body?.word || '').trim();
    if (!word) {
      return res.status(400).json({ error: '词不能为空' });
    }
    const normalized = normalizeText(word);
    if (!normalized) {
      return res.status(400).json({ error: '词格式不正确' });
    }
    const now = Date.now();
    const existing = db.prepare('SELECT id, enabled, word FROM vocabulary_words WHERE normalized = ?').get(normalized);
    let id = existing?.id || null;
    let before = null;
    if (existing) {
      before = { word: existing.word, enabled: Boolean(existing.enabled) };
      db.prepare('UPDATE vocabulary_words SET word = ?, enabled = 1, updated_at = ? WHERE id = ?')
        .run(word, now, existing.id);
      id = existing.id;
    } else {
      const result = db
        .prepare('INSERT INTO vocabulary_words (word, normalized, enabled, created_at, updated_at) VALUES (?, ?, 1, ?, ?)')
        .run(word, normalized, now, now);
      id = Number(result.lastInsertRowid);
    }
    reloadVocabulary();
    logAdminAction(req, {
      action: existing ? 'vocabulary_update' : 'vocabulary_add',
      targetType: 'vocabulary',
      targetId: String(id),
      before,
      after: { word, enabled: true },
    });
    return res.json({ id, word, normalized, enabled: true, updatedAt: now });
  });

  app.post('/api/admin/vocabulary/:id/toggle', requireAdmin, requireAdminCsrf, (req, res) => {
    const id = Number(req.params.id || 0);
    if (!id) {
      return res.status(400).json({ error: '参数错误' });
    }
    const enabled = Boolean(req.body?.enabled);
    const row = db.prepare('SELECT id, word, enabled FROM vocabulary_words WHERE id = ?').get(id);
    if (!row) {
      return res.status(404).json({ error: '词不存在' });
    }
    const now = Date.now();
    db.prepare('UPDATE vocabulary_words SET enabled = ?, updated_at = ? WHERE id = ?')
      .run(enabled ? 1 : 0, now, id);
    reloadVocabulary();
    logAdminAction(req, {
      action: 'vocabulary_toggle',
      targetType: 'vocabulary',
      targetId: String(id),
      before: { word: row.word, enabled: Boolean(row.enabled) },
      after: { word: row.word, enabled },
    });
    return res.json({ id, enabled });
  });

  app.post('/api/admin/vocabulary/:id/delete', requireAdmin, requireAdminCsrf, (req, res) => {
    const id = Number(req.params.id || 0);
    if (!id) {
      return res.status(400).json({ error: '参数错误' });
    }
    const row = db.prepare('SELECT id, word, enabled FROM vocabulary_words WHERE id = ?').get(id);
    if (!row) {
      return res.status(404).json({ error: '词不存在' });
    }
    db.prepare('DELETE FROM vocabulary_words WHERE id = ?').run(id);
    reloadVocabulary();
    logAdminAction(req, {
      action: 'vocabulary_delete',
      targetType: 'vocabulary',
      targetId: String(id),
      before: { word: row.word, enabled: Boolean(row.enabled) },
      after: null,
    });
    return res.json({ id });
  });

  app.post('/api/admin/vocabulary/import', requireAdmin, requireAdminCsrf, (req, res) => {
    const result = importVocabularyFromFiles();
    logAdminAction(req, {
      action: 'vocabulary_import',
      targetType: 'vocabulary',
      targetId: 'files',
      before: null,
      after: { added: result.added, total: result.total },
    });
    return res.json(result);
  });

  app.get('/api/admin/vocabulary/export', requireAdmin, (req, res) => {
    const rows = db.prepare('SELECT word FROM vocabulary_words WHERE enabled = 1 ORDER BY word ASC').all();
    const content = rows.map((row) => row.word).join('\n');
    return res.json({ content });
  });
};
