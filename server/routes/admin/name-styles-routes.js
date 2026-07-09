import {
  createNameStyle,
  listNameStyles,
  NameStyleError,
  patchNameStyle,
} from '../../name-style-service.js';

export const registerAdminNameStylesRoutes = (app, deps) => {
  const {
    requireAdmin,
    requireAdminCsrf,
    requireAdminRead = (_req, _res, next) => next(),
    requireAdminManage = (_req, _res, next) => next(),
    logAdminAction,
  } = deps;

  const handleError = (res, error) => {
    if (error instanceof NameStyleError) {
      return res.status(error.status || 400).json({ error: error.message, path: error.path || '' });
    }
    return res.status(500).json({ error: error instanceof Error ? error.message : '操作失败' });
  };

  app.get('/api/admin/name-styles', requireAdmin, requireAdminRead, (_req, res) => {
    return res.json({ items: listNameStyles({ includeHidden: true }) });
  });

  app.post('/api/admin/name-styles', requireAdmin, requireAdminCsrf, requireAdminManage, (req, res) => {
    try {
      const item = createNameStyle(req.body || {}, {
        adminUsername: req.admin?.username || null,
      });
      logAdminAction?.(req, {
        action: 'name_style_create',
        targetType: 'name_style',
        targetId: item.id,
        before: null,
        after: item,
        reason: null,
      });
      return res.status(201).json({ item });
    } catch (error) {
      return handleError(res, error);
    }
  });

  app.patch('/api/admin/name-styles/:id', requireAdmin, requireAdminCsrf, requireAdminManage, (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      const item = patchNameStyle(id, req.body || {});
      if (!item) {
        return res.status(404).json({ error: '炫彩昵称不存在' });
      }
      logAdminAction?.(req, {
        action: 'name_style_patch',
        targetType: 'name_style',
        targetId: id,
        before: null,
        after: req.body || {},
        reason: null,
      });
      return res.json({ item });
    } catch (error) {
      return handleError(res, error);
    }
  });
};
