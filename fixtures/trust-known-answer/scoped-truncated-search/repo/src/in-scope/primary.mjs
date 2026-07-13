export function registerPrimary(app) {
  app.get('/primary', () => 'primary');
}
