#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import {
  FIXTURE_TRUST_EVALUATION_PROFILE,
  LIVE_TRUST_EVALUATION_PROFILE,
  evaluateTrustCase,
  evaluateTrustRepeatability,
} from '../src/benchmark/evaluator.mjs';
import { buildOracleParentHandoff } from '../src/benchmark/oracle-parent-handoff.mjs';
import { buildParentPayload, measureParentPayload } from '../src/explorer/parent-payload.mjs';
import { redactText } from '../src/explorer/redact.mjs';
import { ExplorerRuntime } from '../src/explorer/runtime.mjs';
import { sanitizeBenchmarkReport } from '../src/benchmark/report.mjs';

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url));
const EMPTY_SHA256 = createHash('sha256').digest('hex');
const MAX_GIT_OUTPUT_BYTES = 256 * 1024 * 1024;
const LIVE_RESUME_PROFILE = 'live-resume-v1';
const RUNTIME_PROJECT_CONFIG = '.cerebras-explorer.json';
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const BEHAVIOR_ENV_NAMES = Object.freeze([
  'CEREBRAS_API_BASE_URL',
  'CEREBRAS_EXPLORER_CLEAR_THINKING',
  'CEREBRAS_EXPLORER_DISABLE_SECRET_DENY_LIST',
  'CEREBRAS_EXPLORER_HTTP_TIMEOUT_MS',
  'CEREBRAS_EXPLORER_MODEL',
  'CEREBRAS_EXPLORER_REASONING_FORMAT',
  'CEREBRAS_EXPLORER_REDACT_ENV_VAR_NAMES',
  'CEREBRAS_EXPLORER_REDACT_GENERIC_HEX',
  'CEREBRAS_EXPLORER_TEMPERATURE',
  'CEREBRAS_EXPLORER_TOP_P',
  'EXPLORER_FAILOVER',
  'EXPLORER_FAILOVER_TIMEOUT_MS',
  'EXPLORER_OPENAI_BASE_URL',
  'EXPLORER_OPENAI_MODEL',
  'EXPLORER_PROVIDER',
]);

function requireOptionValue(argv, index, option) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

export function parseArgs(argv) {
  const options = {
    suite: 'benchmarks/trust-known-answer.json',
    mode: 'fixture',
    repoMap: null,
    output: null,
    resumeFrom: null,
    repeats: null,
    verbose: false,
    measurePayload: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--suite') options.suite = requireOptionValue(argv, index++, arg);
    else if (arg === '--mode') options.mode = requireOptionValue(argv, index++, arg);
    else if (arg === '--repo-map') options.repoMap = requireOptionValue(argv, index++, arg);
    else if (arg === '--output') options.output = requireOptionValue(argv, index++, arg);
    else if (arg === '--resume-from') {
      options.resumeFrom = requireOptionValue(argv, index++, arg);
    }
    else if (arg === '--repeats') {
      const value = requireOptionValue(argv, index++, arg);
      options.repeats = Number(value);
      if (!Number.isSafeInteger(options.repeats) || options.repeats < 1) {
        throw new Error('--repeats must be a positive integer.');
      }
    } else if (arg === '--verbose') options.verbose = true;
    else if (arg === '--measure-payload') options.measurePayload = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!['fixture', 'live'].includes(options.mode)) {
    throw new Error('--mode must be fixture or live.');
  }
  if (options.mode === 'live' && !options.repoMap && !options.help) {
    throw new Error('--repo-map is required in live mode.');
  }
  if (options.resumeFrom && options.mode !== 'live') {
    throw new Error('--resume-from is available only in live mode.');
  }
  if (options.resumeFrom && options.output) {
    const resumePath = path.resolve(options.resumeFrom);
    const outputPath = path.resolve(options.output);
    const samePath = process.platform === 'win32'
      ? resumePath.toLocaleLowerCase('en') === outputPath.toLocaleLowerCase('en')
      : resumePath === outputPath;
    if (samePath) throw new Error('--resume-from and --output must use different files.');
  }
  return options;
}

function printHelp() {
  console.log([
    'Usage: node scripts/run-trust-suite.mjs [options]',
    '',
    'Options:',
    '  --suite <path>          Trust-suite manifest. Default: benchmarks/trust-known-answer.json',
    '  --mode fixture|live     Run pinned fixtures or mapped live repositories. Default: fixture',
    '  --repo-map <path>       JSON object mapping logical repo ids to roots (required for live)',
    '  --output <path>         Write the redacted JSON report',
    '  --resume-from <path>    Resume live run slots from a compatible prior report',
    '  --repeats <count>       Repeat cases declared repeatable this many times',
    '  --verbose               Print per-case violations and record-only measurements',
    '  --measure-payload       Record schema-v3 payload size and available v2 reduction',
    '  --help                  Show this help text',
  ].join('\n'));
}

export function normalizeLfBytes(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const output = [];
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] !== 13) {
      output.push(bytes[index]);
      continue;
    }
    if (bytes[index + 1] === 10) index += 1;
    output.push(10);
  }
  return Buffer.from(output);
}

export function canonicalFileSha256(input) {
  return createHash('sha256').update(normalizeLfBytes(input)).digest('hex');
}

