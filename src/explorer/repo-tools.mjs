import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';

import {
  DEFAULT_GREP_FILE_MAX_BYTES,
  DEFAULT_IGNORE_DIRS,
  DEFAULT_IGNORE_FILE_SUFFIXES,
  DEFAULT_TEXT_FILE_MAX_BYTES,
  DEFAULT_WALK_FILE_LIMIT,
} from './config.mjs';
import { GIT_TOOL_TTL_MS } from './cache.mjs';
import { extractSymbols, classifyReference, detectLanguage } from './symbols.mjs';
import {
  DEFAULT_SECRET_DENY_PATTERNS,
  isSecretPath,
  secretDeniedResult,
} from './security.mjs';
import { redactText } from './redact.mjs';

const execFileAsync = promisify(execFile);

const SAFE_GIT_DIFF_ENV_UNSET = Object.freeze([
  'GIT_EXTERNAL_DIFF',
]);

function withUnsetEnv(names) {
  const env = { ...process.env };
  for (const name of names) {
    delete env[name];
  }
  return env;
}

function toPosix(input) {
  return input.split(path.sep).join('/').replace(/\\/g, '/');
}

function hasGlobSyntax(value) {
  return /[*?[]/.test(value);
}

function escapeRegex(input) {
  return input.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function isCallableUsage(reference, line = '', symbol = '') {
  if (reference.type !== 'usage') return false;
  // A source line may both begin with `export` and call the searched symbol
  // later in the declaration body. The line classifier intentionally returns
  // one primary relation, so recover this unambiguous call shape here.
  if (reference.relation === 'export' && symbol) {
    return new RegExp(`(?:^|[^.\\w$#])${escapeRegex(symbol)}\\s*(?:<[^>]+>)?\\s*\\(`).test(line);
  }
  return !['export', 'type_reference', 'property'].includes(reference.relation);
}

function symbolSearchPattern(symbol) {
  return `(^|[^\\w$#])${escapeRegex(symbol)}([^\\w$#]|$)`;
}

export function globToRegExp(glob) {
  const normalized = toPosix(glob);
  let pattern = '';

  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];

    if (char === '*') {
      const next = normalized[i + 1];
      const afterNext = normalized[i + 2];

      if (next === '*' && afterNext === '/') {
        pattern += '(?:.*/)?';
        i += 2;
        continue;
      }

      if (next === '*') {
        pattern += '.*';
        i += 1;
        continue;
      }

      pattern += '[^/]*';
      continue;
    }

    if (char === '?') {
      pattern += '[^/]';
      continue;
    }

    pattern += escapeRegex(char);
  }

  return new RegExp(`^${pattern}$`);
}

function normalizeScope(scope = []) {
  if (!Array.isArray(scope)) {
    return [];
  }

  return scope
    .filter(Boolean)
    .map(item => {
      const raw = String(item).trim();
      try {
        return sanitizeRelativePath(raw);
      } catch {
        throw new Error(`Scope must stay within repo root: ${raw}`);
      }
    })
    .map(item => item.replace(/\/+$/, ''))
    .filter(Boolean);
}

function scopePatternPrefix(pattern) {
  if (!pattern) {
    return '';
  }

  const parts = pattern.split('/').filter(Boolean);
  const prefix = [];

  for (const part of parts) {
    if (hasGlobSyntax(part)) {
      break;
    }
    prefix.push(part);
  }

  return prefix.join('/');
}

function createScopeRules(scope = []) {
  const normalizedScope = normalizeScope(scope);

  if (normalizedScope.length === 0) {
    return {
      patterns: [],
      matches: () => true,
      mayContain: () => true,
    };
  }

  const entries = normalizedScope.map(entry => {
    if (hasGlobSyntax(entry)) {
      const regex = globToRegExp(entry);
      return {
        entry,
        prefix: scopePatternPrefix(entry),
        matches: relPath => regex.test(relPath),
      };
    }

    const normalized = entry.replace(/\/$/, '');
    return {
      entry: normalized,
      prefix: normalized,
      matches: relPath => relPath === normalized || relPath.startsWith(`${normalized}/`),
    };
  });

  return {
    patterns: normalizedScope,
    matches(relPath) {
      const normalizedPath = sanitizeRelativePath(relPath);
      return entries.some(entry => entry.matches(normalizedPath));
    },
    mayContain(dirPath) {
      const normalizedDir = sanitizeRelativePath(dirPath);
      const dir = normalizedDir === '.' ? '' : normalizedDir.replace(/\/$/, '');
      return entries.some(entry => {
        if (!entry.prefix) {
          return true;
        }
        if (!dir) {
          return true;
        }
        return (
          entry.prefix === dir ||
          entry.prefix.startsWith(`${dir}/`) ||
          dir.startsWith(`${entry.prefix}/`)
        );
      });
    },
  };
}

function combineScopeRules(...rules) {
  const filtered = rules.filter(Boolean);
  return {
    matches(relPath) {
      return filtered.every(rule => rule.matches(relPath));
    },
    mayContain(dirPath) {
      return filtered.every(rule => rule.mayContain(dirPath));
    },
  };
}

function sanitizeRelativePath(inputPath) {
  const raw = toPosix(String(inputPath || '.'))
    .replace(/^\/+/, '')
    .replace(/^\.\//, '');
  const normalized = path.posix.normalize(raw || '.');
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`Path escapes repo root: ${inputPath}`);
  }
  return normalized === '' ? '.' : normalized;
}

export function normalizedRepositoryFileIdentity(filePath) {
  try {
    const relativePath = sanitizeRelativePath(filePath);
    if (relativePath === '.' || isSecretPath(relativePath).matched) return null;
    return `sha256:${createHash('sha256').update(`file\0${relativePath}`).digest('hex')}`;
  } catch {
    return null;
  }
}

function isOutsideRoot(root, targetPath) {
  const relative = path.relative(root, targetPath);
  return relative.startsWith('..') || path.isAbsolute(relative);
}

function ensureWithinRoot(root, targetPath) {
  const absolute = path.resolve(root, targetPath);
  if (isOutsideRoot(root, absolute)) {
    throw new Error(`Path escapes repo root: ${targetPath}`);
  }
  return absolute;
}

