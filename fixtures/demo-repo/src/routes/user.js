import { requireAuth } from '../auth.js';

export function registerUserRoutes(app) {
  app.get('/users/me', requireAuth, (req, res) => {
    res.json({ id: req.user.id });
  });
}
