import { createModerationRepository } from '../../repositories/moderation-repository.js';
import { createAdminModerationService } from '../../services/admin-moderation-service.js';
import { buildAdminIdentity } from '../../admin-identity-utils.js';

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
    getLookupHashesForIdentityHash,
    getStableLegacyFingerprintHashForIdentityHashes,
  } = deps;

  const moderationRepository = createModerationRepository(db);
  const moderationService = createAdminModerationService({
    repository: moderationRepository,
    upsertBan,
    BAN_PERMISSIONS,
    logAdminAction,
    getLookupHashesForIdentityHash,
    getStableLegacyFingerprintHashForIdentityHashes,
  });

  const resolveAdminIdentity = (fingerprint) => buildAdminIdentity({
    fingerprint,
    getLookupHashesForIdentityHash,
    getStableLegacyFingerprintHashForIdentityHashes,
  });

  app.get('/api/admin/bans', requireAdmin, (req, res) => {
    pruneExpiredBans('banned_ips');
    pruneExpiredBans('banned_fingerprints');

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
      .map((row) => {
        const identity = resolveAdminIdentity(row.fingerprint);
        return {
          fingerprint: row.fingerprint,
          identityKey: identity.identityKey,
          identityHashes: identity.identityHashes,
          bannedAt: row.banned_at,
          expiresAt: row.expires_at || null,
          permissions: normalizePermissions(row.permissions),
          reason: row.reason || null,
        };
      });

    return res.json({ ips, fingerprints });
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

