export const registerAdminSettingsRoutes = (app, deps) => {
  const {
    requireAdmin,
    requireAdminCsrf,
    buildSettingsResponse,
    setTurnstileEnabled,
    setCnyThemeEnabled,
    setDefaultPostTags,
    setRateLimits,
    setAutoHideReportThreshold,
    setWecomWebhookConfig,
    getTurnstileEnabled,
    getCnyThemeEnabled,
    getDefaultPostTags,
    getRateLimits,
    getAutoHideReportThreshold,
    getWecomWebhookPublicConfig,
    getWecomWebhookAuditConfig,
    wecomWebhookService,
    logAdminAction,
  } = deps;

  const buildAdminSettingsResponse = () => ({
    ...buildSettingsResponse(),
    rateLimits: getRateLimits(),
    autoHideReportThreshold: getAutoHideReportThreshold(),
    wecomWebhook: getWecomWebhookPublicConfig(),
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
    const hasAutoHideReportThreshold = Object.prototype.hasOwnProperty.call(req.body || {}, 'autoHideReportThreshold');
    const rawAutoHideReportThreshold = req.body?.autoHideReportThreshold;
    const hasWecomWebhook = Object.prototype.hasOwnProperty.call(req.body || {}, 'wecomWebhook');
    const rawWecomWebhook = req.body?.wecomWebhook;
    if (
      typeof rawTurnstileEnabled !== 'boolean'
      && typeof rawCnyThemeEnabled !== 'boolean'
      && !hasDefaultPostTags
      && !hasRateLimits
      && !hasAutoHideReportThreshold
      && !hasWecomWebhook
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
    if (
      hasAutoHideReportThreshold
      && (
        !['number', 'string'].includes(typeof rawAutoHideReportThreshold)
        || !Number.isFinite(Number(rawAutoHideReportThreshold))
        || Number(rawAutoHideReportThreshold) < 1
      )
    ) {
      return res.status(400).json({ error: '\u53c2\u6570\u683c\u5f0f\u9519\u8bef' });
    }
    if (
      hasWecomWebhook
      && (!rawWecomWebhook || typeof rawWecomWebhook !== 'object' || Array.isArray(rawWecomWebhook))
    ) {
      return res.status(400).json({ error: '\u53c2\u6570\u683c\u5f0f\u9519\u8bef' });
    }
    const before = {
      turnstileEnabled: getTurnstileEnabled(),
      cnyThemeEnabled: getCnyThemeEnabled(),
      defaultPostTags: getDefaultPostTags(),
      rateLimits: getRateLimits(),
      autoHideReportThreshold: getAutoHideReportThreshold(),
      wecomWebhook: getWecomWebhookAuditConfig(),
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
    if (hasAutoHideReportThreshold) {
      setAutoHideReportThreshold(rawAutoHideReportThreshold);
    }
    if (hasWecomWebhook) {
      try {
        setWecomWebhookConfig(rawWecomWebhook);
      } catch (error) {
        return res.status(400).json({ error: error instanceof Error ? error.message : '\u53c2\u6570\u683c\u5f0f\u9519\u8bef' });
      }
    }
    const after = {
      turnstileEnabled: getTurnstileEnabled(),
      cnyThemeEnabled: getCnyThemeEnabled(),
      defaultPostTags: getDefaultPostTags(),
      rateLimits: getRateLimits(),
      autoHideReportThreshold: getAutoHideReportThreshold(),
      wecomWebhook: getWecomWebhookAuditConfig(),
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

  app.post('/api/admin/settings/wecom-webhook/test', requireAdmin, requireAdminCsrf, async (req, res) => {
    const rawUrl = typeof req.body?.url === 'string'
      ? req.body.url
      : typeof req.body?.wecomWebhook?.url === 'string'
        ? req.body.wecomWebhook.url
        : '';
    const result = await wecomWebhookService?.sendTestMessage({ url: rawUrl });
    if (!result?.ok) {
      return res.status(result?.skipped ? 400 : 502).json({
        error: result?.error || '\u4f01\u4e1a\u5fae\u4fe1\u673a\u5668\u4eba\u6d4b\u8bd5\u63a8\u9001\u5931\u8d25',
      });
    }
    return res.json({ ok: true });
  });
};
