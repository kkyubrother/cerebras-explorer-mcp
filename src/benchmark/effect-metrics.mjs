// Spec 025: deterministic, offline effect metrics for the benchmark harness.
// Measures what the parent agent ingests (payload tokens) against a
// conservative lower bound of what it would have read natively (cited source
// tokens), and re-verifies citations against the working tree without
// trusting the system's own groundingStatus labels. Read-only by design.
import fs from 'node:fs/promises';
import path from 'node:path';

import { estimateStringTokens } from '../explorer/runtime.mjs';
import { measureParentPayload } from '../explorer/parent-payload.mjs';

const NEUTRAL_STATUSES = new Set(['redacted', 'skipped']);
const MATCH_STATUSES = new Set(['match', 'weak_match']);

const WRAPPER_PROOF_POLICIES = Object.freeze([
  ['find_relevant_code', 'smallest_relevant_location_set'],
  ['trace_symbol', 'definition_and_usage_cross_check'],
  ['map_change_impact', 'requested_impact_categories'],
  ['explain_code_path', 'ordered_handoffs'],
  ['collect_evidence', 'support_or_refute'],
  ['explore_repo', 'audited_subgoal_policies'],
]);

// Mirror of the runtime snippet reader's file guards (runtime.mjs
// readEvidenceSnippet): regular files only, no symlinks, 512 KiB cap.
const MAX_READ_BYTES = 512 * 1024;

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

function roundRatio(value) {
  return Math.round(value * 100) / 100;
}

async function readSafeText(repoRoot, relPath) {
  const resolved = resolveInsideRoot(repoRoot, relPath);
  if (!resolved) return { status: 'out_of_root' };
  try {
    const stat = await fs.lstat(resolved);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_READ_BYTES) {
      return { status: 'file_missing' };
    }
    const content = await fs.readFile(resolved, 'utf8');
    return {
      content,
      lines: content.split('\n').map(line => line.replace(/\r$/, '')),
    };
  } catch {
    return { status: 'file_missing' };
  }
}

function mergeLineRanges(ranges) {
  const sorted = [...ranges].sort((left, right) =>
    left.startLine - right.startLine || left.endLine - right.endLine);
  const merged = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (!previous || range.startLine > previous.endLine + 1) {
      merged.push({ ...range });
    } else {
      previous.endLine = Math.max(previous.endLine, range.endLine);
    }
  }
  return merged;
}

async function computeRequiredTargetRead({ result, repoRoot }) {
  if (result?.state !== 'verify_targets') {
    return { targetReadRequired: false, targetReadTokens: 0, targetReadFileCount: 0 };
  }

  const byPath = new Map();
  for (const target of result.targets ?? []) {
    if (typeof target?.path !== 'string' || !target.path.trim()) continue;
    const relPath = target.path.trim();
    const record = byPath.get(relPath) ?? { wholeFile: false, ranges: [] };
    const hasStart = Number.isInteger(target.startLine);
    const hasEnd = Number.isInteger(target.endLine);
    if (!hasStart && !hasEnd) {
      record.wholeFile = true;
    } else if (hasStart && hasEnd) {
      record.ranges.push({ startLine: target.startLine, endLine: target.endLine });
    }
    byPath.set(relPath, record);
  }

  let targetReadTokens = 0;
  let targetReadFileCount = 0;
  for (const [relPath, selection] of byPath) {
    const file = await readSafeText(repoRoot, relPath);
    if (file.status) continue;
    if (selection.wholeFile) {
      targetReadTokens += estimateStringTokens(file.content);
      targetReadFileCount += 1;
      continue;
    }
    const validRanges = selection.ranges.filter(range =>
      validRange(range.startLine, range.endLine, file.lines.length));
    if (validRanges.length === 0) continue;
    const selectedText = mergeLineRanges(validRanges)
      .map(range => file.lines.slice(range.startLine - 1, range.endLine).join('\n'))
      .join('\n');
    targetReadTokens += estimateStringTokens(selectedText);
    targetReadFileCount += 1;
  }

  return { targetReadRequired: true, targetReadTokens, targetReadFileCount };
}

export async function computeCaseEffectMetrics({ result, parentPayload, repoRoot }) {
  const measuredPayload = parentPayload ? measureParentPayload(parentPayload) : null;
  const measuredResult = parentPayload?.structuredContent ?? result;
  const responsePayloadTokens = parentPayload
    ? estimateStringTokens(
      `${JSON.stringify(parentPayload.content)}\0${JSON.stringify(parentPayload.structuredContent)}`,
    )
    : estimateStringTokens(JSON.stringify(result ?? {}));
  let citedSourceTokens = 0;
  let citedFileCount = 0;
  for (const relPath of uniqueCitedPaths(measuredResult)) {
    const file = await readSafeText(repoRoot, relPath);
    if (file.status) continue;
    citedSourceTokens += estimateStringTokens(file.content);
    citedFileCount += 1;
  }
  const targetRead = await computeRequiredTargetRead({ result: measuredResult, repoRoot });
  const parentContextTokens = responsePayloadTokens + targetRead.targetReadTokens;
  return {
    ...(measuredPayload ? { parentPayloadBytes: measuredPayload.parentPayloadBytes } : {}),
    responsePayloadTokens,
    citedSourceTokens,
    citedFileCount,
    ...targetRead,
    parentContextTokens,
    contextSavingsRatio: citedFileCount > 0 && responsePayloadTokens > 0
      ? roundRatio(citedSourceTokens / responsePayloadTokens)
      : null,
    parentEffectRatio: citedFileCount > 0 && parentContextTokens > 0
      ? roundRatio(citedSourceTokens / parentContextTokens)
      : null,
  };
}