async function resolveSafePath(root, targetPath, { kind } = {}) {
  const absolute = ensureWithinRoot(root, targetPath);

  let stat;
  try {
    stat = await fs.lstat(absolute);
  } catch (error) {
    throw new Error(`Unable to access path ${targetPath}: ${error.message}`);
  }

  if (stat.isSymbolicLink()) {
    throw new Error(`Symlinks are not supported: ${targetPath}`);
  }

  let realPath;
  try {
    realPath = await fs.realpath(absolute);
  } catch (error) {
    throw new Error(`Unable to resolve path ${targetPath}: ${error.message}`);
  }

  if (isOutsideRoot(root, realPath)) {
    throw new Error(`Path resolves outside repo root: ${targetPath}`);
  }

  if (realPath !== absolute) {
    throw new Error(`Symlinks are not supported: ${targetPath}`);
  }

  if (kind === 'directory' && !stat.isDirectory()) {
    throw new Error(`Not a directory: ${targetPath}`);
  }

  if (kind === 'file' && !stat.isFile()) {
    throw new Error(`Not a regular file: ${targetPath}`);
  }

  return { absolute, realPath, stat };
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function loadGitignoreRulesAt(absDir) {
  const gitignorePath = path.join(absDir, '.gitignore');
  if (!(await pathExists(gitignorePath))) {
    return [];
  }
  const raw = await fs.readFile(gitignorePath, 'utf8');
  return raw
    .split(/\r?\n/)
    .map(line => line.trim())
    // Spec 014: negation rules (`!keep`) are silently dropped. The current
    // matcher does not model gitignore's line-precedence override semantics,
    // so admitting them would create false negatives. Document this limit
    // in DESIGN.md instead of throwing.
    .filter(line => line && !line.startsWith('#') && !line.startsWith('!'));
}

async function loadGitignoreRules(root) {
  return loadGitignoreRulesAt(root);
}

function buildGitignoreMatcher(rules) {
  const entries = rules.map(rule => {
    const normalized = toPosix(rule)
      .replace(/^\.\//, '')
      .replace(/^\//, '')
      .replace(/\/$/, '/**');
    if (hasGlobSyntax(normalized)) {
      const regex = globToRegExp(normalized);
      return relPath => regex.test(relPath);
    }
    return relPath => relPath === normalized || relPath.startsWith(`${normalized}/`);
  });
  return relPath => entries.some(match => match(relPath));
}

function buildNestedGitignoreMatcher(prefix, rules) {
  const innerMatch = buildGitignoreMatcher(rules);
  // `prefix` is a repo-root-relative POSIX path ending with '/'. The matcher
  // is single-pass: short-circuit on prefix mismatch, then evaluate the
  // inner glob against the path *relative to the nested .gitignore dir*.
  return relPath => {
    if (!relPath.startsWith(prefix)) return false;
    return innerMatch(relPath.slice(prefix.length));
  };
}

function shouldIgnorePath(relPath, dirent, gitignoreMatcher, ignoreDirs = DEFAULT_IGNORE_DIRS, nestedMatchers = [], extraPatternMatcher = null) {
  // Evaluation order is defined in specs/014-repo-specific-ignore (FR-008).
  // Secret deny-list always wins; scope is enforced earlier in callTool.
  if (dirent?.isSymbolicLink?.()) {
    return true;
  }

  if (isSecretPath(relPath).matched) {
    return true;
  }

  const parts = relPath.split('/');
  if (parts.some(part => ignoreDirs.has(part))) {
    return true;
  }
  if (!dirent.isDirectory()) {
    if (DEFAULT_IGNORE_FILE_SUFFIXES.some(suffix => relPath.endsWith(suffix))) {
      return true;
    }
  }
  if (gitignoreMatcher && gitignoreMatcher(relPath)) {
    return true;
  }
  if (nestedMatchers.length > 0) {
    for (const matcher of nestedMatchers) {
      if (matcher(relPath)) return true;
    }
  }
  if (extraPatternMatcher && extraPatternMatcher(relPath)) {
    return true;
  }
  return false;
}

function isProbablyText(buffer) {
  if (!buffer || buffer.length === 0) {
    return true;
  }
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) {
      return false;
    }
    if (byte < 7 || (byte > 14 && byte < 32)) {
      suspicious += 1;
    }
  }
  return suspicious / sample.length < 0.15;
}


function diffFilePaths(file) {
  return [file?.path, file?.oldPath]
    .filter(Boolean)
    .map(toPosix);
}

function isSecretDiffFile(file) {
  return diffFilePaths(file).some(relPath => isSecretPath(relPath).matched);
}

// git --stat renders renames as `prefix/{old => new}/suffix` or plain `old => new`.
// Reconstruct the real old AND new paths (a naive `{}`-strip + ` => ` split drops
// the shared prefix from the new side, so a secret like `.git/config` was missed
// when the new name alone was not deny-listed — audit F6).
function expandStatRenameCandidates(rawPath) {
  const p = String(rawPath ?? '').trim();
  const candidates = new Set([p]);
  const brace = p.match(/^(.*)\{(.*?) => (.*?)\}(.*)$/);
  if (brace) {
    const [, prefix, oldMid, newMid, suffix] = brace;
    const norm = mid => `${prefix}${mid}${suffix}`.replace(/\/{2,}/g, '/').trim();
    candidates.add(norm(oldMid));
    candidates.add(norm(newMid));
  } else if (/\s=>\s/.test(p)) {
    for (const part of p.split(/\s+=>\s+/)) candidates.add(part.trim());
  }
  return [...candidates].filter(Boolean);
}

export function statPathDenied(rawPath) {
  for (const candidate of expandStatRenameCandidates(rawPath)) {
    if (isSecretPath(candidate).matched) return true;
    if (isSecretPath(path.basename(candidate)).matched) return true;
  }
  return false;
}

function filterGitStatOutput(statText) {
  const kept = [];
  let omittedSecretPaths = 0;
  for (const line of String(statText ?? '').split('\n')) {
    if (!line.trim()) continue;
    if (/^\s*\d+\s+files? changed(?:,|$)/.test(line)) {
      if (omittedSecretPaths === 0) kept.push(line);
      continue;
    }
    const match = line.match(/^\s*(.+?)\s+\|/);
    if (match && statPathDenied(match[1])) {
      omittedSecretPaths += 1;
      continue;
    }
    kept.push(line);
  }
  return {
    text: kept.join('\n'),
    omittedSecretPaths,
  };
}

function filterGitStatByScope(statText, scopeRules) {
  if (!scopeRules || !Array.isArray(scopeRules.patterns) || scopeRules.patterns.length === 0) {
    return { text: String(statText ?? ''), omittedOutOfScopeFiles: 0 };
  }

  const kept = [];
  let omittedOutOfScopeFiles = 0;

  for (const line of String(statText ?? '').split('\n')) {
    if (!line.trim()) {
      kept.push(line);
      continue;
    }
    if (/^\s*\d+\s+files? changed(?:,|$)/.test(line)) {
      // Summary line — keep as-is even if filtering changes counts.
      kept.push(line);
      continue;
    }
    const match = line.match(/^\s*(.+?)\s+\|/);
    if (!match) {
      kept.push(line);
      continue;
    }
    const rawPath = match[1].trim();
    // git --stat may write rename/copy as `old => new` or `dir/{old => new}` —
    // extract every candidate segment and require at least one of them to be
    // inside scope. If we can't reliably parse the rename form, keep the line
    // so we never silently drop a summary the operator might need.
    const candidates = rawPath
      .replace(/\{([^{}]*)\}/g, ' $1 ')
      .split(/\s*=>\s*|\s+/)
      .map(part => part.trim())
      .filter(Boolean);
    if (candidates.length === 0) {
      kept.push(line);
      continue;
    }
    const anyInScope = candidates.some(candidate => scopeRules.matches(candidate));
    if (anyInScope) {
      kept.push(line);
    } else {
      omittedOutOfScopeFiles += 1;
    }
  }

  return { text: kept.join('\n'), omittedOutOfScopeFiles };
}

function parseDiffOutput(diffText) {
  const files = [];
  let current = null;
  for (const line of diffText.split('\n')) {
    if (line.startsWith('diff --git ')) {
      if (current) files.push(current);
      const match = line.match(/diff --git a\/(.*) b\/(.*)/);
      current = {
        path: match?.[2] ?? '',
        oldPath: match?.[1] ?? match?.[2] ?? '',
        additions: 0,
        deletions: 0,
        hunks: [],
        patch: '',
      };
    } else if (current) {
      // Phase 2: extract hunk headers for new-file line ranges
      const hunkMatch = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
      if (hunkMatch) {
        current.hunks.push({
          newStart: parseInt(hunkMatch[3], 10),
          newLines: parseInt(hunkMatch[4] ?? '1', 10),
        });
      }
      if (line.startsWith('+') && !line.startsWith('+++')) current.additions++;
      else if (line.startsWith('-') && !line.startsWith('---')) current.deletions++;
      current.patch += line + '\n';
    }
  }
  if (current) files.push(current);
  for (const f of files) {
    const redactedPatch = redactText(f.patch);
    f.patch = redactedPatch.text;
    if (redactedPatch.redacted) {
      f.redacted = true;
      f.redactions = redactedPatch.redactions;
    }
    if (f.patch.length > 8000) {
      f.patch = f.patch.slice(0, 8000) + '\n... (truncated)';
      f.truncated = true;
    }
  }
  return files;
}

async function detectBinary(cmd, args) {
  try {
    await execFileAsync(cmd, args, { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

// Detects regex patterns prone to catastrophic backtracking (ReDoS). The JS grep
// fallback runs regex.test() per line in-process with no execution deadline, so a nested
// quantifier on a model-supplied pattern can block the event loop (audit F3). The
// ripgrep fast path is linear-time and unaffected; this guard protects only the
// fallback (base-scope greps / environments without ripgrep).
export function isCatastrophicRegexPattern(pattern) {
  const src = String(pattern || '');
  // Nested quantifier: a group that contains an unbounded quantifier (+, *, {n,})
  // and is itself unbounded-quantified — e.g. (a+)+, (a*)*, (.*)*, ([a-z]+)+, (a+){2,}.
  // This covers the common exponential-backtracking ReDoS shapes; the bounded
  // forms (a+)? and (default )? are intentionally left alone.
  return /\([^()]*(?:[*+]|\{\d*,\d*\})[^()]*\)\s*(?:[*+]|\{\d*,\d*\})/.test(src);
}

function tryBuildRegex(pattern, caseSensitive = false) {
  const source = String(pattern || '');
  try {
    return new RegExp(source, caseSensitive ? 'g' : 'gi');
  } catch (error) {
    throw new Error(`Invalid regex pattern: ${error.message}`);
  }
}

function formatLineWindow(lines, startLine, endLine) {
  const selected = lines.slice(startLine - 1, endLine);
  return selected
    .map((line, index) => `${startLine + index} | ${line}`)
    .join('\n');
}

function dedupeArray(values) {
  return [...new Set(values)];
}

function inheritedRuntimeCount(result, key) {
  return result && Object.prototype.hasOwnProperty.call(result, key) ? result[key] : 0;
}

function inheritedSearchTelemetry(result) {
  const walkTruncated = typeof result?.walkTruncated === 'boolean'
    ? result.walkTruncated
    : false;
  const resultTruncated = typeof result?.resultTruncated === 'boolean'
    ? result.resultTruncated
    : result?.truncated === true;
  return {
    walkTruncated,
    resultTruncated,
    enumerationProven: result?.enumerationProven === true,
    errors: inheritedRuntimeCount(result, 'errors'),
    omittedSecretPaths: inheritedRuntimeCount(result, 'omittedSecretPaths'),
    omittedOutOfScopeFiles: inheritedRuntimeCount(result, 'omittedOutOfScopeFiles'),
  };
}

function addRuntimeErrorCount(value, increment) {
  return Number.isSafeInteger(value) && value >= 0 ? value + increment : value;
}

function isSafeGitRef(ref) {
  const value = String(ref || '');
  return (
    value.length > 0 &&
    /^[0-9a-zA-Z_./:^~\-]+$/.test(value) &&
    !value.startsWith('-') &&
    !value.includes('..')
  );
}

function safeGitRef(ref, label = 'ref') {
  if (!isSafeGitRef(ref)) {
    throw new Error(`Invalid ${label}: ${ref}`);
  }
  return String(ref);
}

const DEFAULT_GIT_OUTPUT_MAX_BYTES = 100 * 1024;

export class RepoToolkit {
  constructor({
    repoRoot,
    runtimeConfig,
    logger = () => {},
    cache = null,
    extraIgnoreDirs = [],
    extraIgnorePatterns = [],
  }) {
    this.repoRoot = repoRoot;
    this.repoRootReal = null;
    this.runtimeConfig = runtimeConfig;
    this.logger = logger;
    this.cache = cache;
    this.baseScopeRules = createScopeRules([]);
    this.gitignoreMatcher = null;
    this._hasRipgrep = null;
    this._hasGit = null;
    // Store extra dirs separately for passing to rg (project-specific ignores beyond defaults)
    this.extraIgnoreDirs = new Set(extraIgnoreDirs);
    // Combined ignore set: built-ins + project-specific extras
    this.ignoreDirs = extraIgnoreDirs.length > 0
      ? new Set([...DEFAULT_IGNORE_DIRS, ...extraIgnoreDirs])
      : DEFAULT_IGNORE_DIRS;
    // Spec 014: nested .gitignore matchers built lazily during traversal, and
    // a single matcher for `.cerebras-explorer.json` extraIgnorePatterns.
    this.nestedGitignoreMatchers = [];
    this.nestedGitignoreBuiltFor = new Set();
    this.extraIgnorePatterns = extraIgnorePatterns.filter(item => typeof item === 'string');
    this.extraPatternMatcher = this.extraIgnorePatterns.length > 0
      ? buildGitignoreMatcher(this.extraIgnorePatterns)
      : null;
  }

  async initialize(scope = []) {
    this.repoRootReal = await fs.realpath(this.repoRoot);
    const rules = await loadGitignoreRules(this.repoRootReal);
    this.gitignoreMatcher = rules.length ? buildGitignoreMatcher(rules) : null;
    this.baseScopeRules = createScopeRules(scope);
    this._hasRipgrep = await detectBinary('rg', ['--version']);
    this._hasGit = await detectBinary('git', ['--version']);
  }

  /**
   * Spec 014: when traversal enters a directory containing `.gitignore`,
   * build a prefix-bounded matcher so its rules apply only to descendants
   * of that directory. Idempotent — repeated entries to the same directory
   * during the lifetime of this toolkit instance build at most once.
   */
  async _ensureNestedGitignoreLoaded(absDir, relDir) {
    // Root `.gitignore` is already loaded in initialize() as
    // `this.gitignoreMatcher`. Skip it here.
    if (relDir === '.' || relDir === '') return;
    if (this.nestedGitignoreBuiltFor.has(relDir)) return;
    this.nestedGitignoreBuiltFor.add(relDir);
    const rules = await loadGitignoreRulesAt(absDir);
    if (rules.length === 0) return;
    const prefix = `${relDir}/`;
    this.nestedGitignoreMatchers.push(buildNestedGitignoreMatcher(prefix, rules));
  }

  buildEffectiveScopeRules(scope = []) {
    return combineScopeRules(this.baseScopeRules, createScopeRules(scope));
  }

  async walkFiles({ scope = [], maxFiles = this.runtimeConfig.maxWalkFiles ?? DEFAULT_WALK_FILE_LIMIT } = {}) {
    const effectiveScope = this.buildEffectiveScopeRules(scope);
    const files = [];
    const queue = ['.'];
    let errors = 0;
    let omittedSecretPaths = 0;

    while (queue.length > 0) {
      const current = queue.shift();
      let entries;
      let absoluteDir;
      try {
        const { absolute } = await resolveSafePath(this.repoRootReal, current, { kind: 'directory' });
        absoluteDir = absolute;
        entries = await fs.readdir(absolute, { withFileTypes: true });
      } catch {
        errors += 1;
        continue;
      }

      // Spec 014: pre-load nested .gitignore so siblings see the matcher.
      if (entries.some(e => e.name === '.gitignore' && e.isFile?.())) {
        await this._ensureNestedGitignoreLoaded(absoluteDir, current);
      }

      for (const entry of entries) {
        const rel = current === '.' ? entry.name : path.join(current, entry.name);
        const relPosix = sanitizeRelativePath(rel);
        const secretMatch = isSecretPath(relPosix);
        if (secretMatch.matched) {
          const relevantToBoundary = entry.isDirectory()
            ? effectiveScope.mayContain(relPosix)
            : effectiveScope.matches(relPosix);
          if (relevantToBoundary) omittedSecretPaths += 1;
          continue;
        }
        if (entry.isSymbolicLink()) {
          const relevantToBoundary = effectiveScope.matches(relPosix) ||
            effectiveScope.mayContain(relPosix);
          if (relevantToBoundary) errors += 1;
          continue;
        }
        if (shouldIgnorePath(relPosix, entry, this.gitignoreMatcher, this.ignoreDirs, this.nestedGitignoreMatchers, this.extraPatternMatcher)) {
          continue;
        }

        if (entry.isDirectory()) {
          if (!effectiveScope.mayContain(relPosix)) {
            continue;
          }
          queue.push(relPosix);
          continue;
        }

        if (!effectiveScope.matches(relPosix)) {
          continue;
        }

        files.push(relPosix);
        if (files.length > maxFiles) {
          return {
            files: files.slice(0, maxFiles),
            truncated: true,
            walkTruncated: true,
            errors,
            omittedSecretPaths,
            omittedOutOfScopeFiles: 0,
          };
        }
      }
    }

    return {
      files,
      truncated: false,
      walkTruncated: false,
      errors,
      omittedSecretPaths,
      omittedOutOfScopeFiles: 0,
    };
  }

  async listDirectory({ dirPath = '.', depth = 2, maxEntries = this.runtimeConfig.maxDirectoryEntries } = {}) {
    const relativeDir = sanitizeRelativePath(dirPath);
    const effectiveScope = this.baseScopeRules;
    if (!effectiveScope.mayContain(relativeDir)) {
      throw new Error(`Directory is outside current scope: ${relativeDir}`);
    }

    const visited = [];
    const visitLimit = maxEntries + 1;

    const walk = async (currentRel, currentDepth) => {
      if (visited.length >= visitLimit) {
        return;
      }

      let entries;
      let absoluteDir;
      try {
        const { absolute } = await resolveSafePath(this.repoRootReal, currentRel, { kind: 'directory' });
        absoluteDir = absolute;
        entries = await fs.readdir(absolute, { withFileTypes: true });
      } catch (error) {
        throw new Error(`Unable to list directory ${currentRel}: ${error.message}`);
      }

      // Spec 014: pre-load nested .gitignore so siblings see the matcher.
      if (entries.some(e => e.name === '.gitignore' && e.isFile?.())) {
        await this._ensureNestedGitignoreLoaded(absoluteDir, currentRel);
      }

      for (const entry of entries) {
        if (visited.length >= visitLimit) {
          return;
        }

        const rel = currentRel === '.' ? entry.name : `${currentRel}/${entry.name}`;
        const relPosix = sanitizeRelativePath(rel);
        if (shouldIgnorePath(relPosix, entry, this.gitignoreMatcher, this.ignoreDirs, this.nestedGitignoreMatchers, this.extraPatternMatcher)) {
          continue;
        }

        if (entry.isDirectory()) {
          if (!effectiveScope.mayContain(relPosix)) {
            continue;
          }
          visited.push({ path: relPosix, kind: 'dir' });
          if (currentDepth < depth) {
            await walk(relPosix, currentDepth + 1);
          }
          continue;
        }

        if (!effectiveScope.matches(relPosix)) {
          continue;
        }

        visited.push({ path: relPosix, kind: 'file' });
      }
    };

    await walk(relativeDir, 1);

    return {
      dirPath: relativeDir,
      entries: visited.slice(0, maxEntries),
      truncated: visited.length > maxEntries,
    };
  }

  async findFiles({ pattern, scope = [], maxResults = this.runtimeConfig.maxSearchResults } = {}) {
    if (typeof pattern !== 'string' || !pattern.trim()) {
      throw new Error('pattern is required');
    }
    const regex = globToRegExp(sanitizeRelativePath(pattern));
    const walkResult = await this.walkFiles({ scope });
    const telemetry = inheritedSearchTelemetry(walkResult);
    const allMatches = walkResult.files.filter(relPath => regex.test(relPath));
    const resultTruncated = allMatches.length > maxResults;
    const matches = allMatches.slice(0, maxResults);
    return {
      pattern,
      matches,
      ...telemetry,
      enumerationProven: true,
      resultTruncated,
      truncated: telemetry.walkTruncated || resultTruncated,
    };
  }

  async _grepWithRipgrep({ pattern, scope = [], caseSensitive = false, maxResults }) {
    const effectiveScope = this.buildEffectiveScopeRules(scope);
    const normalizedScope = normalizeScope(scope);

    // If base scope is active, skip ripgrep to guarantee scope enforcement
    if (this.baseScopeRules.patterns?.length > 0) {
      return null;
    }

    // ripgrep does not report traversal denials or partial filesystem errors.
    // Preserve a runtime-owned walk observation so a fast-path search cannot
    // claim complete enumeration merely because rg itself returned successfully.
    const walkTelemetry = inheritedSearchTelemetry(await this.walkFiles({ scope }));
    const captureLimit = maxResults + 1;

    const rgArgs = [
      '--json',
      '--no-binary',
      '--max-filesize', String(DEFAULT_GREP_FILE_MAX_BYTES),
    ];
    // Keep the ripgrep fast path aligned with walkFiles() default directory ignores.
    for (const dir of this.ignoreDirs) {
      const normalizedDir = toPosix(String(dir || ''));
      if (!normalizedDir) continue;
      rgArgs.push('--glob', `!${normalizedDir}`);
      rgArgs.push('--glob', `!${normalizedDir}/**`);
    }
    for (const pattern of DEFAULT_SECRET_DENY_PATTERNS) {
      rgArgs.push('--glob', `!${pattern}`);
    }
    // Spec 014 parity: align the ripgrep fast path with walkFiles()/findFiles(),
    // which already exclude `.cerebras-explorer.json` extraIgnorePatterns during
    // traversal. Without this, grep was the only discovery tool that surfaced
    // ignored paths.
    for (const ignorePattern of this.extraIgnorePatterns) {
      rgArgs.push('--glob', `!${ignorePattern}`);
    }
    if (!caseSensitive) rgArgs.push('--ignore-case');
    const perFileMax = captureLimit;
    rgArgs.push('--max-count', String(perFileMax));
    rgArgs.push('--', pattern);

    if (normalizedScope.length > 0) {
      for (const s of normalizedScope) {
        const prefix = scopePatternPrefix(s);
        let searchRoot;
        try {
          searchRoot = ensureWithinRoot(this.repoRootReal, prefix || '.');
        } catch {
          return null;
        }
        rgArgs.push(searchRoot);
      }
    } else {
      rgArgs.push(this.repoRootReal);
    }

    let rawOutput;
    try {
      const { stdout } = await execFileAsync('rg', rgArgs, {
        encoding: 'utf8',
        maxBuffer: DEFAULT_GIT_OUTPUT_MAX_BYTES * 2,
        cwd: this.repoRootReal,
      });
      rawOutput = stdout;
    } catch (err) {
      // exit code 1 = no matches (not an error), stderr contains real errors
      if (err.code === 1 && !err.stderr?.trim()) {
        return {
          pattern,
          caseSensitive,
          matches: [],
          ...walkTelemetry,
          enumerationProven: false,
          resultTruncated: false,
          truncated: walkTelemetry.walkTruncated,
        };
      }
      // ripgrep failed for another reason — surface via null to trigger fallback
      return null;
    }

    const matches = [];
    for (const line of rawOutput.split('\n')) {
      if (!line.trim()) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }
      if (obj.type !== 'match') continue;
      const filePath = obj.data?.path?.text;
      const lineNum = obj.data?.line_number;
      const text = obj.data?.lines?.text ?? '';
      if (!filePath || !lineNum) continue;
      const absoluteFilePath = path.resolve(this.repoRootReal, filePath);
      if (isOutsideRoot(this.repoRootReal, absoluteFilePath)) continue;
      const relPath = toPosix(path.relative(this.repoRootReal, absoluteFilePath));
      // Post-filter: enforce effectiveScope to catch glob patterns ripgrep may over-include
      if (!effectiveScope.matches(relPath)) continue;
      if (isSecretPath(relPath).matched) continue;
      if (this.extraPatternMatcher && this.extraPatternMatcher(relPath)) continue;
      matches.push({ path: relPath, line: lineNum, text: text.slice(0, 300).replace(/\n$/, '') });
      if (matches.length >= captureLimit) break;
    }

    const resultTruncated = matches.length > maxResults;

    return {
      pattern,
      caseSensitive,
      matches: matches.slice(0, maxResults),
      ...walkTelemetry,
      enumerationProven: false,
      resultTruncated,
      truncated: walkTelemetry.walkTruncated || resultTruncated,
    };
  }

  async grep({ pattern, scope = [], caseSensitive = false, maxResults = this.runtimeConfig.maxSearchResults } = {}) {
    if (typeof pattern !== 'string' || !pattern.trim()) {
      throw new Error('pattern is required');
    }

    if (this._hasRipgrep) {
      const result = await this._grepWithRipgrep({ pattern, scope, caseSensitive, maxResults });
      if (result !== null) return result;
    }

    // ReDoS guard (audit F3): the JS fallback below runs regex.test() per line with
    // no execution deadline, so a nested-quantifier pattern can block the event loop. The
    // ripgrep fast path above is linear-time; only the fallback (base-scope greps /
    // ripgrep-less environments) is reachable here, so reject the pattern instead.
    if (isCatastrophicRegexPattern(pattern)) {
      throw new Error(
        `Pattern rejected: "${pattern}" may cause catastrophic backtracking in the fallback matcher. ` +
        'Simplify it (avoid nested quantifiers like (a+)+) or narrow the scope so ripgrep can run.',
      );
    }

    const regex = tryBuildRegex(pattern, caseSensitive);
    const normalizedScope = normalizeScope(scope);
    const exactFileScope = normalizedScope.length === 1 && !hasGlobSyntax(normalizedScope[0])
      ? normalizedScope[0]
      : null;
    const walkResult = await this.walkFiles({ scope: normalizedScope });
    const walkTelemetry = inheritedSearchTelemetry(walkResult);
    const captureLimit = maxResults + 1;
    const matches = [];
    const skipped = { largeFiles: 0, binaryFiles: 0, walkLimitReached: walkTelemetry.walkTruncated };
    let searchErrors = 0;

    for (const relPath of walkResult.files) {
      if (matches.length >= captureLimit) {
        break;
      }

      if (isSecretPath(relPath).matched) {
        continue;
      }

      let safePath;
      try {
        safePath = await resolveSafePath(this.repoRootReal, relPath, { kind: 'file' });
      } catch {
        searchErrors += 1;
        continue;
      }

      const maxFileBytes = relPath === exactFileScope
        ? DEFAULT_TEXT_FILE_MAX_BYTES
        : DEFAULT_GREP_FILE_MAX_BYTES;
      if (safePath.stat.size > maxFileBytes) {
        skipped.largeFiles++;
        continue;
      }

      let buffer;
      try {
        buffer = await fs.readFile(safePath.absolute);
      } catch {
        searchErrors += 1;
        continue;
      }
      if (!isProbablyText(buffer)) {
        skipped.binaryFiles++;
        continue;
      }

      const text = buffer.toString('utf8');
      const lines = text.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        regex.lastIndex = 0;
        if (regex.test(line)) {
          matches.push({ path: relPath, line: index + 1, text: line.slice(0, 300) });
          if (matches.length >= captureLimit) {
            break;
          }
        }
      }
    }

    const resultTruncated = matches.length > maxResults ||
      skipped.largeFiles > 0 || skipped.binaryFiles > 0;

    return {
      pattern,
      caseSensitive,
      matches: matches.slice(0, maxResults),
      ...walkTelemetry,
      enumerationProven: true,
      resultTruncated,
      errors: addRuntimeErrorCount(walkTelemetry.errors, searchErrors),
      truncated: walkTelemetry.walkTruncated || resultTruncated,
      skipped,
    };
  }

  async readFile({ path: requestedPath, startLine = 1, endLine = this.runtimeConfig.maxReadLines } = {}) {
    if (typeof requestedPath !== 'string' || !requestedPath.trim()) {
      throw new Error('path is required');
    }

    const relativePath = this._enforceScopedPath(requestedPath);
    const secretMatch = isSecretPath(relativePath);
    if (secretMatch.matched) {
      return secretDeniedResult(relativePath, secretMatch);
    }
    const safePath = await resolveSafePath(this.repoRootReal, relativePath, { kind: 'file' });
    if (safePath.stat.size > DEFAULT_TEXT_FILE_MAX_BYTES) {
      throw new Error(`File is too large to read safely: ${relativePath}`);
    }

    const buffer = await fs.readFile(safePath.absolute);
    if (!isProbablyText(buffer)) {
      throw new Error(`File appears to be binary or non-text: ${relativePath}`);
    }

    const lines = buffer.toString('utf8').split(/\r?\n/);
    const safeStart = Math.max(1, Number(startLine) || 1);
    const maxSpan = this.runtimeConfig.maxReadLines;
    const requestedEnd = Math.max(safeStart, Number(endLine) || safeStart);
    const safeEnd = Math.min(lines.length, safeStart + maxSpan - 1, requestedEnd);

    return {
      path: relativePath,
      startLine: safeStart,
      endLine: safeEnd,
      totalLines: lines.length,
      truncated: safeEnd < requestedEnd || safeEnd < lines.length,
      content: formatLineWindow(lines, safeStart, safeEnd),
    };
  }

  /**
   * Extract symbol definitions from a single file.
   */
  async symbols({ path: requestedPath, kind = 'all' } = {}) {
    if (typeof requestedPath !== 'string' || !requestedPath.trim()) {
      throw new Error('path is required');
    }
    const relativePath = this._enforceScopedPath(requestedPath);
    const secretMatch = isSecretPath(relativePath);
    if (secretMatch.matched) {
      return secretDeniedResult(relativePath, secretMatch);
    }
    const safePath = await resolveSafePath(this.repoRootReal, relativePath, { kind: 'file' });

    if (safePath.stat.size > DEFAULT_TEXT_FILE_MAX_BYTES) {
      throw new Error(`File is too large to analyse: ${relativePath}`);
    }
    const buffer = await fs.readFile(safePath.absolute);
    if (!isProbablyText(buffer)) {
      throw new Error(`File appears to be binary: ${relativePath}`);
    }
    const content = buffer.toString('utf8');
    const symbolList = extractSymbols(content, relativePath, kind);
    return {
      path: relativePath,
      totalLines: content.split('\n').length,
      symbols: symbolList,
    };
  }

  /**
   * Find all references to a symbol across the codebase.
   * Returns a structured object with `definition` and `references` arrays.
   */
  async references({ symbol, scope = [] } = {}) {
    if (typeof symbol !== 'string' || !symbol.trim()) {
      throw new Error('symbol is required');
    }
    const sym = symbol.trim();
    const pattern = symbolSearchPattern(sym);
    let grepResult;
    try {
      grepResult = await this.grep({ pattern, scope, caseSensitive: true, maxResults: 60 });
    } catch {
      grepResult = await this.grep({ pattern: escapeRegex(sym), scope, caseSensitive: true, maxResults: 60 });
    }

    let definition = null;
    const references = [];

    for (const match of grepResult.matches) {
      const reference = classifyReference(match.text ?? '', sym, match.path);
      if (reference.type === 'definition' && definition === null) {
        definition = {
          path: match.path,
          line: match.line,
          context: (match.text ?? '').trim(),
          ...reference,
        };
      } else {
        references.push({
          path: match.path,
          line: match.line,
          context: (match.text ?? '').trim(),
          ...reference,
        });
      }
    }

    const telemetry = inheritedSearchTelemetry(grepResult);

    return {
      symbol: sym,
      definition,
      references,
      ...telemetry,
      truncated: telemetry.walkTruncated || telemetry.resultTruncated,
    };
  }

  /**
   * MACRO: retrieve definition body + callers in a single call.
   * Combines grep + symbols + readFile to save 2–4 turns.
   */
  async symbolContext({ symbol, scope = [], depth = 1 } = {}) {
    if (typeof symbol !== 'string' || !symbol.trim()) {
      throw new Error('symbol is required');
    }
    // Phase 4: depth is accepted but clamped to 1 — only direct callers are supported.
    const effectiveDepth = 1;
    const sym = symbol.trim();

    // Step 1: grep for all occurrences (escape special regex chars in symbol name)
    const grepResult = await this.grep({ pattern: symbolSearchPattern(sym), scope, caseSensitive: true, maxResults: this.runtimeConfig?.maxSearchResults ?? 80 });

    let definition = null;
    const callers = [];

    for (const match of grepResult.matches) {
      const reference = classifyReference(match.text ?? '', sym, match.path);
      if (reference.type === 'definition' && definition === null) {
        definition = { path: match.path, line: match.line, kind: 'unknown', endLine: null };
      } else if (isCallableUsage(reference, match.text ?? '', sym)) {
        callers.push({
          path: match.path,
          line: match.line,
          context: (match.text ?? '').trim(),
          relation: reference.relation,
        });
      }
    }

    // Step 2: refine definition via repo_symbols for exact range
    if (definition) {
      try {
        const symResult = await this.symbols({ path: definition.path });
        const found = symResult.symbols.find(s => s.name === sym);
        if (found) {
          definition = {
            ...definition,
            line: found.line,
            endLine: found.endLine,
            kind: found.kind,
            exported: found.exported,
            signature: found.signature,
            containerName: found.containerName,
            containerKind: found.containerKind,
            qualifiedName: found.qualifiedName,
          };
        }
      } catch { /* keep grep-based definition */ }

      // Step 3: read definition body
      try {
        const endLine = definition.endLine ?? definition.line + 60;
        const readResult = await this.readFile({
          path: definition.path,
          startLine: definition.line,
          endLine,
        });
        definition = { ...definition, content: readResult.content };
      } catch { /* skip body read */ }
    }

    // Step 4: deterministic, diversity-preserving truncation of callers.
    // Priority order: (a) code files first, (b) relation weight (call/member_call/
    // constructor=0, other callable usages (reference)=1), (c) true round-robin
    // per-file cap of 3, (d) stable tie-break by (path asc, line asc).
    // This ensures production callsites in code files are never crowded out by
    // non-code (e.g. markdown) mentions or by a single test file with many hits.
    const RELATION_WEIGHT = { call: 0, member_call: 0, constructor: 0 };
    const CALLER_PER_FILE_CAP = 3;
    const CALLER_TOTAL_CAP = 20;

    // Sort: code-first, then relation weight, then path asc, then line asc.
    // This establishes both per-file internal order and inter-file priority.
    const sortedCallers = callers.slice().sort((a, b) => {
      const aIsCode = detectLanguage(a.path) !== 'generic' ? 0 : 1;
      const bIsCode = detectLanguage(b.path) !== 'generic' ? 0 : 1;
      if (aIsCode !== bIsCode) return aIsCode - bIsCode;
      const aWeight = RELATION_WEIGHT[a.relation] ?? 1;
      const bWeight = RELATION_WEIGHT[b.relation] ?? 1;
      if (aWeight !== bWeight) return aWeight - bWeight;
      if (a.path < b.path) return -1;
      if (a.path > b.path) return 1;
      return a.line - b.line;
    });

    // True round-robin per-file cap: group callers by file path, preserving each
    // group's internal sorted order. Groups are ordered by their first entry's sort
    // position (i.e. the order in which each file first appears in sortedCallers),
    // so a code file with a `call` outranks a doc file with a `reference`.
    // Then iterate rounds 0..CALLER_PER_FILE_CAP-1; in each round take the round-th
    // entry from each group in group-priority order, stopping at CALLER_TOTAL_CAP.
    // This guarantees every file gets its 1st callsite before any file gets its 2nd,
    // maximising cross-file breadth while never exceeding 3 per file.
    const fileGroups = new Map(); // path → caller[]
    for (const caller of sortedCallers) {
      const group = fileGroups.get(caller.path);
      if (group) {
        group.push(caller);
      } else {
        fileGroups.set(caller.path, [caller]);
      }
    }
    const groups = [...fileGroups.values()]; // ordered by first-entry sort position

    const selectedCallers = [];
    outer: for (let round = 0; round < CALLER_PER_FILE_CAP; round++) {
      for (const group of groups) {
        if (round < group.length) {
          selectedCallers.push(group[round]);
          if (selectedCallers.length >= CALLER_TOTAL_CAP) break outer;
        }
      }
    }

    const telemetry = inheritedSearchTelemetry(grepResult);
    const macroTruncated = selectedCallers.length < callers.length;

    const observedRanges = [];

    if (definition?.path && Number.isInteger(definition.line)) {
      observedRanges.push({
        path: definition.path,
        startLine: definition.line,
        endLine: definition.endLine ?? definition.line,
        source: 'symbol_context_definition',
      });
    }

    for (const caller of selectedCallers) {
      if (caller.path && Number.isInteger(caller.line)) {
        observedRanges.push({
          path: caller.path,
          startLine: caller.line,
          endLine: caller.line,
          source: 'symbol_context_usage',
        });
      }
    }

    return {
      symbol: sym,
      definition,
      callers: selectedCallers,
      callerCount: callers.length,
      ...telemetry,
      macroTruncated,
      truncated: telemetry.walkTruncated || telemetry.resultTruncated || macroTruncated,
      effectiveDepth,
      observedRanges,
    };
  }

  /**
   * Add surrounding context lines to grep match results by re-reading files.
   * Used when contextLines > 0 in callTool('repo_grep', ...).
   */
  async _enrichMatchesWithContext(grepResult, contextLines) {
    const fileMatches = new Map();
    for (const m of grepResult.matches) {
      if (!fileMatches.has(m.path)) fileMatches.set(m.path, []);
      fileMatches.get(m.path).push(m);
    }

    const fileLines = new Map();
    for (const filePath of fileMatches.keys()) {
      if (isSecretPath(filePath).matched) {
        continue;
      }
      try {
        const safePath = await resolveSafePath(this.repoRootReal, filePath, { kind: 'file' });
        const buf = await fs.readFile(safePath.absolute);
        fileLines.set(filePath, buf.toString('utf8').split('\n'));
      } catch { /* skip unreadable files */ }
    }

    const enriched = grepResult.matches.map(m => {
      const lines = fileLines.get(m.path);
      if (!lines) return m;
      const idx = m.line - 1;
      const start = Math.max(0, idx - contextLines);
      const end = Math.min(lines.length - 1, idx + contextLines);
      const ctx = lines
        .slice(start, end + 1)
        .map((l, i) => `${start + i + 1} | ${l}`)
        .join('\n');
      return { ...m, context: ctx };
    });

    return { ...grepResult, matches: enriched };
  }

  async _runGit(args, { env } = {}) {
    if (!this._hasGit) throw new Error('git is not available');
    try {
      const { stdout } = await execFileAsync('git', args, {
        encoding: 'utf8',
        maxBuffer: DEFAULT_GIT_OUTPUT_MAX_BYTES,
        cwd: this.repoRootReal,
        ...(env ? { env } : {}),
      });
      return stdout;
    } catch (err) {
      const msg = err.stderr?.trim() || err.message || 'git command failed';
      throw new Error(`git error: ${msg}`);
    }
  }

  _enforceScopedPath(filePath) {
    const rel = sanitizeRelativePath(filePath);
    ensureWithinRoot(this.repoRootReal, path.resolve(this.repoRootReal, rel));
    if (this.baseScopeRules.patterns?.length > 0 && !this.baseScopeRules.matches(rel)) {
      throw new Error(`Path is outside current scope: ${rel}`);
    }
    return rel;
  }

  _validateGitPath(filePath) {
    if (!filePath) return null;
    const rel = this._enforceScopedPath(filePath);
    const secretMatch = isSecretPath(rel);
    if (secretMatch.matched) {
      throw new Error(`Path is denied by secret policy: ${rel}`);
    }
    return rel;
  }

  _gitScopePathspecs(patterns = this.baseScopeRules.patterns ?? []) {
    return dedupeArray(patterns.flatMap(pattern => {
      if (hasGlobSyntax(pattern)) return [`:(glob)${pattern}`];
      const normalized = pattern.replace(/\/$/, '');
      return [`:(glob)${normalized}`, `:(glob)${normalized}/**`];
    }));
  }

  _gitLogPathspecs(filePath) {
    if (!filePath) return this._gitScopePathspecs();
    const rel = sanitizeRelativePath(filePath);
    ensureWithinRoot(this.repoRootReal, path.resolve(this.repoRootReal, rel));
    if (isSecretPath(rel).matched) {
      throw new Error(`Path is denied by secret policy: ${rel}`);
    }
    const patterns = this.baseScopeRules.patterns ?? [];
    if (patterns.length === 0 || this.baseScopeRules.matches(rel)) return [rel];

    const containedPatterns = patterns.filter(pattern => {
      const prefix = scopePatternPrefix(pattern);
      return rel === '.' || (prefix && (prefix === rel || prefix.startsWith(`${rel}/`)));
    });
    if (containedPatterns.length === 0) {
      throw new Error(`Path is outside current scope: ${rel}`);
    }
    return this._gitScopePathspecs(containedPatterns);
  }

  _countGitPathOmissions(rawNames) {
    let omittedOutOfScopeFiles = 0;
    let omittedSecretPaths = 0;
    for (const rawPath of String(rawNames ?? '').split('\0').filter(Boolean)) {
      const relPath = toPosix(rawPath);
      if (isSecretPath(relPath).matched) {
        omittedSecretPaths += 1;
      } else if (!this.baseScopeRules.matches(relPath)) {
        omittedOutOfScopeFiles += 1;
      }
    }
    return { omittedOutOfScopeFiles, omittedSecretPaths };
  }

  _filterGitDiffFiles(files, { enforceScope = true } = {}) {
    let omittedOutOfScopeFiles = 0;
    let omittedSecretPaths = 0;
    const scopeActive = enforceScope && (this.baseScopeRules.patterns?.length ?? 0) > 0;

    const filtered = files
      .filter(file => {
        if (isSecretDiffFile(file)) {
          omittedSecretPaths += 1;
          return false;
        }
        if (scopeActive && !this.baseScopeRules.matches(file.path)) {
          omittedOutOfScopeFiles += 1;
          return false;
        }
        return true;
      })
      .map(({ oldPath, ...file }) => file);

    return { files: filtered, omittedOutOfScopeFiles, omittedSecretPaths };
  }

  async gitLog({ path: filePath, maxCount = 20, since, author, grep: grepFilter } = {}) {
    const count = Math.max(1, Math.min(Number(maxCount) || 20, 100));
    const args = ['log', `--format=%H|%an|%ai|%s`, `-n`, String(count + 1)];
    if (since) args.push(`--since=${since}`);
    if (author) args.push(`--author=${author}`);
    if (grepFilter) args.push(`--grep=${grepFilter}`);
    const pathspecs = this._gitLogPathspecs(filePath);
    if (pathspecs.length > 0) args.push('--', ...pathspecs);

    const output = await this._runGit(args);
    const observedCommits = output
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const pipeIdx = line.indexOf('|');
        const p2 = line.indexOf('|', pipeIdx + 1);
        const p3 = line.indexOf('|', p2 + 1);
        return {
          hash: line.slice(0, pipeIdx),
          author: line.slice(pipeIdx + 1, p2),
          date: line.slice(p2 + 1, p3),
          message: line.slice(p3 + 1),
        };
      });
    const resultTruncated = observedCommits.length > count;
    return {
      commits: observedCommits.slice(0, count),
      resultTruncated,
      truncated: resultTruncated,
    };
  }

  async gitBlame({ path: filePath, startLine, endLine } = {}) {
    if (!filePath) throw new Error('path is required');
    const rel = this._validateGitPath(filePath);
    const args = ['blame', '--porcelain'];
    if (startLine) {
      const end = endLine ?? Math.min(Number(startLine) + 49, 99999);
      args.push(`-L${startLine},${end}`);
    }
    args.push('--', rel);

    const output = await this._runGit(args);
    return {
      ...this._parseBlamePorcelain(output),
      resultTruncated: false,
      truncated: false,
    };
  }

  _parseBlamePorcelain(output) {
    const lines = [];
    const commitMeta = {};
    const rawLines = output.split('\n');
    let i = 0;
    while (i < rawLines.length) {
      const headerMatch = rawLines[i]?.match(/^([0-9a-f]{40}) \d+ (\d+)/);
      if (headerMatch) {
        const hash = headerMatch[1];
        const lineNum = parseInt(headerMatch[2], 10);
        if (!commitMeta[hash]) commitMeta[hash] = {};
        i++;
        while (i < rawLines.length && !rawLines[i].startsWith('\t')) {
          const spaceIdx = rawLines[i].indexOf(' ');
          if (spaceIdx !== -1) {
            const key = rawLines[i].slice(0, spaceIdx);
            const val = rawLines[i].slice(spaceIdx + 1);
            commitMeta[hash][key] = val;
          }
          i++;
        }
        const content = rawLines[i]?.slice(1) ?? '';
        const meta = commitMeta[hash];
        const ts = parseInt(meta['author-time'] ?? '0', 10);
        lines.push({
          line: lineNum,
          hash: hash.slice(0, 8),
          author: meta['author'] ?? '',
          date: ts ? new Date(ts * 1000).toISOString().slice(0, 10) : '',
          content,
        });
        i++;
      } else {
        i++;
      }
    }
    return { lines };
  }

  async gitDiff({ from = 'HEAD~1', to = 'HEAD', path: filePath, stat = false } = {}) {
    const safeFrom = safeGitRef(from, 'from ref');
    const safeTo = safeGitRef(to, 'to ref');
    // --no-renames keeps scope a hard boundary: a rename into scope is reported as a
    // delete(old) + add(new) pair, so the out-of-scope source path is filtered out
    // instead of surviving in `rename from <old>` patch/stat metadata.
    const args = ['-c', 'diff.external=', 'diff', '--no-ext-diff', '--no-textconv', '--no-renames'];
    if (stat) {
      args.push('--stat');
    } else {
      args.push('--unified=3');
    }
    args.push(`${safeFrom}..${safeTo}`);
    const rel = this._validateGitPath(filePath);
    const scopePathspecs = rel ? [] : this._gitScopePathspecs();
    let scopedOmissions = { omittedOutOfScopeFiles: 0, omittedSecretPaths: 0 };
    if (rel) {
      args.push('--', rel);
    } else if (scopePathspecs.length > 0) {
      const names = await this._runGit([
        '-c', 'diff.external=', 'diff', '--name-only', '-z', '--no-ext-diff', '--no-textconv', '--no-renames',
        `${safeFrom}..${safeTo}`,
      ], { env: withUnsetEnv(SAFE_GIT_DIFF_ENV_UNSET) });
      scopedOmissions = this._countGitPathOmissions(names);
      args.push('--', ...scopePathspecs);
    }

    const output = await this._runGit(args, { env: withUnsetEnv(SAFE_GIT_DIFF_ENV_UNSET) });

    if (stat) {
      const filteredStat = filterGitStatOutput(output.trim());
      const scopedStat = filterGitStatByScope(filteredStat.text, this.baseScopeRules);
      const redactedStat = redactText(scopedStat.text);
      const omittedSecretPaths = Math.max(filteredStat.omittedSecretPaths, scopedOmissions.omittedSecretPaths);
      const omittedOutOfScopeFiles = Math.max(scopedStat.omittedOutOfScopeFiles, scopedOmissions.omittedOutOfScopeFiles);
      return {
        from: safeFrom,
        to: safeTo,
        stat: redactedStat.text,
        resultTruncated: false,
        truncated: false,
        ...(omittedSecretPaths > 0 ? { omittedSecretPaths } : {}),
        ...(omittedOutOfScopeFiles > 0 ? { omittedOutOfScopeFiles } : {}),
        ...(redactedStat.redacted ? { redacted: true, redactions: redactedStat.redactions } : {}),
      };
    }

    const filtered = this._filterGitDiffFiles(parseDiffOutput(output), { enforceScope: true });
    const resultTruncated = filtered.files.some(file => file.truncated === true);
    const omittedOutOfScopeFiles = Math.max(filtered.omittedOutOfScopeFiles, scopedOmissions.omittedOutOfScopeFiles);
    const omittedSecretPaths = Math.max(filtered.omittedSecretPaths, scopedOmissions.omittedSecretPaths);
    return {
      from: safeFrom,
      to: safeTo,
      files: filtered.files,
      resultTruncated,
      truncated: resultTruncated,
      ...(omittedOutOfScopeFiles > 0 ? { omittedOutOfScopeFiles } : {}),
      ...(omittedSecretPaths > 0 ? { omittedSecretPaths } : {}),
    };
  }

  async gitShow({ ref } = {}) {
    if (!ref) throw new Error('ref is required');
    const safeRef = safeGitRef(ref);
    // Get metadata (hash, author, date, message) separately from file list
    const metaOutput = await this._runGit(['log', '-1', '--format=%H|%an|%ai|%B', safeRef]);
    const metaStr = metaOutput.trim();
    const firstNl = metaStr.indexOf('\n');
    const headerLine = firstNl === -1 ? metaStr : metaStr.slice(0, firstNl);
    const p1 = headerLine.indexOf('|');
    const p2 = headerLine.indexOf('|', p1 + 1);
    const p3 = headerLine.indexOf('|', p2 + 1);
    const hash = headerLine.slice(0, p1);
    const author = headerLine.slice(p1 + 1, p2);
    const date = headerLine.slice(p2 + 1, p3);
    const bodyFromHeader = headerLine.slice(p3 + 1);
    const bodyRest = firstNl === -1 ? '' : metaStr.slice(firstNl + 1).trim();
    const rawMessage = bodyRest ? `${bodyFromHeader}\n${bodyRest}`.trim() : bodyFromHeader.trim();
    const redactedMessage = redactText(rawMessage);

    const patchArgs = [
      '-c', 'diff.external=',
      // --no-renames: see gitDiff — prevents out-of-scope rename source paths from
      // leaking through `rename from <old>` metadata when the new path is in scope.
      'show', '--no-ext-diff', '--no-textconv', '--no-renames', '--format=', '--unified=3', safeRef,
    ];
    const scopePathspecs = this._gitScopePathspecs();
    let scopedOmissions = { omittedOutOfScopeFiles: 0, omittedSecretPaths: 0 };
    if (scopePathspecs.length > 0) {
      const names = await this._runGit([
        '-c', 'diff.external=', 'show', '--name-only', '-z', '--no-ext-diff', '--no-textconv', '--no-renames', '--format=', safeRef,
      ], { env: withUnsetEnv(SAFE_GIT_DIFF_ENV_UNSET) });
      scopedOmissions = this._countGitPathOmissions(names);
      patchArgs.push('--', ...scopePathspecs);
    }
    const patchOutput = await this._runGit(patchArgs, { env: withUnsetEnv(SAFE_GIT_DIFF_ENV_UNSET) });
    const filtered = this._filterGitDiffFiles(parseDiffOutput(patchOutput), { enforceScope: true });
    const resultTruncated = filtered.files.some(file => file.truncated === true);
    const omittedOutOfScopeFiles = Math.max(filtered.omittedOutOfScopeFiles, scopedOmissions.omittedOutOfScopeFiles);
    const omittedSecretPaths = Math.max(filtered.omittedSecretPaths, scopedOmissions.omittedSecretPaths);

    return {
      hash,
      author,
      date,
      message: redactedMessage.text,
      files: filtered.files,
      resultTruncated,
      truncated: resultTruncated,
      ...(omittedOutOfScopeFiles > 0 ? { omittedOutOfScopeFiles } : {}),
      ...(omittedSecretPaths > 0 ? { omittedSecretPaths } : {}),
      ...(redactedMessage.redacted ? { redacted: true, redactions: redactedMessage.redactions } : {}),
    };
  }

  buildToolDefinitions() {
    return [
      {
        type: 'function',
        function: {
          name: 'repo_list_dir',
          description:
            'List directories and files under a path. Use this to understand top-level structure before searching more deeply.',
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
              dirPath: { type: 'string', description: 'Relative directory path. Defaults to ".".' },
              depth: { type: 'integer', minimum: 1, maximum: 4 },
              maxEntries: { type: 'integer', minimum: 1, maximum: 500 },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'repo_find_files',
          description:
            'Find files by glob-like pattern, for example "src/**/*.ts" or "**/auth*.py".',
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
              pattern: { type: 'string' },
              scope: { type: 'array', items: { type: 'string' } },
              maxResults: { type: 'integer', minimum: 1, maximum: 200 },
            },
            required: ['pattern'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'repo_grep',
          description:
            'Search file contents with a regular expression. Use this to trace symbols, routes, config keys, or keywords. To search one file, pass scope:["relative/path"]; repo_grep has no path argument. Set contextLines to include surrounding lines in each match.',
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
              pattern: { type: 'string' },
              scope: { type: 'array', items: { type: 'string' } },
              caseSensitive: { type: 'boolean' },
              maxResults: { type: 'integer', minimum: 1, maximum: 200 },
              contextLines: { type: 'integer', minimum: 0, maximum: 5, description: 'Lines of context to include before and after each match (0–5).' },
            },
            required: ['pattern'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'repo_symbols',
          description:
            'List all symbol definitions (functions, classes, variables, types) in a file with their line numbers. More precise than grep for finding where something is defined.',
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
              path: { type: 'string', description: 'File path relative to repo root.' },
              kind: {
                type: 'string',
                enum: ['function', 'class', 'variable', 'type', 'all'],
                description: 'Filter by symbol kind. Defaults to "all".',
              },
            },
            required: ['path'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'repo_references',
          description:
            'Find likely textual references to a symbol and a likely definition, categorising each hit as import, definition, or usage. Matching is text/heuristic-based (not semantic) and results are capped (the truncated flag is set when so) — use grep/read follow-ups when complete coverage is required. Prefer over raw grep when you need structured reference information.',
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
              symbol: { type: 'string', description: 'Exact symbol name to search for.' },
              scope: { type: 'array', items: { type: 'string' }, description: 'Optional path prefixes to limit the search.' },
            },
            required: ['symbol'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'repo_symbol_context',
          description:
            'MACRO: retrieves a symbol\'s definition body and its callers in a single call. Saves 2–4 turns compared to separate grep + read + grep. Use this as the first step for any symbol-first or reference-chase task.',
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
              symbol: { type: 'string', description: 'Symbol name to analyse.' },
              scope: { type: 'array', items: { type: 'string' }, description: 'Optional path prefixes.' },
              depth: { type: 'integer', minimum: 1, maximum: 3, description: 'Caller-chain depth (currently only direct callers are supported — effectiveDepth is always 1).' },
            },
            required: ['symbol'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'repo_read_file',
          description:
            'Read a specific file range with line numbers. Prefer narrow ranges instead of whole files.',
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
              path: { type: 'string' },
              startLine: { type: 'integer', minimum: 1 },
              endLine: { type: 'integer', minimum: 1 },
            },
            required: ['path'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'repo_git_log',

          description:
            'Show recent git commit history for the repo or a specific file/directory. Use to understand "what changed recently" or "who changed this".',
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
              path: { type: 'string', description: 'Optional file or directory to filter commits.' },
              maxCount: { type: 'integer', minimum: 1, maximum: 100, description: 'Number of commits to return (default 20).' },
              since: { type: 'string', description: 'Start date filter, e.g. "2 weeks ago" or "2024-01-01".' },
              author: { type: 'string', description: 'Filter by author name or email.' },
              grep: { type: 'string', description: 'Filter by commit message keyword.' },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'repo_git_blame',

          description:
            'Show line-by-line author and commit info for a file. Use to find who wrote a specific section and why it was changed.',
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
              path: { type: 'string', description: 'File path (required).' },
              startLine: { type: 'integer', minimum: 1, description: 'First line to blame (defaults to start of file).' },
              endLine: { type: 'integer', minimum: 1, description: 'Last line to blame.' },
            },
            required: ['path'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'repo_git_diff',

          description:
            'Show changes between two commits or branches. Use to understand "what changed in a PR" or "how did this file evolve".',
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
              from: { type: 'string', description: 'Start ref (default "HEAD~1").' },
              to: { type: 'string', description: 'End ref (default "HEAD").' },
              path: { type: 'string', description: 'Optional file path to narrow the diff.' },
              stat: { type: 'boolean', description: 'Return only the diffstat summary instead of full patch.' },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'repo_git_show',

          description:
            'Show the details of a specific commit: message, author, date, and changed files with patches.',
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
              ref: { type: 'string', description: 'Commit hash, tag, or branch name (required).' },
            },
            required: ['ref'],
          },
        },
      },
    ];
  }

  _cacheGet(key) {
    return this.cache ? this.cache.get(key) : undefined;
  }

  _cacheSet(key, value, ttlMs = null, cacheMeta = undefined) {
    if (this.cache) this.cache.set(key, value, ttlMs, cacheMeta);
  }

  _baseScopeFingerprint() {
    const patterns = this.baseScopeRules.patterns ?? [];
    return patterns.length > 0 ? [...patterns].sort().join(',') : '*';
  }

  _ignoreDirsFingerprint() {
    return [...this.ignoreDirs].sort().join(',');
  }

  _extraIgnorePatternsFingerprint() {
    return this.extraIgnorePatterns.length > 0 ? [...this.extraIgnorePatterns].sort().join(',') : '';
  }

  /**
   * Build a scoped cache key that includes repoRoot, baseScopeRules, and ignoreDirs
   * so that toolkit instances with different scopes never share cache entries.
   */
  _scopedCacheKey(kind, parts = {}) {
    return JSON.stringify({
      k: kind,
      r: this.repoRootReal,
      s: this._baseScopeFingerprint(),
      i: this._ignoreDirsFingerprint(),
      x: this._extraIgnorePatternsFingerprint(),
      ...parts,
    });
  }

  async callTool(name, args) {
    validateRepoToolArguments(name, args);
    let cacheKey;
    let ttlMs = null;

    switch (name) {
      case 'repo_list_dir': {
        cacheKey = this._scopedCacheKey('list_dir', {
          dirPath: args?.dirPath ?? '.',
          depth: args?.depth ?? 2,
          maxEntries: args?.maxEntries ?? this.runtimeConfig.maxDirectoryEntries,
        });
        const cached = this._cacheGet(cacheKey);
        if (cached !== undefined) return cached;
        const result = await this.listDirectory({ dirPath: args?.dirPath, depth: args?.depth, maxEntries: args?.maxEntries });
        this._cacheSet(cacheKey, result);
        return result;
      }
      case 'repo_find_files': {
        cacheKey = this._scopedCacheKey('find_files', {
          pattern: args?.pattern ?? '',
          scope: Array.isArray(args?.scope) ? [...args.scope].sort() : [],
          maxResults: args?.maxResults ?? this.runtimeConfig.maxSearchResults,
        });
        const cached = this._cacheGet(cacheKey);
        if (cached !== undefined) return cached;
        const result = await this.findFiles({ pattern: args?.pattern, scope: args?.scope, maxResults: args?.maxResults });
        this._cacheSet(cacheKey, result);
        return result;
      }
      case 'repo_grep': {
        const ctxLines = typeof args?.contextLines === 'number' ? Math.min(Math.max(0, args.contextLines), 5) : 0;
        cacheKey = this._scopedCacheKey('grep', {
          pattern: args?.pattern ?? '',
          caseSensitive: args?.caseSensitive ?? false,
          scope: Array.isArray(args?.scope) ? [...args.scope].sort() : [],
          maxResults: args?.maxResults ?? this.runtimeConfig.maxSearchResults,
          ctxLines,
        });
        const cached = this._cacheGet(cacheKey);
        let result = cached !== undefined
          ? cached
          : await this.grep({ pattern: args?.pattern, scope: args?.scope, caseSensitive: args?.caseSensitive, maxResults: args?.maxResults });
        if (cached === undefined) this._cacheSet(cacheKey, result);
        if (ctxLines > 0 && result.matches?.length > 0) {
          result = await this._enrichMatchesWithContext(result, ctxLines);
        }
        return result;
      }
      case 'repo_read_file': {
        // Include file mtime in cache key to detect changes during exploration
        let mtimeMs = 0;
        try {
          const requestedPath = args?.path ?? '';
          const relativePath = this._enforceScopedPath(requestedPath);
          const safePath = await resolveSafePath(this.repoRootReal, relativePath, { kind: 'file' });
          mtimeMs = safePath.stat.mtimeMs ?? 0;
        } catch { /* ignore — readFile will produce proper error */ }
        cacheKey = this._scopedCacheKey('read_file', {
          path: args?.path ?? '',
          startLine: args?.startLine ?? 1,
          endLine: args?.endLine ?? this.runtimeConfig.maxReadLines,
          mtime: Math.floor(mtimeMs),
        });
        const cached = this._cacheGet(cacheKey);
        if (cached !== undefined) return cached;
        const result = await this.readFile({ path: args?.path, startLine: args?.startLine, endLine: args?.endLine });
        this._cacheSet(cacheKey, result);
        return result;
      }
      case 'repo_git_log': {
        ttlMs = GIT_TOOL_TTL_MS;
        cacheKey = this._scopedCacheKey('git_log', {
          path: args?.path ?? '',
          maxCount: args?.maxCount ?? 20,
          since: args?.since ?? '',
          author: args?.author ?? '',
          grep: args?.grep ?? '',
        });
        const cached = this._cacheGet(cacheKey);
        if (cached !== undefined) return cached;
        const result = await this.gitLog({ path: args?.path, maxCount: args?.maxCount, since: args?.since, author: args?.author, grep: args?.grep });
        this._cacheSet(cacheKey, result, ttlMs);
        return result;
      }
      case 'repo_git_blame': {
        ttlMs = GIT_TOOL_TTL_MS;
        cacheKey = this._scopedCacheKey('git_blame', {
          path: args?.path ?? '',
          startLine: args?.startLine ?? '',
          endLine: args?.endLine ?? '',
        });
        const cached = this._cacheGet(cacheKey);
        if (cached !== undefined) return cached;
        const result = await this.gitBlame({ path: args?.path, startLine: args?.startLine, endLine: args?.endLine });
        this._cacheSet(cacheKey, result, ttlMs);
        return result;
      }
      case 'repo_git_diff': {
        ttlMs = GIT_TOOL_TTL_MS;
        cacheKey = this._scopedCacheKey('git_diff', {
          from: args?.from ?? 'HEAD~1',
          to: args?.to ?? 'HEAD',
          path: args?.path ?? '',
          stat: args?.stat ?? false,
        });
        const cached = this._cacheGet(cacheKey);
        if (cached !== undefined) return cached;
        const result = await this.gitDiff({ from: args?.from, to: args?.to, path: args?.path, stat: args?.stat });
        this._cacheSet(cacheKey, result, ttlMs);
        return result;
      }
      case 'repo_git_show': {
        ttlMs = GIT_TOOL_TTL_MS;
        cacheKey = this._scopedCacheKey('git_show', { ref: args?.ref ?? '' });
        const cached = this._cacheGet(cacheKey);
        if (cached !== undefined) return cached;
        const result = await this.gitShow({ ref: args?.ref });
        this._cacheSet(cacheKey, result, ttlMs);
        return result;
      }
      case 'repo_symbols': {
        // Include file mtime in cache key to detect changes
        let symMtimeMs = 0;
        try {
          const relPath = this._enforceScopedPath(args?.path ?? '');
          const sp = await resolveSafePath(this.repoRootReal, relPath, { kind: 'file' });
          symMtimeMs = sp.stat.mtimeMs ?? 0;
        } catch { /* ignore */ }
        cacheKey = this._scopedCacheKey('symbols', {
          path: args?.path ?? '',
          kind: args?.kind ?? 'all',
          mtime: Math.floor(symMtimeMs),
        });
        const cached = this._cacheGet(cacheKey);
        if (cached !== undefined) return cached;
        const result = await this.symbols({ path: args?.path, kind: args?.kind });
        this._cacheSet(cacheKey, result);
        return result;
      }
      case 'repo_references': {
        // Not cached — always fresh (uses grep internally which is cached)
        return this.references({ symbol: args?.symbol, scope: args?.scope });
      }
      case 'repo_symbol_context': {
        // Not cached at top level — calls this.grep directly (bypasses grep cache)
        return this.symbolContext({ symbol: args?.symbol, scope: args?.scope, depth: args?.depth });
      }
      default:
        throw new Error(`Unknown repo tool: ${name}`);
    }
  }
}

