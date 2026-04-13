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
