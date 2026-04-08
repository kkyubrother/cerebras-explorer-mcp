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

export function cacheKeyListDir(dirPath, depth, maxEntries) {
  return `list_dir:${dirPath}:${depth}:${maxEntries}`;
}

export function cacheKeyFindFiles(pattern, scope) {
  const scopeStr = Array.isArray(scope) ? [...scope].sort().join(',') : '';
  return `find_files:${pattern}:${scopeStr}`;
}

export function cacheKeyGrep(pattern, caseSensitive, scope) {
  const scopeStr = Array.isArray(scope) ? [...scope].sort().join(',') : '';
  return `grep:${pattern}:${caseSensitive}:${scopeStr}`;
}

export function cacheKeyReadFile(filePath, startLine, endLine) {
  return `read_file:${filePath}:${startLine}:${endLine}`;
}

export function cacheKeyGitLog(filePath, maxCount, since, author, grep) {
  return `git_log:${filePath ?? ''}:${maxCount}:${since ?? ''}:${author ?? ''}:${grep ?? ''}`;
}

export function cacheKeyGitBlame(filePath, startLine, endLine) {
  return `git_blame:${filePath}:${startLine ?? ''}:${endLine ?? ''}`;
}

export function cacheKeyGitDiff(from, to, filePath, stat) {
  return `git_diff:${from}:${to}:${filePath ?? ''}:${stat}`;
}

export function cacheKeyGitShow(ref) {
  return `git_show:${ref}`;
}

export function cacheKeySymbols(filePath, kind) {
  return `symbols:${filePath}:${kind ?? 'all'}`;
}

export { GIT_TOOL_TTL_MS };
