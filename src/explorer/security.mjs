function toPosixPath(input) {
  return String(input ?? '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/');
}

function escapeRegex(input) {
  return input.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function globToRegExp(glob) {
  const normalized = toPosixPath(glob);
  let pattern = '';
  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    if (char === '*') {
      const next = normalized[i + 1];
      const afterNext = normalized[i + 2];
      if (next === '*' && afterNext === '/') {
        pattern += '(?:.*/)?';
        i += 2;
        continue;
      }
      if (next === '*') {
        pattern += '.*';
        i += 1;
        continue;
      }
      pattern += '[^/]*';
      continue;
    }
    if (char === '?') {
      pattern += '[^/]';
      continue;
    }
    pattern += escapeRegex(char);
  }
  return new RegExp(`^${pattern}$`);
}

export const DEFAULT_SECRET_DENY_PATTERNS = Object.freeze([
  '.env',
  '.env.*',
  '.envrc',
  '**/.env',
  '**/.env.*',
  '**/.envrc',
  'id_rsa',
  'id_rsa.pub',
  'id_ed25519',
  'id_ed25519.pub',
  'id_ecdsa',
  'id_ecdsa.pub',
  '.ssh',
  '**/.ssh',
  '.ssh/**',
  '**/.ssh/**',
  '.gnupg',
  '**/.gnupg',
  '.gnupg/**',
  '**/.gnupg/**',
  '*.pem',
  '**/*.pem',
  '*.key',
  '**/*.key',
  '*.p12',
  '**/*.p12',
  '*.pfx',
  '**/*.pfx',
  '.aws/credentials',
  '**/.aws/credentials',
  '.aws/config',
  '**/.aws/config',
  '.aws',
  '**/.aws',
  '.azure',
  '**/.azure',
  '.azure/**',
  '**/.azure/**',
  'gcloud',
  '**/gcloud',
  'gcloud/credentials**',
  '**/gcloud/credentials**',
  '.netrc',
  '**/.netrc',
  '.npmrc',
  '**/.npmrc',
  '.pypirc',
  '**/.pypirc',
  '.git/config',
  '**/.git/config',
  '.git/credentials',
  '**/.git/credentials',
  '.git/hooks',
  '**/.git/hooks',
  '.git/hooks/**',
  '**/.git/hooks/**',
  'secrets',
  '**/secrets',
  'secrets/**',
  '**/secrets/**',
  'credentials.json',
  '**/credentials.json',
  'credentials.yaml',
  '**/credentials.yaml',
  'credentials.yml',
  '**/credentials.yml',
]);

const COMPILED_SECRET_DENY_PATTERNS = DEFAULT_SECRET_DENY_PATTERNS.map(pattern => ({
  pattern,
  regex: globToRegExp(pattern),
}));

export function secretDenyListDisabled(env = process.env) {
  return env.CEREBRAS_EXPLORER_DISABLE_SECRET_DENY_LIST === '1';
}

export function isSecretPath(relPath, {
  patterns = COMPILED_SECRET_DENY_PATTERNS,
  env = process.env,
} = {}) {
  if (secretDenyListDisabled(env)) return { matched: false };
  const normalized = toPosixPath(relPath);
  if (!normalized || normalized === '.') return { matched: false };

  for (const entry of patterns) {
    const pattern = typeof entry === 'string' ? entry : entry.pattern;
    const regex = typeof entry === 'string' ? globToRegExp(entry) : entry.regex;
    if (regex.test(normalized)) {
      return { matched: true, pattern };
    }
  }
  return { matched: false };
}

export function secretDeniedResult(relPath, match = isSecretPath(relPath)) {
  return {
    error: 'redacted_by_policy',
    reason: 'secret-deny-list',
    path: toPosixPath(relPath),
    pattern: match.pattern,
  };
}
