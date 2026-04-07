export function requireAuth(req, res, next) {
  if (!req.user) {
    throw new Error('unauthorized');
  }
  next();
}

export const AUTH_HEADER = 'x-auth-token';