function jsonSha256(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function runtimeConfigSha256(env = process.env) {
  return jsonSha256(BEHAVIOR_ENV_NAMES.map(name => [
    name,
    Object.hasOwn(env, name) ? String(env[name]) : null,
  ]));
}

async function walkRegularFiles(root, relativeRoot = '') {
  const files = [];
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const relativePath = relativeRoot ? `${relativeRoot}/${entry.name}` : entry.name;
    const absolutePath = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Fixture tree contains a symlink: ${relativePath}`);
    if (entry.isDirectory()) {
      files.push(...await walkRegularFiles(absolutePath, relativePath));
    } else if (entry.isFile()) {
      files.push({ absolutePath, relativePath });
    } else {
      throw new Error(`Fixture tree contains a non-regular entry: ${relativePath}`);
    }
  }
  return files;
}

export async function fixtureTreeSha256(root) {
  const files = await walkRegularFiles(root);
  files.sort((left, right) => left.relativePath === right.relativePath
    ? 0
    : left.relativePath < right.relativePath ? -1 : 1);
  const hash = createHash('sha256');
  for (const file of files) {
    const content = normalizeLfBytes(await fs.readFile(file.absolutePath));
    hash.update(file.relativePath);
    hash.update('\0');
    hash.update(String(content.length));
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
  }
  return hash.digest('hex');
}

function sanitizedGitEnvironment(overrides = {}) {
  const environment = { ...process.env, ...overrides };
  for (const key of Object.keys(environment)) {
    if (/^GIT_CONFIG_(?:KEY|VALUE)_\d+$/u.test(key) || [
      'GIT_DIR',
      'GIT_WORK_TREE',
      'GIT_INDEX_FILE',
      'GIT_OBJECT_DIRECTORY',
      'GIT_ALTERNATE_OBJECT_DIRECTORIES',
      'GIT_COMMON_DIR',
      'GIT_CEILING_DIRECTORIES',
      'GIT_TEMPLATE_DIR',
      'GIT_CONFIG_COUNT',
      'GIT_CONFIG_SYSTEM',
      'GIT_CONFIG_GLOBAL',
    ].includes(key)) delete environment[key];
  }
  environment.GIT_CONFIG_NOSYSTEM = '1';
  environment.GIT_CONFIG_GLOBAL = process.platform === 'win32' ? 'NUL' : '/dev/null';
  return environment;
}

async function runGit(repoRoot, args, options = {}) {
  const { env, ...rest } = options;
  const { stdout } = await execFileAsync('git', ['-C', repoRoot, ...args], {
    encoding: null,
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    windowsHide: true,
    ...rest,
    env: sanitizedGitEnvironment(env),
  });
  return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
}

export async function prepareFixtureRepository(repoRoot, fixtureSetup) {
  if (fixtureSetup === undefined) {
    return { repoRoot, cleanup: async () => {} };
  }
  if (!fixtureSetup || fixtureSetup.kind !== 'deterministic_git_commit') {
    throw new Error('Unsupported fixture setup.');
  }

  const requiredText = ['message', 'name', 'email', 'date', 'headSha'];
  const setupKeys = Object.keys(fixtureSetup).sort();
  const expectedKeys = ['date', 'email', 'headSha', 'kind', 'message', 'name'];
  if (setupKeys.length !== expectedKeys.length ||
      setupKeys.some((key, index) => key !== expectedKeys[index]) ||
      requiredText.some(key => typeof fixtureSetup[key] !== 'string' || !fixtureSetup[key])) {
    throw new Error('Deterministic Git fixture setup is incomplete.');
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(fixtureSetup.date) ||
      !/^[0-9a-f]{40}$/.test(fixtureSetup.headSha)) {
    throw new Error('Deterministic Git fixture setup has an invalid pin.');
  }

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-trust-git-'));
  const preparedRoot = path.join(tempRoot, 'repo');
  const hooksRoot = path.join(tempRoot, 'hooks');
  try {
    await fs.cp(repoRoot, preparedRoot, { recursive: true });
    await fs.mkdir(hooksRoot);
    await runGit(preparedRoot, ['init', '--quiet', '--object-format=sha1']);
    await runGit(preparedRoot, ['config', 'core.autocrlf', 'false']);
    await runGit(preparedRoot, ['config', 'core.filemode', 'false']);
    await runGit(preparedRoot, ['config', 'core.hooksPath', hooksRoot]);
    await runGit(preparedRoot, ['config', 'commit.gpgsign', 'false']);
    await runGit(preparedRoot, ['config', 'user.name', fixtureSetup.name]);
    await runGit(preparedRoot, ['config', 'user.email', fixtureSetup.email]);
    await runGit(preparedRoot, ['add', '--', '.']);
    const commitEnvironment = {
      GIT_AUTHOR_NAME: fixtureSetup.name,
      GIT_AUTHOR_EMAIL: fixtureSetup.email,
      GIT_AUTHOR_DATE: fixtureSetup.date,
      GIT_COMMITTER_NAME: fixtureSetup.name,
      GIT_COMMITTER_EMAIL: fixtureSetup.email,
      GIT_COMMITTER_DATE: fixtureSetup.date,
    };
    await runGit(preparedRoot, ['commit', '--quiet', '-m', fixtureSetup.message], {
      env: commitEnvironment,
    });
    const headSha = (await runGit(preparedRoot, ['rev-parse', 'HEAD'])).toString('utf8').trim();
    if (headSha !== fixtureSetup.headSha) {
      throw new Error('Deterministic Git fixture setup did not reproduce its manifest pin.');
    }
    const status = (await runGit(preparedRoot, [
      'status', '--porcelain=v1', '--untracked-files=all',
    ])).toString('utf8');
    if (status !== '') throw new Error('Deterministic Git fixture setup is not clean.');
    return {
      repoRoot: preparedRoot,
      fixtureSetupHeadSha: headSha,
      cleanup: () => fs.rm(tempRoot, { recursive: true, force: true }),
    };
  } catch (error) {
    await fs.rm(tempRoot, { recursive: true, force: true });
    throw error;
  }
}

function splitNullTerminated(buffer) {
  const values = [];
  let start = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] !== 0) continue;
    if (index > start) values.push(buffer.subarray(start, index));
    start = index + 1;
  }
  if (start < buffer.length) values.push(buffer.subarray(start));
  return values;
}

export async function dirtyTreeSha256(repoRoot) {
  const trackedDiff = normalizeLfBytes(await runGit(
    repoRoot,
    ['diff', '--binary', '--no-ext-diff', 'HEAD', '--', '.'],
  ));
  const ordinaryUntrackedPaths = splitNullTerminated(await runGit(
    repoRoot,
    ['ls-files', '--others', '--exclude-standard', '-z'],
  ));
  const ignoredRuntimeConfigPaths = splitNullTerminated(await runGit(
    repoRoot,
    ['ls-files', '--others', '--ignored', '--exclude-standard', '-z', '--', RUNTIME_PROJECT_CONFIG],
  ));
  const untrackedPaths = [...new Map([
    ...ordinaryUntrackedPaths,
    ...ignoredRuntimeConfigPaths,
  ].map(value => [value.toString('hex'), value])).values()].sort(Buffer.compare);

  if (trackedDiff.length === 0 && untrackedPaths.length === 0) return EMPTY_SHA256;

  const hash = createHash('sha256').update(trackedDiff);
  for (const pathBytes of untrackedPaths) {
    const relativePath = pathBytes.toString('utf8');
    const absolutePath = path.resolve(repoRoot, ...relativePath.split('/'));
    const stat = await fs.lstat(absolutePath);
    if (!stat.isFile()) throw new Error('Dirty-tree pin only accepts regular untracked files.');
    const content = normalizeLfBytes(await fs.readFile(absolutePath));
    hash.update(pathBytes);
    hash.update('\0');
    hash.update(String(content.length));
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
  }
  return hash.digest('hex');
}

function safeProjectPath(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath)) {
    throw new Error('Manifest paths must be non-empty repository-relative paths.');
  }
  const parts = relativePath.replaceAll('\\', '/').split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) {
    throw new Error('Manifest path crosses the project boundary.');
  }
  const resolved = path.resolve(PROJECT_ROOT, ...parts);
  const relative = path.relative(PROJECT_ROOT, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Manifest path crosses the project boundary.');
  }
  return resolved;
}

async function loadManifest(suitePath) {
  const resolved = path.resolve(suitePath);
  const bytes = await fs.readFile(resolved);
  const manifest = JSON.parse(bytes.toString('utf8'));
  if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.cases) ||
      !manifest.sources || typeof manifest.sources !== 'object') {
    throw new Error('Trust suite requires sources and a non-empty cases array.');
  }
  if (manifest.cases.length === 0) throw new Error('Trust suite has no cases.');
  return { manifest, sha256: canonicalFileSha256(bytes) };
}

async function loadRepoMap(repoMapPath) {
  const parsed = JSON.parse(await fs.readFile(path.resolve(repoMapPath), 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Repo map must be a JSON object.');
  }
  const entries = Object.entries(parsed);
  if (entries.some(([key, value]) => !key || typeof value !== 'string' || !path.isAbsolute(value))) {
    throw new Error('Repo map values must be absolute repository paths.');
  }
  const normalized = new Map();
  for (const [key, value] of entries) {
    const lookup = key.toLocaleLowerCase('en');
    if (normalized.has(lookup)) throw new Error(`Duplicate logical repo id: ${key}`);
    normalized.set(lookup, path.resolve(value));
  }
  return normalized;
}

function mappedRepoRoot(source, repoMap) {
  const repoId = String(source.repoId ?? '');
  const direct = repoMap.get(repoId.toLocaleLowerCase('en'));
  if (direct) return direct;
  if (repoId === 'cerebras-explorer-mcp') return repoMap.get('self') ?? null;
  return null;
}

function selectCases(manifest, mode) {
  return manifest.cases.filter(caseDefinition => {
    const source = manifest.sources[caseDefinition.sourceRef];
    if (mode === 'fixture') {
      return source?.kind === 'fixture' && caseDefinition.fixtureExecution === 'direct';
    }
    return source?.kind === 'repository' && !caseDefinition.oracle?.transportExpectation;
  });
}

export function repeatCountForCase(caseDefinition, override) {
  if (override === null || override === undefined) return caseDefinition.repeatCount ?? 1;
  return (caseDefinition.repeatCount ?? 1) > 1 ? override : 1;
}

export function evaluationOptionsForCase(mode, caseDefinition) {
  if (mode === 'fixture') {
    return { mode, profile: FIXTURE_TRUST_EVALUATION_PROFILE };
  }
  return { mode, profile: caseDefinition?.livePolicy?.profile ?? null };
}

function selectedCasePlan(manifest, selected, options) {
  const plan = selected.map(caseDefinition => ({
    id: caseDefinition.id,
    sourceRef: caseDefinition.sourceRef,
    repoId: manifest.sources[caseDefinition.sourceRef]?.repoId,
    runCount: repeatCountForCase(caseDefinition, options.repeats),
  }));
  if (plan.some(item => typeof item.id !== 'string' || !item.id) ||
      new Set(plan.map(item => item.id)).size !== plan.length) {
    throw new Error('Selected trust cases require unique non-empty ids.');
  }
  if (plan.some(item => !Number.isSafeInteger(item.runCount) || item.runCount < 1)) {
    throw new Error('Selected trust cases require a positive integer run count.');
  }
  return plan;
}

async function buildLiveCheckpointBase({ manifestSha256, selectedCases, measurePayload }) {
  const gitSha = (await runGit(PROJECT_ROOT, ['rev-parse', 'HEAD']))
    .toString('utf8').trim();
  return {
    profile: LIVE_RESUME_PROFILE,
    manifestSha256,
    runnerPin: {
      gitSha,
      dirtyTreeSha256: await dirtyTreeSha256(PROJECT_ROOT),
    },
    runtimeConfigSha256: runtimeConfigSha256(),
    selectedCases,
    measurePayload: Boolean(measurePayload),
  };
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function loadResumeReport(resumePath) {
  try {
    const parsed = JSON.parse(await fs.readFile(path.resolve(resumePath), 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new Error('Resume report could not be read as JSON.');
  }
}

function validateResumeCheckpoint(report, checkpointBase, suiteName) {
  const checkpoint = report?.checkpoint;
  const expectedCheckpointKeys = [
    'casesSha256',
    'manifestSha256',
    'measurePayload',
    'profile',
    'runnerPin',
    'runtimeConfigSha256',
    'selectedCases',
  ];
  if (report?.schemaVersion !== 2 || report.mode !== 'live' || report.suite !== suiteName ||
      !Array.isArray(report.cases) || !hasExactKeys(checkpoint, expectedCheckpointKeys) ||
      checkpoint.profile !== LIVE_RESUME_PROFILE ||
      !hasExactKeys(checkpoint.runnerPin, ['dirtyTreeSha256', 'gitSha']) ||
      !SHA256_PATTERN.test(checkpoint.casesSha256) ||
      !SHA256_PATTERN.test(checkpoint.manifestSha256) ||
      !SHA256_PATTERN.test(checkpoint.runnerPin.dirtyTreeSha256) ||
      !/^[0-9a-f]{40,64}$/u.test(checkpoint.runnerPin.gitSha) ||
      !SHA256_PATTERN.test(checkpoint.runtimeConfigSha256)) {
    throw new Error('Resume report does not contain a valid live checkpoint.');
  }
  if (checkpoint.casesSha256 !== jsonSha256(report.cases)) {
    // This is corruption detection for a trusted local report, not authentication.
    throw new Error('Resume report case data does not match its checkpoint.');
  }
  for (const [key, value] of Object.entries(checkpointBase)) {
    if (!sameJson(checkpoint[key], value)) {
      throw new Error('Resume checkpoint is incompatible with the current live run.');
    }
  }
}

function responseSchemaRequired(request) {
  const wrapped = request.responseFormat?.json_schema;
  const schema = wrapped?.schema ?? wrapped;
  return Array.isArray(schema?.required) ? schema.required : [];
}

function classifyProviderStage(request, plannerCallCount) {
  const messages = Array.isArray(request.messages) ? request.messages : [];
  if (messages.some(message => typeof message?.content === 'string' &&
      message.content.includes('BEGIN_EVIDENCE_REPAIR_JSON'))) return 'repair';
  const required = responseSchemaRequired(request);
  if (required.includes('taskSummary') && required.includes('subgoals')) {
    return plannerCallCount === 0 ? 'planner' : 'plan_revision';
  }
  if (required.includes('goals') && required.includes('uncoveredRequestParts')) return 'goal_audit';
  if (required.includes('findings') && required.includes('uncoveredRequestParts')) return 'goal_coverage';
  if (required.includes('claims')) return 'claim_synthesis';
  if (required.includes('verdicts') && required.includes('uncoveredRequestParts')) {
    return 'semantic_verifier';
  }
  if (request.responseFormat) return 'synthesis';
  return 'exploration';
}

function normalizeFixtureCompletion(result) {
  const message = structuredClone(result.message);
  message.content = typeof message.content === 'string'
    ? message.content
    : JSON.stringify(message.content);
  message.toolCalls = message.toolCalls.map(toolCall => ({
    ...toolCall,
    function: {
      ...toolCall.function,
      arguments: typeof toolCall.function?.arguments === 'string'
        ? toolCall.function.arguments
        : JSON.stringify(toolCall.function?.arguments ?? {}),
    },
  }));
  return {
    usage: result.usage ?? { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
    finishReason: result.finishReason ?? (message.toolCalls.length > 0 ? 'tool_calls' : 'stop'),
    message,
  };
}

class SequentialFixtureClient {
  constructor(document) {
    if (!Array.isArray(document?.responses) || document.responses.length === 0) {
      throw new Error('Provider fixture has no responses.');
    }
    this.model = 'pinned-trust-fixture';
    this.responses = document.responses;
    this.cursor = 0;
    this.plannerCallCount = 0;
    this.abortPending = new Promise(resolve => { this.resolveAbortPending = resolve; });
  }

  async createChatCompletion(request) {
    const stage = classifyProviderStage(request, this.plannerCallCount);
    if (stage === 'planner' || stage === 'plan_revision') this.plannerCallCount += 1;
    const response = this.responses[this.cursor];
    if (!response) throw new Error(`Provider fixture ended before stage ${stage}.`);
    if (response.stage !== stage) {
      throw new Error(`Provider fixture expected stage ${response.stage}, received ${stage}.`);
    }
    this.cursor += 1;
    if (response.waitForAbort === true) {
      if (!request.signal) throw new Error('Abort fixture did not receive an abort signal.');
      this.resolveAbortPending();
      await new Promise((resolve, reject) => {
        const abort = () => {
          const error = new Error('fixture request aborted');
          error.name = 'AbortError';
          reject(error);
        };
        if (request.signal.aborted) abort();
        else request.signal.addEventListener('abort', abort, { once: true });
      });
      throw new Error('Abort fixture unexpectedly continued.');
    }
    if (response.error) {
      const error = new Error(response.error.message);
      error.name = response.error.name ?? 'Error';
      if (typeof response.error.retryable === 'boolean') error.retryable = response.error.retryable;
      throw error;
    }
    return normalizeFixtureCompletion(response.result);
  }

  assertConsumed() {
    if (this.cursor !== this.responses.length) {
      throw new Error('Provider fixture was not fully consumed.');
    }
  }
}

function cleanStrings(value) {
  return Array.isArray(value)
    ? value.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim())
    : [];
}

function escapeRegexLiteral(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function anchorHints({ knownFiles, knownSymbols, knownText } = {}) {
  const hints = {};
  const files = cleanStrings(knownFiles);
  const symbols = cleanStrings(knownSymbols);
  const regex = cleanStrings(knownText).map(escapeRegexLiteral);
  if (files.length > 0) hints.files = files;
  if (symbols.length > 0) hints.symbols = symbols;
  if (regex.length > 0) hints.regex = regex;
  return Object.keys(hints).length > 0 ? hints : undefined;
}

function requireText(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be non-empty.`);
  return value.trim();
}

