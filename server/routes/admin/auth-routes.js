export const registerAdminAuthRoutes = (app, deps) => {
  const {
    adminEnabled,
    requireAdmin,
    requireAdminCsrf,
    db,
    bcrypt,
    crypto,
  } = deps;

  app.get('/api/admin/session', (req, res) => {
    if (!adminEnabled) {
      return res.json({ loggedIn: false, disabled: true });
    }
    if (req.session?.admin) {
      return res.json({
        loggedIn: true,
        username: req.session.admin.username,
        csrfToken: req.session.admin.csrfToken || null,
      });
    }
    return res.json({ loggedIn: false, disabled: false });
  });

  app.post('/api/admin/login', (req, res) => {
    if (!adminEnabled) {
      return res.status(503).json({ error: '\u540e\u53f0\u672a\u542f\u7528\uff0c\u8bf7\u914d\u7f6e\u7ba1\u7406\u5458\u4e0e\u4f1a\u8bdd\u5bc6\u94a5' });
    }
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '').trim();

    if (!username || !password) {
      return res.status(400).json({ error: '\u8bf7\u8f93\u5165\u8d26\u53f7\u548c\u5bc6\u7801' });
    }

    const user = db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: '\u8d26\u53f7\u6216\u5bc6\u7801\u9519\u8bef' });
    }

    const csrfToken = crypto.randomBytes(32).toString('hex');
    req.session.admin = { id: user.id, username: user.username, role: 'admin', csrfToken };
    return res.json({ loggedIn: true, username: user.username, csrfToken });
  });

  app.post('/api/admin/logout', requireAdmin, requireAdminCsrf, (req, res) => {
    req.session.destroy(() => {
      res.json({ loggedIn: false });
    });
  });
};
