export const registerAdminStatsRoutes = (app, deps) => {
  const {
    db,
    requireAdmin,
    refreshAdminSession = (req) => req.session?.admin || null,
    hasAdminPermission = () => false,
    formatDateKey,
    startOfWeek,
    getOnlineCount,
  } = deps;

  app.get('/api/admin/stats', requireAdmin, (req, res) => {
    const admin = refreshAdminSession(req);
    if (!admin) {
      return res.status(401).json({ error: '登录状态已失效' });
    }

    const canReadContentReview = hasAdminPermission(admin, 'content_review', 'read');
    const canReadPosts = hasAdminPermission(admin, 'posts', 'read');
    const canReadUserSafety = hasAdminPermission(admin, 'user_safety', 'read');
    const canReadSettings = hasAdminPermission(admin, 'settings', 'read');

    const todayKey = formatDateKey();
    const todayStats = canReadContentReview
      ? db.prepare('SELECT reports FROM stats_daily WHERE date = ?').get(todayKey)
      : null;

    const weekStart = startOfWeek();
    const weekDates = [];
    for (let i = 0; i < 7; i += 1) {
      const date = new Date(weekStart + i * 24 * 60 * 60 * 1000);
      weekDates.push(formatDateKey(date));
    }

    const weeklyRows = canReadPosts || canReadSettings
      ? db
        .prepare('SELECT date, visits, posts FROM stats_daily WHERE date IN (' + weekDates.map(() => '?').join(',') + ')')
        .all(...weekDates)
      : [];

    const weeklyVisits = canReadSettings ? weekDates.map((date) => {
      const row = weeklyRows.find((item) => item.date === date);
      return row ? row.visits : 0;
    }) : weekDates.map(() => 0);

    const weeklyPosts = canReadPosts ? weekDates.map((date) => {
      const row = weeklyRows.find((item) => item.date === date);
      return row ? row.posts : 0;
    }) : weekDates.map(() => 0);

    const totalPosts = canReadPosts
      ? db.prepare('SELECT COUNT(1) AS count FROM posts WHERE deleted = 0').get().count
      : 0;
    const totalVisits = canReadSettings
      ? db.prepare('SELECT COALESCE(SUM(visits), 0) AS count FROM stats_daily').get().count
      : 0;
    const now = Date.now();
    const bannedIps = canReadUserSafety
      ? db
        .prepare('SELECT COUNT(1) AS count FROM banned_ips WHERE expires_at IS NULL OR expires_at > ?')
        .get(now).count
      : 0;
    const bannedFingerprints = canReadUserSafety
      ? db
        .prepare('SELECT COUNT(1) AS count FROM banned_fingerprints WHERE expires_at IS NULL OR expires_at > ?')
        .get(now).count
      : 0;
    const bannedIdentities = canReadUserSafety
      ? db
        .prepare('SELECT COUNT(1) AS count FROM banned_identities WHERE expires_at IS NULL OR expires_at > ?')
        .get(now).count
      : 0;
    const bannedUsers = bannedIps + bannedFingerprints + bannedIdentities;

    return res.json({
      todayReports: todayStats?.reports || 0,
      bannedUsers,
      weeklyVisits,
      weeklyPosts,
      totalPosts,
      totalVisits,
      onlineCount: canReadSettings ? getOnlineCount() : 0,
    });
  });
};
