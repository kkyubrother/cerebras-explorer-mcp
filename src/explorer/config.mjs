import path from 'node:path';
import fs from 'node:fs/promises';

export const DEFAULT_EXPLORER_MODEL = 'zai-glm-4.7';
export const DEFAULT_PROTOCOL_VERSION = '2025-06-18';
export const DEFAULT_EXPLORER_TEMPERATURE = 1;
export const DEFAULT_EXPLORER_TOP_P = 0.95;
export const DEFAULT_EXPLORE_V2_TURN_MULTIPLIER = 2;
export const DEFAULT_EXPLORE_V2_MAX_EXTRA_TURNS = 30;
export const DEFAULT_EXPLORE_V2_MAX_COMPACTIONS = 3;

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
  return (
    process.env.CEREBRAS_EXPLORER_MODEL?.trim() ||
    process.env.CEREBRAS_MODEL?.trim() ||
    DEFAULT_EXPLORER_MODEL
  );
}

export function getExplorerTemperature() {
  return parseEnvNumber('CEREBRAS_EXPLORER_TEMPERATURE') ?? DEFAULT_EXPLORER_TEMPERATURE;
}

export function getExplorerTopP() {
  return parseEnvNumber('CEREBRAS_EXPLORER_TOP_P') ?? DEFAULT_EXPLORER_TOP_P;
}

export function getExploreV2TurnMultiplier() {
  const parsed = parseEnvNumber('CEREBRAS_EXPLORER_V2_TURN_MULTIPLIER');
  if (parsed === null) {
    return DEFAULT_EXPLORE_V2_TURN_MULTIPLIER;
  }
  return clampNumber(Math.round(parsed), 1, 4);
}

export function getExploreV2MaxExtraTurns() {
  const parsed = parseEnvNumber('CEREBRAS_EXPLORER_V2_MAX_EXTRA_TURNS');
  if (parsed === null) {
    return DEFAULT_EXPLORE_V2_MAX_EXTRA_TURNS;
  }
  return clampNumber(Math.round(parsed), 0, 200);
}