function directRuntimeArgs(invocation) {
  const args = invocation?.args ?? {};
  switch (invocation?.tool) {
    case 'explore_repo':
      return { ...args };
    case 'find_relevant_code': {
      const query = requireText(args.query, 'find_relevant_code.query');
      return {
        task: `Find the code most relevant to this task and return bounded useful targets: ${query}.`,
        scope: args.scope,
        taskMode: 'locate',
        hints: anchorHints(args),
      };
    }
    case 'trace_symbol': {
      const symbol = requireText(args.symbol, 'trace_symbol.symbol');
      return {
        task: `Explain the symbol "${symbol}": where it is defined, what it does, its parameters/return type if applicable, and where it is called or used in the codebase.`,
        scope: args.scope,
        taskMode: 'symbol_trace',
        hints: { symbols: [symbol] },
      };
    }
    case 'map_change_impact': {
      const change = requireText(args.change, 'map_change_impact.change');
      return {
        task: `Map the likely impact of this intended change before editing: ${change}. Identify actionable targets, dependent callers/consumers, affected verification or public-contract surfaces, and the remaining risk boundary.`,
        scope: args.scope,
        taskMode: 'edit_planning',
        hints: anchorHints(args),
      };
    }
    case 'explain_code_path': {
      const query = requireText(args.pathQuery, 'explain_code_path.pathQuery');
      const knownFiles = cleanStrings(args.knownFiles);
      if (typeof args.entryPoint === 'string' && args.entryPoint.trim()) {
        knownFiles.unshift(args.entryPoint.trim());
      }
      return {
        task: `Explain this code path across files with grounded citations: ${query}`,
        scope: args.scope,
        taskMode: 'path_explanation',
        hints: anchorHints({ knownFiles, knownSymbols: args.knownSymbols }),
      };
    }
    case 'collect_evidence': {
      const claim = requireText(args.claim, 'collect_evidence.claim');
      return {
        task: `Verify this claim with repository evidence: ${claim}`,
        scope: args.scope,
        taskMode: 'evidence_verification',
        hints: anchorHints(args),
      };
    }
    default:
      throw new Error(`Unsupported trust-suite tool: ${invocation?.tool}`);
  }
}

