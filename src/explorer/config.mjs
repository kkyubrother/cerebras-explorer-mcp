import path from 'node:path';
import fs from 'node:fs/promises';
export { DEFAULT_SECRET_DENY_PATTERNS, isSecretPath, secretDenyListDisabled } from './security.mjs';

export const DEFAULT_EXPLORER_MODEL = 'zai-glm-4.7';
export const DEFAULT_PROTOCOL_VERSION = '2025-06-18';
export const DEFAULT_EXPLORER_TEMPERATURE = 1;
export const DEFAULT_EXPLORER_TOP_P = 0.95;
export const DEFAULT_EXPLORE_TURN_MULTIPLIER = 2;
export const DEFAULT_EXPLORE_MAX_EXTRA_TURNS = 30;
export const DEFAULT_EXPLORE_MAX_COMPACTIONS = 3;

function parseEnvNumber(name) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return null;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeModelId(model) {
  return String(model ?? '').trim().toLowerCase();
}

export function isGlm47Model(model) {
  return normalizeModelId(model).startsWith('zai-glm-4.7');
}

export function isGptOssModel(model) {
  return normalizeModelId(model).startsWith('gpt-oss');
}

export function getExplorerModel() {
  // spec 011: the `CEREBRAS_MODEL` alias was removed. Use `CEREBRAS_EXPLORER_MODEL` only.
  return process.env.CEREBRAS_EXPLORER_MODEL?.trim() || DEFAULT_EXPLORER_MODEL;
}

export function getExplorerTemperature() {
  return parseEnvNumber('CEREBRAS_EXPLORER_TEMPERATURE') ?? DEFAULT_EXPLORER_TEMPERATURE;
}

export function getExplorerTopP() {
  return parseEnvNumber('CEREBRAS_EXPLORER_TOP_P') ?? DEFAULT_EXPLORER_TOP_P;
}

export function getExploreTurnMultiplier() {
  const parsed = parseEnvNumber('CEREBRAS_EXPLORER_TURN_MULTIPLIER');
  if (parsed === null) {
    return DEFAULT_EXPLORE_TURN_MULTIPLIER;
  }
  return clampNumber(Math.round(parsed), 1, 4);
}

export function getExploreMaxExtraTurns() {
  const parsed = parseEnvNumber('CEREBRAS_EXPLORER_MAX_EXTRA_TURNS');
  if (parsed === null) {
    return DEFAULT_EXPLORE_MAX_EXTRA_TURNS;
  }
  return clampNumber(Math.round(parsed), 0, 200);
}

export function getExploreMaxCompactions() {
  const parsed = parseEnvNumber('CEREBRAS_EXPLORER_MAX_COMPACTIONS');
  if (parsed === null) {
    return DEFAULT_EXPLORE_MAX_COMPACTIONS;
  }
  return clampNumber(Math.round(parsed), 0, 10);
}

export function getExplorerReasoningFormat(model = getExplorerModel()) {
  const override = process.env.CEREBRAS_EXPLORER_REASONING_FORMAT?.trim();
  if (override) {
    return override;
  }
  return isGlm47Model(model) || isGptOssModel(model) ? 'parsed' : undefined;
}

export function getExplorerClearThinking(model = getExplorerModel()) {
  const raw = process.env.CEREBRAS_EXPLORER_CLEAR_THINKING;
  if (raw !== undefined && raw !== null) {
    return isTruthyEnv(raw);
  }
  return isGlm47Model(model) ? false : undefined;
}

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

// Fixed provider, context, and repository-tool ceilings. These values protect
// process correctness; callers cannot select or mutate an effort profile.
const RUNTIME_CONFIG = Object.freeze({
  maxTurns: 30,
  maxSearchResults: 80,
  maxReadLines: 320,
  maxDirectoryEntries: 300,
  maxWalkFiles: 6000,
  maxCompletionTokens: 32000,
  finalizeMaxCompletionTokens: 3000,
  // Working input limit, held under the Cerebras zai-glm-4.7 paid-tier context
  // window (131k tokens, max output 40k —
  // https://inference-docs.cerebras.ai/models/zai-glm-47). ~21k headroom is left
  // for the model's output/reasoning (finalize caps at 3k). Proactive compaction
  // fires at 70% (≈77k); see spec 024. Calibrated to the paid tier, not arbitrary.
  maxContextTokens: 110_000,
  temperature: 1.0,
  topP: 0.95,
});

export function getRuntimeConfig() {
  return RUNTIME_CONFIG;
}

function getPathModule(platform = process.platform) {
  return platform === 'win32' ? path.win32 : path.posix;
}

