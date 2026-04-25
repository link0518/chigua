const uniqueNonEmpty = (values) => Array.from(new Set(values.filter(Boolean)));

const buildBanAuditState = (banOptions, defaultPermissions) => ({
  banned: true,
  permissions: banOptions?.permissions || defaultPermissions,
  expiresAt: banOptions?.expiresAt || null,
});

const normalizeStoredTarget = (value, resolveStoredIdentityHash) => {
  const normalizedValue = String(value || '').trim();
  if (!normalizedValue) {
    return null;
  }
  const resolved = typeof resolveStoredIdentityHash === 'function'
    ? resolveStoredIdentityHash(normalizedValue)
    : null;
  return {
    type: resolved?.type === 'identity' ? 'identity' : 'legacy_fingerprint',
    value: String(resolved?.identityKey || normalizedValue).trim(),
  };
};

export const createAdminModerationService = ({
  repository,
  upsertBan,
  BAN_PERMISSIONS,
  logAdminAction,
  resolveStoredIdentityHash,
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
    if (type === 'identity') {
      upsertBan('banned_identities', 'identity', value, banOptions || {});
      return;
    }
    upsertBan('banned_fingerprints', 'fingerprint', value, banOptions || {});
  };

  const removeBan = (type, value) => {
    if (type === 'ip') {
      repository.unbanIp(value);
      return;
    }
    if (type === 'identity') {
      repository.unbanIdentity(value);
      return;
    }
    repository.unbanFingerprint(value);
  };

  const collectStoredTargets = (rows) => uniqueNonEmpty(
    rows
      .map((row) => normalizeStoredTarget(row?.fingerprint, resolveStoredIdentityHash))
      .filter(Boolean)
      .map((item) => `${item.type}:${item.value}`)
  ).map((item) => {
    const separatorIndex = item.indexOf(':');
    return {
      type: item.slice(0, separatorIndex),
      value: item.slice(separatorIndex + 1),
    };
  });

  const summarizeTargets = (targets) => ({
    fingerprints: targets.filter((item) => item.type === 'legacy_fingerprint').length,
    identities: targets.filter((item) => item.type === 'identity').length,
  });

  const mapStoredTypeToBanType = (type) => (type === 'identity' ? 'identity' : 'fingerprint');

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
      const targets = collectStoredTargets(rows);
      const summary = summarizeTargets(targets);

      if (action === 'ban') {
        ips.forEach((ip) => {
          applyBan('ip', ip, banOptions);
          logBan(req, 'ip', ip, reason, banOptions);
        });
        targets.forEach((target) => {
          const banType = mapStoredTypeToBanType(target.type);
          applyBan(banType, target.value, banOptions);
          logBan(req, banType, target.value, reason, banOptions);
        });
        logAdminAction(req, {
          action: 'post_batch_ban',
          targetType: 'post_batch',
          targetId: ids.join(','),
          before: null,
          after: { posts: ids.length, ips: ips.length, ...summary },
          reason,
        });
        return { updated: ids.length, ips: ips.length, ...summary };
      }

      ips.forEach((ip) => {
        removeBan('ip', ip);
        logUnban(req, 'ip', ip, reason);
      });
      targets.forEach((target) => {
        const banType = mapStoredTypeToBanType(target.type);
        removeBan(banType, target.value);
        logUnban(req, banType, target.value, reason);
      });
      logAdminAction(req, {
        action: 'post_batch_unban',
        targetType: 'post_batch',
        targetId: ids.join(','),
        before: null,
        after: { posts: ids.length, ips: ips.length, ...summary },
        reason,
      });
      return { updated: ids.length, ips: ips.length, ...summary };
    },

    executeBanAction({ req, action, type, value, reason, banOptions }) {
      const normalizedType = type === 'identity' ? 'identity' : type === 'fingerprint' ? 'fingerprint' : 'ip';

      if (action === 'ban') {
        applyBan(normalizedType, value, banOptions);
        logBan(req, normalizedType, value, reason, banOptions);
        return { ok: true };
      }

      removeBan(normalizedType, value);
      logUnban(req, normalizedType, value, reason);
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
              value: commentRow.fingerprint || null,
              createdAt: commentRow.created_at,
            };
          }
        } else {
          const postRow = repository.getPostIdentity(report.post_id);
          repository.softDeletePost(report.post_id, now);
          if (postRow) {
            targetIdentity = {
              ip: postRow.ip || null,
              value: postRow.fingerprint || null,
              createdAt: postRow.created_at,
            };
          }
        }
      }

      if (action === 'ban' && banOptions && targetIdentity) {
        if (targetIdentity.ip) {
          applyBan('ip', targetIdentity.ip, banOptions);
        }
        const target = normalizeStoredTarget(targetIdentity.value, resolveStoredIdentityHash);
        if (target) {
          applyBan(mapStoredTypeToBanType(target.type), target.value, banOptions);
        }
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
        const target = normalizeStoredTarget(targetIdentity.value, resolveStoredIdentityHash);
        if (target) {
          logBan(req, mapStoredTypeToBanType(target.type), target.value, reason, banOptions);
        }
      }

      return { status: nextStatus, action };
    },

    executeReportBatchResolve({ req, ids, reason, action = 'resolve', now = Date.now() }) {
      const rows = repository.getReportsByIds(ids);
      const isIgnore = action === 'ignore';
      const result = isIgnore
        ? repository.ignorePendingReports(ids, now)
        : repository.resolvePendingReports(ids, now);
      const nextStatus = isIgnore ? 'ignored' : 'resolved';
      const nextAction = isIgnore ? 'ignore' : 'reviewed';

      rows
        .filter((row) => row.status === 'pending')
        .forEach((row) => {
          logAdminAction(req, {
            action: isIgnore ? 'report_ignore' : 'report_resolve',
            targetType: 'report',
            targetId: row.id,
            before: { status: row.status, action: row.action || null },
            after: { status: nextStatus, action: nextAction },
            reason,
          });
        });

      return { updated: result.changes || 0 };
    },
  };
};
