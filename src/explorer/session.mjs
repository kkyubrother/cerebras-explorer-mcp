import { randomBytes } from 'node:crypto';

/** Default session lifetime: 30 minutes. */
const DEFAULT_TTL_MS = 30 * 60 * 1000;

/** Maximum number of explore() calls allowed per session. */
const DEFAULT_MAX_CALLS = 5;

/** Maximum number of summary entries stored per session (keep most recent). */
const MAX_SUMMARIES = 3;

/** Maximum target paths retained per session. */
const MAX_TARGET_PATHS = 50;

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
 * Deduplicate and append structured { path, why } objects by path.
 * Later entries for the same path overwrite earlier ones (most recent why wins).
 */
function dedupeContextPaths(existing, incoming, limit) {
  const map = new Map(existing.map(e => [e.path, e]));
  for (const item of incoming) {
    if (typeof item.path === 'string' && item.path) {
      map.set(item.path, { path: item.path, why: typeof item.why === 'string' ? item.why : '' });
    }
  }
  return [...map.values()].slice(0, limit);
}

/**
 * In-memory session store for stateful, multi-call exploration.
 *
 * Each session accumulates:
 *   - `targetPaths`:    files selected from compact targets across calls
 *   - `evidencePaths`:   files cited in evidence (used for context)
 *   - `summaries`:       short summaries from each call (injected into system prompt)
 *
 * Sessions expire after `ttlMs` of inactivity or after `maxCalls` explore calls.
 */
/** Interval for automatic session pruning: 5 minutes. */
const AUTO_PRUNE_INTERVAL_MS = 5 * 60 * 1000;

export class SessionStore {
  constructor({ ttlMs = DEFAULT_TTL_MS, maxCalls = DEFAULT_MAX_CALLS } = {}) {
    this._sessions = new Map();
    this._ttlMs = ttlMs;
    this._maxCalls = maxCalls;
    // Auto-prune expired sessions periodically to prevent memory leaks
    this._pruneTimer = setInterval(() => this.prune(), AUTO_PRUNE_INTERVAL_MS);
    if (this._pruneTimer.unref) this._pruneTimer.unref(); // Don't keep process alive just for pruning
  }

  /** Stop the auto-prune timer. Call during graceful shutdown. */
  destroy() {
    if (this._pruneTimer) {
      clearInterval(this._pruneTimer);
      this._pruneTimer = null;
    }
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
      targetPaths: [],
      evidencePaths: [],
      targetPathsWithContext: [],
      summaries: [],
    });
    return id;
  }

  // spec 011: SessionStore.findReusableForRepo was removed alongside
  // CEREBRAS_EXPLORER_AUTO_SESSION_BY_REPO. Multi-call continuity now
  // requires an explicit `session` argument.

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

    if (Array.isArray(result.targets) || Array.isArray(result.discoveredPaths)) {
      const targetEntries = Array.isArray(result.targets) ? result.targets : [];
      const discoveredEntries = Array.isArray(result.discoveredPaths) ? result.discoveredPaths : [];
      const newTargetPaths = [
        ...targetEntries.map(target => (typeof target?.path === 'string' ? target.path : null)),
        ...discoveredEntries.map(entry => (typeof entry?.path === 'string' ? entry.path : null)),
      ].filter(Boolean);
      session.targetPaths = dedupeAppend(
        session.targetPaths,
        newTargetPaths,
        MAX_TARGET_PATHS,
      );
      const targetPathsWithContext = [
        ...targetEntries
          .filter(target => typeof target?.path === 'string' && target.path)
          .map(target => ({ path: target.path, why: typeof target.reason === 'string' ? target.reason : '' })),
        ...discoveredEntries
          .filter(entry => typeof entry?.path === 'string' && entry.path)
          .map(entry => ({ path: entry.path, why: typeof entry.reason === 'string' ? entry.reason : '' })),
      ];
      session.targetPathsWithContext = dedupeContextPaths(
        session.targetPathsWithContext,
        targetPathsWithContext,
        MAX_TARGET_PATHS,
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
      const newPathsWithContext = result.evidence
        .filter(e => typeof e.path === 'string' && e.path)
        .map(e => ({ path: e.path, why: typeof e.why === 'string' ? e.why : '' }));
      session.targetPathsWithContext = dedupeContextPaths(
        session.targetPathsWithContext,
        newPathsWithContext,
        MAX_EVIDENCE_PATHS,
      );
    }

    const summary = typeof result.directAnswer === 'string' && result.directAnswer.trim()
      ? result.directAnswer.trim()
      : '';
    if (summary) {
      session.summaries.push(summary.slice(0, 400));
      session.summaries = session.summaries.slice(-MAX_SUMMARIES);
    }
  }

  /**
   * Returns true if the session has exhausted its call allowance.
   */
  isExhausted(id) {
    const session = this.get(id);
    return !session || session.calls >= this._maxCalls;
  }

  /**
   * Returns the number of remaining explore calls for a live session.
   * Returns null when the session is missing or expired.
   */
  getRemainingCalls(id) {
    const session = this.get(id);
    if (!session) return null;
    return Math.max(0, this._maxCalls - session.calls);
  }

  /**
   * Validate a session for reuse. Returns an object describing the outcome.
   * @param {string} id - Session ID to validate.
   * @param {string} repoRoot - Expected repo root.
   * @returns {{ ok: boolean, reason?: string, session?: object, remainingCalls?: number }}
   */
  validateForReuse(id, repoRoot) {
    if (!id || typeof id !== 'string') {
      return { ok: false, reason: 'invalid_session' };
    }
    const raw = this._sessions.get(id);
    if (!raw) {
      return { ok: false, reason: 'invalid_session' };
    }
    // Check TTL expiration
    if (Date.now() - raw.lastUsedAt > this._ttlMs) {
      this._sessions.delete(id);
      return { ok: false, reason: 'expired_session' };
    }
    // Check exhaustion
    if (raw.calls >= this._maxCalls) {
      return { ok: false, reason: 'exhausted_session' };
    }
    // Check repo root binding
    if (raw.repoRoot && repoRoot && raw.repoRoot !== repoRoot) {
      return { ok: false, reason: 'repo_mismatch' };
    }
    return {
      ok: true,
      session: raw,
      remainingCalls: this._maxCalls - raw.calls,
    };
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
