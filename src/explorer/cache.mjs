const GIT_TOOL_TTL_MS = 60_000;
const MAX_CACHE_BYTES = 50 * 1024 * 1024; // 50 MB

class LruCache {
  constructor({ maxBytes = MAX_CACHE_BYTES } = {}) {
    this._map = new Map(); // key -> { value, sizeBytes, expiresAt }
    this._totalBytes = 0;
    this._maxBytes = maxBytes;
    this.hits = 0;
    this.misses = 0;
  }

  get(key) {
    const entry = this._map.get(key);
    if (!entry) {
      this.misses += 1;
      return undefined;
    }
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this._totalBytes -= entry.sizeBytes;
      this._map.delete(key);
      this.misses += 1;
      return undefined;
    }
    // Refresh position to end (most-recently-used)
    this._map.delete(key);
    this._map.set(key, entry);
    this.hits += 1;
    return entry.value;
  }

  set(key, value, ttlMs = null) {
    // Rough UTF-16 byte estimate
    const sizeBytes = JSON.stringify(value).length * 2;

    // Replace existing entry
    if (this._map.has(key)) {
      this._totalBytes -= this._map.get(key).sizeBytes;
      this._map.delete(key);
    }

    // Evict oldest entries until there is room
    while (this._totalBytes + sizeBytes > this._maxBytes && this._map.size > 0) {
      const oldestKey = this._map.keys().next().value;
      this._totalBytes -= this._map.get(oldestKey).sizeBytes;
      this._map.delete(oldestKey);
    }

    if (sizeBytes <= this._maxBytes) {
      this._map.set(key, {
        value,
        sizeBytes,
        expiresAt: ttlMs !== null ? Date.now() + ttlMs : null,
      });
      this._totalBytes += sizeBytes;
    }
  }

  clear() {
    this._map.clear();
    this._totalBytes = 0;
    this.hits = 0;
    this.misses = 0;
  }

  stats() {
    const total = this.hits + this.misses;
    return {
      cacheHits: this.hits,
      cacheMisses: this.misses,
      cacheHitRate: total > 0 ? Math.round((this.hits / total) * 1000) / 1000 : 0,
      cacheEntries: this._map.size,
      cacheSizeBytes: this._totalBytes,
    };
  }
}

// Module-level singleton: shared across all explore_repo calls in the same process.
export const globalRepoCache = new LruCache();

// --- Cache key builders ---

function scopeToken(scope) {
  return Array.isArray(scope) ? [...scope].sort().join(',') : '';
}

export function cacheKeyListDir(repoRootReal, dirPath, depth, maxEntries) {
  return `list_dir:${repoRootReal}:${dirPath}:${depth}:${maxEntries}`;
}

export function cacheKeyFindFiles(repoRootReal, pattern, scope, maxResults) {
  return `find_files:${repoRootReal}:${pattern}:${scopeToken(scope)}:${maxResults}`;
}

export function cacheKeyGrep(repoRootReal, pattern, caseSensitive, scope, maxResults, contextLines = 0) {
  return `grep:${repoRootReal}:${pattern}:${caseSensitive}:${scopeToken(scope)}:${maxResults}:${contextLines}`;
}

export function cacheKeyReadFile(repoRootReal, filePath, startLine, endLine) {
  return `read_file:${repoRootReal}:${filePath}:${startLine}:${endLine}`;
}

export function cacheKeyGitLog(repoRootReal, filePath, maxCount, since, author, grep) {
  return `git_log:${repoRootReal}:${filePath ?? ''}:${maxCount}:${since ?? ''}:${author ?? ''}:${grep ?? ''}`;
}

export function cacheKeyGitBlame(repoRootReal, filePath, startLine, endLine) {
  return `git_blame:${repoRootReal}:${filePath}:${startLine ?? ''}:${endLine ?? ''}`;
}

export function cacheKeyGitDiff(repoRootReal, from, to, filePath, stat) {
  return `git_diff:${repoRootReal}:${from}:${to}:${filePath ?? ''}:${stat}`;
}

export function cacheKeyGitShow(repoRootReal, ref) {
  return `git_show:${repoRootReal}:${ref}`;
}

export function cacheKeySymbols(repoRootReal, filePath, kind) {
  return `symbols:${repoRootReal}:${filePath}:${kind ?? 'all'}`;
}

export { GIT_TOOL_TTL_MS };
