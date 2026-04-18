import {
  getNextWikiDisplayOrder,
  isWikiDisplayOrderConflict,
  mapWikiEntryRow,
  mapWikiRevisionRow,
  parseWikiRevisionData,
  resolveUniqueWikiSlug,
  sanitizeWikiPayload,
} from '../../wiki-utils.js';

export const registerAdminWikiRoutes = (app, deps) => {
  const {
    db,
    requireAdmin,
    requireAdminCsrf,
    logAdminAction,
    crypto,
  } = deps;

  const parsePositiveInt = (value, fallback) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    const normalized = Math.floor(parsed);
    return normalized >= 1 ? normalized : fallback;
  };

  const sanitizeAdminPayload = (body, res) => {
    const payload = sanitizeWikiPayload(body || {});
    if (!payload.ok) {
      res.status(400).json({ error: payload.error });
      return null;
    }
    return payload.data;
  };

  const getAdminName = (req) => String(req.session?.admin?.username || 'admin');

  const runWithWikiDisplayOrderRetry = (operation) => {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return operation();
      } catch (error) {
        if (!isWikiDisplayOrderConflict(error)) {
          throw error;
        }
        lastError = error;
      }
    }
    throw lastError || new Error('瓜条编号分配失败，请稍后重试。');
  };

  const getRevision = (id) => db
    .prepare(
      `
      SELECT wiki_entry_revisions.*, wiki_entries.name AS entry_name, wiki_entries.slug AS entry_slug
      FROM wiki_entry_revisions
      LEFT JOIN wiki_entries ON wiki_entries.id = wiki_entry_revisions.entry_id
      WHERE wiki_entry_revisions.id = ?
      `
    )
    .get(id);

  const approveRevision = db.transaction((req, revision) => {
    const now = Date.now();
    const adminName = getAdminName(req);
    const data = parseWikiRevisionData(revision.data_json);

    if (revision.action_type === 'create') {
      const entryId = crypto.randomUUID();
      const slug = resolveUniqueWikiSlug(db, data.name);
      const displayOrder = getNextWikiDisplayOrder(db);
      db.prepare(
        `
        INSERT INTO wiki_entries (
          id,
          slug,
          name,
          narrative,
          tags,
          display_order,
          status,
          current_revision_id,
          version_number,
          created_at,
          updated_at,
          deleted,
          deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'approved', ?, 1, ?, ?, 0, NULL)
        `
      ).run(
        entryId,
        slug,
        data.name,
        data.narrative,
        JSON.stringify(data.tags),
        displayOrder,
        revision.id,
        revision.created_at || now,
        now
      );
      db.prepare(
        `
        UPDATE wiki_entry_revisions
        SET entry_id = ?,
          status = 'approved',
          reviewed_at = ?,
          reviewed_by = ?,
          review_reason = NULL
        WHERE id = ?
        `
      ).run(entryId, now, adminName, revision.id);
      return { entryId, slug, versionNumber: 1 };
    }

    const entry = db
      .prepare("SELECT * FROM wiki_entries WHERE id = ? AND deleted = 0")
      .get(revision.entry_id);
    if (!entry) {
      throw new Error('瓜条不存在或已删除');
    }
    const currentRevisionId = String(entry.current_revision_id || '');
    const baseRevisionId = String(revision.base_revision_id || '');
    const currentVersionNumber = Number(entry.version_number || 1);
    const baseVersionNumber = Number(revision.base_version_number || 0);
    if (currentRevisionId !== baseRevisionId || currentVersionNumber !== baseVersionNumber) {
      throw new Error('瓜条已有新版本，请基于最新内容重新提交或手动合并');
    }
    const versionNumber = Number(entry.version_number || 1) + 1;
    const slug = resolveUniqueWikiSlug(db, data.name, entry.id);
    db.prepare(
      `
      UPDATE wiki_entries
      SET slug = ?,
        name = ?,
        narrative = ?,
        tags = ?,
        status = 'approved',
        current_revision_id = ?,
        version_number = ?,
        updated_at = ?
      WHERE id = ?
      `
    ).run(
      slug,
      data.name,
      data.narrative,
      JSON.stringify(data.tags),
      revision.id,
      versionNumber,
      now,
      entry.id
    );
    db.prepare(
      `
      UPDATE wiki_entry_revisions
      SET status = 'approved',
        reviewed_at = ?,
        reviewed_by = ?,
        review_reason = NULL
      WHERE id = ?
      `
    ).run(now, adminName, revision.id);
    return { entryId: entry.id, slug, versionNumber };
  });

  const createApprovedEntry = db.transaction((data, now, adminName) => {
    const entryId = crypto.randomUUID();
    const revisionId = crypto.randomUUID();
    const slug = resolveUniqueWikiSlug(db, data.name);
    const displayOrder = getNextWikiDisplayOrder(db);

    db.prepare(
      `
      INSERT INTO wiki_entries (
        id,
        slug,
        name,
        narrative,
        tags,
        display_order,
        status,
        current_revision_id,
        version_number,
        created_at,
        updated_at,
        deleted,
        deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'approved', ?, 1, ?, ?, 0, NULL)
      `
    ).run(entryId, slug, data.name, data.narrative, JSON.stringify(data.tags), displayOrder, revisionId, now, now);
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
        created_at,
        reviewed_at,
        reviewed_by
      ) VALUES (?, ?, 'create', NULL, 0, ?, ?, 'approved', NULL, NULL, ?, ?, ?)
      `
    ).run(
      revisionId,
      entryId,
      JSON.stringify({ name: data.name, narrative: data.narrative, tags: data.tags }),
      data.editSummary || '管理员创建',
      now,
      now,
      adminName
    );

    return { entryId, slug };
  });

  app.get('/api/admin/wiki/revisions', requireAdmin, (req, res) => {
    const status = String(req.query.status || 'pending').trim();
    const actionType = String(req.query.actionType || 'all').trim();
    const q = String(req.query.q || '').trim();
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(parsePositiveInt(req.query.limit, 12), 50);
    const offset = (page - 1) * limit;

    const conditions = [];
    const params = [];
    if (['pending', 'approved', 'rejected'].includes(status)) {
      conditions.push('wiki_entry_revisions.status = ?');
      params.push(status);
    }
    if (['create', 'edit'].includes(actionType)) {
      conditions.push('wiki_entry_revisions.action_type = ?');
      params.push(actionType);
    }
    if (q) {
      const keyword = `%${q}%`;
      conditions.push(`(
        wiki_entry_revisions.id LIKE ?
        OR wiki_entry_revisions.data_json LIKE ?
        OR wiki_entry_revisions.edit_summary LIKE ?
        OR wiki_entries.name LIKE ?
        OR wiki_entries.slug LIKE ?
      )`);
      params.push(keyword, keyword, keyword, keyword, keyword);
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const total = db
      .prepare(
        `
        SELECT COUNT(1) AS count
        FROM wiki_entry_revisions
        LEFT JOIN wiki_entries ON wiki_entries.id = wiki_entry_revisions.entry_id
        ${whereClause}
        `
      )
      .get(...params)?.count ?? 0;
    const rows = db
      .prepare(
        `
        SELECT wiki_entry_revisions.*, wiki_entries.name AS entry_name, wiki_entries.slug AS entry_slug
        FROM wiki_entry_revisions
        LEFT JOIN wiki_entries ON wiki_entries.id = wiki_entry_revisions.entry_id
        ${whereClause}
        ORDER BY wiki_entry_revisions.created_at DESC
        LIMIT ? OFFSET ?
        `
      )
      .all(...params, limit, offset);

    return res.json({ items: rows.map((row) => mapWikiRevisionRow(row)), total, page, limit });
  });

  app.get('/api/admin/wiki/entries', requireAdmin, (req, res) => {
    const status = String(req.query.status || 'active').trim();
    const q = String(req.query.q || '').trim();
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(parsePositiveInt(req.query.limit, 12), 50);
    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];

    if (status === 'active') {
      conditions.push('deleted = 0');
    } else if (status === 'deleted') {
      conditions.push('deleted = 1');
    }
    if (q) {
      const keyword = `%${q}%`;
      conditions.push('(id LIKE ? OR slug LIKE ? OR name LIKE ? OR narrative LIKE ? OR tags LIKE ?)');
      params.push(keyword, keyword, keyword, keyword, keyword);
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const total = db
      .prepare(`SELECT COUNT(1) AS count FROM wiki_entries ${whereClause}`)
      .get(...params)?.count ?? 0;
    const rows = db
      .prepare(
        `
        SELECT *
        FROM wiki_entries
        ${whereClause}
        ORDER BY updated_at DESC, created_at DESC
        LIMIT ? OFFSET ?
        `
      )
      .all(...params, limit, offset);

    return res.json({ items: rows.map(mapWikiEntryRow), total, page, limit });
  });

  app.post('/api/admin/wiki/entries', requireAdmin, requireAdminCsrf, (req, res) => {
    const data = sanitizeAdminPayload(req.body || {}, res);
    if (!data) {
      return;
    }
    const now = Date.now();
    const adminName = getAdminName(req);

    try {
      const result = runWithWikiDisplayOrderRetry(() => createApprovedEntry(data, now, adminName));
      logAdminAction(req, {
        action: 'wiki_entry_create',
        targetType: 'wiki_entry',
        targetId: result.entryId,
        before: null,
        after: { name: data.name, slug: result.slug },
        reason: data.editSummary || null,
      });
      return res.status(201).json({
        entry: mapWikiEntryRow(
          db.prepare('SELECT * FROM wiki_entries WHERE id = ?').get(result.entryId)
        ),
      });
    } catch (error) {
      if (isWikiDisplayOrderConflict(error)) {
        return res.status(409).json({ error: '瓜条编号分配冲突，请稍后重试。' });
      }

      return res.status(500).json({
        error: error instanceof Error ? error.message : '创建失败，请稍后再试。',
      });
    }
  });

  app.post('/api/admin/wiki/revisions/:id/action', requireAdmin, requireAdminCsrf, (req, res) => {
    const id = String(req.params.id || '').trim();
    const action = String(req.body?.action || '').trim();
    const reason = String(req.body?.reason || '').trim();
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: '无效操作' });
    }
    const revision = getRevision(id);
    if (!revision) {
      return res.status(404).json({ error: '审核记录不存在' });
    }
    if (revision.status !== 'pending') {
      return res.status(400).json({ error: '该记录已处理' });
    }

    if (action === 'reject') {
      const now = Date.now();
      db.prepare(
        `
        UPDATE wiki_entry_revisions
        SET status = 'rejected',
          review_reason = ?,
          reviewed_at = ?,
          reviewed_by = ?
        WHERE id = ?
        `
      ).run(reason || null, now, getAdminName(req), id);
      logAdminAction(req, {
        action: 'wiki_revision_reject',
        targetType: 'wiki_revision',
        targetId: id,
        before: { status: 'pending' },
        after: { status: 'rejected' },
        reason,
      });
      return res.json({ id, status: 'rejected' });
    }

    try {
      const result = runWithWikiDisplayOrderRetry(() => approveRevision(req, revision));
      logAdminAction(req, {
        action: 'wiki_revision_approve',
        targetType: 'wiki_revision',
        targetId: id,
        before: { status: 'pending' },
        after: { status: 'approved', entryId: result.entryId, versionNumber: result.versionNumber },
        reason,
      });
      return res.json({ id, status: 'approved', ...result });
    } catch (error) {
      if (isWikiDisplayOrderConflict(error)) {
        return res.status(409).json({ error: '瓜条编号分配冲突，请稍后重试。' });
      }
      return res.status(400).json({ error: error instanceof Error ? error.message : '审核失败' });
    }
  });

  app.post('/api/admin/wiki/entries/:id/edit', requireAdmin, requireAdminCsrf, (req, res) => {
    const entryId = String(req.params.id || '').trim();
    const entry = db.prepare('SELECT * FROM wiki_entries WHERE id = ?').get(entryId);
    if (!entry) {
      return res.status(404).json({ error: '瓜条不存在' });
    }
    const data = sanitizeAdminPayload(req.body || {}, res);
    if (!data) {
      return;
    }
    const now = Date.now();
    const revisionId = crypto.randomUUID();
    const versionNumber = Number(entry.version_number || 1) + 1;
    const slug = resolveUniqueWikiSlug(db, data.name, entry.id);
    const before = mapWikiEntryRow(entry);

    db.transaction(() => {
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
          created_at,
          reviewed_at,
          reviewed_by
        ) VALUES (?, ?, 'edit', ?, ?, ?, ?, 'approved', NULL, NULL, ?, ?, ?)
        `
      ).run(
        revisionId,
        entry.id,
        entry.current_revision_id || null,
        Number(entry.version_number || 1),
        JSON.stringify({ name: data.name, narrative: data.narrative, tags: data.tags }),
        data.editSummary || '管理员直接编辑',
        now,
        now,
        getAdminName(req)
      );
      db.prepare(
        `
        UPDATE wiki_entries
        SET slug = ?,
          name = ?,
          narrative = ?,
          tags = ?,
          current_revision_id = ?,
          version_number = ?,
          updated_at = ?
        WHERE id = ?
        `
      ).run(
        slug,
        data.name,
        data.narrative,
        JSON.stringify(data.tags),
        revisionId,
        versionNumber,
        now,
        entry.id
      );
    })();

    const updated = mapWikiEntryRow(db.prepare('SELECT * FROM wiki_entries WHERE id = ?').get(entry.id));
    logAdminAction(req, {
      action: 'wiki_entry_edit',
      targetType: 'wiki_entry',
      targetId: entry.id,
      before,
      after: updated,
      reason: data.editSummary || null,
    });
    return res.json({ entry: updated });
  });

  app.post('/api/admin/wiki/entries/:id/action', requireAdmin, requireAdminCsrf, (req, res) => {
    const entryId = String(req.params.id || '').trim();
    const action = String(req.body?.action || '').trim();
    const reason = String(req.body?.reason || '').trim();
    if (!['delete', 'restore'].includes(action)) {
      return res.status(400).json({ error: '无效操作' });
    }
    const entry = db.prepare('SELECT * FROM wiki_entries WHERE id = ?').get(entryId);
    if (!entry) {
      return res.status(404).json({ error: '瓜条不存在' });
    }
    const now = Date.now();
    if (action === 'delete') {
      db.prepare('UPDATE wiki_entries SET deleted = 1, deleted_at = ? WHERE id = ?').run(now, entryId);
    } else {
      db.prepare('UPDATE wiki_entries SET deleted = 0, deleted_at = NULL WHERE id = ?').run(entryId);
    }
    logAdminAction(req, {
      action: action === 'delete' ? 'wiki_entry_delete' : 'wiki_entry_restore',
      targetType: 'wiki_entry',
      targetId: entryId,
      before: { deleted: entry.deleted === 1 },
      after: { deleted: action === 'delete' },
      reason,
    });
    return res.json({ id: entryId, deleted: action === 'delete' });
  });
};