const OBSERVATION_ARG_KEYS = Object.freeze({
  repo_list_dir: ['dirPath', 'depth', 'maxEntries'],
  repo_find_files: ['pattern', 'scope', 'maxResults'],
  repo_grep: ['pattern', 'scope', 'caseSensitive', 'maxResults', 'contextLines'],
  repo_symbols: ['path', 'kind'],
  repo_references: ['symbol', 'scope'],
  repo_symbol_context: ['symbol', 'scope', 'depth'],
  repo_read_file: ['path', 'startLine', 'endLine'],
  repo_git_log: ['path', 'maxCount', 'since', 'author', 'grep'],
  repo_git_blame: ['path', 'startLine', 'endLine'],
  repo_git_diff: ['from', 'to', 'path', 'stat'],
  repo_git_show: ['ref'],
});

function validateRepoToolArguments(name, args) {
  if (args === undefined || args === null) return;
  if (typeof args !== 'object' || Array.isArray(args)) {
    throw new TypeError(`Invalid tool arguments for ${name}: expected an object.`);
  }

  const allowed = OBSERVATION_ARG_KEYS[name];
  if (!allowed) return;
  const allowedSet = new Set(allowed);
  const unexpected = Object.keys(args).filter(key => !allowedSet.has(key));
  if (unexpected.length === 0) return;

  const label = unexpected.length === 1 ? 'field' : 'fields';
  const names = unexpected.map(key => `"${key}"`).join(', ');
  throw new TypeError(
    `Invalid tool arguments for ${name}: unexpected ${label} ${names}. ` +
    `Allowed fields: ${allowed.join(', ')}.`,
  );
}