async function runFixture(caseDefinition, repoRoot, providerDocument) {
  const client = new SequentialFixtureClient(providerDocument);
  const runtime = new ExplorerRuntime({ chatClient: client });
  const runtimeArgs = { ...directRuntimeArgs(caseDefinition.invocation), repo_root: repoRoot };
  const needsAbort = providerDocument.responses.some(response => response.waitForAbort === true);
  const controller = needsAbort ? new AbortController() : null;
  const running = runtime.explore(
    runtimeArgs,
    controller ? { abortSignal: controller.signal } : undefined,
  );
  if (controller) {
    const reachedAbort = await Promise.race([
      client.abortPending.then(() => true),
      running.then(() => false, () => false),
    ]);
    if (reachedAbort) controller.abort();
  }
  const result = await running;
  client.assertConsumed();
  return result;
}

async function runLive(caseDefinition, repoRoot) {
  const runtime = new ExplorerRuntime();
  return runtime.explore({
    ...directRuntimeArgs(caseDefinition.invocation),
    repo_root: repoRoot,
  });
}

async function fixturePin(caseDefinition, source) {
  const repoRoot = safeProjectPath(source.repoPath);
  const providerPath = caseDefinition.providerFixture?.path ?? source.providerPath;
  const expectedProviderHash = caseDefinition.providerFixture?.sha256 ?? source.providerSha256;
  if (typeof providerPath !== 'string' || !providerPath.startsWith(`${source.root}/`)) {
    throw new Error('Provider fixture crosses its source boundary.');
  }
  const providerBytes = await fs.readFile(safeProjectPath(providerPath));
  const providerActual = canonicalFileSha256(providerBytes);
  const treeActual = await fixtureTreeSha256(repoRoot);
  return {
    repoRoot,
    providerDocument: JSON.parse(providerBytes.toString('utf8')),
    pin: {
      kind: 'fixture',
      repoId: source.repoId,
      fixtureTreeSha256: { expected: source.repoTreeSha256, actual: treeActual },
      providerSha256: { expected: expectedProviderHash, actual: providerActual },
      matched: treeActual === source.repoTreeSha256 && providerActual === expectedProviderHash,
    },
  };
}

async function livePin(source, repoRoot) {
  const topLevel = (await runGit(repoRoot, ['rev-parse', '--show-toplevel'])).toString('utf8').trim();
  const comparablePath = value => process.platform === 'win32'
    ? path.resolve(value).toLocaleLowerCase('en')
    : path.resolve(value);
  if (comparablePath(topLevel) !== comparablePath(repoRoot)) {
    throw new Error('Mapped repository path must be the Git worktree root.');
  }
  const actualGitSha = (await runGit(repoRoot, ['rev-parse', 'HEAD'])).toString('utf8').trim();
  const actualDirtyHash = await dirtyTreeSha256(repoRoot);
  return {
    repoRoot,
    pin: {
      kind: 'repository',
      repoId: source.repoId,
      gitSha: { expected: source.gitSha, actual: actualGitSha },
      dirtyTreeSha256: { expected: source.dirtyTreeSha256, actual: actualDirtyHash },
      matched: actualGitSha === source.gitSha && actualDirtyHash === source.dirtyTreeSha256,
    },
  };
}