// Replicates the snippet shape built by runtime.mjs attachEvidenceMetadata():
// "N: content" lines from a '\n'-split file, optional trailing
// "... [snippet truncated]" marker, and a whole-snippet maxChars cut that can
// truncate the final line mid-text (hence the prefix tolerance).
function parseSnippetLines(snippet) {
  const lines = [];
  for (const raw of String(snippet).split('\n')) {
    // The runtime splits files on '\n' only, so CRLF working trees leave a
    // trailing '\r' on every snippet line; without stripping it the regex
    // never matches and verification silently degrades to weak_match.
    const match = raw.replace(/\r$/, '').match(/^(\d+): (.*)$/);
    if (match) lines.push({ line: Number(match[1]), text: match[2] });
  }
  return lines;
}

async function readFileLines(repoRoot, relPath) {
  return readSafeText(repoRoot, relPath);
}

function validRange(startLine, endLine, totalLines) {
  return Number.isInteger(startLine) && Number.isInteger(endLine)
    && startLine >= 1 && endLine >= startLine && endLine <= totalLines;
}

async function verifyEvidenceItem(item, repoRoot) {
  const citation = `${item?.path}:${item?.startLine}-${item?.endLine}`;
  if (item?.redacted === true) return { citation, status: 'redacted' };
  if (item?.kind && item.kind !== 'source') {
    return { citation, status: 'skipped' };
  }
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
    // No snippet to compare — the runtime omits snippets it could not rebuild
    // (e.g. a path whose realpath escapes the root: the runtime suppresses the
    // snippet, while this harness's lexical root check still admits the file).
    // Existence + range validity is the strongest possible check here.
    // Oversized files never reach this branch — readFileLines already
    // classified them as unreadable.
    return { citation, status: 'weak_match', weak: true };
  }
  for (const [index, { line, text }] of snippetLines.entries()) {
    if (line < item.startLine || line > item.endLine) return { citation, status: 'mismatch' };
    const fileLine = file.lines[line - 1] ?? '';
    const isLast = index === snippetLines.length - 1;
    // text === '' can occur when the maxChars cut lands right after "N: ";
    // requiring exact equality there (no vacuous startsWith('')) trades a
    // rare false mismatch for never auto-passing an empty comparison.
    const matches = fileLine === text || (isLast && text.length > 0 && fileLine.startsWith(text));
    if (!matches) return { citation, status: 'mismatch' };
  }
  return { citation, status: 'match' };
}

async function verifyReportCitation(item, repoRoot) {
  const citation = `${item?.path}:${item?.startLine}-${item?.endLine}`;
  const file = await readFileLines(repoRoot, item?.path);
  if (file.status) return { citation, status: file.status };
  if (!validRange(item?.startLine, item?.endLine, file.lines.length)) {
    return { citation, status: 'range_invalid' };
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

/** Independently verify that every parent target is a readable in-root file/range. */
export async function verifyTargetReads({ result, repoRoot }) {
  const checks = [];
  for (const item of result?.targets ?? []) {
    const target = `${item?.path}:${item?.startLine ?? ''}-${item?.endLine ?? ''}`;
    const file = await readFileLines(repoRoot, item?.path);
    if (file.status) {
      checks.push({ target, status: file.status });
      continue;
    }
    const hasStart = Number.isInteger(item?.startLine);
    const hasEnd = Number.isInteger(item?.endLine);
    if (hasStart !== hasEnd ||
        (hasStart && !validRange(item.startLine, item.endLine, file.lines.length))) {
      checks.push({ target, status: 'range_invalid' });
      continue;
    }
    checks.push({
      target,
      status: 'match',
      readScope: hasStart ? 'range' : 'file',
    });
  }
  const matched = checks.filter(check => check.status === 'match').length;
  return {
    checks,
    targetReadAccuracy: checks.length > 0
      ? Math.round((matched / checks.length) * 1000) / 1000
      : null,
  };
}

/**
 * Group external benchmark-case outcomes by the six runtime-owned proof
 * policies. Explorer confidence, evidence counts, and grounding labels are
 * deliberately not inputs.
 */
export function computeWrapperDistinctnessMetrics(caseResults) {
  const normalizedCases = Array.isArray(caseResults) ? caseResults : [];
  const wrappers = WRAPPER_PROOF_POLICIES.map(([tool, proofPolicy]) => {
    const scenarios = normalizedCases.filter(item => item?.caseDefinition?.tool === tool);
    const passedScenarioCount = scenarios.filter(item => item?.evaluation?.passed === true).length;
    return {
      tool,
      proofPolicy,
      scenarioCount: scenarios.length,
      passedScenarioCount,
      passed: passedScenarioCount > 0,
    };
  });
  const scenarioCount = wrappers.reduce((sum, item) => sum + item.scenarioCount, 0);
  const passedScenarioCount = wrappers.reduce((sum, item) => sum + item.passedScenarioCount, 0);
  const coveredWrapperCount = wrappers.filter(item => item.scenarioCount > 0).length;
  const passedWrapperCount = wrappers.filter(item => item.passed).length;
  const totalWrapperCount = wrappers.length;
  const round3 = value => Math.round(value * 1000) / 1000;
  return {
    totalWrapperCount,
    coveredWrapperCount,
    passedWrapperCount,
    wrapperCoverageRate: round3(coveredWrapperCount / totalWrapperCount),
    wrapperDistinctnessRate: round3(passedWrapperCount / totalWrapperCount),
    wrapperScenarioPassRate: scenarioCount > 0
      ? round3(passedScenarioCount / scenarioCount)
      : null,
    wrappers,
  };
}

export { NEUTRAL_STATUSES as NEUTRAL_CITATION_STATUSES, MATCH_STATUSES as MATCH_CITATION_STATUSES };
export { measureParentPayload };
