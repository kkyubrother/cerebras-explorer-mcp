export function registerSecondary(app) {
  app.get('/secondary', () => 'secondary');
}
