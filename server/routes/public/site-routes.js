export const registerPublicSiteRoutes = (app, deps) => {
  const {
    getClientIp,
    getIdentityLookupHashes,
    getActiveBans,
    mergePermissions,
    buildSettingsResponse,
    getAnnouncement,
    chatRealtime,
  } = deps;

  app.get('/api/access', (req, res) => {
    const clientIp = getClientIp(req);
    const identityHashes = getIdentityLookupHashes(req, res);
    const bans = getActiveBans(clientIp, identityHashes);
    const permissions = mergePermissions(bans);
    const blocked = bans.some((ban) => ban.permissions.includes('site'));
    const viewBlocked = bans.some((ban) => ban.permissions.includes('view'));
    const hasPermanent = bans.some((ban) => !ban.expires_at);
    const expiring = bans.map((ban) => ban.expires_at).filter((value) => typeof value === 'number');
    const expiresAt = hasPermanent || expiring.length === 0 ? null : Math.min(...expiring);
    return res.json({
      banned: bans.length > 0,
      blocked,
      viewBlocked,
      permissions,
      expiresAt,
    });
  });

  app.get('/api/settings', (req, res) => {
    const chatEnabled = chatRealtime?.getChatConfig?.().chatEnabled;
    return res.json({
      ...buildSettingsResponse(),
      chatEnabled: typeof chatEnabled === 'boolean' ? chatEnabled : true,
    });
  });

  app.get('/api/announcement', (req, res) => {
    const row = getAnnouncement();
    if (!row) {
      return res.json({ content: '', updatedAt: null });
    }
    return res.json({ content: row.content, updatedAt: row.updated_at });
  });
};
