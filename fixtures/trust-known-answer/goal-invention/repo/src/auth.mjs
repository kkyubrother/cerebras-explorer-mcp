export function isAuthenticated(session) {
  return Boolean(session?.userId);
}
