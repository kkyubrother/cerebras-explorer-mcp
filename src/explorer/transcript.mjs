import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { redactValue } from './redact.mjs';

/**
 * Lightweight transcript recorder for exploration sessions.
 * Writes conversation messages to a JSONL file for debugging and prompt improvement.
 *
 * Inspired by Claude Code's sidechain transcript recording
 * (src/utils/sessionStorage.ts:recordSidechainTranscript).
 *
 * Design:
 * - Each exploration gets its own transcript file
 * - Messages are appended as JSONL (one JSON object per line) for streaming writes
 * - Fire-and-forget: write errors are logged, never thrown
 * - Directory is created lazily on first write
 */

const DEFAULT_TRANSCRIPT_DIR = '.cerebras-explorer/transcripts';
const DEFAULT_COMPACT_TRACE_LIMIT = 20;
const MAX_TRACE_STRING_CHARS = 180;
const MAX_TRACE_ITEMS = 6;
const MAX_TRACE_DEPTH = 8;
const MAX_TRACE_DEPTH_PLACEHOLDER = '[MaxDepth]';

const TRACE_ARG_KEYS = new Set([
  'path',
  'dirPath',
  'pattern',
  'symbol',
  'scope',
  'kind',
  'startLine',
  'endLine',
  'maxResults',
  'contextLines',
  'from',
  'to',
  'ref',
]);

/** Resolve the transcript directory (relative to repo root, or absolute override). */
function resolveTranscriptDir(repoRoot) {
  const override = process.env.CEREBRAS_EXPLORER_LOG_PATH;
  if (override) return path.resolve(override);
  if (repoRoot) return path.resolve(repoRoot, DEFAULT_TRANSCRIPT_DIR);
  return path.resolve(process.cwd(), DEFAULT_TRANSCRIPT_DIR);
}

function isTruthyEnv(value) {
  if (value === undefined || value === null) return false;
  return value === '1' || value.toLowerCase() === 'true' || value.toLowerCase() === 'yes';
}

/**
 * Check whether transcript recording is enabled.
 * Default: disabled (opt-in via environment variable).
 */
export function isTranscriptEnabled() {
  return Boolean(process.env.CEREBRAS_EXPLORER_LOG_PATH);
}

export function isTranscriptRawMode() {
  return isTruthyEnv(process.env.CEREBRAS_EXPLORER_LOG_RAW);
}

function redactForTranscript(data) {
  if (isTranscriptRawMode()) return data;
  return redactValue(data).value;
}

function stringOrNull(value) {
  return typeof value === 'string' && value ? value : null;
}

