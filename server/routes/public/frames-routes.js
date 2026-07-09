import { getFramePublic, listRenderFrames } from '../../frame-service.js';

/** 公开渲染用框数据（含 off_sale，不含 hidden） */
export const registerPublicFramesRoutes = (app) => {
  app.get('/api/frames', (_req, res) => {
    return res.json({ items: listRenderFrames() });
  });

  app.get('/api/frames/:id', (req, res) => {
    const item = getFramePublic(String(req.params.id || '').trim());
    if (!item || item.status === 'hidden') {
      return res.status(404).json({ error: '框不存在' });
    }
    return res.json({ item });
  });
};