const GENERATED_SOURCE_SEGMENTS = new Set([
  'build', 'coverage', 'dist', 'gen', 'generated', 'out', '.next',
]);
const FIXTURE_SOURCE_SEGMENTS = new Set([
  '__fixtures__', '__snapshots__', 'fixture', 'fixtures', 'snapshot', 'snapshots',
  'test-data', 'testdata',
]);
const DOCUMENTATION_SOURCE_SEGMENTS = new Set([
  'doc', 'docs', 'documentation',
]);
const TEST_SOURCE_SEGMENTS = new Set([
  '__tests__', 'spec', 'specs', 'test', 'tests',
]);
const CONFIG_SOURCE_SEGMENTS = new Set([
  '.github', '.kiro', 'config', 'configs', 'configuration', 'prisma', 'settings',
]);
const IMPLEMENTATION_SOURCE_EXTENSIONS = new Set([
  '.c', '.cc', '.cjs', '.cpp', '.cs', '.css', '.dart', '.fs', '.go', '.h', '.hpp',
  '.html', '.java', '.js', '.jsx', '.kt', '.kts', '.mjs', '.php', '.ps1', '.py',
  '.rb', '.rs', '.scala', '.scss', '.sh', '.sql', '.svelte', '.swift', '.ts',
  '.tsx', '.vue',
]);

