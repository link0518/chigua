import { createModerationRepository } from '../../repositories/moderation-repository.js';
import { createAdminModerationService } from '../../services/admin-moderation-service.js';

export const registerAdminBansRoutes = (app, deps) => {
  const {
    db,
    requireAdmin,
    requireAdminCsrf,
    pruneExpiredBans,
    normalizePermissions,
    resolveBanOptions,
    upsertBan,
    BAN_PERMISSIONS,
    logAdminAction,
    resolveStoredIdentityHash,
  } = deps;

  const moderationRepository = createModerationRepository(db);
  const moderationService = createAdminModerationService({
    repository: moderationRepository,
    upsertBan,
    BAN_PERMISSIONS,
    logAdminAction,
    resolveStoredIdentityHash,
  });

  app.get('/api/admin/bans', requireAdmin, (req, res) => {
    pruneExpiredBans('banned_ips');
    pruneExpiredBans('banned_fingerprints');
    pruneExpiredBans('banned_identities');

    const ips = moderationRepository
      .listBannedIps()
      .map((row) => ({
        ip: row.ip,
        bannedAt: row.banned_at,
        expiresAt: row.expires_at || null,
        permissions: normalizePermissions(row.permissions),
        reason: row.reason || null,
      }));

    const fingerprints = moderationRepository
      .listBannedFingerprints()
      .map((row) => ({
        type: 'fingerprint',
        fingerprint: row.fingerprint,
        identityKey: null,
        identityHashes: [row.fingerprint],
        bannedAt: row.banned_at,
        expiresAt: row.expires_at || null,
        permissions: normalizePermissions(row.permissions),
        reason: row.reason || null,
      }));

    const identities = moderationRepository
      .listBannedIdentities()
      .map((row) => ({
        type: 'identity',
        fingerprint: row.identity,
        identityKey: row.identity,
        identityHashes: [row.identity],
        bannedAt: row.banned_at,
        expiresAt: row.expires_at || null,
        permissions: normalizePermissions(row.permissions),
        reason: row.reason || null,
      }));

    return res.json({ ips, fingerprints: [...fingerprints, ...identities] });
  });

  app.post('/api/admin/bans/action', requireAdmin, requireAdminCsrf, (req, res) => {
    const action = String(req.body?.action || '').trim();
    const type = String(req.body?.type || '').trim();
    const value = String(req.body?.value || '').trim();
    const reason = String(req.body?.reason || '').trim();
    const banOptions = action === 'ban' ? resolveBanOptions(req) : null;

    if (!['ban', 'unban'].includes(action) || !['ip', 'fingerprint', 'identity'].includes(type) || !value) {
      return res.status(400).json({ error: '无效操作' });
    }

    return res.json(
      moderationService.executeBanAction({
        req,
        action,
        type,
        value,
        reason,
        banOptions,
      })
    );
  });
};