async function assertLiveSourcePin(source, repoRoot, expectedPin) {
  const current = await livePin(source, repoRoot);
  if (!current.pin.matched || !sameJson(current.pin, expectedPin)) {
    throw new Error('Live repository changed after source preflight.');
  }
}

function observedSourcePaths(result) {
  const runtimeResult = result?.result && typeof result.result === 'object'
    ? result.result
    : result;
  const paths = new Set();
  for (const observation of runtimeResult?.observations ?? []) {
    const value = observation?.kind === 'source' ? observation.path : null;
    if (typeof value !== 'string' || !value || path.isAbsolute(value) || value.includes('\0')) {
      continue;
    }
    const parts = value.replaceAll('\\', '/').split('/');
    if (parts.some(part => !part || part === '.' || part === '..')) continue;
    paths.add(parts.join('/'));
  }
  return [...paths].sort();
}

async function assertObservedSourcesArePinned(result, repoRoot) {
  const sourcePaths = observedSourcePaths(result);
  for (const sourcePath of sourcePaths) {
    if (sourcePath === RUNTIME_PROJECT_CONFIG) continue;
    let ignored = false;
    try {
      await runGit(repoRoot, ['check-ignore', '-q', '--', sourcePath]);
      ignored = true;
    } catch (error) {
      if (error?.code !== 1) throw error;
    }
    if (ignored) throw new Error('Live result used an ignored source outside the source pin.');
  }
}

