import {
  exportFrame,
  importFramePackage,
  listFrames,
  patchFrame,
  validateFramePackage,
  FramePackageError,
} from '../../frame-service.js';

export const registerAdminNicknameFramesRoutes = (app, deps) => {
  const {
    requireAdmin,
    requireAdminCsrf,
    requireAdminRead = (_req, _res, next) => next(),
    requireAdminManage = (_req, _res, next) => next(),
    logAdminAction,
  } = deps;

  const handlePackageError = (res, error) => {
    if (error instanceof FramePackageError) {
      return res.status(error.status || 400).json({
        error: error.message,
        path: error.path || '',
      });
    }
    const message = error instanceof Error ? error.message : '操作失败';
    return res.status(500).json({ error: message });
  };

  app.get('/api/admin/nickname-frames', requireAdmin, requireAdminRead, (_req, res) => {
    return res.json({ items: listFrames({ includeHidden: true }) });
  });

  app.post('/api/admin/nickname-frames/validate', requireAdmin, requireAdminRead, (req, res) => {
    try {
      const raw = req.body?.package ?? req.body;
      const pkg = validateFramePackage(raw);
      return res.json({ ok: true, package: pkg });
    } catch (error) {
      return handlePackageError(res, error);
    }
  });

  app.post('/api/admin/nickname-frames/import', requireAdmin, requireAdminCsrf, requireAdminManage, (req, res) => {
    try {
      const raw = req.body?.package ?? req.body;
      const mode = String(req.body?.mode || 'create').trim() === 'upsert' ? 'upsert' : 'create';
      // 支持 body.fileText：导入文件读出的 JSON 字符串
      const payload = req.body?.fileText != null ? req.body.fileText : raw;
      const item = importFramePackage(payload, {
        mode,
        adminUsername: req.admin?.username || null,
      });
      logAdminAction?.(req, {
        action: 'nickname_frame_import',
        targetType: 'nickname_frame',
        targetId: item.id,
        before: null,
        after: { id: item.id, price: item.price, status: item.status, mode },
        reason: null,
      });
      return res.status(mode === 'create' ? 201 : 200).json({ item });
    } catch (error) {
      return handlePackageError(res, error);
    }
  });

  app.patch('/api/admin/nickname-frames/:id', requireAdmin, requireAdminCsrf, requireAdminManage, (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      const item = patchFrame(id, req.body || {});
      if (!item) {
        return res.status(404).json({ error: '框不存在' });
      }
      logAdminAction?.(req, {
        action: 'nickname_frame_patch',
        targetType: 'nickname_frame',
        targetId: id,
        before: null,
        after: req.body || {},
        reason: null,
      });
      return res.json({ item });
    } catch (error) {
      return handlePackageError(res, error);
    }
  });

  app.get('/api/admin/nickname-frames/:id/export', requireAdmin, requireAdminRead, (req, res) => {
    const id = String(req.params.id || '').trim();
    const pkg = exportFrame(id);
    if (!pkg) {
      return res.status(404).json({ error: '框不存在' });
    }
    return res.json({ package: pkg });
  });
};