/**
 * Classify a repository path without inspecting model-authored prose. Segment and
 * suffix checks are deliberately conservative: names such as `contest.mjs` and
 * `specialist.ts` must not become tests merely because they contain `test`/`spec`.
 */
export function classifySourceRole(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) return 'unknown';
  const normalized = filePath.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
  const segments = normalized.split('/').filter(Boolean);
  const filename = segments.at(-1) ?? '';
  const extension = path.extname(filename);
  const hasSegment = candidates => segments.slice(0, -1).some(segment => candidates.has(segment));

  if (hasSegment(GENERATED_SOURCE_SEGMENTS) ||
      /(?:^|[._-])generated(?:[._-]|$)/.test(filename) ||
      /^(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(filename)) {
    return 'generated';
  }
  if (hasSegment(FIXTURE_SOURCE_SEGMENTS) || extension === '.snap') return 'fixture';
  if (hasSegment(DOCUMENTATION_SOURCE_SEGMENTS) ||
      /^(?:agents|changelog|claude|contributing|design|license|readme)(?:\.[^.]+)?$/.test(filename) ||
      ['.adoc', '.md', '.mdx', '.rst'].includes(extension)) {
    return 'documentation';
  }
  if (hasSegment(TEST_SOURCE_SEGMENTS) ||
      /(?:^|[._-])(?:spec|test)(?:[._-]|$)/.test(filename)) {
    return 'test';
  }
  if (hasSegment(CONFIG_SOURCE_SEGMENTS) ||
      /^(?:config|dockerfile|makefile|package|pyproject|requirements|schema|settings|tsconfig)(?:[._-].*)?$/.test(filename) ||
      ['.conf', '.ini', '.json', '.jsonc', '.prisma', '.properties', '.toml', '.yaml', '.yml'].includes(extension)) {
    return 'config';
  }
  if (IMPLEMENTATION_SOURCE_EXTENSIONS.has(extension)) return 'implementation';
  return 'unknown';
}

function requireObservationObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  return value;
}

function isPlainObservationObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function ownValue(value, key) {
  return hasOwn(value, key) ? value[key] : undefined;
}

function cloneRedactedObservationValue(value, seen = new Set()) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return redactText(value).text;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Observation arguments require finite numbers.');
    }
    return value;
  }
  if (!value || typeof value !== 'object') {
    throw new TypeError('Observation arguments must be JSON-compatible.');
  }
  if (seen.has(value)) {
    throw new TypeError('Observation arguments must not contain cycles.');
  }

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map(item => cloneRedactedObservationValue(item, seen));
    }
    requireObservationObject(value, 'Observation argument');
    const output = {};
    for (const key of Object.keys(value).sort()) {
      const redactedKey = redactText(key).text;
      Object.defineProperty(output, redactedKey, {
        value: cloneRedactedObservationValue(value[key], seen),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return output;
  } finally {
    seen.delete(value);
  }
}

function normalizeObservationArgs(tool, args) {
  const allowedKeys = OBSERVATION_ARG_KEYS[tool];
  if (!allowedKeys) throw new TypeError(`Unsupported repository observation tool: ${tool}`);
  const value = requireObservationObject(args, 'Repository observation arguments');
  const normalized = {};
  for (const key of allowedKeys) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      normalized[key] = cloneRedactedObservationValue(value[key]);
    }
  }
  return normalized;
}

function normalizeObservationBoundary(boundary) {
  if (!Array.isArray(boundary) || boundary.some(item => typeof item !== 'string' || !item)) {
    throw new TypeError('Repository observation boundary must be a string array.');
  }
  return boundary.map(item => redactText(item).text);
}

function readNonNegativeCount(result, key) {
  if (!hasOwn(result, key)) {
    return { value: 0, valid: true };
  }
  const value = result[key];
  if (!Number.isSafeInteger(value) || value < 0) {
    return { value: 0, valid: false };
  }
  return { value, valid: true };
}

function readAliasedCount(result, keys) {
  let value = 0;
  let valid = true;
  for (const key of keys) {
    const count = readNonNegativeCount(result, key);
    value = Math.max(value, count.value);
    valid = valid && count.valid;
  }
  return { value, valid };
}

function countArrayField(result, key, predicate) {
  if (!hasOwn(result, key) || !Array.isArray(result[key])) {
    return { value: 0, valid: false };
  }
  let value = 0;
  let valid = true;
  for (const item of result[key]) {
    if (predicate(item)) value += 1;
    else valid = false;
  }
  return { value, valid };
}

function hasPath(value) {
  return Boolean(isPlainObservationObject(value) &&
    hasOwn(value, 'path') && typeof value.path === 'string' && value.path);
}

