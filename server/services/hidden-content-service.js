export const AUTO_HIDE_THRESHOLD = 10;
export const AUTO_HIDE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const HIDDEN_REVIEW_PENDING = 'pending';
export const HIDDEN_REVIEW_KEPT = 'kept';

const countPendingReports = (db, targetType, targetId, since) => {
  if (!targetId) {
    return 0;
  }
  if (targetType === 'comment') {
    return Number(
      db.prepare(`
        SELECT COUNT(1) AS count
        FROM reports
        WHERE target_type = 'comment'
          AND comment_id = ?
          AND status = 'pending'
          AND created_at >= ?
      `).get(targetId, since)?.count || 0
    );
  }

  return Number(
    db.prepare(`
      SELECT COUNT(1) AS count
      FROM reports
      WHERE target_type = 'post'
        AND post_id = ?
        AND status = 'pending'
        AND created_at >= ?
    `).get(targetId, since)?.count || 0
  );
};

const resolvePendingReportsForTarget = (db, targetType, targetId, action, resolvedAt) => {
  if (!targetId) {
    return 0;
  }

  const result = targetType === 'comment'
    ? db.prepare(`
      UPDATE reports
      SET status = 'resolved', action = ?, resolved_at = ?
      WHERE target_type = 'comment'
        AND comment_id = ?
        AND status = 'pending'
    `).run(action, resolvedAt, targetId)
    : db.prepare(`
      UPDATE reports
      SET status = 'resolved', action = ?, resolved_at = ?
      WHERE target_type = 'post'
        AND post_id = ?
        AND status = 'pending'
    `).run(action, resolvedAt, targetId);

  return Number(result?.changes || 0);
};

const getHiddenTargetRow = (db, targetType, targetId) => {
  if (targetType === 'comment') {
    return db.prepare(`
      SELECT id, post_id, deleted, hidden, hidden_at, hidden_review_status
      FROM comments
      WHERE id = ?
    `).get(targetId);
  }

  return db.prepare(`
    SELECT id, deleted, hidden, hidden_at, hidden_review_status
    FROM posts
    WHERE id = ?
  `).get(targetId);
};

const markPostHidden = (db, postId, now, reviewStatus = HIDDEN_REVIEW_PENDING) => {
  const row = db.prepare('SELECT id, deleted, hidden FROM posts WHERE id = ?').get(postId);
  if (!row || row.deleted === 1 || row.hidden === 1) {
    return false;
  }
  db.prepare('UPDATE posts SET hidden = 1, hidden_at = ?, hidden_review_status = ? WHERE id = ?')
    .run(now, reviewStatus, postId);
  return true;
};

const markCommentHidden = (db, commentId, now, reviewStatus = HIDDEN_REVIEW_PENDING) => {
  const row = db.prepare('SELECT id, post_id, deleted, hidden FROM comments WHERE id = ?').get(commentId);
  if (!row || row.deleted === 1 || row.hidden === 1) {
    return false;
  }
  const tx = db.transaction(() => {
    db.prepare('UPDATE comments SET hidden = 1, hidden_at = ?, hidden_review_status = ? WHERE id = ?')
      .run(now, reviewStatus, commentId);
    db.prepare(`
      UPDATE posts
      SET comments_count = CASE WHEN comments_count - 1 < 0 THEN 0 ELSE comments_count - 1 END
      WHERE id = ?
    `).run(row.post_id);
  });
  tx();
  return true;
};

const restorePostVisibility = (db, postId) => {
  db.prepare('UPDATE posts SET hidden = 0, hidden_at = NULL, hidden_review_status = NULL WHERE id = ?')
    .run(postId);
};

const restoreCommentVisibility = (db, commentId, postId) => {
  const tx = db.transaction(() => {
    db.prepare('UPDATE comments SET hidden = 0, hidden_at = NULL, hidden_review_status = NULL WHERE id = ?')
      .run(commentId);
    db.prepare('UPDATE posts SET comments_count = comments_count + 1 WHERE id = ?').run(postId);
  });
  tx();
};

export const createHiddenContentService = ({ db, logAdminAction }) => ({
  maybeAutoHideTarget({ targetType, targetId, now = Date.now() }) {
    const since = now - AUTO_HIDE_WINDOW_MS;
    const pendingCount = countPendingReports(db, targetType, targetId, since);
    if (pendingCount < AUTO_HIDE_THRESHOLD) {
      return { autoHidden: false, pendingCount };
    }

    const autoHidden = targetType === 'comment'
      ? markCommentHidden(db, targetId, now)
      : markPostHidden(db, targetId, now);

    return { autoHidden, pendingCount };
  },

  handleHiddenContentAction({ req, targetType, targetId, action, reason = '', now = Date.now() }) {
    if (!['post', 'comment'].includes(targetType) || !['keep', 'restore'].includes(action)) {
      return null;
    }

    const row = getHiddenTargetRow(db, targetType, targetId);
    if (!row) {
      return null;
    }
    if (row.deleted === 1) {
      return { error: '内容已删除，无法处理隐藏状态', code: 'deleted' };
    }
    if (row.hidden !== 1) {
      return { error: '内容当前未处于隐藏状态', code: 'not_hidden' };
    }

    const before = {
      hidden: true,
      hiddenAt: row.hidden_at || null,
      hiddenReviewStatus: row.hidden_review_status || null,
    };

    if (action === 'keep') {
      const hiddenAt = row.hidden_at || now;
      if (targetType === 'comment') {
        db.prepare('UPDATE comments SET hidden = 1, hidden_at = ?, hidden_review_status = ? WHERE id = ?')
          .run(hiddenAt, HIDDEN_REVIEW_KEPT, targetId);
      } else {
        db.prepare('UPDATE posts SET hidden = 1, hidden_at = ?, hidden_review_status = ? WHERE id = ?')
          .run(hiddenAt, HIDDEN_REVIEW_KEPT, targetId);
      }

      const resolvedReports = resolvePendingReportsForTarget(db, targetType, targetId, 'hidden_keep', now);
      logAdminAction?.(req, {
        action: `${targetType}_hidden_keep`,
        targetType,
        targetId,
        before,
        after: {
          hidden: true,
          hiddenAt,
          hiddenReviewStatus: HIDDEN_REVIEW_KEPT,
          resolvedReports,
        },
        reason,
      });

      return {
        id: targetId,
        targetType,
        action,
        hidden: true,
        hiddenAt,
        hiddenReviewStatus: HIDDEN_REVIEW_KEPT,
        resolvedReports,
      };
    }

    if (targetType === 'comment') {
      restoreCommentVisibility(db, targetId, row.post_id);
    } else {
      restorePostVisibility(db, targetId);
    }

    const resolvedReports = resolvePendingReportsForTarget(db, targetType, targetId, 'hidden_restore', now);
    logAdminAction?.(req, {
      action: `${targetType}_hidden_restore`,
      targetType,
      targetId,
      before,
      after: {
        hidden: false,
        hiddenAt: null,
        hiddenReviewStatus: null,
        resolvedReports,
      },
      reason,
    });

    return {
      id: targetId,
      targetType,
      action,
      hidden: false,
      hiddenAt: null,
      hiddenReviewStatus: null,
      resolvedReports,
    };
  },
});
