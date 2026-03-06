export const registerAdminSettingsRoutes = (app, deps) => {
  const {
    requireAdmin,
    requireAdminCsrf,
    buildSettingsResponse,
    setTurnstileEnabled,
    setCnyThemeEnabled,
    setDefaultPostTags,
    setRateLimits,
    getTurnstileEnabled,
    getCnyThemeEnabled,
    getDefaultPostTags,
    getRateLimits,
    logAdminAction,
  } = deps;

  const buildAdminSettingsResponse = () => ({
    ...buildSettingsResponse(),
    rateLimits: getRateLimits(),
  });

  app.get('/api/admin/settings', requireAdmin, (req, res) => {
    return res.json(buildAdminSettingsResponse());
  });

  app.post('/api/admin/settings', requireAdmin, requireAdminCsrf, (req, res) => {
    const rawTurnstileEnabled = req.body?.turnstileEnabled;
    const rawCnyThemeEnabled = req.body?.cnyThemeEnabled;
    const hasDefaultPostTags = Object.prototype.hasOwnProperty.call(req.body || {}, 'defaultPostTags');
    const rawDefaultPostTags = req.body?.defaultPostTags;
    const hasRateLimits = Object.prototype.hasOwnProperty.call(req.body || {}, 'rateLimits');
    const rawRateLimits = req.body?.rateLimits;
    if (
      typeof rawTurnstileEnabled !== 'boolean'
      && typeof rawCnyThemeEnabled !== 'boolean'
      && !hasDefaultPostTags
      && !hasRateLimits
    ) {
      return res.status(400).json({ error: '\u53c2\u6570\u683c\u5f0f\u9519\u8bef' });
    }
    if (
      hasDefaultPostTags
      && !Array.isArray(rawDefaultPostTags)
      && typeof rawDefaultPostTags !== 'string'
    ) {
      return res.status(400).json({ error: '\u53c2\u6570\u683c\u5f0f\u9519\u8bef' });
    }
    if (
      hasRateLimits
      && (!rawRateLimits || typeof rawRateLimits !== 'object' || Array.isArray(rawRateLimits))
    ) {
      return res.status(400).json({ error: '\u53c2\u6570\u683c\u5f0f\u9519\u8bef' });
    }
    const before = {
      turnstileEnabled: getTurnstileEnabled(),
      cnyThemeEnabled: getCnyThemeEnabled(),
      defaultPostTags: getDefaultPostTags(),
      rateLimits: getRateLimits(),
    };
    if (typeof rawTurnstileEnabled === 'boolean') {
      setTurnstileEnabled(rawTurnstileEnabled);
    }
    if (typeof rawCnyThemeEnabled === 'boolean') {
      setCnyThemeEnabled(rawCnyThemeEnabled);
    }
    if (hasDefaultPostTags) {
      setDefaultPostTags(rawDefaultPostTags);
    }
    if (hasRateLimits) {
      setRateLimits(rawRateLimits);
    }
    const after = {
      turnstileEnabled: getTurnstileEnabled(),
      cnyThemeEnabled: getCnyThemeEnabled(),
      defaultPostTags: getDefaultPostTags(),
      rateLimits: getRateLimits(),
    };
    logAdminAction(req, {
      action: 'settings_update',
      targetType: 'settings',
      targetId: 'site_settings',
      before,
      after,
    });
    return res.json(buildAdminSettingsResponse());
  });
};
