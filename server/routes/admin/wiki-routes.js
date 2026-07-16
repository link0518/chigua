import {
  buildWikiAttachmentValidationOptions,
  getNextWikiDisplayOrder,
  isWikiDisplayOrderConflict,
  mapWikiEntryRow,
  mapWikiRevisionRow,
  resolveWikiRelatedPosts,
  resolveUniqueWikiSlug,
  sanitizeWikiPayload,
  serializeWikiRevisionData,
  validatePublicWikiRelatedPosts,
} from '../../wiki-utils.js';

export const registerAdminWikiRoutes = (app, deps) => {
  const {
    db,
    requireAdmin,
    requireAdminCsrf,
    requireAdminRead = (_req, _res, next) => next(),
    requireAdminManage = (_req, _res, next) => next(),
    logAdminAction,
    crypto,
    getRuntimeConfig = () => ({}),
  } = deps;

  const parsePositiveInt = (value, fallback) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    const normalized = Math.floor(parsed);
    return normalized >= 1 ? normalized : fallback;
  };

  const getAttachmentValidationOptions = () => buildWikiAttachmentValidationOptions(getRuntimeConfig());

  const validateRelatedPosts = (relatedPostIds) => {
    const validation = validatePublicWikiRelatedPosts(db, relatedPostIds);
    if (!validation.ok) {
      throw new Error(validation.error);
    }
  };

  const sanitizeAdminPayload = (body, res, fallbackData = undefined) => {
    const payload = sanitizeWikiPayload(body || {}, {
      ...getAttachmentValidationOptions(),
      fallbackData,
    });
    if (!payload.ok) {
      res.status(400).json({ error: payload.error });
      return null;
    }
    const relatedPostsValidation = validatePublicWikiRelatedPosts(db, payload.data.relatedPostIds);
    if (!relatedPostsValidation.ok) {
      res.status(400).json({ error: relatedPostsValidation.error });
      return null;
    }
    return payload.data;
  };

  const parseRevisionPayload = (revision, fallbackData = undefined) => {
    let source;
    try {
      source = JSON.parse(String(revision.data_json || '{}'));
    } catch {
      throw new Error('审核数据格式错误');
    }
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      throw new Error('审核数据格式错误');
    }
    const payload = sanitizeWikiPayload(source, {
      ...getAttachmentValidationOptions(),
      fallbackData,
    });
    if (!payload.ok) {
      throw new Error(payload.error || '审核数据格式错误');
    }
    validateRelatedPosts(payload.data.relatedPostIds);
    return payload.data;
  };

  const mapAdminWikiEntry = (row) => {
    const entry = mapWikiEntryRow(row);
    entry.relatedPosts = resolveWikiRelatedPosts(db, entry.relatedPostIds);
    return entry;
  };

  const mapAdminWikiRevision = (row, versionNumber = null) => {
    const revision = mapWikiRevisionRow(row, versionNumber);
    if (row.action_type === 'edit' && row.entry_id) {
      const entry = db.prepare('SELECT * FROM wiki_entries WHERE id = ?').get(row.entry_id);
      if (entry) {
        const fallbackData = mapWikiEntryRow(entry);
        let rawData = {};
        try {
          const parsed = JSON.parse(String(row.data_json || '{}'));
          rawData = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch {
          rawData = {};
        }
        // 兼容旧格式编辑稿：缺失的新字段应继承当前瓜条，而不是在管理员保存时被清空。
        if (!Object.prototype.hasOwnProperty.call(rawData, 'relatedPostIds')) {
          revision.data.relatedPostIds = fallbackData.relatedPostIds;
        }
        if (!Object.prototype.hasOwnProperty.call(rawData, 'attachments')) {
          revision.data.attachments = fallbackData.attachments;
        }
      }
    }
    revision.relatedPosts = resolveWikiRelatedPosts(db, revision.data.relatedPostIds);
    return revision;
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
    const claimResult = db.prepare(
      `
      UPDATE wiki_entry_revisions
      SET status = 'approved'
      WHERE id = ? AND status = 'pending'
      `
    ).run(revision.id);
    if (Number(claimResult.changes || 0) !== 1) {
      throw new Error('该记录已处理');
    }

    if (revision.action_type === 'create') {
      const data = parseRevisionPayload(revision);
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
          related_post_ids_json,
          attachments_json,
          display_order,
          status,
          current_revision_id,
          version_number,
          created_at,
          updated_at,
          deleted,
          deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, 1, ?, ?, 0, NULL)
        `
      ).run(
        entryId,
        slug,
        data.name,
        data.narrative,
        JSON.stringify(data.tags),
        JSON.stringify(data.relatedPostIds),
        JSON.stringify(data.attachments),
        displayOrder,
        revision.id,
        revision.created_at || now,
        now
      );
      db.prepare(
        `
        UPDATE wiki_entry_revisions
        SET entry_id = ?,
          data_json = ?,
          status = 'approved',
          reviewed_at = ?,
          reviewed_by = ?,
          review_reason = NULL
        WHERE id = ?
        `
      ).run(entryId, serializeWikiRevisionData(data), now, adminName, revision.id);
      return { entryId, slug, versionNumber: 1 };
    }

    const entry = db
      .prepare("SELECT * FROM wiki_entries WHERE id = ? AND deleted = 0")
      .get(revision.entry_id);
    if (!entry) {
      throw new Error('瓜条不存在或已删除');
    }
    const data = parseRevisionPayload(revision, mapWikiEntryRow(entry));
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
        related_post_ids_json = ?,
        attachments_json = ?,
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
      JSON.stringify(data.relatedPostIds),
      JSON.stringify(data.attachments),
      revision.id,
      versionNumber,
      now,
      entry.id
    );
    db.prepare(
      `
      UPDATE wiki_entry_revisions
      SET data_json = ?,
        status = 'approved',
        reviewed_at = ?,
        reviewed_by = ?,
        review_reason = NULL
      WHERE id = ?
      `
    ).run(serializeWikiRevisionData(data), now, adminName, revision.id);
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
        related_post_ids_json,
        attachments_json,
        display_order,
        status,
        current_revision_id,
        version_number,
        created_at,
        updated_at,
        deleted,
        deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, 1, ?, ?, 0, NULL)
      `
    ).run(
      entryId,
      slug,
      data.name,
      data.narrative,
      JSON.stringify(data.tags),
      JSON.stringify(data.relatedPostIds),
      JSON.stringify(data.attachments),
      displayOrder,
      revisionId,
      now,
      now
    );
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
      serializeWikiRevisionData(data),
      data.editSummary || '管理员创建',
      now,
      now,
      adminName
    );

    return { entryId, slug };
  });

  app.get('/api/admin/wiki/revisions', requireAdmin, requireAdminRead, (req, res) => {
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

    return res.json({ items: rows.map((row) => mapAdminWikiRevision(row)), total, page, limit });
  });

  app.get('/api/admin/wiki/entries', requireAdmin, requireAdminRead, (req, res) => {
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

    return res.json({ items: rows.map(mapAdminWikiEntry), total, page, limit });
  });

  app.post('/api/admin/wiki/entries', requireAdmin, requireAdminCsrf, requireAdminManage, (req, res) => {
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
        entry: mapAdminWikiEntry(
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

  app.post('/api/admin/wiki/revisions/:id/action', requireAdmin, requireAdminCsrf, requireAdminManage, (req, res) => {
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
      const result = db.prepare(
        `
        UPDATE wiki_entry_revisions
        SET status = 'rejected',
          review_reason = ?,
          reviewed_at = ?,
          reviewed_by = ?
        WHERE id = ? AND status = 'pending'
        `
      ).run(reason || null, now, getAdminName(req), id);
      if (Number(result.changes || 0) !== 1) {
        return res.status(400).json({ error: '该记录已处理' });
      }
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

  app.post('/api/admin/wiki/revisions/:id/edit', requireAdmin, requireAdminCsrf, requireAdminManage, (req, res) => {
    const id = String(req.params.id || '').trim();
    const revision = getRevision(id);
    if (!revision) {
      return res.status(404).json({ error: '审核记录不存在' });
    }
    if (revision.status !== 'pending') {
      return res.status(400).json({ error: '只能编辑待审核稿件' });
    }

    // 旧稿中的关联帖子可能在投稿后失效；这里只读取旧快照，最终保存内容由下方统一校验。
    const currentData = mapAdminWikiRevision(revision).data;
    const data = sanitizeAdminPayload(req.body || {}, res, currentData);
    if (!data) {
      return;
    }

    const result = db.prepare(
      `
      UPDATE wiki_entry_revisions
      SET data_json = ?
      WHERE id = ? AND status = 'pending'
      `
    ).run(serializeWikiRevisionData(data), id);
    if (Number(result.changes || 0) !== 1) {
      return res.status(400).json({ error: '该记录已处理' });
    }

    logAdminAction(req, {
      action: 'wiki_revision_edit',
      targetType: 'wiki_revision',
      targetId: id,
      before: currentData,
      after: data,
      reason: '管理员修订待审核稿件',
    });

    return res.json({ revision: mapAdminWikiRevision(getRevision(id)) });
  });

  app.post('/api/admin/wiki/entries/:id/edit', requireAdmin, requireAdminCsrf, requireAdminManage, (req, res) => {
    const entryId = String(req.params.id || '').trim();
    const entry = db.prepare('SELECT * FROM wiki_entries WHERE id = ?').get(entryId);
    if (!entry) {
      return res.status(404).json({ error: '瓜条不存在' });
    }
    const data = sanitizeAdminPayload(req.body || {}, res, mapWikiEntryRow(entry));
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
        serializeWikiRevisionData(data),
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
          related_post_ids_json = ?,
          attachments_json = ?,
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
        JSON.stringify(data.relatedPostIds),
        JSON.stringify(data.attachments),
        revisionId,
        versionNumber,
        now,
        entry.id
      );
    })();

    const updated = mapAdminWikiEntry(db.prepare('SELECT * FROM wiki_entries WHERE id = ?').get(entry.id));
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

  app.post('/api/admin/wiki/entries/:id/action', requireAdmin, requireAdminCsrf, requireAdminManage, (req, res) => {
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