export function getExploreV2MaxCompactions() {
  const parsed = parseEnvNumber('CEREBRAS_EXPLORER_V2_MAX_COMPACTIONS');
  if (parsed === null) {
    return DEFAULT_EXPLORE_V2_MAX_COMPACTIONS;
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

export const BUDGETS = {
  quick: {
    label: 'quick',
    maxTurns: 10,
    maxSearchResults: 20,
    maxReadLines: 140,
    maxDirectoryEntries: 120,
    maxWalkFiles: 1500,
    maxCompletionTokens: 8000,
    finalizeMaxCompletionTokens: 1500,
    maxContextTokens: 80_000,
    temperature: 0.3,
    topP: 0.95,
  },
  normal: {
    label: 'normal',
    maxTurns: 20,
    maxSearchResults: 40,
    maxReadLines: 220,
    maxDirectoryEntries: 200,
    maxWalkFiles: 3000,
    maxCompletionTokens: 16000,
    finalizeMaxCompletionTokens: 2000,
    maxContextTokens: 100_000,
    temperature: 0.8,
    topP: 0.95,
  },
  deep: {
    label: 'deep',
    maxTurns: 30,
    maxSearchResults: 80,
    maxReadLines: 320,
    maxDirectoryEntries: 300,
    maxWalkFiles: 6000,
    maxCompletionTokens: 32000,
    finalizeMaxCompletionTokens: 3000,
    maxContextTokens: 110_000,
    temperature: 1.0,
    topP: 0.95,
  },
};

export function getBudgetConfig(label) {
  return BUDGETS[label] ?? BUDGETS.normal;
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
 * Return the model to use for a given budget label.
 * Reads budget-specific env vars first, then falls back to the global model.
 *
 * Env vars:
 *   CEREBRAS_EXPLORER_MODEL_QUICK   — model for quick budget
 *   CEREBRAS_EXPLORER_MODEL_NORMAL  — model for normal budget
 *   CEREBRAS_EXPLORER_MODEL_DEEP    — model for deep budget
 */
export function getModelForBudget(budget) {
  if (budget === 'quick') {
    return process.env.CEREBRAS_EXPLORER_MODEL_QUICK?.trim() || getExplorerModel();
  }
  if (budget === 'deep') {
    return process.env.CEREBRAS_EXPLORER_MODEL_DEEP?.trim() || getExplorerModel();
  }
  return process.env.CEREBRAS_EXPLORER_MODEL_NORMAL?.trim() || getExplorerModel();
}

/**
 * Resolve reasoning settings for the selected model and exploration budget.
 *
 * GLM 4.7 only supports `reasoning_effort="none"` to disable reasoning.
 * Normal and deep budgets therefore leave the parameter unset, which keeps
 * reasoning enabled with the model default behavior.
 *
 * GPT-OSS supports the classic low/medium/high ladder.
 */
export function getReasoningEffortForBudget(model, budget) {
  const label = BUDGETS[budget] ? budget : 'normal';

  if (isGlm47Model(model)) {
    return label === 'quick' ? 'none' : undefined;
  }

  if (isGptOssModel(model)) {
    if (label === 'quick') return 'low';
    if (label === 'deep') return 'high';
    return 'medium';
  }

  return undefined;
}

/**
 * Classify the complexity of a task string as 'simple', 'moderate', or 'complex'.
 * Used for automatic model routing when CEREBRAS_EXPLORER_AUTO_ROUTE=true.
 *
 * - simple:   "where is X defined?" type questions → cheapest/fastest model
 * - complex:  performance/security/bug-cause analysis → most capable model
 * - moderate: everything else → normal model
 */
export function classifyTaskComplexity(task) {
  const t = task.toLowerCase();
  if (
    /어디\s|찾아|위치|선언|정의\s|defined|where\s|find\s|locate|definition/.test(t)
  ) {
    return 'simple';
  }
  if (
    /원인|왜\s|버그|보안|성능|취약|race.*cond|security|vulnerabilit|performance|memory.?leak|오류.*원인|bug.*cause/.test(t)
  ) {
    return 'complex';
  }
  return 'moderate';
}

export function chooseAutoBudget({ task = '', scope = [], hints = {} } = {}) {
  const text = String(task ?? '').toLowerCase();
  const hasAnchors =
    (Array.isArray(hints?.symbols) && hints.symbols.length > 0) ||
    (Array.isArray(hints?.files) && hints.files.length > 0) ||
    (Array.isArray(hints?.regex) && hints.regex.length > 0);

  if (hasAnchors) return 'quick';

  if (/어디\s|찾아|위치|선언|정의\s|defined|where\s|find\s|locate|definition/.test(text)) {
    return 'quick';
  }

  if (
    /architecture|overview|impact|root cause|bug|security|performance|아키텍처|개요|영향|원인|버그|보안|성능/.test(text)
  ) {
    return 'normal';
  }

  if (Array.isArray(scope) && scope.length === 1 && typeof scope[0] === 'string' && scope[0].trim()) {
    return 'quick';
  }

  return 'normal';
}

/**
 * Load the project-level configuration file from the repository root.
 *
 * Looks for `.cerebras-explorer.json` in `repoRoot`. Returns an empty object
 * when the file is absent, unreadable, or contains invalid JSON.
 *
 * Recognised fields (all optional):
 *   defaultBudget       — "quick"|"normal"|"deep"
 *   defaultScope        — string[] of glob patterns
 *   extraIgnoreDirs     — string[] of directory names to skip during traversal
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

  if (['quick', 'normal', 'deep'].includes(raw.defaultBudget)) {
    config.defaultBudget = raw.defaultBudget;
  }
  if (Array.isArray(raw.defaultScope)) {
    config.defaultScope = raw.defaultScope.filter(s => typeof s === 'string');
  }
  if (Array.isArray(raw.extraIgnoreDirs)) {
    config.extraIgnoreDirs = raw.extraIgnoreDirs.filter(s => typeof s === 'string');
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