function countObservationMatches(tool, result, { policyDenied, executionError }) {
  if (policyDenied || executionError) return { value: 0, valid: true };

  switch (tool) {
    case 'repo_list_dir':
      return countArrayField(result, 'entries', hasPath);
    case 'repo_find_files':
      return countArrayField(result, 'matches', item => typeof item === 'string' && item.length > 0);
    case 'repo_grep':
      return countArrayField(result, 'matches', item =>
        hasPath(item) && hasOwn(item, 'line') &&
          Number.isSafeInteger(item.line) && item.line >= 1);
    case 'repo_symbols':
      return countArrayField(result, 'symbols', item =>
        Boolean(isPlainObservationObject(item) &&
          hasOwn(item, 'name') && typeof item.name === 'string' && item.name));
    case 'repo_references': {
      const references = countArrayField(result, 'references', hasPath);
      const definition = ownValue(result, 'definition');
      const definitionValid = hasOwn(result, 'definition') &&
        (definition === null || hasPath(definition));
      return {
        value: references.value + (hasPath(definition) ? 1 : 0),
        valid: references.valid && definitionValid,
      };
    }
    case 'repo_symbol_context': {
      const callers = countArrayField(result, 'callers', hasPath);
      const definition = ownValue(result, 'definition');
      const definitionValid = hasOwn(result, 'definition') &&
        (definition === null || hasPath(definition));
      return {
        value: callers.value + (hasPath(definition) ? 1 : 0),
        valid: callers.valid && definitionValid,
      };
    }
    case 'repo_read_file': {
      const valid = hasPath(result) &&
        hasOwn(result, 'startLine') && Number.isSafeInteger(result.startLine) && result.startLine >= 1 &&
        hasOwn(result, 'endLine') && Number.isSafeInteger(result.endLine) && result.endLine >= result.startLine &&
        hasOwn(result, 'content') && typeof result.content === 'string';
      return {
        value: valid ? 1 : 0,
        valid,
      };
    }
    case 'repo_git_log':
      return countArrayField(result, 'commits', item =>
        Boolean(isPlainObservationObject(item) &&
          hasOwn(item, 'hash') && typeof item.hash === 'string' && item.hash));
    case 'repo_git_blame':
      return countArrayField(result, 'lines', item =>
        Boolean(isPlainObservationObject(item) &&
          hasOwn(item, 'line') && Number.isSafeInteger(item.line) && item.line >= 1));
    case 'repo_git_diff':
    case 'repo_git_show':
      return countArrayField(result, 'files', hasPath);
    default:
      return { value: 0, valid: false };
  }
}

function skipStaticArrayTrivia(source, start) {
  let index = start;
  while (index < source.length) {
    if (/\s/u.test(source[index])) {
      index += 1;
      continue;
    }
    if (source[index] === '/' && source[index + 1] === '/') {
      index += 2;
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (source[index] === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2);
      if (end < 0) return -1;
      index = end + 2;
      continue;
    }
    break;
  }
  return index;
}

function scanStaticStringLiteral(source, start) {
  const quote = source[start];
  if (!['\'', '"', '`'].includes(quote)) return -1;
  let escaped = false;
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (quote === '`' && char === '$' && source[index + 1] === '{') return -1;
    if (char === quote) return index + 1;
    if ((quote === '\'' || quote === '"') && (char === '\n' || char === '\r')) return -1;
  }
  return -1;
}

function staticStringArrayItems(result) {
  if (!isPlainObservationObject(result) || ownValue(result, 'truncated') !== false) return null;
  const definition = ownValue(result, 'definition');
  const symbol = ownValue(result, 'symbol');
  if (!isPlainObservationObject(definition) || typeof symbol !== 'string' || !symbol ||
      typeof ownValue(definition, 'path') !== 'string' ||
      !Number.isSafeInteger(ownValue(definition, 'line')) ||
      !Number.isSafeInteger(ownValue(definition, 'endLine')) ||
      typeof ownValue(definition, 'content') !== 'string') return null;

  const contentLines = definition.content.split(/\r?\n/u);
  if (definition.endLine - definition.line + 1 !== contentLines.length) return null;
  const numberedLines = contentLines.map((line, offset) => {
    const match = line.match(/^(\d+) \| (.*)$/u);
    return match && Number(match[1]) === definition.line + offset ? match[2] : null;
  });
  if (numberedLines.some(line => line === null) && numberedLines.some(line => line !== null)) {
    return null;
  }
  const source = numberedLines.every(line => line !== null)
    ? numberedLines.join('\n')
    : contentLines.join('\n');
  const escapedSymbol = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const assignment = source.indexOf('=');
  if (assignment < 0 || !new RegExp(`\\b${escapedSymbol}\\b`, 'u').test(source.slice(0, assignment))) {
    return null;
  }

  let index = skipStaticArrayTrivia(source, assignment + 1);
  if (index < 0) return null;
  let frozen = false;
  if (source.startsWith('Object.freeze', index)) {
    index = skipStaticArrayTrivia(source, index + 'Object.freeze'.length);
    if (index < 0 || source[index] !== '(') return null;
    frozen = true;
    index = skipStaticArrayTrivia(source, index + 1);
  }
  if (index < 0 || source[index] !== '[') return null;
  index += 1;

  const items = [];
  while (index < source.length) {
    index = skipStaticArrayTrivia(source, index);
    if (index < 0) return null;
    if (source[index] === ']') {
      index += 1;
      break;
    }
    const itemStart = index;
    const itemEnd = scanStaticStringLiteral(source, itemStart);
    if (itemEnd < 0) return null;
    items.push(source.slice(itemStart, itemEnd));
    index = skipStaticArrayTrivia(source, itemEnd);
    if (index < 0) return null;
    if (source[index] === ',') {
      index += 1;
      continue;
    }
    if (source[index] !== ']') return null;
  }
  if (source[index - 1] !== ']') return null;

  index = skipStaticArrayTrivia(source, index);
  if (index < 0) return null;
  if (frozen) {
    if (source[index] !== ')') return null;
    index = skipStaticArrayTrivia(source, index + 1);
    if (index < 0) return null;
  }
  if (source[index] === ';') index = skipStaticArrayTrivia(source, index + 1);
  if (index < 0 || index !== source.length) return null;

  return items.map((item, itemIndex) => `sha256:${createHash('sha256')
    .update(`${definition.path}\0${itemIndex}\0${item}`)
    .digest('hex')}`);
}

function normalizedCountItemIds(tool, result, boundary) {
  if (!isPlainObservationObject(result)) return null;
  if (tool === 'repo_symbol_context') return staticStringArrayItems(result);
  const rawItems = ownValue(result, 'matches');
  if (!Array.isArray(rawItems) || !['repo_find_files', 'repo_grep'].includes(tool)) {
    return null;
  }

  const itemIds = [];
  try {
    const boundaryRules = createScopeRules(boundary);
    for (const item of rawItems) {
      if (tool === 'repo_find_files') {
        if (typeof item !== 'string' || !item) return null;
        const relativePath = sanitizeRelativePath(item);
        const identity = normalizedRepositoryFileIdentity(relativePath);
        if (!identity || !boundaryRules.matches(relativePath)) return null;
        itemIds.push(identity);
        continue;
      }
      if (!isPlainObservationObject(item) ||
          !hasOwn(item, 'path') || typeof item.path !== 'string' || !item.path ||
          !hasOwn(item, 'line') || !Number.isSafeInteger(item.line) || item.line < 1) {
        return null;
      }
      const relativePath = sanitizeRelativePath(item.path);
      if (relativePath === '.' || isSecretPath(relativePath).matched ||
          !boundaryRules.matches(relativePath)) return null;
      itemIds.push(`sha256:${createHash('sha256')
        .update(`line\0${relativePath}\0${item.line}`)
        .digest('hex')}`);
    }
  } catch {
    return null;
  }
  return itemIds;
}

function normalizedCountItemAnchors(tool, result, boundary) {
  if (tool !== 'repo_grep' || !isPlainObservationObject(result) ||
      !Array.isArray(ownValue(result, 'matches'))) {
    return null;
  }
  const anchors = [];
  try {
    const boundaryRules = createScopeRules(boundary);
    for (const item of ownValue(result, 'matches')) {
      if (!isPlainObservationObject(item) || typeof item.path !== 'string' || !item.path ||
          !Number.isSafeInteger(item.line) || item.line < 1) {
        return null;
      }
      const relativePath = sanitizeRelativePath(item.path);
      if (relativePath === '.' || isSecretPath(relativePath).matched ||
          !boundaryRules.matches(relativePath)) {
        return null;
      }
      anchors.push({ path: relativePath, line: item.line });
    }
  } catch {
    return null;
  }
  return anchors;
}

export function canonicalizeRepositoryObservationScope(scope) {
  if (!Array.isArray(scope)) {
    throw new TypeError('Effective repository observation scope must be an array.');
  }
  const normalized = normalizeScope(scope)
    .map(item => item === '.' ? '**' : item);
  return dedupeArray(normalized.length > 0 ? normalized : ['**']);
}

function observationScopeContains(broadPattern, narrowPattern) {
  if (broadPattern === narrowPattern || broadPattern === '**' || broadPattern === '**/*') return true;
  if (!broadPattern.endsWith('/**')) return false;
  const prefix = broadPattern.slice(0, -3).replace(/\/$/, '');
  return narrowPattern === prefix || narrowPattern.startsWith(`${prefix}/`);
}

