import { buildAdminIdentity } from '../admin-identity-utils.js';

const uniqueNonEmpty = (values) => Array.from(new Set(values.filter(Boolean)));

const buildBanAuditState = (banOptions, defaultPermissions) => ({
  banned: true,
  permissions: banOptions?.permissions || defaultPermissions,
  expiresAt: banOptions?.expiresAt || null,
});

export const createAdminModerationService = ({
  repository,
  upsertBan,
  BAN_PERMISSIONS,
  logAdminAction,
  getLookupHashesForIdentityHash,
  getStableLegacyFingerprintHashForIdentityHashes,
}) => {
  const getBanActionName = (type, action) => {
    if (type === 'ip') {
      return action === 'ban' ? 'ban_ip' : 'unban_ip';
    }
    if (type === 'identity') {
      return action === 'ban' ? 'ban_identity' : 'unban_identity';
    }
    return action === 'ban' ? 'ban_fingerprint' : 'unban_fingerprint';
  };

  const logBan = (req, type, value, reason, banOptions) => {
    logAdminAction(req, {
      action: getBanActionName(type, 'ban'),
      targetType: type,
      targetId: value,
      before: null,
      after: buildBanAuditState(banOptions, BAN_PERMISSIONS),
      reason,
    });
  };

  const logUnban = (req, type, value, reason) => {
    logAdminAction(req, {
      action: getBanActionName(type, 'unban'),
      targetType: type,
      targetId: value,
      before: { banned: true },
      after: { banned: false },
      reason,
    });
  };

  const applyBan = (type, value, banOptions) => {
    if (type === 'ip') {
      upsertBan('banned_ips', 'ip', value, banOptions || {});
      return;
    }
    upsertBan('banned_fingerprints', 'fingerprint', value, banOptions || {});
  };

  const resolveIdentityHashes = (value) => {
    const summary = buildAdminIdentity({
      identityHash: value,
      fingerprint: value,
      getLookupHashesForIdentityHash,
      getStableLegacyFingerprintHashForIdentityHashes,
    });
    return uniqueNonEmpty(summary.identityHashes || []);
  };

  const resolveFingerprintsToIdentityHashes = (fingerprints) => uniqueNonEmpty(
    fingerprints.flatMap((fingerprint) => resolveIdentityHashes(fingerprint))
  );

  return {
    executePostBatchAction({ req, action, ids, reason, banOptions, now = Date.now() }) {
      const rows = repository.getPostsByIds(ids);

      if (action === 'delete' || action === 'restore') {
        const deleted = action === 'delete' ? 1 : 0;
        const deletedAt = action === 'delete' ? now : null;
        repository.setPostsDeletedState(ids, deleted, deletedAt);

        rows.forEach((row) => {
          logAdminAction(req, {
            action: action === 'delete' ? 'post_delete' : 'post_restore',
            targetType: 'post',
            targetId: row.id,
            before: { deleted: row.deleted === 1 },
            after: { deleted: action === 'delete' },
            reason,
          });
        });

        return { updated: rows.length };
      }

      const ips = uniqueNonEmpty(rows.map((row) => row.ip));
      const identities = resolveFingerprintsToIdentityHashes(rows.map((row) => row.fingerprint));

      if (action === 'ban') {
        ips.forEach((ip) => {
          applyBan('ip', ip, banOptions);
          logBan(req, 'ip', ip, reason, banOptions);
        });
        identities.forEach((identityHash) => {
          applyBan('identity', identityHash, banOptions);
          logBan(req, 'identity', identityHash, reason, banOptions);
        });
        logAdminAction(req, {
          action: 'post_batch_ban',
          targetType: 'post_batch',
          targetId: ids.join(','),
          before: null,
          after: { posts: ids.length, ips: ips.length, identities: identities.length },
          reason,
        });
        return { updated: ids.length, ips: ips.length, identities: identities.length };
      }

      ips.forEach((ip) => {
        repository.unbanIp(ip);
        logUnban(req, 'ip', ip, reason);
      });
      identities.forEach((identityHash) => {
        repository.unbanFingerprint(identityHash);
        logUnban(req, 'identity', identityHash, reason);
      });
      logAdminAction(req, {
        action: 'post_batch_unban',
        targetType: 'post_batch',
        targetId: ids.join(','),
        before: null,
        after: { posts: ids.length, ips: ips.length, identities: identities.length },
        reason,
      });
      return { updated: ids.length, ips: ips.length, identities: identities.length };
    },

    executeBanAction({ req, action, type, value, reason, banOptions }) {
      const normalizedType = type === 'identity' ? 'identity' : type;
      const identityHashes = normalizedType === 'identity' ? resolveIdentityHashes(value) : [value];

      if (action === 'ban') {
        if (normalizedType === 'ip') {
          applyBan('ip', value, banOptions);
          logBan(req, 'ip', value, reason, banOptions);
        } else {
          identityHashes.forEach((identityHash) => {
            applyBan('identity', identityHash, banOptions);
            logBan(req, 'identity', identityHash, reason, banOptions);
          });
        }
        return { ok: true };
      }

      if (normalizedType === 'ip') {
        repository.unbanIp(value);
        logUnban(req, 'ip', value, reason);
      } else {
        identityHashes.forEach((identityHash) => {
          repository.unbanFingerprint(identityHash);
          logUnban(req, 'identity', identityHash, reason);
        });
      }
      return { ok: true };
    },

    executeReportAction({ req, reportId, action, reason, banOptions, deleteComment = false, now = Date.now() }) {
      const report = repository.getReportById(reportId);
      if (!report) {
        return null;
      }

      const nextStatus = action === 'ignore' ? 'ignored' : 'resolved';
      repository.setReportResolution(reportId, nextStatus, action, now);

      let targetIdentity = null;
      if (action === 'delete' || action === 'ban') {
        const isCommentTarget = report.target_type === 'comment' && report.comment_id;
        if (isCommentTarget) {
          const commentRow = repository.getCommentById(report.comment_id);
          if (commentRow) {
            const shouldDeleteReportedComment = action === 'delete' || (action === 'ban' && deleteComment);
            if (shouldDeleteReportedComment && commentRow.deleted !== 1) {
              repository.softDeleteComment(report.comment_id, now);
              repository.decrementPostComments(report.post_id);
            }
            targetIdentity = {
              ip: commentRow.ip || null,
              fingerprint: commentRow.fingerprint || null,
            };
          }
        } else {
          const postRow = repository.getPostIdentity(report.post_id);
          repository.softDeletePost(report.post_id, now);
          if (postRow) {
            targetIdentity = {
              ip: postRow.ip || null,
              fingerprint: postRow.fingerprint || null,
            };
          }
        }
      }

      if (action === 'ban' && banOptions && targetIdentity) {
        if (targetIdentity.ip) {
          applyBan('ip', targetIdentity.ip, banOptions);
        }
        resolveIdentityHashes(targetIdentity.fingerprint).forEach((identityHash) => {
          applyBan('identity', identityHash, banOptions);
        });
      }

      logAdminAction(req, {
        action: `report_${action}`,
        targetType: 'report',
        targetId: reportId,
        before: { status: report.status, action: report.action || null },
        after: { status: nextStatus, action },
        reason,
      });

      if (action === 'ban' && targetIdentity) {
        if (targetIdentity.ip) {
          logBan(req, 'ip', targetIdentity.ip, reason, banOptions);
        }
        resolveIdentityHashes(targetIdentity.fingerprint).forEach((identityHash) => {
          logBan(req, 'identity', identityHash, reason, banOptions);
        });
      }

      return { status: nextStatus, action };
    },

    executeReportBatchResolve({ req, ids, reason, now = Date.now() }) {
      const rows = repository.getReportsByIds(ids);
      const result = repository.resolvePendingReports(ids, now);

      rows
        .filter((row) => row.status === 'pending')
        .forEach((row) => {
          logAdminAction(req, {
            action: 'report_resolve',
            targetType: 'report',
            targetId: row.id,
            before: { status: row.status, action: row.action || null },
            after: { status: 'resolved', action: 'reviewed' },
            reason,
          });
        });

      return { updated: result.changes || 0 };
    },
  };
};
