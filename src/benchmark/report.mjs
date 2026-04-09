import path from 'node:path';

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function isWithinRoot(rootPath, targetPath) {
  const relative = path.relative(rootPath, targetPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function sanitizePathForReport(targetPath, { repoRoot, cwd = process.cwd() } = {}) {
  if (typeof targetPath !== 'string' || targetPath.trim() === '') {
    return targetPath;
  }

  if (!path.isAbsolute(targetPath)) {
    return targetPath.includes('\\') ? targetPath.replaceAll('\\', '/') : targetPath;
  }

  const absoluteTarget = path.resolve(targetPath);
  const resolvedRepoRoot = typeof repoRoot === 'string' && repoRoot.trim()
    ? path.resolve(repoRoot)
    : null;
  if (resolvedRepoRoot && isWithinRoot(resolvedRepoRoot, absoluteTarget)) {
    const relative = path.relative(resolvedRepoRoot, absoluteTarget);
    return relative ? toPosix(relative) : '.';
  }

  const resolvedCwd = typeof cwd === 'string' && cwd.trim()
    ? path.resolve(cwd)
    : null;
  if (resolvedCwd && isWithinRoot(resolvedCwd, absoluteTarget)) {
    const relative = path.relative(resolvedCwd, absoluteTarget);
    return relative ? toPosix(relative) : '.';
  }

  return path.basename(absoluteTarget);
}

function redactRepoRootFragments(value, { repoRoot, cwd } = {}) {
  if (typeof value !== 'string' || value.trim() === '' || typeof repoRoot !== 'string' || repoRoot.trim() === '') {
    return value;
  }

  const resolvedRepoRoot = path.resolve(repoRoot);
  const candidates = [
    resolvedRepoRoot,
    resolvedRepoRoot.replaceAll('\\', '/'),
  ];

  let sanitized = value;
  for (const candidate of candidates) {
    const pattern = new RegExp(`${escapeRegex(candidate)}(?:[\\\\/][^\\s"']+)*`, 'g');
    sanitized = sanitized.replace(pattern, match => sanitizePathForReport(match, { repoRoot, cwd }));
  }
  return sanitized;
}

export function sanitizeStringForReport(value, options = {}) {
  if (typeof value !== 'string') {
    return value;
  }

  const redacted = redactRepoRootFragments(value, options);
  if (path.isAbsolute(redacted)) {
    return sanitizePathForReport(redacted, options);
  }
  return redacted;
}

function sanitizeValue(value, options) {
  if (typeof value === 'string') {
    return sanitizeStringForReport(value, options);
  }
  if (Array.isArray(value)) {
    return value.map(item => sanitizeValue(item, options));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [key, sanitizeValue(entryValue, options)]),
    );
  }
  return value;
}

export function sanitizeBenchmarkReport(report, options = {}) {
  return sanitizeValue(report, options);
}
