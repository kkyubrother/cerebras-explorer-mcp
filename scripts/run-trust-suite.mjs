#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import {
  evaluateTrustCase,
  evaluateTrustRepeatability,
} from '../src/benchmark/evaluator.mjs';
import { buildParentPayload, measureParentPayload } from '../src/explorer/parent-payload.mjs';
import { ExplorerRuntime } from '../src/explorer/runtime.mjs';
import { sanitizeBenchmarkReport } from '../src/benchmark/report.mjs';

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url));
const EMPTY_SHA256 = createHash('sha256').digest('hex');
const MAX_GIT_OUTPUT_BYTES = 256 * 1024 * 1024;

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

async function runGit(repoRoot, args) {
  const { stdout } = await execFileAsync('git', ['-C', repoRoot, ...args], {
    encoding: null,
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    windowsHide: true,
  });
  return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
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
  const untrackedPaths = splitNullTerminated(await runGit(
    repoRoot,
    ['ls-files', '--others', '--exclude-standard', '-z'],
  )).sort(Buffer.compare);

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
  const manifest = JSON.parse(await fs.readFile(resolved, 'utf8'));
  if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.cases) ||
      !manifest.sources || typeof manifest.sources !== 'object') {
    throw new Error('Trust suite requires sources and a non-empty cases array.');
  }
  if (manifest.cases.length === 0) throw new Error('Trust suite has no cases.');
  return manifest;
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
        task: `Find the code most relevant to this task and return the smallest useful read/edit targets: ${query}.`,
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
        task: `Map the likely impact of this intended change before editing: ${change}. Identify likely edit targets, read targets, callers, tests, configuration, and risky dependent paths.`,
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
        task: `Explain this code path across files with grounded citations: ${query}. Include the entry point, handoff points, and next read targets.`,
        scope: args.scope,
        taskMode: 'path_explanation',
        hints: anchorHints({ knownFiles, knownSymbols: args.knownSymbols }),
      };
    }
    case 'collect_evidence': {
      const claim = requireText(args.claim, 'collect_evidence.claim');
      return {
        task: `Verify this claim and collect a compact evidence bundle with snippets: ${claim}. Mark uncertainties and avoid unsupported facts.`,
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
  safe = safe.replace(/\/(?:home|Users|tmp|var\/tmp|private|mnt|workspace)\/[^\s"'<>]+/g,
    '<redacted-absolute-path>');
  return safe;
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

async function runCase({ manifest, caseDefinition, source, mode, repoRoot, pinData, options }) {
  const runCount = repeatCountForCase(caseDefinition, options.repeats);
  const artifacts = [];
  const runs = [];
  for (let index = 0; index < runCount; index += 1) {
    const startedAt = Date.now();
    let result;
    let runnerError = null;
    try {
      result = mode === 'fixture'
        ? await runFixture(caseDefinition, repoRoot, pinData.providerDocument)
        : await runLive(caseDefinition, repoRoot);
    } catch (error) {
      runnerError = error;
      result = {};
    }
    const latencyMs = Date.now() - startedAt;
    artifacts.push(result);
    const evaluation = evaluateTrustCase(caseDefinition, result);
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
          message: logicalizeString(String(runnerError.message ?? runnerError), repoRoot, source.repoId),
        },
      } : {}),
      artifact: sanitizeTrustArtifact(result, { repoRoot, repoId: source.repoId }),
    });
  }

  const repeatability = evaluateTrustRepeatability(
    { ...caseDefinition, repeatCount: runCount },
    artifacts,
  );
  const hasHarnessFailure = runs.some(run => run.harnessFailure);
  return {
    id: caseDefinition.id,
    repoId: source.repoId,
    tool: caseDefinition.invocation?.tool,
    pin: pinData.pin,
    runCount,
    passed: pinData.pin.matched && repeatability.passed && !hasHarnessFailure,
    repeatability: withoutRepeatedRuns(repeatability),
    runs,
  };
}

