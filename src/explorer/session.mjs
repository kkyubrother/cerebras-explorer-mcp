import { randomBytes } from 'node:crypto';

/** Default session lifetime: 30 minutes. */
const DEFAULT_TTL_MS = 30 * 60 * 1000;

/** Maximum number of explore() calls allowed per session. */
const DEFAULT_MAX_CALLS = 5;

/** Maximum number of summary entries stored per session (keep most recent). */
const MAX_SUMMARIES = 3;

/** Maximum candidate paths retained per session. */
const MAX_CANDIDATE_PATHS = 50;

/** Maximum evidence file paths retained per session. */
const MAX_EVIDENCE_PATHS = 30;

function generateSessionId() {
  return 'sess_' + randomBytes(8).toString('hex');
}

function dedupeAppend(existing, incoming, limit) {
  const seen = new Set(existing);
  const result = [...existing];
  for (const item of incoming) {
    if (!seen.has(item)) {
      seen.add(item);
      result.push(item);
    }
  }
  return result.slice(0, limit);
}

/**
 * In-memory session store for stateful, multi-call exploration.
 *
 * Each session accumulates:
 *   - `candidatePaths`:  files discovered across calls (auto-injected as hints)
 *   - `evidencePaths`:   files cited in evidence (used for context)
 *   - `summaries`:       short summaries from each call (injected into system prompt)
 *   - `followups`:       structured followups from the most recent call
 *
 * Sessions expire after `ttlMs` of inactivity or after `maxCalls` explore calls.
 */
export class SessionStore {
  constructor({ ttlMs = DEFAULT_TTL_MS, maxCalls = DEFAULT_MAX_CALLS } = {}) {
    this._sessions = new Map();
    this._ttlMs = ttlMs;
    this._maxCalls = maxCalls;
  }

  /**
   * Create a new session and return its ID.
   * @param {string} repoRoot - Repo root the session is tied to.
   */
  create(repoRoot = '') {
    const id = generateSessionId();
    this._sessions.set(id, {
      id,
      repoRoot,
      calls: 0,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      candidatePaths: [],
      evidencePaths: [],
      summaries: [],
      followups: [],
    });
    return id;
  }

  /**
   * Retrieve a session by ID. Returns null if not found or expired.
   */
  get(id) {
    if (!id || typeof id !== 'string') return null;
    const session = this._sessions.get(id);
    if (!session) return null;
    if (Date.now() - session.lastUsedAt > this._ttlMs) {
      this._sessions.delete(id);
      return null;
    }
    return session;
  }

  /**
   * Update an existing session with results from a completed explore() call.
   * Merges paths and summaries, increments call counter, refreshes TTL.
   */
  update(id, result) {
    const session = this.get(id);
    if (!session) return;

    session.calls += 1;
    session.lastUsedAt = Date.now();

    if (Array.isArray(result.candidatePaths)) {
      session.candidatePaths = dedupeAppend(
        session.candidatePaths,
        result.candidatePaths,
        MAX_CANDIDATE_PATHS,
      );
    }

    if (Array.isArray(result.evidence)) {
      const newPaths = result.evidence
        .map(e => (typeof e.path === 'string' ? e.path : null))
        .filter(Boolean);
      session.evidencePaths = dedupeAppend(
        session.evidencePaths,
        newPaths,
        MAX_EVIDENCE_PATHS,
      );
    }

    if (typeof result.summary === 'string' && result.summary.trim()) {
      session.summaries.push(result.summary.slice(0, 400));
      session.summaries = session.summaries.slice(-MAX_SUMMARIES);
    }

    if (Array.isArray(result.followups)) {
      session.followups = result.followups;
    }
  }

  /**
   * Returns true if the session has exhausted its call allowance.
   */
  isExhausted(id) {
    const session = this.get(id);
    return !session || session.calls >= this._maxCalls;
  }

  /** Remove all expired sessions. Call periodically to reclaim memory. */
  prune() {
    const now = Date.now();
    for (const [id, session] of this._sessions) {
      if (now - session.lastUsedAt > this._ttlMs) {
        this._sessions.delete(id);
      }
    }
  }

  /** Number of live (non-expired) sessions. */
  get size() {
    this.prune();
    return this._sessions.size;
  }
}

/** Shared singleton — used by the MCP server by default. */
export const globalSessionStore = new SessionStore();
