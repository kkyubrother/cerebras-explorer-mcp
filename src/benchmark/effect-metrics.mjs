// Spec 025: deterministic, offline effect metrics for the benchmark harness.
// Measures what the parent agent ingests (payload tokens) against a
// conservative lower bound of what it would have read natively (cited source
// tokens), and re-verifies citations against the working tree without
// trusting the system's own groundingStatus labels. Read-only by design.
import fs from 'node:fs/promises';
import path from 'node:path';

import { estimateStringTokens } from '../explorer/runtime.mjs';

const NEUTRAL_STATUSES = new Set(['redacted', 'skipped']);
const MATCH_STATUSES = new Set(['match', 'weak_match']);

function resolveInsideRoot(repoRoot, relPath) {
  if (typeof relPath !== 'string' || !relPath.trim()) return null;
  const root = path.resolve(repoRoot);
  const resolved = path.resolve(root, relPath.trim());
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

function uniqueCitedPaths(result) {
  const paths = new Set();
  for (const item of result?.evidence ?? []) {
    if (typeof item?.path === 'string' && item.path.trim()) paths.add(item.path.trim());
  }
  for (const item of result?.targets ?? []) {
    if (typeof item?.path === 'string' && item.path.trim()) paths.add(item.path.trim());
  }
  return [...paths];
}

export async function computeCaseEffectMetrics({ result, repoRoot }) {
  const responsePayloadTokens = estimateStringTokens(JSON.stringify(result ?? {}));
  let citedSourceTokens = 0;
  let citedFileCount = 0;
  for (const relPath of uniqueCitedPaths(result)) {
    const resolved = resolveInsideRoot(repoRoot, relPath);
    if (!resolved) continue;
    try {
      const content = await fs.readFile(resolved, 'utf8');
      citedSourceTokens += estimateStringTokens(content);
      citedFileCount += 1;
    } catch {
      // Missing files are classified by verifyCitations; they add no tokens.
    }
  }
  return {
    responsePayloadTokens,
    citedSourceTokens,
    citedFileCount,
    contextSavingsRatio: citedFileCount > 0 && responsePayloadTokens > 0
      ? Math.round((citedSourceTokens / responsePayloadTokens) * 100) / 100
      : null,
  };
}

// Replicates the snippet shape built at runtime.mjs readEvidenceSnippet():
// "N: content" lines from a '\n'-split file, optional trailing
// "... [snippet truncated]" marker, and a whole-snippet maxChars cut that can
// truncate the final line mid-text (hence the prefix tolerance).
function parseSnippetLines(snippet) {
  const lines = [];
  for (const raw of String(snippet).split('\n')) {
    const match = raw.match(/^(\d+): (.*)$/);
    if (match) lines.push({ line: Number(match[1]), text: match[2] });
  }
  return lines;
}

async function readFileLines(repoRoot, relPath) {
  const resolved = resolveInsideRoot(repoRoot, relPath);
  if (!resolved) return { status: 'out_of_root' };
  try {
    return { lines: (await fs.readFile(resolved, 'utf8')).split('\n') };
  } catch {
    return { status: 'file_missing' };
  }
}

function validRange(startLine, endLine, totalLines) {
  return Number.isInteger(startLine) && Number.isInteger(endLine)
    && startLine >= 1 && endLine >= startLine && endLine <= totalLines;
}

async function verifyEvidenceItem(item, repoRoot) {
  const citation = `${item?.path}:${item?.startLine}-${item?.endLine}`;
  if (item?.redacted === true) return { citation, status: 'redacted' };
  if ((item?.evidenceType ?? 'file_range') !== 'file_range') {
    return { citation, status: 'skipped' };
  }
  const file = await readFileLines(repoRoot, item?.path);
  if (file.status) return { citation, status: file.status };
  if (!validRange(item.startLine, item.endLine, file.lines.length)) {
    return { citation, status: 'range_invalid' };
  }
  const snippetLines = parseSnippetLines(item.snippet ?? '');
  if (snippetLines.length === 0) {
    // No snippet to compare (e.g. oversized file skipped by the runtime):
    // existence + range validity is the strongest possible check.
    return { citation, status: 'weak_match', weak: true };
  }
  for (const [index, { line, text }] of snippetLines.entries()) {
    if (line < item.startLine || line > item.endLine) return { citation, status: 'mismatch' };
    const fileLine = file.lines[line - 1] ?? '';
    const isLast = index === snippetLines.length - 1;
    const matches = fileLine === text || (isLast && text.length > 0 && fileLine.startsWith(text));
    if (!matches) return { citation, status: 'mismatch' };
  }
  return { citation, status: 'match' };
}

async function verifyReportCitation(item, repoRoot) {
  const citation = `${item?.path}:${item?.startLine}-${item?.endLine}`;
  const file = await readFileLines(repoRoot, item?.path);
  if (file.status) return { citation, status: file.status, weak: true };
  if (!validRange(item?.startLine, item?.endLine, file.lines.length)) {
    return { citation, status: 'range_invalid', weak: true };
  }
  // citations[] carry no snippets: existence + range validity only.
  return { citation, status: 'weak_match', weak: true };
}

export async function verifyCitations({ result, repoRoot }) {
  const checks = [];
  for (const item of result?.evidence ?? []) {
    checks.push(await verifyEvidenceItem(item, repoRoot));
  }
  for (const item of result?.citations ?? []) {
    checks.push(await verifyReportCitation(item, repoRoot));
  }
  const counted = checks.filter(check => !NEUTRAL_STATUSES.has(check.status));
  const matched = counted.filter(check => MATCH_STATUSES.has(check.status));
  return {
    checks,
    citationAccuracy: counted.length > 0
      ? Math.round((matched.length / counted.length) * 1000) / 1000
      : null,
  };
}

export { NEUTRAL_STATUSES as NEUTRAL_CITATION_STATUSES, MATCH_STATUSES as MATCH_CITATION_STATUSES };