function printCase(caseResult, verbose) {
  const status = caseResult.passed ? 'PASS' : caseResult.skipped ? 'SKIP' : 'FAIL';
  console.log(`${status} ${caseResult.id}  repo=${caseResult.repoId ?? 'unmapped'}${
    caseResult.runCount ? `  runs=${caseResult.runCount}` : ''}`);
  if (!verbose) return;
  if (caseResult.reason) console.log(`  ${caseResult.reason}`);
  if (caseResult.pin && !caseResult.pin.matched) console.log('  source pin mismatch');
  for (const violation of caseResult.repeatability?.violations ?? []) {
    console.log(`  ${violation.code}`);
  }
  for (const run of caseResult.runs ?? []) {
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
  const executed = caseResults.filter(item => !item.skipped);
  const reductions = executed.flatMap(item => item.runs ?? [])
    .map(run => run.payload?.reductionRatio)
    .filter(Number.isFinite);
  return {
    selectedCaseCount: caseResults.length,
    executedCaseCount: executed.length,
    skippedCaseCount: caseResults.length - executed.length,
    passedCaseCount: executed.filter(item => item.passed).length,
    failedCaseCount: executed.filter(item => !item.passed).length,
    passed: executed.length > 0 && executed.every(item => item.passed),
    ...(reductions.length > 0 ? {
      payload: {
        comparedRunCount: reductions.length,
        medianReductionRatio: Math.round(median(reductions) * 1000) / 1000,
      },
    } : {}),
    recordOnly: {
      latencyMs: executed.flatMap(item => item.runs ?? [])
        .reduce((sum, run) => sum + run.recordOnly.latencyMs, 0),
      totalTokens: executed.flatMap(item => item.runs ?? [])
        .reduce((sum, run) => sum + run.recordOnly.usage.totalTokens, 0),
    },
  };
}

export async function runTrustSuite(options) {
  const manifest = await loadManifest(options.suite);
  const repoMap = options.mode === 'live' ? await loadRepoMap(options.repoMap) : null;
  const selected = selectCases(manifest, options.mode);
  if (selected.length === 0) throw new Error(`No ${options.mode} cases are runnable.`);

  const caseResults = [];
  for (const caseDefinition of selected) {
    const source = manifest.sources[caseDefinition.sourceRef];
    let repoRoot = null;
    if (options.mode === 'live') {
      repoRoot = mappedRepoRoot(source, repoMap);
      if (!repoRoot) {
        const skipped = {
          id: caseDefinition.id,
          repoId: source.repoId,
          skipped: true,
          passed: false,
          reason: 'No logical repository mapping was supplied.',
        };
        caseResults.push(skipped);
        printCase(skipped, options.verbose);
        continue;
      }
    }

    let pinData;
    try {
      pinData = options.mode === 'fixture'
        ? await fixturePin(caseDefinition, source)
        : await livePin(source, repoRoot);
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

    const caseResult = await runCase({
      manifest,
      caseDefinition,
      source,
      mode: options.mode,
      repoRoot,
      pinData,
      options,
    });
    caseResults.push(caseResult);
    printCase(caseResult, options.verbose);
  }

  const summary = summarize(caseResults);
  return {
    schemaVersion: 1,
    suite: manifest.name ?? path.basename(options.suite),
    mode: options.mode,
    sourcePolicy: options.mode === 'fixture'
      ? 'sha256-tree-lf-v1 + sha256-lf-v1'
      : 'git SHA + sha256-dirty-tree-v1',
    acceptancePolicy: {
      oracle: 'independent manifest oracle',
      repeatability: 'required-goal state and accepted-claim signature',
      recordOnly: ['usage', 'latency'],
    },
    cases: caseResults,
    summary,
  };
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
    `${summary.passedCaseCount}/${summary.executedCaseCount} cases; ${summary.skippedCaseCount} skipped`);
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