function observationLiteralPrefix(pattern) {
  const wildcardIndex = pattern.search(/[?*\[]/);
  return pattern.slice(0, wildcardIndex === -1 ? pattern.length : wildcardIndex).replace(/\/$/, '');
}

function observationScopesAreDisjoint(left, right) {
  const leftPrefix = observationLiteralPrefix(left);
  const rightPrefix = observationLiteralPrefix(right);
  if (!leftPrefix || !rightPrefix) return false;
  return !(leftPrefix === rightPrefix ||
    leftPrefix.startsWith(`${rightPrefix}/`) ||
    rightPrefix.startsWith(`${leftPrefix}/`));
}

function intersectObservationBoundaries(effectiveScope, localScope) {
  const base = canonicalizeRepositoryObservationScope(effectiveScope);
  if (localScope !== undefined && !Array.isArray(localScope)) {
    throw new TypeError('Local repository observation scope must be an array.');
  }
  const local = normalizeScope(localScope).map(item => item === '.' ? '**' : item);
  if (local.length === 0) return base;

  const intersections = [];
  for (const basePattern of base) {
    for (const localPattern of local) {
      if (observationScopeContains(basePattern, localPattern)) {
        const basePrefix = basePattern.endsWith('/**')
          ? basePattern.slice(0, -3).replace(/\/$/, '')
          : null;
        intersections.push(localPattern === basePrefix ? basePattern : localPattern);
      }
      else if (observationScopeContains(localPattern, basePattern)) intersections.push(basePattern);
      else if (!observationScopesAreDisjoint(basePattern, localPattern)) {
        intersections.push(`intersection:${JSON.stringify([basePattern, localPattern])}`);
      }
    }
  }
  return dedupeArray(intersections.length > 0 ? intersections : ['empty-intersection']);
}

function pathObservationBoundary(requestedPath, effectiveScope) {
  const relativePath = sanitizeRelativePath(requestedPath);
  if (isSecretPath(relativePath).matched) return ['[REDACTED:secret-path]'];
  const effectiveRules = createScopeRules(canonicalizeRepositoryObservationScope(effectiveScope));
  return effectiveRules.matches(relativePath) ? [relativePath] : ['empty-intersection'];
}

function gitLogObservationBoundary(requestedPath, effectiveScope) {
  const exactBoundary = pathObservationBoundary(requestedPath, effectiveScope);
  if (!exactBoundary.includes('empty-intersection')) return exactBoundary;
  const intersections = intersectObservationBoundaries(effectiveScope, [requestedPath]);
  const usable = intersections.filter(item =>
    item !== 'empty-intersection' && !item.startsWith('intersection:'));
  if (usable.length > 0) return usable;

  const relativePath = sanitizeRelativePath(requestedPath).replace(/\/$/, '');
  const containedScope = canonicalizeRepositoryObservationScope(effectiveScope)
    .filter(pattern => {
      const prefix = scopePatternPrefix(pattern);
      return relativePath === '.' ||
        (prefix && (prefix === relativePath || prefix.startsWith(`${relativePath}/`)));
    });
  return containedScope.length > 0 ? containedScope : ['empty-intersection'];
}

function listDirectoryObservationBoundary(args, effectiveScope) {
  const relativeDir = sanitizeRelativePath(args?.dirPath ?? '.');
  const depth = Math.min(4, Math.max(1, Number.isInteger(args?.depth) ? args.depth : 2));
  const prefix = relativeDir === '.' ? '' : `${relativeDir.replace(/\/$/, '')}/`;
  const patterns = Array.from({ length: depth }, (_, index) => `${prefix}${'*/'.repeat(index)}*`);
  return intersectObservationBoundaries(effectiveScope, patterns);
}

function deriveObservationBoundary(tool, args, effectiveScope) {
  if (tool === 'repo_list_dir') return listDirectoryObservationBoundary(args, effectiveScope);
  if (tool === 'repo_git_log' && typeof args?.path === 'string' && args.path.trim()) {
    return gitLogObservationBoundary(args.path, effectiveScope);
  }
  if (['repo_read_file', 'repo_symbols', 'repo_git_blame', 'repo_git_diff'].includes(tool) &&
      typeof args?.path === 'string' && args.path.trim()) {
    return pathObservationBoundary(args.path, effectiveScope);
  }
  if (['repo_find_files', 'repo_grep', 'repo_references', 'repo_symbol_context'].includes(tool)) {
    return intersectObservationBoundaries(effectiveScope, args?.scope);
  }
  return canonicalizeRepositoryObservationScope(effectiveScope);
}

function booleanTelemetry(result, key) {
  const value = ownValue(result, key);
  return { value: value === true, valid: typeof value === 'boolean' };
}

function deriveToolTruncation(tool, result) {
  const walk = booleanTelemetry(result, 'walkTruncated');
  const output = booleanTelemetry(result, 'resultTruncated');
  const macro = booleanTelemetry(result, 'macroTruncated');
  const legacy = booleanTelemetry(result, 'truncated');
  const callers = ownValue(result, 'callers');
  const callerCount = ownValue(result, 'callerCount');
  const macroCountValid = Array.isArray(callers) &&
    Number.isSafeInteger(callerCount) && callerCount >= callers.length;
  const observedMacroTruncated = macroCountValid && callerCount > callers.length;
  const macroTelemetryConsistent = macroCountValid && macro.value === observedMacroTruncated;
  const toolTruncated = walk.value || output.value || macro.value ||
    observedMacroTruncated || legacy.value;

  switch (tool) {
    case 'repo_find_files':
    case 'repo_grep':
      return { toolTruncated, valid: walk.valid && output.valid };
    case 'repo_symbol_context':
      return {
        toolTruncated,
        valid: walk.valid && output.valid && macro.valid && macroTelemetryConsistent,
      };
    case 'repo_git_log':
    case 'repo_git_blame':
    case 'repo_git_diff':
    case 'repo_git_show':
      return { toolTruncated, valid: output.valid };
    case 'repo_list_dir':
    case 'repo_read_file':
      return { toolTruncated, valid: legacy.valid };
    default:
      return { toolTruncated, valid: false };
  }
}

function toolSupportsCompleteEnumeration(tool, args) {
  switch (tool) {
    case 'repo_find_files':
    case 'repo_grep':
    case 'repo_read_file':
    case 'repo_symbol_context':
      return true;
    case 'repo_git_diff':
      return Boolean((args?.from ?? 'HEAD~1') && (args?.to ?? 'HEAD'));
    case 'repo_git_show':
      return typeof args?.ref === 'string' && Boolean(args.ref.trim());
    case 'repo_git_blame':
      return typeof args?.path === 'string' && Boolean(args.path.trim());
    case 'repo_git_log':
      // Without a path, git log runs across the repository even when the
      // explorer has a narrower base scope, so it cannot certify that scope.
      return typeof args?.path === 'string' && Boolean(args.path.trim());
    // Symbol extraction is heuristic, and textual references cannot prove
    // dynamic/aliased semantic exhaustiveness on their own.
    case 'repo_symbols':
    case 'repo_references':
    // listDirectory currently returns a compact capped view without the
    // traversal denial/error telemetry required for negative certification.
    case 'repo_list_dir':
    default:
      return false;
  }
}

/**
 * Derive the runtime-owned coverage facts for one repository tool result.
 * Result-authored boundary/completeness fields are intentionally ignored.
 */
export function deriveRepositoryObservationCoverage({
  tool,
  args = {},
  result,
  effectiveScope = [],
  contextTruncated = false,
} = {}) {
  if (typeof tool !== 'string' || !tool) {
    throw new TypeError('Repository observation tool must be a non-empty string.');
  }
  normalizeObservationArgs(tool, args);

  const boundary = normalizeObservationBoundary(deriveObservationBoundary(tool, args, effectiveScope));
  const resultIsObject = isPlainObservationObject(result);
  const safeResult = resultIsObject ? result : {};
  const resultError = ownValue(safeResult, 'error');
  const policyDenied = resultError === 'redacted_by_policy' &&
    ownValue(safeResult, 'reason') === 'secret-deny-list';
  const executionError = !policyDenied && Boolean(resultError);
  const omitted = readNonNegativeCount(safeResult, 'omittedOutOfScopeFiles');
  const denied = readAliasedCount(safeResult, ['deniedPaths', 'omittedSecretPaths']);
  const reportedErrors = readNonNegativeCount(safeResult, 'errors');
  const matches = countObservationMatches(tool, safeResult, { policyDenied, executionError });
  const truncation = deriveToolTruncation(tool, safeResult);
  const contextTruncationKnown = typeof contextTruncated === 'boolean';
  const normalizedContextTruncated = contextTruncated === true;
  const omittedOutOfScopeFiles = omitted.value;
  const deniedPaths = Math.max(denied.value, policyDenied ? 1 : 0);
  const errors = Math.max(reportedErrors.value, executionError || !resultIsObject ? 1 : 0);
  const boundaryUsable = boundary.every(item =>
    item !== 'empty-intersection' &&
    !item.startsWith('intersection:') &&
    item !== '[REDACTED:secret-path]');
  const methodEnumerationProven = !['repo_find_files', 'repo_grep', 'repo_symbol_context'].includes(tool) ||
    ownValue(safeResult, 'enumerationProven') === true;
  const requestedMacroDepth = Number.isInteger(args?.depth) ? Math.max(1, args.depth) : 1;
  const macroDepthProven = tool !== 'repo_symbol_context' ||
    (Number.isSafeInteger(ownValue(safeResult, 'effectiveDepth')) &&
      ownValue(safeResult, 'effectiveDepth') >= requestedMacroDepth);

  const enumerationComplete = toolSupportsCompleteEnumeration(tool, args) &&
    boundaryUsable &&
    methodEnumerationProven &&
    macroDepthProven &&
    resultIsObject &&
    matches.valid &&
    omitted.valid &&
    denied.valid &&
    reportedErrors.valid &&
    truncation.valid &&
    contextTruncationKnown &&
    !truncation.toolTruncated &&
    !normalizedContextTruncated &&
    omittedOutOfScopeFiles === 0 &&
    deniedPaths === 0 &&
    errors === 0;

  return {
    boundary,
    toolTruncated: truncation.toolTruncated,
    contextTruncated: normalizedContextTruncated,
    omittedOutOfScopeFiles,
    deniedPaths,
    errors,
    enumerationComplete,
  };
}

export function normalizeRepositoryObservation({
  id,
  tool,
  args,
  boundary,
  enumerationCandidate = false,
  result,
  contextTruncated = false,
} = {}) {
  if (typeof id !== 'string' || !id) {
    throw new TypeError('Repository observation id must be a non-empty string.');
  }
  if (typeof tool !== 'string' || !tool) {
    throw new TypeError('Repository observation tool must be a non-empty string.');
  }

  const normalizedArgs = normalizeObservationArgs(tool, args);
  const normalizedBoundary = normalizeObservationBoundary(boundary);
  const resultIsObject = isPlainObservationObject(result);
  const safeResult = resultIsObject ? result : {};
  const resultError = ownValue(safeResult, 'error');
  const policyDenied = resultError === 'redacted_by_policy' &&
    ownValue(safeResult, 'reason') === 'secret-deny-list';
  const executionError = !policyDenied && Boolean(resultError);

  const omitted = readNonNegativeCount(safeResult, 'omittedOutOfScopeFiles');
  const denied = readAliasedCount(safeResult, ['deniedPaths', 'omittedSecretPaths']);
  const reportedErrors = readNonNegativeCount(safeResult, 'errors');
  const matchCount = countObservationMatches(tool, safeResult, { policyDenied, executionError });
  const normalizedItemIds = normalizedCountItemIds(tool, safeResult, normalizedBoundary);
  const normalizedItemAnchors = normalizedCountItemAnchors(
    tool,
    safeResult,
    normalizedBoundary,
  );
  const countIdentitiesValid = !['repo_find_files', 'repo_grep'].includes(tool) ||
    normalizedItemIds !== null;

  const omittedOutOfScopeFiles = omitted.value;
  const deniedPaths = Math.max(denied.value, policyDenied ? 1 : 0);
  const errors = Math.max(reportedErrors.value, executionError || !resultIsObject ? 1 : 0);
  const resultTruncated = ownValue(safeResult, 'truncated');
  const toolTruncationKnown = typeof resultTruncated === 'boolean';
  const toolTruncated = resultTruncated === true;
  const contextTruncationKnown = typeof contextTruncated === 'boolean';
  const normalizedContextTruncated = contextTruncated === true;

  const enumerationComplete = enumerationCandidate === true &&
    resultIsObject &&
    matchCount.valid &&
    countIdentitiesValid &&
    omitted.valid &&
    denied.valid &&
    reportedErrors.valid &&
    toolTruncationKnown &&
    contextTruncationKnown &&
    !toolTruncated &&
    !normalizedContextTruncated &&
    omittedOutOfScopeFiles === 0 &&
    deniedPaths === 0 &&
    errors === 0;

  return {
    id,
    kind: 'search',
    tool,
    normalizedArgs,
    boundary: normalizedBoundary,
    matchCount: matchCount.value,
    toolTruncated,
    contextTruncated: normalizedContextTruncated,
    omittedOutOfScopeFiles,
    deniedPaths,
    errors,
    enumerationComplete,
    ...(normalizedItemIds === null ? {} : { normalizedItemIds }),
    ...(normalizedItemAnchors === null ? {} : { normalizedItemAnchors }),
    ...(tool === 'repo_symbol_context' && normalizedItemIds !== null ? {
      deterministicMeasurement: {
        kind: 'count',
        unit: 'array_entries',
        value: normalizedItemIds.length,
      },
    } : {}),
  };
}

export function collectTargetPathsFromToolResult(toolName, result) {
  if (!result || typeof result !== 'object') {
    return [];
  }
  switch (toolName) {
    case 'repo_list_dir':
      return Array.isArray(result.entries) ? result.entries.map(entry => entry.path).filter(Boolean) : [];
    case 'repo_find_files':
      return Array.isArray(result.matches) ? result.matches.filter(Boolean) : [];
    case 'repo_grep':
      return Array.isArray(result.matches)
        ? result.matches.map(item => item.path).filter(Boolean)
        : [];
    case 'repo_read_file':
      return typeof result.path === 'string' ? [result.path] : [];
    case 'repo_git_diff':
    case 'repo_git_show':
      return Array.isArray(result.files) ? result.files.map(f => f.path).filter(Boolean) : [];
    case 'repo_git_log':
    case 'repo_git_blame':
      return [];
    case 'repo_symbols':
      return typeof result.path === 'string' ? [result.path] : [];
    case 'repo_references': {
      const paths = [];
      if (result.definition?.path) paths.push(result.definition.path);
      if (Array.isArray(result.references)) {
        for (const ref of result.references) {
          if (ref.path) paths.push(ref.path);
        }
      }
      return [...new Set(paths)];
    }
    case 'repo_symbol_context': {
      const paths = [];
      if (result.definition?.path) paths.push(result.definition.path);
      if (Array.isArray(result.callers)) {
        for (const caller of result.callers) {
          if (caller.path) paths.push(caller.path);
        }
      }
      return [...new Set(paths)];
    }
    default:
      return [];
  }
}

export function mergeTargetPaths(existing, nextValues) {
  return dedupeArray([...(existing || []), ...(nextValues || [])]);
}

function discoveredEntry({ path, kind, sourceTool, reason }) {
  if (typeof path !== 'string' || !path) return null;
  return {
    path,
    kind: kind === 'dir' || kind === 'file' ? kind : 'unknown',
    sourceTool,
    reason,
  };
}

export function collectDiscoveredPathsFromToolResult(toolName, result) {
  if (!result || typeof result !== 'object') return [];

  switch (toolName) {
    case 'repo_list_dir':
      return Array.isArray(result.entries)
        ? result.entries
            .map(entry => discoveredEntry({
              path: entry.path,
              kind: entry.kind === 'dir' ? 'dir' : entry.kind === 'file' ? 'file' : 'unknown',
              sourceTool: toolName,
              reason: 'Listed during repository discovery.',
            }))
            .filter(Boolean)
        : [];

    case 'repo_find_files':
      return Array.isArray(result.matches)
        ? result.matches
            .map(matchPath => discoveredEntry({
              path: matchPath,
              kind: 'file',
              sourceTool: toolName,
              reason: 'Matched file discovery query.',
            }))
            .filter(Boolean)
        : [];

    case 'repo_git_diff':
    case 'repo_git_show':
      return Array.isArray(result.files)
        ? result.files
            .map(file => discoveredEntry({
              path: file?.path,
              kind: 'file',
              sourceTool: toolName,
              reason: 'Changed file discovered from git metadata.',
            }))
            .filter(Boolean)
        : [];

    default: {
      const fallbackPaths = collectTargetPathsFromToolResult(toolName, result);
      return fallbackPaths.map(filePath => discoveredEntry({
        path: filePath,
        kind: 'unknown',
        sourceTool: toolName,
        reason: 'Discovered from tool result.',
      })).filter(Boolean);
    }
  }
}
