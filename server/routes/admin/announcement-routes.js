export const registerAdminAnnouncementRoutes = (app, deps) => {
  const {
    requireAdmin,
    requireAdminCsrf,
    db,
    getAnnouncement,
    logAdminAction,
  } = deps;

  app.get('/api/admin/announcement', requireAdmin, (req, res) => {
    const row = getAnnouncement();
    if (!row) {
      return res.json({ content: '', updatedAt: null });
    }
    return res.json({ content: row.content, updatedAt: row.updated_at });
  });

  app.post('/api/admin/announcement', requireAdmin, requireAdminCsrf, (req, res) => {
    const content = String(req.body?.content || '').trim();
    if (!content) {
      return res.status(400).json({ error: '\u516c\u544a\u5185\u5bb9\u4e0d\u80fd\u4e3a\u7a7a' });
    }
    if (content.length > 5000) {
      return res.status(400).json({ error: '\u516c\u544a\u5185\u5bb9\u8fc7\u957f' });
    }
    const now = Date.now();
    db.prepare(
      `
      INSERT INTO announcements (id, content, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at
      `
    ).run('current', content, now);
    logAdminAction(req, {
      action: 'announcement_update',
      targetType: 'announcement',
      targetId: 'current',
      before: null,
      after: { updatedAt: now },
      reason: null,
    });
    return res.json({ content, updatedAt: now });
  });

  app.post('/api/admin/announcement/clear', requireAdmin, requireAdminCsrf, (req, res) => {
    db.prepare('DELETE FROM announcements WHERE id = ?').run('current');
    logAdminAction(req, {
      action: 'announcement_clear',
      targetType: 'announcement',
      targetId: 'current',
      before: null,
      after: null,
      reason: null,
    });
    return res.json({ content: '', updatedAt: null });
  });
};
