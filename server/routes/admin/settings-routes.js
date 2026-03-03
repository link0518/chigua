export const registerAdminSettingsRoutes = (app, deps) => {
  const {
    requireAdmin,
    requireAdminCsrf,
    buildSettingsResponse,
    setTurnstileEnabled,
    setCnyThemeEnabled,
    getTurnstileEnabled,
    getCnyThemeEnabled,
    logAdminAction,
  } = deps;

  app.get('/api/admin/settings', requireAdmin, (req, res) => {
    return res.json(buildSettingsResponse());
  });

  app.post('/api/admin/settings', requireAdmin, requireAdminCsrf, (req, res) => {
    const rawTurnstileEnabled = req.body?.turnstileEnabled;
    const rawCnyThemeEnabled = req.body?.cnyThemeEnabled;
    if (typeof rawTurnstileEnabled !== 'boolean' && typeof rawCnyThemeEnabled !== 'boolean') {
      return res.status(400).json({ error: '\u53c2\u6570\u683c\u5f0f\u9519\u8bef' });
    }
    const before = {
      turnstileEnabled: getTurnstileEnabled(),
      cnyThemeEnabled: getCnyThemeEnabled(),
    };
    if (typeof rawTurnstileEnabled === 'boolean') {
      setTurnstileEnabled(rawTurnstileEnabled);
    }
    if (typeof rawCnyThemeEnabled === 'boolean') {
      setCnyThemeEnabled(rawCnyThemeEnabled);
    }
    const after = {
      turnstileEnabled: getTurnstileEnabled(),
      cnyThemeEnabled: getCnyThemeEnabled(),
    };
    logAdminAction(req, {
      action: 'settings_update',
      targetType: 'settings',
      targetId: 'site_settings',
      before,
      after,
    });
    return res.json(buildSettingsResponse());
  });
};
