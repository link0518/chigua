export const registerAdminStatsRoutes = (app, deps) => {
  const {
    db,
    requireAdmin,
    formatDateKey,
    startOfWeek,
    getOnlineCount,
  } = deps;

  app.get('/api/admin/stats', requireAdmin, (req, res) => {
    const todayKey = formatDateKey();
    const todayStats = db.prepare('SELECT reports FROM stats_daily WHERE date = ?').get(todayKey);

    const weekStart = startOfWeek();
    const weekDates = [];
    for (let i = 0; i < 7; i += 1) {
      const date = new Date(weekStart + i * 24 * 60 * 60 * 1000);
      weekDates.push(formatDateKey(date));
    }

    const weeklyRows = db
      .prepare('SELECT date, visits, posts FROM stats_daily WHERE date IN (' + weekDates.map(() => '?').join(',') + ')')
      .all(...weekDates);

    const weeklyVisits = weekDates.map((date) => {
      const row = weeklyRows.find((item) => item.date === date);
      return row ? row.visits : 0;
    });

    const weeklyPosts = weekDates.map((date) => {
      const row = weeklyRows.find((item) => item.date === date);
      return row ? row.posts : 0;
    });

    const totalPosts = db.prepare('SELECT COUNT(1) AS count FROM posts WHERE deleted = 0').get().count;
    const totalVisits = db.prepare('SELECT COALESCE(SUM(visits), 0) AS count FROM stats_daily').get().count;
    const now = Date.now();
    const bannedIps = db
      .prepare('SELECT COUNT(1) AS count FROM banned_ips WHERE expires_at IS NULL OR expires_at > ?')
      .get(now).count;
    const bannedFingerprints = db
      .prepare('SELECT COUNT(1) AS count FROM banned_fingerprints WHERE expires_at IS NULL OR expires_at > ?')
      .get(now).count;
    const bannedUsers = bannedIps + bannedFingerprints;

    return res.json({
      todayReports: todayStats?.reports || 0,
      bannedUsers,
      weeklyVisits,
      weeklyPosts,
      totalPosts,
      totalVisits,
      onlineCount: getOnlineCount(),
    });
  });
};
