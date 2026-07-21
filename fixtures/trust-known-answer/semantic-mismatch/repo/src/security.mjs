export const SECRET_PATTERNS = [
  '**/.env',
  '**/.ssh/**',
  '**/credentials.json',
];

export function secretPatternCount() {
  return SECRET_PATTERNS.length;
}
