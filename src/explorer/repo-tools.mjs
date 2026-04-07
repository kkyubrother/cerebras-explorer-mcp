import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_GREP_FILE_MAX_BYTES,
  DEFAULT_IGNORE_DIRS,
  DEFAULT_IGNORE_FILE_SUFFIXES,
  DEFAULT_TEXT_FILE_MAX_BYTES,
  DEFAULT_WALK_FILE_LIMIT,
} from './config.mjs';

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

export class RepoToolkit {
  constructor({
    repoRoot,
    budgetConfig,
    logger = () => {},
  }) {
    this.repoRoot = repoRoot;
    this.repoRootReal = null;
    this.budgetConfig = budgetConfig;
    this.logger = logger;
    this.baseScopeRules = createScopeRules([]);
    this.gitignoreMatcher = null;
  }

  async initialize(scope = []) {
    this.repoRootReal = await fs.realpath(this.repoRoot);
    const rules = await loadGitignoreRules(this.repoRootReal);
    this.gitignoreMatcher = rules.length ? buildGitignoreMatcher(rules) : null;
    this.baseScopeRules = createScopeRules(scope);
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

  async grep({ pattern, scope = [], caseSensitive = false, maxResults = this.budgetConfig.maxSearchResults } = {}) {
    if (typeof pattern !== 'string' || !pattern.trim()) {
      throw new Error('pattern is required');
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
    ];
  }

  async callTool(name, args) {
    switch (name) {
      case 'repo_list_dir':
        return await this.listDirectory({
          dirPath: args?.dirPath,
          depth: args?.depth,
          maxEntries: args?.maxEntries,
        });
      case 'repo_find_files':
        return await this.findFiles({
          pattern: args?.pattern,
          scope: args?.scope,
          maxResults: args?.maxResults,
        });
      case 'repo_grep':
        return await this.grep({
          pattern: args?.pattern,
          scope: args?.scope,
          caseSensitive: args?.caseSensitive,
          maxResults: args?.maxResults,
        });
      case 'repo_read_file':
        return await this.readFile({
          path: args?.path,
          startLine: args?.startLine,
          endLine: args?.endLine,
        });
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
    default:
      return [];
  }
}

export function mergeCandidatePaths(existing, nextValues) {
  return dedupeArray([...(existing || []), ...(nextValues || [])]);
}
