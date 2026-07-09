import { getNameStyleById, listNameStylesForRender } from '../../name-style-service.js';

/** 公开渲染目录：非 hidden，供前台按 id 取 RGB */
export const registerPublicNameStylesRoutes = (app) => {
  app.get('/api/name-styles', (_req, res) => {
    return res.json({ items: listNameStylesForRender() });
  });

  app.get('/api/name-styles/:id', (req, res) => {
    const item = getNameStyleById(String(req.params.id || '').trim());
    if (!item) {
      return res.status(404).json({ error: '炫彩昵称不存在' });
    }
    return res.json({ item });
  });
};