function stringList(value) {
  return Array.isArray(value)
    ? [...new Set(value.filter(item => typeof item === 'string' && item))]
    : [];
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function summarizeClaims(claims = []) {
  return (Array.isArray(claims) ? claims : []).map(claim => ({
    claimId: stringOrNull(claim?.id),
    subgoalId: stringOrNull(claim?.subgoalId),
    evidenceRefs: stringList(claim?.evidenceRefs),
  })).filter(claim => claim.claimId && claim.subgoalId);
}

function summarizeVerdicts(data = {}) {
  const subgoalByClaim = new Map(
    summarizeClaims(data.claims).map(claim => [claim.claimId, claim.subgoalId]),
  );
  return (Array.isArray(data.verdicts) ? data.verdicts : []).map(verdict => ({
    claimId: stringOrNull(verdict?.claimId),
    subgoalId: subgoalByClaim.get(verdict?.claimId) ?? null,
    result: stringOrNull(verdict?.result),
    ...(stringOrNull(verdict?.resolution) ? { resolution: verdict.resolution } : {}),
    supportingEvidenceRefs: stringList(verdict?.supportingEvidenceRefs),
    reasonCode: stringOrNull(verdict?.reasonCode),
  })).filter(verdict => verdict.claimId && verdict.result);
}

function summarizeRepair(data = {}) {
  const gaps = Array.isArray(data.gaps) ? data.gaps : [];
  const outcomes = Array.isArray(data.outcomes) ? data.outcomes : [];
  const outcome = ['completed', 'failed', 'aborted'].includes(data.outcome)
    ? data.outcome
    : null;
  return {
    status: data.status === 'finished' ? 'finished' : 'started',
    round: 1,
    ...(outcome ? { outcome } : {}),
    selectedGapIds: stringList(data.selectedGapIds ?? gaps.map(gap => gap?.id)),
    affectedSubgoalIds: stringList(
      data.affectedSubgoalIds ?? gaps.map(gap => gap?.subgoalId),
    ),
    priorActionFingerprints: stringList(data.priorActionFingerprints),
    actionFingerprints: stringList(data.actionFingerprints),
    freshEvidenceRefs: stringList(data.freshEvidenceRefs),
    outcomes: outcomes.map(outcome => ({
      subgoalId: stringOrNull(outcome?.id ?? outcome?.subgoalId),
      state: stringOrNull(outcome?.state),
      ...(stringOrNull(outcome?.resolution) ? { resolution: outcome.resolution } : {}),
      ...(stringOrNull(outcome?.gapRef) ? { gapRef: outcome.gapRef } : {}),
    })).filter(outcome => outcome.subgoalId && outcome.state),
  };
}

function summarizeFinal(data = {}) {
  const requiredSubgoals = Array.isArray(data.requiredSubgoals)
    ? data.requiredSubgoals
    : [];
  const gaps = Array.isArray(data.gaps) ? data.gaps : [];
  const parentPayload = data.parentPayload;
  const validParentPayload = parentPayload?.encoding === 'utf8' &&
    Number.isInteger(parentPayload.contentBytes) && parentPayload.contentBytes >= 0 &&
    Number.isInteger(parentPayload.structuredContentBytes) &&
      parentPayload.structuredContentBytes >= 0 &&
    Number.isInteger(parentPayload.parentPayloadBytes) &&
      parentPayload.parentPayloadBytes ===
        parentPayload.contentBytes + parentPayload.structuredContentBytes &&
    typeof parentPayload.sha256 === 'string' && /^[a-f0-9]{64}$/.test(parentPayload.sha256);
  return {
    ...(stringOrNull(data.failureReason) ? { failureReason: data.failureReason } : {}),
    requiredSubgoals: requiredSubgoals.map(subgoal => ({
      subgoalId: stringOrNull(subgoal?.id ?? subgoal?.subgoalId),
      state: stringOrNull(subgoal?.state),
      ...(stringOrNull(subgoal?.resolution) ? { resolution: subgoal.resolution } : {}),
      ...(stringOrNull(subgoal?.gapRef) ? { gapRef: subgoal.gapRef } : {}),
    })).filter(subgoal => subgoal.subgoalId && subgoal.state),
    acceptedClaimIds: stringList(data.failureReason ? [] : data.acceptedClaimIds),
    gaps: gaps.map(gap => ({
      gapId: stringOrNull(gap?.id ?? gap?.gapId),
      ...(stringOrNull(gap?.subgoalId) ? { subgoalId: gap.subgoalId } : {}),
      reason: stringOrNull(gap?.reason),
      repairable: gap?.repairable === true,
    })).filter(gap => gap.gapId && gap.reason),
    ...(validParentPayload ? {
      parentPayload: {
        encoding: 'utf8',
        contentBytes: parentPayload.contentBytes,
        structuredContentBytes: parentPayload.structuredContentBytes,
        parentPayloadBytes: parentPayload.parentPayloadBytes,
        sha256: parentPayload.sha256,
      },
    } : {}),
  };
}

function summarizeUsage(data = {}) {
  return {
    ...(Number.isInteger(data.providerIndex) && data.providerIndex >= 0
      ? { providerIndex: data.providerIndex }
      : {}),
    ...(stringOrNull(data.model) ? { model: data.model } : {}),
    providerCalls: nonNegativeInteger(data.providerCalls),
    repositoryToolCalls: nonNegativeInteger(data.repositoryToolCalls),
    inputTokens: nonNegativeInteger(data.inputTokens),
    outputTokens: nonNegativeInteger(data.outputTokens),
    totalTokens: nonNegativeInteger(data.totalTokens),
    elapsedMs: nonNegativeInteger(data.elapsedMs),
  };
}

function buildTrustEventData(type, data = {}) {
  switch (type) {
    case 'claim':
      return {
        phase: data.phase === 'post-repair' ? 'post-repair' : 'initial',
        claims: summarizeClaims(data.claims),
      };
    case 'verdict':
      return {
        phase: data.phase === 'post-repair' ? 'post-repair' : 'initial',
        verdicts: summarizeVerdicts(data),
        uncoveredProposalCount: Array.isArray(data.uncoveredRequestParts)
          ? data.uncoveredRequestParts.length
          : 0,
      };
    case 'repair':
      return summarizeRepair(data);
    case 'safety_limit':
      return {
        name: stringOrNull(data.name),
        stage: stringOrNull(data.stage),
        affectedSubgoalIds: stringList(data.affectedSubgoalIds),
        truncated: data.truncated === true,
      };
    case 'final':
      return summarizeFinal(data);
    case 'usage':
      return summarizeUsage(data);
    default:
      throw new TypeError(`Unsupported trust transcript event: ${type}`);
  }
}

function recordAlwaysRedactedEvent(recorder, type, data) {
  recorder.record(type, redactValue(data).value);
}

/** Record one trusted planning control event through the transcript's redaction boundary. */
export function recordPlanningEvent(recorder, type, data = {}) {
  if (!recorder || typeof recorder.record !== 'function' || recorder.filePath === null) return;
  // Planning control events remain redacted even when legacy LOG_RAW mode is
  // enabled; they may contain rejected secret-bearing model proposals.
  recordAlwaysRedactedEvent(recorder, type, data);
}

/** Record one allowlisted trust-pipeline event without retaining model prose. */
export function recordTrustEvent(recorder, type, data = {}) {
  if (!recorder || recorder.filePath === null) return;
  if (typeof recorder.recordTrust === 'function') {
    recorder.recordTrust(type, data);
    return;
  }
  if (typeof recorder.record !== 'function') return;
  recordAlwaysRedactedEvent(recorder, type, buildTrustEventData(type, data));
}

function truncateString(value, maxChars = MAX_TRACE_STRING_CHARS) {
  if (typeof value !== 'string') return value;
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}...`;
}

function compactValue(value, depth = 0) {
  if (typeof value === 'string') return truncateString(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (depth >= MAX_TRACE_DEPTH) return MAX_TRACE_DEPTH_PLACEHOLDER;
  if (Array.isArray(value)) {
    return value.slice(0, MAX_TRACE_ITEMS).map(item => compactValue(item, depth + 1));
  }
  if (value && typeof value === 'object') {
    const output = {};
    for (const [key, nestedValue] of Object.entries(value).slice(0, MAX_TRACE_ITEMS)) {
      output[key] = compactValue(nestedValue, depth + 1);
    }
    return output;
  }
  return undefined;
}

function compactArgs(args = {}) {
  const output = {};
  if (!args || typeof args !== 'object') return output;

  for (const [key, value] of Object.entries(args)) {
    if (!TRACE_ARG_KEYS.has(key)) continue;
    const compacted = compactValue(value);
    if (compacted !== undefined) output[key] = compacted;
  }
  return output;
}

function uniqueLimited(items, limit = MAX_TRACE_ITEMS) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    if (!item || seen.has(item)) continue;
    seen.add(item);
    output.push(item);
    if (output.length >= limit) break;
  }
  return output;
}

function summarizeDefinition(definition) {
  if (!definition || typeof definition !== 'object') return null;
  return {
    path: definition.path,
    line: definition.line,
    endLine: definition.endLine,
    kind: definition.kind,
  };
}

function summarizeError(result) {
  return {
    error: true,
    type: result?.type ?? 'tool_error',
    stage: result?.stage,
    message: truncateString(result?.message ?? ''),
  };
}

function summarizeToolResult(tool, result = {}) {
  if (result?.error) return summarizeError(result);

  switch (tool) {
    case 'repo_read_file':
      return {
        path: result.path,
        startLine: result.startLine,
        endLine: result.endLine,
        totalLines: result.totalLines,
        truncated: Boolean(result.truncated),
      };
    case 'repo_grep':
      return {
        matches: Array.isArray(result.matches) ? result.matches.length : 0,
        paths: uniqueLimited((result.matches ?? []).map(match => match.path)),
        truncated: Boolean(result.truncated),
      };
    case 'repo_find_files':
      return {
        matches: Array.isArray(result.matches) ? result.matches.length : 0,
        paths: uniqueLimited(result.matches ?? []),
        truncated: Boolean(result.truncated),
      };
    case 'repo_list_dir':
      return {
        entries: Array.isArray(result.entries) ? result.entries.length : 0,
        paths: uniqueLimited((result.entries ?? []).map(entry => entry.path)),
      };
    case 'repo_symbols':
      return {
        path: result.path,
        symbols: Array.isArray(result.symbols) ? result.symbols.length : 0,
        names: uniqueLimited((result.symbols ?? []).map(symbol => symbol.name)),
      };
    case 'repo_references':
      return {
        symbol: result.symbol,
        definition: summarizeDefinition(result.definition),
        references: Array.isArray(result.references) ? result.references.length : 0,
        truncated: Boolean(result.truncated),
      };
    case 'repo_symbol_context':
      return {
        symbol: result.symbol,
        definition: summarizeDefinition(result.definition),
        callers: typeof result.callerCount === 'number' ? result.callerCount : (result.callers?.length ?? 0),
        observedRanges: Array.isArray(result.observedRanges) ? result.observedRanges.length : 0,
        truncated: Boolean(result.truncated),
      };
    case 'repo_git_log':
      return {
        commits: Array.isArray(result.commits) ? result.commits.length : 0,
        hashes: uniqueLimited((result.commits ?? []).map(commit => commit.hash ?? commit.sha)),
        truncated: Boolean(result.truncated),
      };
    case 'repo_git_blame':
      return {
        lines: Array.isArray(result.lines) ? result.lines.length : 0,
        hashes: uniqueLimited((result.lines ?? []).map(line => line.hash)),
      };
    case 'repo_git_diff':
    case 'repo_git_show':
      return {
        files: Array.isArray(result.files) ? result.files.length : 0,
        paths: uniqueLimited((result.files ?? []).map(file => file.path)),
        additions: (result.files ?? []).reduce((sum, file) => sum + (file.additions ?? 0), 0),
        deletions: (result.files ?? []).reduce((sum, file) => sum + (file.deletions ?? 0), 0),
      };
    default:
      if (Array.isArray(result.matches)) {
        return {
          matches: result.matches.length,
          paths: uniqueLimited(result.matches.map(match => match.path ?? match)),
          truncated: Boolean(result.truncated),
        };
      }
      if (result.path && Number.isInteger(result.startLine)) {
        return {
          path: result.path,
          startLine: result.startLine,
          endLine: result.endLine,
          truncated: Boolean(result.truncated),
        };
      }
      return {};
  }
}

export function buildCompactToolDiagnostic({ tool, args = {}, result = {} } = {}) {
  return {
    args: compactArgs(args),
    result: summarizeToolResult(tool, result),
  };
}

/**
 * Create an in-memory compact trace of tool calls.
 *
 * Unlike the JSONL transcript recorder, this is always available and deliberately
 * stores only small argument/result summaries. It must never include raw file
 * content, prompts, or complete tool result JSON.
 */
export function createCompactToolTrace({ maxEntries = DEFAULT_COMPACT_TRACE_LIMIT } = {}) {
  const entries = [];
  let totalCalls = 0;
  let truncated = false;

  function record({ turn, tool, args = {}, result = {} }) {
    totalCalls += 1;
    if (entries.length >= maxEntries) {
      truncated = true;
      return;
    }

    entries.push({
      turn,
      tool,
      ...buildCompactToolDiagnostic({ tool, args, result }),
    });
  }

  function toJSON() {
    return {
      entries: entries.map(entry => ({
        ...entry,
        args: { ...entry.args },
        result: { ...entry.result },
      })),
      totalCalls,
      truncated,
      maxEntries,
    };
  }

  return { record, toJSON };
}

/**
 * Create a transcript recorder for a single exploration run.
 *
 * @param {object} opts
 * @param {string} opts.repoRoot - Repository root path
 * @param {string} opts.tool - Tool name (e.g., 'explore_repo', 'explore')
 * @param {string} [opts.task] - The exploration task/prompt (first 200 chars)
 * @param {Function} [opts.logger] - Logger function for errors
 * @param {object} [opts.provenance] - Optional server-authored execution metadata
 * @returns {{ record: Function, finalize: Function, filePath: string }}
 */
export function createTranscriptRecorder({ repoRoot, tool, task, logger = () => {}, provenance = null }) {
  if (!isTranscriptEnabled()) {
    // No-op recorder when disabled
    return {
      record: () => {},
      recordTrust: () => {},
      observeUsage: () => {},
      finalize: () => Promise.resolve(),
      filePath: null,
      callId: null,
    };
  }

  const transcriptDir = resolveTranscriptDir(repoRoot);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const callId = randomUUID();
  const filename = `${timestamp}_${tool}_${callId}.jsonl`;
  const filePath = path.join(transcriptDir, filename);

  let dirCreated = false;
  let buffer = [];
  const usage = {
    providerCalls: 0,
    providerIndex: null,
    model: null,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
  const FLUSH_THRESHOLD = 5; // Flush after N buffered entries

  // Serializes all append operations so threshold-triggered fire-and-forget
  // flushes and the finalize flush can never race on the same file.
  let writeChain = Promise.resolve();

  async function ensureDir() {
    if (dirCreated) return;
    try {
      await fs.mkdir(transcriptDir, { recursive: true });
      dirCreated = true;
    } catch (err) {
      logger(`Transcript dir creation failed: ${err.message}`);
    }
  }

  async function doFlush() {
    if (buffer.length === 0) return;
    const lines = buffer.map(entry => JSON.stringify(entry)).join('\n') + '\n';
    buffer = [];
    await ensureDir();
    try {
      await fs.appendFile(filePath, lines, 'utf-8');
    } catch (err) {
      logger(`Transcript write failed: ${err.message}`);
    }
  }

  function flush() {
    writeChain = writeChain.then(() => doFlush()).catch(() => {});
    return writeChain;
  }

  /**
   * Record a message or event to the transcript.
   * @param {string} type - Message or operational event type
   * @param {object} data - Message data
   */
  function record(type, data) {
    const entryData = redactForTranscript(data ?? {});
    buffer.push({
      ...entryData,
      t: Date.now(),
      type,
      callId,
    });
    if (buffer.length >= FLUSH_THRESHOLD) {
      flush(); // fire-and-forget, serialized through writeChain
    }
  }

  function recordTrust(type, data = {}) {
    recordAlwaysRedactedEvent({ record }, type, buildTrustEventData(type, data));
  }

  function observeUsage({ providerIndex = null, model = null, usage: completionUsage = null } = {}) {
    usage.providerCalls += 1;
    if (Number.isInteger(providerIndex) && providerIndex >= 0) {
      usage.providerIndex = providerIndex;
    }
    if (typeof model === 'string' && model) usage.model = model;
    usage.inputTokens += nonNegativeInteger(completionUsage?.prompt_tokens);
    usage.outputTokens += nonNegativeInteger(completionUsage?.completion_tokens);
    usage.totalTokens += nonNegativeInteger(completionUsage?.total_tokens);
  }

  // Write initial metadata
  record('meta', {
    tool,
    task: typeof task === 'string' ? task.slice(0, 200) : '',
    repoRoot,
    startedAt: new Date().toISOString(),
    pid: process.pid,
    ...(provenance ? { provenance } : {}),
  });

  /**
   * Finalize: flush remaining buffer and write summary.
   * Awaits the full writeChain so all previously enqueued records are
   * durably written before this promise resolves.
   * @param {object} [stats] - Final stats to include
   */
  async function finalize(stats, { finalEvent = null } = {}) {
    if (stats) {
      for (const limit of Array.isArray(stats.safetyLimits) ? stats.safetyLimits : []) {
        if (!limit || typeof limit !== 'object') continue;
        recordTrust('safety_limit', limit);
      }
      if (finalEvent) recordTrust('final', finalEvent);
      recordTrust('usage', {
        ...usage,
        repositoryToolCalls: stats.toolCalls,
        elapsedMs: stats.elapsedMs,
      });
      const protectedStats = {
        ...stats,
        safetyLimits: (Array.isArray(stats.safetyLimits) ? stats.safetyLimits : [])
          .filter(limit => limit && typeof limit === 'object')
          .map(limit => buildTrustEventData('safety_limit', limit)),
      };
      recordAlwaysRedactedEvent({ record }, 'meta', {
        finishedAt: new Date().toISOString(),
        stats: protectedStats,
        redacted: !isTranscriptRawMode(),
        callId,
      });
    }
    // Route the final flush through the chain so it runs after any
    // in-flight threshold-triggered flushes, then await the chain tail.
    flush();
    await writeChain;
  }

  return { record, recordTrust, observeUsage, finalize, filePath, callId };
}
