import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  DEFAULT_GREP_FILE_MAX_BYTES,
  DEFAULT_IGNORE_DIRS,
  DEFAULT_IGNORE_FILE_SUFFIXES,
  DEFAULT_TEXT_FILE_MAX_BYTES,
  DEFAULT_WALK_FILE_LIMIT,
} from './config.mjs';
import {
  GIT_TOOL_TTL_MS,
  cacheKeyListDir,
  cacheKeyFindFiles,
  cacheKeyGrep,
  cacheKeyReadFile,
  cacheKeyGitLog,
  cacheKeyGitBlame,
  cacheKeyGitDiff,
  cacheKeyGitShow,
} from './cache.mjs';

function toPosix(input) {
  return input.split(path.sep).join('/');
}

function hasGlobSyntax(value) {
  return /[*?[]/.test(value);
}

function escapeRegex(input) {
  return input.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
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
  return Array.isArray(scope)
    ? scope
        .filter(Boolean)
        .map(item => toPosix(String(item).trim().replace(/^\.\//, '').replace(/^\//, '')))
        .map(item => item.replace(/\/+$/, ''))
        .filter(Boolean)
    : [];
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
  const normalized = toPosix(String(inputPath || '.')).replace(/^\.\//, '').replace(/^\//, '');
  return normalized || '.';
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

async function loadGitignoreRules(root) {
  const gitignorePath = path.join(root, '.gitignore');
  if (!(await pathExists(gitignorePath))) {
    return [];
  }
  const raw = await fs.readFile(gitignorePath, 'utf8');
  return raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
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

function shouldIgnorePath(relPath, dirent, gitignoreMatcher) {
  if (dirent?.isSymbolicLink?.()) {
    return true;
  }

  const parts = relPath.split('/');
  if (parts.some(part => DEFAULT_IGNORE_DIRS.has(part))) {
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

function parseDiffOutput(diffText) {
  const files = [];
  let current = null;
  for (const line of diffText.split('\n')) {
    if (line.startsWith('diff --git ')) {
      if (current) files.push(current);
      const match = line.match(/diff --git a\/(.*) b\/(.*)/);
      current = { path: match?.[2] ?? '', additions: 0, deletions: 0, patch: '' };
    } else if (current) {
      if (line.startsWith('+') && !line.startsWith('+++')) current.additions++;
      else if (line.startsWith('-') && !line.startsWith('---')) current.deletions++;
      current.patch += line + '\n';
    }
  }
  if (current) files.push(current);
  for (const f of files) {
    if (f.patch.length > 8000) {
      f.patch = f.patch.slice(0, 8000) + '\n... (truncated)';
    }
  }
  return files;
}

function detectBinary(cmd, args) {
  try {
    execFileSync(cmd, args, { stdio: 'pipe', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
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

const DEFAULT_GIT_OUTPUT_MAX_BYTES = 100 * 1024;

export class RepoToolkit {
  constructor({
    repoRoot,
    budgetConfig,
    logger = () => {},
    cache = null,
  }) {
    this.repoRoot = repoRoot;
    this.repoRootReal = null;
    this.budgetConfig = budgetConfig;
    this.logger = logger;
    this.cache = cache;
    this.baseScopeRules = createScopeRules([]);
    this.gitignoreMatcher = null;
    this._hasRipgrep = null;
    this._hasGit = null;
  }

  async initialize(scope = []) {
    this.repoRootReal = await fs.realpath(this.repoRoot);
    const rules = await loadGitignoreRules(this.repoRootReal);
    this.gitignoreMatcher = rules.length ? buildGitignoreMatcher(rules) : null;
    this.baseScopeRules = createScopeRules(scope);
    this._hasRipgrep = detectBinary('rg', ['--version']);
    this._hasGit = detectBinary('git', ['--version']);
  }

  buildEffectiveScopeRules(scope = []) {
    return combineScopeRules(this.baseScopeRules, createScopeRules(scope));
  }

  async walkFiles({ scope = [], maxFiles = this.budgetConfig.maxWalkFiles ?? DEFAULT_WALK_FILE_LIMIT } = {}) {
    const effectiveScope = this.buildEffectiveScopeRules(scope);
    const files = [];
    const queue = ['.'];

    while (queue.length > 0) {
      const current = queue.shift();
      let entries;
      try {
        const { absolute } = await resolveSafePath(this.repoRootReal, current, { kind: 'directory' });
        entries = await fs.readdir(absolute, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        const rel = current === '.' ? entry.name : path.join(current, entry.name);
        const relPosix = sanitizeRelativePath(rel);
        if (shouldIgnorePath(relPosix, entry, this.gitignoreMatcher)) {
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
        if (files.length >= maxFiles) {
          return { files, truncated: true };
        }
      }
    }

    return { files, truncated: false };
  }

  async listDirectory({ dirPath = '.', depth = 2, maxEntries = this.budgetConfig.maxDirectoryEntries } = {}) {
    const relativeDir = sanitizeRelativePath(dirPath);
    const effectiveScope = this.baseScopeRules;
    if (!effectiveScope.mayContain(relativeDir)) {
      throw new Error(`Directory is outside current scope: ${relativeDir}`);
    }

    const visited = [];

    const walk = async (currentRel, currentDepth) => {
      if (visited.length >= maxEntries) {
        return;
      }

      let entries;
      try {
        const { absolute } = await resolveSafePath(this.repoRootReal, currentRel, { kind: 'directory' });
        entries = await fs.readdir(absolute, { withFileTypes: true });
      } catch (error) {
        throw new Error(`Unable to list directory ${currentRel}: ${error.message}`);
      }

      for (const entry of entries) {
        if (visited.length >= maxEntries) {
          return;
        }

        const rel = currentRel === '.' ? entry.name : `${currentRel}/${entry.name}`;
        const relPosix = sanitizeRelativePath(rel);
        if (shouldIgnorePath(relPosix, entry, this.gitignoreMatcher)) {
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
      entries: visited,
      truncated: visited.length >= maxEntries,
    };
  }

  async findFiles({ pattern, scope = [], maxResults = this.budgetConfig.maxSearchResults } = {}) {
    if (typeof pattern !== 'string' || !pattern.trim()) {
      throw new Error('pattern is required');
    }
    const regex = globToRegExp(sanitizeRelativePath(pattern));
    const { files, truncated } = await this.walkFiles({ scope });
    const matches = files.filter(relPath => regex.test(relPath)).slice(0, maxResults);
    return {
      pattern,
      matches,
      truncated: truncated || matches.length >= maxResults,
    };
  }

  _grepWithRipgrep({ pattern, scope = [], caseSensitive = false, maxResults }) {
    const rgArgs = [
      '--json',
      '--no-binary',
      '--max-filesize', '256K',
      '--glob', '!.git',
    ];
    if (!caseSensitive) rgArgs.push('--ignore-case');
    const perFileMax = Math.min(maxResults, 50);
    rgArgs.push('--max-count', String(perFileMax));
    rgArgs.push('--', pattern);

    const normalizedScope = normalizeScope(scope);
    if (normalizedScope.length > 0) {
      for (const s of normalizedScope) {
        rgArgs.push(path.join(this.repoRootReal, s));
      }
    } else {
      rgArgs.push(this.repoRootReal);
    }

    let rawOutput;
    try {
      rawOutput = execFileSync('rg', rgArgs, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: DEFAULT_GIT_OUTPUT_MAX_BYTES * 2,
        cwd: this.repoRootReal,
      });
    } catch (err) {
      // exit code 1 = no matches (not an error), stderr contains real errors
      if (err.status === 1 && !err.stderr?.trim()) {
        return { pattern, caseSensitive, matches: [], truncated: false };
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
      const relPath = toPosix(path.relative(this.repoRootReal, filePath));
      matches.push({ path: relPath, line: lineNum, text: text.slice(0, 300).replace(/\n$/, '') });
      if (matches.length >= maxResults) break;
    }

    return {
      pattern,
      caseSensitive,
      matches,
      truncated: matches.length >= maxResults,
    };
  }

  async grep({ pattern, scope = [], caseSensitive = false, maxResults = this.budgetConfig.maxSearchResults } = {}) {
    if (typeof pattern !== 'string' || !pattern.trim()) {
      throw new Error('pattern is required');
    }

    if (this._hasRipgrep) {
      const result = this._grepWithRipgrep({ pattern, scope, caseSensitive, maxResults });
      if (result !== null) return result;
    }

    const regex = tryBuildRegex(pattern, caseSensitive);
    const { files, truncated: walkTruncated } = await this.walkFiles({ scope });
    const matches = [];

    for (const relPath of files) {
      if (matches.length >= maxResults) {
        break;
      }

      let safePath;
      try {
        safePath = await resolveSafePath(this.repoRootReal, relPath, { kind: 'file' });
      } catch {
        continue;
      }

      if (safePath.stat.size > DEFAULT_GREP_FILE_MAX_BYTES) {
        continue;
      }

      let buffer;
      try {
        buffer = await fs.readFile(safePath.absolute);
      } catch {
        continue;
      }
      if (!isProbablyText(buffer)) {
        continue;
      }

      const text = buffer.toString('utf8');
      const lines = text.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        regex.lastIndex = 0;
        if (regex.test(line)) {
          matches.push({ path: relPath, line: index + 1, text: line.slice(0, 300) });
          if (matches.length >= maxResults) {
            break;
          }
        }
      }
    }

    return {
      pattern,
      caseSensitive,
      matches,
      truncated: walkTruncated || matches.length >= maxResults,
    };
  }

  async readFile({ path: requestedPath, startLine = 1, endLine = this.budgetConfig.maxReadLines } = {}) {
    if (typeof requestedPath !== 'string' || !requestedPath.trim()) {
      throw new Error('path is required');
    }

    const relativePath = sanitizeRelativePath(requestedPath);
    if (!this.baseScopeRules.matches(relativePath)) {
      throw new Error(`Path is outside current scope: ${relativePath}`);
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
    const maxSpan = this.budgetConfig.maxReadLines;
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

  _runGit(args) {
    if (!this._hasGit) throw new Error('git is not available');
    let output;
    try {
      output = execFileSync('git', args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: DEFAULT_GIT_OUTPUT_MAX_BYTES,
        cwd: this.repoRootReal,
      });
    } catch (err) {
      const msg = err.stderr?.trim() || err.message || 'git command failed';
      throw new Error(`git error: ${msg}`);
    }
    return output;
  }

  _validateGitPath(filePath) {
    if (!filePath) return null;
    const rel = sanitizeRelativePath(filePath);
    ensureWithinRoot(this.repoRootReal, path.resolve(this.repoRootReal, rel));
    return rel;
  }

  async gitLog({ path: filePath, maxCount = 20, since, author, grep: grepFilter } = {}) {
    const count = Math.min(Number(maxCount) || 20, 100);
    const args = ['log', `--format=%H|%an|%ai|%s`, `-n`, String(count)];
    if (since) args.push(`--since=${since}`);
    if (author) args.push(`--author=${author}`);
    if (grepFilter) args.push(`--grep=${grepFilter}`);
    const rel = this._validateGitPath(filePath);
    if (rel) args.push('--', rel);

    const output = this._runGit(args);
    const commits = output
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
    return { commits };
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

    const output = this._runGit(args);
    return this._parseBlamePorcelain(output);
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
    const args = ['diff'];
    if (stat) {
      args.push('--stat');
    } else {
      args.push('--unified=3');
    }
    args.push(`${from}..${to}`);
    const rel = this._validateGitPath(filePath);
    if (rel) args.push('--', rel);

    const output = this._runGit(args);

    if (stat) {
      return { from, to, stat: output.trim() };
    }

    const files = parseDiffOutput(output);
    return { from, to, files };
  }

  async gitShow({ ref } = {}) {
    if (!ref) throw new Error('ref is required');
    // Validate ref: only allow safe characters
    if (!/^[0-9a-zA-Z_./:^~\-]+$/.test(ref)) {
      throw new Error(`Invalid ref: ${ref}`);
    }
    // Get metadata (hash, author, date, message) separately from file list
    const metaOutput = this._runGit(['log', '-1', '--format=%H|%an|%ai|%B', ref]);
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
    const message = bodyRest ? `${bodyFromHeader}\n${bodyRest}`.trim() : bodyFromHeader.trim();

    const patchArgs = ['show', '--format=', '--unified=3', ref];
    const patchOutput = this._runGit(patchArgs);
    const files = parseDiffOutput(patchOutput);

    return { hash, author, date, message, files };
  }

  buildToolDefinitions() {
    return [
      {
        type: 'function',
        function: {
          name: 'repo_list_dir',
          strict: true,
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
          strict: true,
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
          strict: true,
          description:
            'Search file contents with a regular expression. Use this to trace symbols, routes, config keys, or keywords.',
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
              pattern: { type: 'string' },
              scope: { type: 'array', items: { type: 'string' } },
              caseSensitive: { type: 'boolean' },
              maxResults: { type: 'integer', minimum: 1, maximum: 200 },
            },
            required: ['pattern'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'repo_read_file',
          strict: true,
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
          strict: false,
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
          strict: false,
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
          strict: false,
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
          strict: false,
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

  _cacheSet(key, value, ttlMs = null) {
    if (this.cache) this.cache.set(key, value, ttlMs);
  }

  async callTool(name, args) {
    let cacheKey;
    let ttlMs = null;

    switch (name) {
      case 'repo_list_dir': {
        cacheKey = cacheKeyListDir(args?.dirPath ?? '.', args?.depth ?? 2, args?.maxEntries ?? this.budgetConfig.maxDirectoryEntries);
        const cached = this._cacheGet(cacheKey);
        if (cached !== undefined) return cached;
        const result = await this.listDirectory({ dirPath: args?.dirPath, depth: args?.depth, maxEntries: args?.maxEntries });
        this._cacheSet(cacheKey, result);
        return result;
      }
      case 'repo_find_files': {
        cacheKey = cacheKeyFindFiles(args?.pattern, args?.scope);
        const cached = this._cacheGet(cacheKey);
        if (cached !== undefined) return cached;
        const result = await this.findFiles({ pattern: args?.pattern, scope: args?.scope, maxResults: args?.maxResults });
        this._cacheSet(cacheKey, result);
        return result;
      }
      case 'repo_grep': {
        cacheKey = cacheKeyGrep(args?.pattern, args?.caseSensitive ?? false, args?.scope);
        const cached = this._cacheGet(cacheKey);
        if (cached !== undefined) return cached;
        const result = await this.grep({ pattern: args?.pattern, scope: args?.scope, caseSensitive: args?.caseSensitive, maxResults: args?.maxResults });
        this._cacheSet(cacheKey, result);
        return result;
      }
      case 'repo_read_file': {
        cacheKey = cacheKeyReadFile(args?.path, args?.startLine ?? 1, args?.endLine ?? this.budgetConfig.maxReadLines);
        const cached = this._cacheGet(cacheKey);
        if (cached !== undefined) return cached;
        const result = await this.readFile({ path: args?.path, startLine: args?.startLine, endLine: args?.endLine });
        this._cacheSet(cacheKey, result);
        return result;
      }
      case 'repo_git_log': {
        ttlMs = GIT_TOOL_TTL_MS;
        cacheKey = cacheKeyGitLog(args?.path, args?.maxCount ?? 20, args?.since, args?.author, args?.grep);
        const cached = this._cacheGet(cacheKey);
        if (cached !== undefined) return cached;
        const result = await this.gitLog({ path: args?.path, maxCount: args?.maxCount, since: args?.since, author: args?.author, grep: args?.grep });
        this._cacheSet(cacheKey, result, ttlMs);
        return result;
      }
      case 'repo_git_blame': {
        ttlMs = GIT_TOOL_TTL_MS;
        cacheKey = cacheKeyGitBlame(args?.path, args?.startLine, args?.endLine);
        const cached = this._cacheGet(cacheKey);
        if (cached !== undefined) return cached;
        const result = await this.gitBlame({ path: args?.path, startLine: args?.startLine, endLine: args?.endLine });
        this._cacheSet(cacheKey, result, ttlMs);
        return result;
      }
      case 'repo_git_diff': {
        ttlMs = GIT_TOOL_TTL_MS;
        cacheKey = cacheKeyGitDiff(args?.from ?? 'HEAD~1', args?.to ?? 'HEAD', args?.path, args?.stat ?? false);
        const cached = this._cacheGet(cacheKey);
        if (cached !== undefined) return cached;
        const result = await this.gitDiff({ from: args?.from, to: args?.to, path: args?.path, stat: args?.stat });
        this._cacheSet(cacheKey, result, ttlMs);
        return result;
      }
      case 'repo_git_show': {
        ttlMs = GIT_TOOL_TTL_MS;
        cacheKey = cacheKeyGitShow(args?.ref);
        const cached = this._cacheGet(cacheKey);
        if (cached !== undefined) return cached;
        const result = await this.gitShow({ ref: args?.ref });
        this._cacheSet(cacheKey, result, ttlMs);
        return result;
      }
      default:
        throw new Error(`Unknown repo tool: ${name}`);
    }
  }
}

export function collectCandidatePathsFromToolResult(toolName, result) {
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
    default:
      return [];
  }
}

export function mergeCandidatePaths(existing, nextValues) {
  return dedupeArray([...(existing || []), ...(nextValues || [])]);
}
