import path from 'node:path';

export const DEFAULT_EXPLORER_MODEL = 'zai-glm-4.7';

export function getExplorerModel() {
  return (
    process.env.CEREBRAS_EXPLORER_MODEL?.trim() ||
    process.env.CEREBRAS_MODEL?.trim() ||
    DEFAULT_EXPLORER_MODEL
  );
}
export const DEFAULT_PROTOCOL_VERSION = '2025-06-18';

export const DEFAULT_IGNORE_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.turbo',
  '.vercel',
  '.cache',
  'coverage',
  'tmp',
  'temp',
  'vendor',
  'target',
  '.venv',
  'venv',
  '__pycache__',
  '.idea',
  '.vscode',
]);

export const DEFAULT_IGNORE_FILE_SUFFIXES = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.pdf',
  '.zip',
  '.gz',
  '.tar',
  '.7z',
  '.jar',
  '.class',
  '.lock',
  '.sqlite',
  '.db',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.mp4',
  '.mov',
  '.mp3',
  '.wav',
  '.ogg',
  '.bin',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
];

export const DEFAULT_TEXT_FILE_MAX_BYTES = 512 * 1024;
export const DEFAULT_GREP_FILE_MAX_BYTES = 256 * 1024;
export const DEFAULT_WALK_FILE_LIMIT = 5000;

export const BUDGETS = {
  quick: {
    label: 'quick',
    maxTurns: 6,
    maxSearchResults: 20,
    maxReadLines: 140,
    maxDirectoryEntries: 120,
    maxWalkFiles: 1500,
    reasoningEffort: 'none',
    maxCompletionTokens: 4000,
  },
  normal: {
    label: 'normal',
    maxTurns: 10,
    maxSearchResults: 40,
    maxReadLines: 220,
    maxDirectoryEntries: 200,
    maxWalkFiles: 3000,
    reasoningEffort: 'low',
    maxCompletionTokens: 6000,
  },
  deep: {
    label: 'deep',
    maxTurns: 16,
    maxSearchResults: 80,
    maxReadLines: 320,
    maxDirectoryEntries: 300,
    maxWalkFiles: 6000,
    reasoningEffort: 'medium',
    maxCompletionTokens: 8000,
  },
};

export function getBudgetConfig(label) {
  return BUDGETS[label] ?? BUDGETS.normal;
}

export function getRepoRoot(inputRepoRoot) {
  if (!inputRepoRoot || typeof inputRepoRoot !== 'string') {
    return process.cwd();
  }
  return path.resolve(process.cwd(), inputRepoRoot);
}

export function isTruthyEnv(value) {
  return value === '1' || value === 'true' || value === 'yes';
}