function toWindowsDrivePath(driveLetter, rest = '') {
  const normalizedRest = rest.replace(/\//g, '\\').replace(/^\\+/, '');
  return normalizedRest ? `${driveLetter.toUpperCase()}:\\${normalizedRest}` : `${driveLetter.toUpperCase()}:\\`;
}

function normalizeWindowsRepoRootInput(inputRepoRoot) {
  const trimmed = String(inputRepoRoot ?? '').trim();
  if (!trimmed) {
    return trimmed;
  }

  let match = trimmed.match(/^\/([a-zA-Z])(?:\/(.*))?$/);
  if (match) {
    return toWindowsDrivePath(match[1], match[2] ?? '');
  }

  match = trimmed.match(/^\/cygdrive\/([a-zA-Z])(?:\/(.*))?$/);
  if (match) {
    return toWindowsDrivePath(match[1], match[2] ?? '');
  }

  match = trimmed.match(/^\/mnt\/([a-zA-Z])(?:\/(.*))?$/);
  if (match) {
    return toWindowsDrivePath(match[1], match[2] ?? '');
  }

  return trimmed;
}

export function getRepoRoot(
  inputRepoRoot,
  { cwd = process.cwd(), platform = process.platform } = {},
) {
  const effectiveCwd = typeof cwd === 'string' && cwd.trim() ? cwd : process.cwd();
  if (!inputRepoRoot || typeof inputRepoRoot !== 'string' || !inputRepoRoot.trim()) {
    return effectiveCwd;
  }

  const pathModule = getPathModule(platform);
  const normalizedInput = platform === 'win32'
    ? normalizeWindowsRepoRootInput(inputRepoRoot)
    : inputRepoRoot.trim();

  return pathModule.resolve(effectiveCwd, normalizedInput);
}

export async function resolveRepoRoot(
  inputRepoRoot,
  { cwd = process.cwd(), platform = process.platform, realpathImpl = fs.realpath } = {},
) {
  const repoRoot = getRepoRoot(inputRepoRoot, { cwd, platform });
  const rawInput = typeof inputRepoRoot === 'string' ? inputRepoRoot.trim() : '';

  try {
    return await realpathImpl(repoRoot);
  } catch (error) {
    const detail = rawInput && rawInput !== repoRoot
      ? `${rawInput} -> ${repoRoot}`
      : repoRoot;
    const wrapped = new Error(`repo_root could not be resolved: ${detail}. ${error.message}`);
    wrapped.code = -32602;
    wrapped.repoRootError = 'unresolvable';
    wrapped.repoRootInput = rawInput || null;
    wrapped.repoRootResolved = repoRoot;
    throw wrapped;
  }
}

export function isTruthyEnv(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

/**
 * When set to a truthy value, the redaction layer masks environment-variable
 * identifiers (e.g. `process.env.X`, `import.meta.env.Y`) in snippet/report
 * text in addition to secret values and secret paths. Default off — the
 * modern behavior preserves identifier names because they describe a public
 * code interface, not a secret value.
 */
export function redactEnvVarNamesEnabled(env = process.env) {
  return isTruthyEnv(env.CEREBRAS_EXPLORER_REDACT_ENV_VAR_NAMES);
}

/**
 * Resolve the reasoning effort hint for the selected model under the single
 * runtime config. GLM 4.7 leaves the parameter unset (model default behavior).
 * GPT-OSS uses the high effort tier. Other models leave the parameter unset.
 */
export function getReasoningEffortForModel(model) {
  if (isGlm47Model(model)) return undefined;
  if (isGptOssModel(model)) return 'high';
  return undefined;
}

/**
 * Load the project-level configuration file from the repository root.
 *
 * Looks for `.cerebras-explorer.json` in `repoRoot`. Returns an empty object
 * when the file is absent, unreadable, or contains invalid JSON.
 *
 * Recognised fields (all optional):
 *   defaultScope        — string[] of glob patterns
 *   extraIgnoreDirs     — string[] of directory names to skip during traversal
 *   extraIgnorePatterns — string[] of repo-root-relative glob patterns to skip (spec 014)
 *   projectContext      — string injected into the explorer's system prompt
 *   entryPoints         — string[] of key entry-point file paths (used by codeMap and breadth-first exploration)
 *   keyFiles            — string[] of important files (searched first on arch queries)
 *
 * @param {string} repoRoot
 * @returns {Promise<object>}
 */
export async function loadProjectConfig(repoRoot) {
  const configPath = path.join(repoRoot, '.cerebras-explorer.json');
  try {
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // File not found, not readable, or invalid JSON — silently use defaults.
  }
  return {};
}

/**
 * Validate and normalise a raw project config object into a known shape.
 * Unknown fields are dropped; type errors are coerced or silently ignored.
 */
export function normalizeProjectConfig(raw) {
  if (!raw || typeof raw !== 'object') return {};

  const config = {};

  if (Array.isArray(raw.defaultScope)) {
    config.defaultScope = raw.defaultScope.filter(s => typeof s === 'string');
  }
  if (Array.isArray(raw.extraIgnoreDirs)) {
    config.extraIgnoreDirs = raw.extraIgnoreDirs.filter(s => typeof s === 'string');
  }
  if (Array.isArray(raw.extraIgnorePatterns)) {
    // Spec 014: path glob patterns evaluated with the same semantics as the
    // root .gitignore matcher. Drop non-string entries silently (same policy
    // as extraIgnoreDirs).
    config.extraIgnorePatterns = raw.extraIgnorePatterns.filter(s => typeof s === 'string');
  }
  if (typeof raw.projectContext === 'string' && raw.projectContext.trim()) {
    config.projectContext = raw.projectContext.trim();
  }
  if (Array.isArray(raw.entryPoints)) {
    config.entryPoints = raw.entryPoints.filter(s => typeof s === 'string');
  }
  if (Array.isArray(raw.keyFiles)) {
    config.keyFiles = raw.keyFiles.filter(s => typeof s === 'string');
  }

  return config;
}
