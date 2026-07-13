export function registerLegacy(app) {
  app.get('/legacy', () => 'legacy');
}