async function preflightLiveSources(manifest, selected, repoMap) {
  const results = new Map();
  for (const caseDefinition of selected) {
    const sourceRef = caseDefinition.sourceRef;
    if (results.has(sourceRef)) continue;
    const source = manifest.sources[sourceRef];
    const repoRoot = mappedRepoRoot(source, repoMap);
    if (!repoRoot) {
      results.set(sourceRef, { repoRoot: null, pinData: null, error: null });
      continue;
    }
    try {
      results.set(sourceRef, {
        repoRoot,
        pinData: await livePin(source, repoRoot),
        error: null,
      });
    } catch (error) {
      results.set(sourceRef, { repoRoot, pinData: null, error });
    }
  }
  return results;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function logicalizeString(value, repoRoot, repoId) {
  let safe = value;
  const variants = new Set([
    repoRoot,
    repoRoot.replaceAll('\\', '/'),
    repoRoot.replaceAll('/', '\\'),
  ]);
  for (const variant of variants) {
    safe = safe.replace(new RegExp(escapeRegex(variant), 'gi'), () => `<repo:${repoId}>`);
  }
  safe = safe.replace(/[A-Za-z]:[\\/][^\s"'<>|]+/g, '<redacted-absolute-path>');
  safe = safe.replace(/\\\\[^\\\s]+\\[^\s"'<>|]+/g, '<redacted-absolute-path>');
  safe = safe.replace(
    /(^|[\s"'=(:,;\[])(\/(?:home|Users|tmp|var|private|mnt|workspace|opt|srv|etc|root|usr|data|app|run|build|code|project)\/[^\s"'<>|]+)/g,
    (_raw, prefix) => `${prefix}<redacted-absolute-path>`,
  );
  return safe;
}

function sanitizeHarnessMessage(value, repoRoot, repoId) {
  return redactText(logicalizeString(String(value ?? ''), repoRoot, repoId)).text;
}

function logicalizePaths(value, repoRoot, repoId) {
  if (typeof value === 'string') return logicalizeString(value, repoRoot, repoId);
  if (Array.isArray(value)) return value.map(item => logicalizePaths(item, repoRoot, repoId));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) =>
      [key, logicalizePaths(item, repoRoot, repoId)]));
  }
  return value;
}

export function sanitizeTrustArtifact(artifact, { repoRoot, repoId }) {
  const logicalized = logicalizePaths(artifact, path.resolve(repoRoot), repoId);
  return sanitizeBenchmarkReport(logicalized, { cwd: PROJECT_ROOT });
}

function recordOnlyMetrics(result, latencyMs) {
  const stats = result?.stats ?? {};
  return {
    latencyMs,
    usage: {
      inputTokens: Number(stats.inputTokens ?? 0),
      outputTokens: Number(stats.outputTokens ?? 0),
      totalTokens: Number(stats.totalTokens ?? 0),
      turns: Number(stats.turns ?? 0),
      toolCalls: Number(stats.toolCalls ?? 0),
    },
  };
}

function payloadRecord(manifest, caseDefinition, result) {
  const measurement = result.parentPayloadMeasurement ??
    measureParentPayload(buildParentPayload(result.parentHandoff));
  const baselineRef = caseDefinition.schemaV2Baseline?.baselineRef ?? null;
  const baselineBytes = baselineRef
    ? manifest.baselines?.[baselineRef]?.parentPayloadBytes ?? null
    : null;
  return {
    schemaV3: measurement,
    schemaV2BaselineRef: baselineRef,
    schemaV2ParentPayloadBytes: baselineBytes,
    reductionRatio: Number.isFinite(baselineBytes) && baselineBytes > 0
      ? Math.round((1 - (measurement.parentPayloadBytes / baselineBytes)) * 1000) / 1000
      : null,
  };
}

function withoutRepeatedRuns(evaluation) {
  const { runs, ...summary } = evaluation;
  return summary;
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function hasExactKeys(value, expectedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actualKeys = Object.keys(value).sort();
  return actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === [...expectedKeys].sort()[index]);
}

function sameStringSet(left, right) {
  return left.length === right.length &&
    [...new Set(left)].length === left.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

export function payloadComparisonRecord(manifest) {
  const comparison = manifest.offlineResults?.payloadComparison;
  const responseBaselineCaseIds = (manifest.cases ?? [])
    .filter(item => {
      const baselineRef = item?.schemaV2Baseline?.baselineRef;
      return Number.isInteger(manifest.baselines?.[baselineRef]?.parentPayloadBytes) &&
        manifest.baselines[baselineRef].parentPayloadBytes > 0;
    })
    .map(item => item.id);
  const samples = comparison?.samples;
  const sampleIds = Array.isArray(samples) ? samples.map(item => item?.caseId) : [];
  if (!hasExactKeys(comparison, ['metric', 'minimumMedianReduction', 'samples']) ||
      comparison.metric !== manifest.payloadMetric?.id ||
      !Number.isFinite(comparison.minimumMedianReduction) ||
      !sameStringSet(sampleIds, responseBaselineCaseIds)) {
    throw new Error('Portable payload comparison has an invalid denominator or metric.');
  }

  const caseById = new Map((manifest.cases ?? []).map(item => [item.id, item]));
  const reductions = samples.map(sample => {
    const caseDefinition = caseById.get(sample?.caseId);
    const baseline = manifest.baselines?.[sample?.baselineRef];
    const measurement = measureParentPayload(buildParentPayload(
      buildOracleParentHandoff(caseDefinition),
    ));
    if (!hasExactKeys(sample, [
      'caseId', 'baselineRef', 'currentParentPayloadBytes', 'currentPayloadSha256',
    ]) || caseDefinition?.schemaV2Baseline?.baselineRef !== sample.baselineRef ||
        sample.currentParentPayloadBytes !== measurement.parentPayloadBytes ||
        sample.currentPayloadSha256 !== measurement.sha256 ||
        !Number.isInteger(baseline?.parentPayloadBytes) ||
        sample.currentParentPayloadBytes >= baseline.parentPayloadBytes) {
      throw new Error(`Portable payload sample ${String(sample?.caseId)} is invalid.`);
    }
    return (baseline.parentPayloadBytes - sample.currentParentPayloadBytes) /
      baseline.parentPayloadBytes;
  });
  const medianReductionRatio = median(reductions);
  if (medianReductionRatio === null || medianReductionRatio < comparison.minimumMedianReduction) {
    throw new Error('Portable payload comparison misses the median reduction gate.');
  }
  return {
    metric: comparison.metric,
    comparedRunCount: reductions.length,
    medianReductionRatio: Math.round(medianReductionRatio * 1000) / 1000,
    minimumMedianReduction: comparison.minimumMedianReduction,
  };
}

function providerFailureSummary(result) {
  if (result?.failure?.category !== 'provider') return null;
  return {
    category: 'provider',
    reason: typeof result.failure.reason === 'string' && result.failure.reason
      ? result.failure.reason
      : 'provider_error',
  };
}

function resumeRunPrefixes(report, selectedCases) {
  if (report.cases.length !== selectedCases.length) {
    throw new Error('Resume report does not preserve the selected case denominator.');
  }
  const prefixes = new Map();
  let providerBoundary = false;
  for (let caseIndex = 0; caseIndex < selectedCases.length; caseIndex += 1) {
    const selectedCase = selectedCases[caseIndex];
    const priorCase = report.cases[caseIndex];
    if (priorCase?.id !== selectedCase.id || priorCase.repoId !== selectedCase.repoId ||
        priorCase.runCount !== selectedCase.runCount ||
        !Array.isArray(priorCase.runs) || priorCase.runs.length !== selectedCase.runCount) {
      throw new Error('Resume report does not preserve the selected case denominator.');
    }

    const runs = [];
    let attempted = false;
    for (let runIndex = 0; runIndex < selectedCase.runCount; runIndex += 1) {
      const priorRun = priorCase.runs[runIndex];
      if (priorRun?.run !== runIndex + 1) {
        throw new Error('Resume report has an invalid run-slot sequence.');
      }
      if (priorRun.notRun !== undefined) {
        if (!providerBoundary || !hasExactKeys(priorRun, ['notRun', 'run']) ||
            !hasExactKeys(priorRun.notRun, ['reason']) ||
            priorRun.notRun.reason !== 'provider_unavailable') {
          throw new Error('Resume report has an invalid provider-unavailable suffix.');
        }
        continue;
      }
      if (providerBoundary || !priorRun.artifact || typeof priorRun.artifact !== 'object' ||
          Array.isArray(priorRun.artifact) || !priorRun.evaluation ||
          typeof priorRun.evaluation !== 'object' || !priorRun.recordOnly ||
          typeof priorRun.recordOnly !== 'object') {
        throw new Error('Resume report has an invalid completed run slot.');
      }
      attempted = true;
      if (providerFailureSummary(priorRun.artifact)) {
        providerBoundary = true;
        continue;
      }
      runs.push(priorRun);
    }
    prefixes.set(selectedCase.id, { runs, priorCase, attempted });
  }
  return prefixes;
}

function rebuildResumedRun({
  priorRun,
  manifest,
  caseDefinition,
  source,
  repoRoot,
  evaluationOptions,
  measurePayload,
}) {
  const latencyMs = priorRun.recordOnly?.latencyMs;
  const usage = priorRun.recordOnly?.usage;
  if (!hasExactKeys(priorRun.recordOnly, ['latencyMs', 'usage']) ||
      !Number.isSafeInteger(latencyMs) || latencyMs < 0 ||
      !hasExactKeys(usage, ['inputTokens', 'outputTokens', 'toolCalls', 'totalTokens', 'turns']) ||
      Object.values(usage).some(value => !Number.isFinite(value) || value < 0)) {
    throw new Error('Resume report has invalid record-only measurements.');
  }
  if (priorRun.harnessFailure !== undefined &&
      (!hasExactKeys(priorRun.harnessFailure, ['code', 'message']) ||
       priorRun.harnessFailure.code !== 'RUNNER_EXECUTION_FAILED' ||
       typeof priorRun.harnessFailure.message !== 'string')) {
    throw new Error('Resume report has an invalid harness failure record.');
  }

  const artifact = sanitizeTrustArtifact(priorRun.artifact, {
    repoRoot,
    repoId: source.repoId,
  });
  const recordOnly = recordOnlyMetrics(artifact, latencyMs);
  if (!sameJson(recordOnly, priorRun.recordOnly)) {
    throw new Error('Resume report measurements do not match the preserved artifact.');
  }
  const harnessFailure = priorRun.harnessFailure
    ? {
      code: priorRun.harnessFailure.code,
      message: sanitizeHarnessMessage(priorRun.harnessFailure.message, repoRoot, source.repoId),
    }
    : null;
  return {
    artifact,
    run: {
      run: priorRun.run,
      evaluation: evaluateTrustCase(caseDefinition, artifact, evaluationOptions),
      recordOnly,
      ...(measurePayload && artifact.parentHandoff
        ? {
          payload: payloadRecord(manifest, caseDefinition, {
            ...artifact,
            parentPayloadMeasurement: null,
          }),
        }
        : {}),
      ...(harnessFailure ? { harnessFailure } : {}),
      artifact,
    },
  };
}

function providerUnavailableRun(run) {
  return {
    run,
    notRun: { reason: 'provider_unavailable' },
  };
}

function providerUnavailableCase(caseDefinition, source, options, providerFailure) {
  const runCount = repeatCountForCase(caseDefinition, options.repeats);
  return {
    id: caseDefinition.id,
    repoId: source.repoId,
    tool: caseDefinition.invocation?.tool,
    evaluationProfile: evaluationOptionsForCase('live', caseDefinition).profile,
    passed: false,
    runCount,
    executedRunCount: 0,
    notRun: {
      reason: 'provider_unavailable',
      provider: providerFailure,
    },
    runs: Array.from({ length: runCount }, (_, index) => providerUnavailableRun(index + 1)),
  };
}

async function runCase({
  manifest,
  caseDefinition,
  source,
  mode,
  repoRoot,
  pinData,
  options,
  runLiveCase,
  resumedRuns = [],
}) {
  const runCount = repeatCountForCase(caseDefinition, options.repeats);
  const evaluationOptions = evaluationOptionsForCase(mode, caseDefinition);
  const artifacts = [];
  const runs = [];
  let providerFailure = null;
  for (const priorRun of resumedRuns) {
    const rebuilt = rebuildResumedRun({
      priorRun,
      manifest,
      caseDefinition,
      source,
      repoRoot,
      evaluationOptions,
      measurePayload: options.measurePayload,
    });
    artifacts.push(rebuilt.artifact);
    runs.push(rebuilt.run);
  }
  for (let index = runs.length; index < runCount; index += 1) {
    const startedAt = Date.now();
    let result;
    let runnerError = null;
    try {
      if (mode === 'fixture') {
        result = await runFixture(caseDefinition, repoRoot, pinData.providerDocument);
      } else {
        await assertLiveSourcePin(source, repoRoot, pinData.pin);
        result = await runLiveCase(caseDefinition, repoRoot);
        await assertObservedSourcesArePinned(result, repoRoot);
        await assertLiveSourcePin(source, repoRoot, pinData.pin);
      }
    } catch (error) {
      runnerError = error;
      result = {};
    }
    const latencyMs = Date.now() - startedAt;
    artifacts.push(result);
    const evaluation = evaluateTrustCase(caseDefinition, result, evaluationOptions);
    runs.push({
      run: index + 1,
      evaluation,
      recordOnly: recordOnlyMetrics(result, latencyMs),
      ...(options.measurePayload && result.parentHandoff
        ? { payload: payloadRecord(manifest, caseDefinition, result) }
        : {}),
      ...(runnerError ? {
        harnessFailure: {
          code: 'RUNNER_EXECUTION_FAILED',
          message: sanitizeHarnessMessage(
            runnerError.message ?? runnerError,
            repoRoot,
            source.repoId,
          ),
        },
      } : {}),
      artifact: sanitizeTrustArtifact(result, { repoRoot, repoId: source.repoId }),
    });
    if (mode === 'live') providerFailure = providerFailureSummary(result);
    if (providerFailure) break;
  }
  for (let index = runs.length; index < runCount; index += 1) {
    runs.push(providerUnavailableRun(index + 1));
  }

  const repeatability = evaluateTrustRepeatability(
    { ...caseDefinition, repeatCount: runCount },
    artifacts,
    evaluationOptions,
  );
  const hasHarnessFailure = runs.some(run => run.harnessFailure);
  return {
    id: caseDefinition.id,
    repoId: source.repoId,
    tool: caseDefinition.invocation?.tool,
    evaluationProfile: evaluationOptions.profile,
    pin: pinData.pin,
    runCount,
    executedRunCount: artifacts.length,
    passed: pinData.pin.matched && repeatability.passed && !hasHarnessFailure && !providerFailure,
    repeatability: withoutRepeatedRuns(repeatability),
    runs,
    ...(providerFailure ? { providerFailure } : {}),
  };
}

export function printCase(caseResult, verbose) {
  const status = caseResult.passed
    ? 'PASS'
    : caseResult.skipped
      ? 'SKIP'
      : caseResult.notRun
        ? 'NOT_RUN'
        : 'FAIL';
  console.log(`${status} ${caseResult.id}  repo=${caseResult.repoId ?? 'unmapped'}${
    caseResult.runCount ? `  runs=${caseResult.runCount}` : ''}${
    Number.isInteger(caseResult.executedRunCount)
      ? `  attempted=${caseResult.executedRunCount}`
      : ''}`);
  if (!verbose) return;
  if (caseResult.reason) console.log(`  ${caseResult.reason}`);
  if (caseResult.notRun) console.log(`  not_run=${caseResult.notRun.reason}`);
  if (caseResult.providerFailure) {
    console.log(`  provider=${caseResult.providerFailure.category}/${caseResult.providerFailure.reason}`);
  } else if (caseResult.notRun?.provider) {
    console.log(`  provider=${caseResult.notRun.provider.category}/${caseResult.notRun.provider.reason}`);
  }
  if (caseResult.pin && !caseResult.pin.matched) console.log('  source pin mismatch');
  for (const violation of caseResult.repeatability?.violations ?? []) {
    console.log(`  ${violation.code}`);
  }
  for (const run of caseResult.runs ?? []) {
    if (run.notRun) continue;
    const usage = run.recordOnly.usage;
    console.log(`  run=${run.run} state=${run.evaluation.observedState} ` +
      `latency=${run.recordOnly.latencyMs}ms tokens=${usage.totalTokens}`);
    for (const violation of run.evaluation.violations ?? []) {
      console.log(`    ${violation.code}`);
    }
    if (run.harnessFailure) console.log(`    ${run.harnessFailure.code}: ${run.harnessFailure.message}`);
  }
}

function summarize(caseResults) {
  const skipped = caseResults.filter(item => item.skipped);
  const notRun = caseResults.filter(item => item.notRun);
  const executed = caseResults.filter(item => !item.skipped && !item.notRun);
  const runs = caseResults.flatMap(item => item.runs ?? []);
  const executedRuns = runs.filter(run => !run.notRun);
  const notRunRuns = runs.filter(run => run.notRun);
  const reductions = executedRuns
    .map(run => run.payload?.reductionRatio)
    .filter(Number.isFinite);
  return {
    selectedCaseCount: caseResults.length,
    executedCaseCount: executed.length,
    skippedCaseCount: skipped.length,
    notRunCaseCount: notRun.length,
    passedCaseCount: executed.filter(item => item.passed).length,
    failedCaseCount: executed.filter(item => !item.passed).length,
    plannedRunCount: runs.length,
    executedRunCount: executedRuns.length,
    notRunRunCount: notRunRuns.length,
    passed: executed.length > 0 && notRun.length === 0 && executed.every(item => item.passed),
    ...(reductions.length > 0 ? {
      payload: {
        comparedRunCount: reductions.length,
        medianReductionRatio: Math.round(median(reductions) * 1000) / 1000,
      },
    } : {}),
    recordOnly: {
      latencyMs: executedRuns
        .reduce((sum, run) => sum + run.recordOnly.latencyMs, 0),
      totalTokens: executedRuns
        .reduce((sum, run) => sum + run.recordOnly.usage.totalTokens, 0),
    },
  };
}

export async function runTrustSuite(options, { runLiveCase = runLive } = {}) {
  if (options.resumeFrom && options.mode !== 'live') {
    throw new Error('Resume reports are accepted only in live mode.');
  }
  if (options.resumeFrom && options.output) {
    const resumePath = path.resolve(options.resumeFrom);
    const outputPath = path.resolve(options.output);
    const samePath = process.platform === 'win32'
      ? resumePath.toLocaleLowerCase('en') === outputPath.toLocaleLowerCase('en')
      : resumePath === outputPath;
    if (samePath) throw new Error('Resume input and output must use different files.');
  }

  const loadedManifest = await loadManifest(options.suite);
  const manifest = loadedManifest.manifest;
  const repoMap = options.mode === 'live' ? await loadRepoMap(options.repoMap) : null;
  const selected = selectCases(manifest, options.mode);
  if (selected.length === 0) throw new Error(`No ${options.mode} cases are runnable.`);
  const suiteName = manifest.name ?? path.basename(options.suite);
  const selectedCases = selectedCasePlan(manifest, selected, options);
  const checkpointBase = options.mode === 'live'
    ? await buildLiveCheckpointBase({
      manifestSha256: loadedManifest.sha256,
      selectedCases,
      measurePayload: options.measurePayload,
    })
    : null;
  let resumePrefixes = null;
  if (options.resumeFrom) {
    const resumeReport = await loadResumeReport(options.resumeFrom);
    validateResumeCheckpoint(resumeReport, checkpointBase, suiteName);
    resumePrefixes = resumeRunPrefixes(resumeReport, selectedCases);
  }

  const liveSources = options.mode === 'live'
    ? await preflightLiveSources(manifest, selected, repoMap)
    : null;
  if (liveSources) {
    for (const [sourceRef, sourceState] of liveSources) {
      const source = manifest.sources[sourceRef];
      if (!sourceState.repoRoot) {
        throw new Error(`Live source mapping is missing for logical repository ${source.repoId}.`);
      }
      if (sourceState.error || !sourceState.pinData?.pin?.matched) {
        throw new Error(`Live source preflight failed for logical repository ${source.repoId}.`);
      }
    }
    if (resumePrefixes) {
      for (const caseDefinition of selected) {
        const resumeEntry = resumePrefixes.get(caseDefinition.id);
        if (!resumeEntry?.attempted) continue;
        const sourceState = liveSources.get(caseDefinition.sourceRef);
        if (!sameJson(resumeEntry.priorCase.pin, sourceState.pinData.pin)) {
          const source = manifest.sources[caseDefinition.sourceRef];
          throw new Error(`Resume source pin changed for logical repository ${source.repoId}.`);
        }
      }
    }
  }

  const caseResults = [];
  let providerUnavailable = null;
  for (const caseDefinition of selected) {
    const source = manifest.sources[caseDefinition.sourceRef];
    if (options.mode === 'live' && providerUnavailable) {
      const notRun = providerUnavailableCase(
        caseDefinition,
        source,
        options,
        providerUnavailable,
      );
      caseResults.push(notRun);
      printCase(notRun, options.verbose);
      continue;
    }
    let repoRoot = options.mode === 'live'
      ? liveSources.get(caseDefinition.sourceRef).repoRoot
      : null;

    let pinData;
    try {
      pinData = options.mode === 'fixture'
        ? await fixturePin(caseDefinition, source)
        : liveSources.get(caseDefinition.sourceRef).pinData;
    } catch (error) {
      const failed = {
        id: caseDefinition.id,
        repoId: source.repoId,
        skipped: false,
        passed: false,
        reason: logicalizeString(String(error.message ?? error), repoRoot ?? PROJECT_ROOT, source.repoId),
        violations: [{ code: 'SOURCE_PIN_VALIDATION_FAILED' }],
      };
      caseResults.push(failed);
      printCase(failed, options.verbose);
      continue;
    }
    repoRoot = pinData.repoRoot;
    if (!pinData.pin.matched) {
      const failed = {
        id: caseDefinition.id,
        repoId: source.repoId,
        skipped: false,
        passed: false,
        pin: pinData.pin,
        reason: 'Pinned source content does not match the manifest.',
        violations: [{ code: 'SOURCE_PIN_MISMATCH' }],
      };
      caseResults.push(failed);
      printCase(failed, options.verbose);
      continue;
    }

    let prepared = { repoRoot, cleanup: async () => {} };
    try {
      if (options.mode === 'fixture') {
        prepared = await prepareFixtureRepository(repoRoot, caseDefinition.fixtureSetup);
        if (prepared.fixtureSetupHeadSha) {
          pinData = {
            ...pinData,
            pin: {
              ...pinData.pin,
              fixtureSetupHeadSha: {
                expected: caseDefinition.fixtureSetup.headSha,
                actual: prepared.fixtureSetupHeadSha,
              },
            },
          };
        }
      }
      if (options.mode === 'live') {
        await assertLiveSourcePin(source, prepared.repoRoot, pinData.pin);
      }
      const caseResult = await runCase({
        manifest,
        caseDefinition,
        source,
        mode: options.mode,
        repoRoot: prepared.repoRoot,
        pinData,
        options,
        runLiveCase,
        resumedRuns: resumePrefixes?.get(caseDefinition.id)?.runs ?? [],
      });
      caseResults.push(caseResult);
      printCase(caseResult, options.verbose);
      if (options.mode === 'live' && caseResult.providerFailure) {
        providerUnavailable = caseResult.providerFailure;
      }
    } catch (error) {
      const failed = {
        id: caseDefinition.id,
        repoId: source.repoId,
        skipped: false,
        passed: false,
        pin: pinData.pin,
        reason: logicalizeString(
          String(error.message ?? error),
          prepared.repoRoot ?? repoRoot,
          source.repoId,
        ),
        violations: [{
          code: options.mode === 'fixture' ? 'FIXTURE_SETUP_FAILED' : 'CASE_EXECUTION_FAILED',
        }],
      };
      caseResults.push(failed);
      printCase(failed, options.verbose);
    } finally {
      await prepared.cleanup();
    }
  }

  const summary = summarize(caseResults);
  if (options.measurePayload) summary.payload = payloadComparisonRecord(manifest);
  const report = {
    schemaVersion: 2,
    suite: suiteName,
    mode: options.mode,
    sourcePolicy: options.mode === 'fixture'
      ? 'sha256-tree-lf-v1 + sha256-lf-v1'
      : 'git SHA + sha256-dirty-tree-v1',
    acceptancePolicy: {
      oracle: 'independent manifest oracle',
      profiles: {
        fixture: FIXTURE_TRUST_EVALUATION_PROFILE,
        live: LIVE_TRUST_EVALUATION_PROFILE,
      },
      repeatability: options.mode === 'live'
        ? 'completion state and independently anchored dispositions'
        : 'required-goal state and accepted-claim signature',
      recordOnly: ['usage', 'latency'],
    },
    cases: caseResults,
    summary,
  };
  if (checkpointBase) {
    report.checkpoint = {
      ...checkpointBase,
      casesSha256: jsonSha256(caseResults),
    };
  }
  return report;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const report = await runTrustSuite(options);
  if (options.output) {
    const outputPath = path.resolve(options.output);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`Wrote redacted report: ${path.basename(outputPath)}`);
  }
  const summary = report.summary;
  console.log(`${summary.passed ? 'PASS' : 'FAIL'} ${report.suite} (${report.mode}) ` +
    `${summary.passedCaseCount}/${summary.selectedCaseCount} selected cases; ` +
    `${summary.executedCaseCount} executed; ${summary.skippedCaseCount} skipped; ` +
    `${summary.notRunCaseCount} not run`);
  if (summary.payload) {
    console.log(`Payload median reduction: ${Math.round(summary.payload.medianReductionRatio * 100)}%`);
  }
  console.log(`Record only: latency=${summary.recordOnly.latencyMs}ms ` +
    `tokens=${summary.recordOnly.totalTokens}`);
  if (!summary.passed) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  main().catch(error => {
    const message = logicalizeString(String(error.message ?? error), PROJECT_ROOT, 'project');
    console.error(`Trust suite failed: ${message}`);
    process.exitCode = 1;
  });
}
