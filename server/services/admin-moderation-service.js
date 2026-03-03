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
}) => {
  const logBan = (req, type, value, reason, banOptions) => {
    logAdminAction(req, {
      action: type === 'ip' ? 'ban_ip' : 'ban_fingerprint',
      targetType: type,
      targetId: value,
      before: null,
      after: buildBanAuditState(banOptions, BAN_PERMISSIONS),
      reason,
    });
  };

  const logUnban = (req, type, value, reason) => {
    logAdminAction(req, {
      action: type === 'ip' ? 'unban_ip' : 'unban_fingerprint',
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
      const fingerprints = uniqueNonEmpty(rows.map((row) => row.fingerprint));

      if (action === 'ban') {
        ips.forEach((ip) => {
          applyBan('ip', ip, banOptions);
          logBan(req, 'ip', ip, reason, banOptions);
        });
        fingerprints.forEach((fingerprint) => {
          applyBan('fingerprint', fingerprint, banOptions);
          logBan(req, 'fingerprint', fingerprint, reason, banOptions);
        });
        logAdminAction(req, {
          action: 'post_batch_ban',
          targetType: 'post_batch',
          targetId: ids.join(','),
          before: null,
          after: { posts: ids.length, ips: ips.length, fingerprints: fingerprints.length },
          reason,
        });
        return { updated: ids.length, ips: ips.length, fingerprints: fingerprints.length };
      }

      ips.forEach((ip) => {
        repository.unbanIp(ip);
        logUnban(req, 'ip', ip, reason);
      });
      fingerprints.forEach((fingerprint) => {
        repository.unbanFingerprint(fingerprint);
        logUnban(req, 'fingerprint', fingerprint, reason);
      });
      logAdminAction(req, {
        action: 'post_batch_unban',
        targetType: 'post_batch',
        targetId: ids.join(','),
        before: null,
        after: { posts: ids.length, ips: ips.length, fingerprints: fingerprints.length },
        reason,
      });
      return { updated: ids.length, ips: ips.length, fingerprints: fingerprints.length };
    },

    executeBanAction({ req, action, type, value, reason, banOptions }) {
      if (action === 'ban') {
        applyBan(type, value, banOptions);
        logBan(req, type, value, reason, banOptions);
        return { ok: true };
      }

      if (type === 'ip') {
        repository.unbanIp(value);
      } else {
        repository.unbanFingerprint(value);
      }
      logUnban(req, type, value, reason);
      return { ok: true };
    },

    executeReportAction({ req, reportId, action, reason, banOptions, now = Date.now() }) {
      const report = repository.getReportById(reportId);
      if (!report) {
        return null;
      }

      const nextStatus = action === 'ignore' ? 'ignored' : 'resolved';
      repository.setReportResolution(reportId, nextStatus, action, now);

      let targetIdentity = null;
      if (action === 'delete' || action === 'ban') {
        if (report.target_type === 'comment' && report.comment_id) {
          const commentRow = repository.getCommentById(report.comment_id);
          if (commentRow) {
            const removedCount = commentRow.deleted === 1 ? 0 : 1;
            if (removedCount > 0) {
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
        if (targetIdentity.fingerprint) {
          applyBan('fingerprint', targetIdentity.fingerprint, banOptions);
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
        if (targetIdentity.fingerprint) {
          logBan(req, 'fingerprint', targetIdentity.fingerprint, reason, banOptions);
        }
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
