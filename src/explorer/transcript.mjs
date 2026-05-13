import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

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
  const override = process.env.CEREBRAS_EXPLORER_TRANSCRIPT_DIR;
  if (override) return path.resolve(override);
  if (repoRoot) return path.resolve(repoRoot, DEFAULT_TRANSCRIPT_DIR);
  return path.resolve(process.cwd(), DEFAULT_TRANSCRIPT_DIR);
}

/**
 * Check whether transcript recording is enabled.
 * Default: disabled (opt-in via environment variable).
 */
export function isTranscriptEnabled() {
  const v = process.env.CEREBRAS_EXPLORER_TRANSCRIPT;
  if (v === undefined || v === null) return false;
  return v === '1' || v.toLowerCase() === 'true' || v.toLowerCase() === 'yes';
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
      args: compactArgs(args),
      result: summarizeToolResult(tool, result),
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
 * @param {string} opts.tool - Tool name (e.g., 'explore_repo', 'explore_v2')
 * @param {string} [opts.task] - The exploration task/prompt (first 200 chars)
 * @param {Function} [opts.logger] - Logger function for errors
 * @returns {{ record: Function, finalize: Function, filePath: string }}
 */
export function createTranscriptRecorder({ repoRoot, tool, task, logger = () => {} }) {
  if (!isTranscriptEnabled()) {
    // No-op recorder when disabled
    return {
      record: () => {},
      finalize: () => Promise.resolve(),
      filePath: null,
    };
  }

  const transcriptDir = resolveTranscriptDir(repoRoot);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const id = randomBytes(4).toString('hex');
  const filename = `${timestamp}_${tool}_${id}.jsonl`;
  const filePath = path.join(transcriptDir, filename);

  let dirCreated = false;
  let buffer = [];
  const FLUSH_THRESHOLD = 5; // Flush after N buffered entries

  async function ensureDir() {
    if (dirCreated) return;
    try {
      await fs.mkdir(transcriptDir, { recursive: true });
      dirCreated = true;
    } catch (err) {
      logger(`Transcript dir creation failed: ${err.message}`);
    }
  }

  async function flush() {
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

  /**
   * Record a message or event to the transcript.
   * @param {string} type - Message type: 'system', 'user', 'assistant', 'tool', 'meta'
   * @param {object} data - Message data
   */
  function record(type, data) {
    buffer.push({
      t: Date.now(),
      type,
      ...data,
    });
    if (buffer.length >= FLUSH_THRESHOLD) {
      flush().catch(() => {}); // fire-and-forget
    }
  }

  // Write initial metadata
  record('meta', {
    tool,
    task: typeof task === 'string' ? task.slice(0, 200) : '',
    repoRoot,
    startedAt: new Date().toISOString(),
    pid: process.pid,
  });

  /**
   * Finalize: flush remaining buffer and write summary.
   * @param {object} [stats] - Final stats to include
   */
  async function finalize(stats) {
    if (stats) {
      record('meta', { finishedAt: new Date().toISOString(), stats });
    }
    await flush();
  }

  return { record, finalize, filePath };
}
