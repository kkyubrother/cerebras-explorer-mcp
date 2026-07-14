#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { buildExecutionProvenance, createMcpRequestHandler } from '../src/mcp/server.mjs';
import { evaluateBenchmarkCase, summarizeBenchmarkSuite } from '../src/benchmark/evaluator.mjs';
import { sanitizeBenchmarkReport, sanitizePathForReport } from '../src/benchmark/report.mjs';
import { analyzeTranscriptFile } from '../src/benchmark/transcript-metrics.mjs';
import {
  computeCaseEffectMetrics,
  computeWrapperDistinctnessMetrics,
  verifyCitations,
  verifyTargetReads,
  NEUTRAL_CITATION_STATUSES,
  MATCH_CITATION_STATUSES,
} from '../src/benchmark/effect-metrics.mjs';

function parseArgs(argv) {
  const options = {
    suite: 'benchmarks/adoption.json',
    repoRoot: process.cwd(),
    output: null,
    caseId: null,
    verbose: false,
    help: false,
    keepTranscripts: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--suite') options.suite = argv[++index];
    else if (arg === '--repo-root') options.repoRoot = argv[++index];
    else if (arg === '--output') options.output = argv[++index];
    else if (arg === '--case') options.caseId = argv[++index];
    else if (arg === '--verbose') options.verbose = true;
    else if (arg === '--keep-transcripts') options.keepTranscripts = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log(
    [
      'Usage: node ./scripts/run-benchmark.mjs [options]',
      '',
      'Options:',
      '  --suite <path>      Benchmark suite JSON file. Default: benchmarks/adoption.json',
      '  --repo-root <path>  Repository root to benchmark. Default: current working directory',
      '  --case <id>         Run only one benchmark case',
      '  --output <path>     Write full JSON results to a file',
      '  --verbose           Print per-expectation details',
      '  --keep-transcripts  Keep the temporary transcript directory (when the runner created one)',
      '  --help              Show this help text',
    ].join('\n'),
  );
}

async function loadSuite(suitePath) {
  const resolvedPath = path.resolve(suitePath);
  const raw = await fs.readFile(resolvedPath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.cases) || parsed.cases.length === 0) {
    throw new Error(`Benchmark suite has no cases: ${resolvedPath}`);
  }
  return { path: resolvedPath, suite: parsed };
}

async function createHandler(logger) {
  const { handleRequest } = createMcpRequestHandler({ logger });
  await handleRequest({
    jsonrpc: '2.0',
    id: 'init',
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'benchmark-runner', version: '0.3.0' },
    },
  });
  return handleRequest;
}

async function listTranscriptFiles() {
  const transcriptDir = process.env.CEREBRAS_EXPLORER_LOG_PATH;
  if (!transcriptDir) return new Set();
  try {
    const entries = await fs.readdir(transcriptDir, { withFileTypes: true });
    return new Set(entries
      .filter(entry => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map(entry => path.resolve(transcriptDir, entry.name)));
  } catch {
    return new Set();
  }
}

async function runCase(handleRequest, caseDefinition, repoRoot) {
  const startedAt = Date.now();
  const transcriptsBefore = await listTranscriptFiles();
  const response = await handleRequest({
    jsonrpc: '2.0',
    id: caseDefinition.id,
    method: 'tools/call',
    params: {
      name: caseDefinition.tool,
      arguments: {
        ...caseDefinition.args,
        repo_root: repoRoot,
      },
    },
  });

  if (response?.isError) {
    const message = response.content?.map(item => item.text).join('\n') || 'Unknown tool error';
    throw new Error(message);
  }

  const ops = response._meta?.ops ?? null;
  const transcriptsAfter = await listTranscriptFiles();
  const newTranscriptPaths = [...transcriptsAfter]
    .filter(filePath => !transcriptsBefore.has(filePath))
    .sort();
  const parentPayload = {
    content: Array.isArray(response.content) ? response.content : [],
    structuredContent: response.structuredContent,
  };
  return {
    elapsedMs: Date.now() - startedAt,
    result: response.structuredContent,
    parentPayload,
    // Keep stats for metrics; do not persist transcriptPath on the case
    // result so temp paths never reach the saved JSON report.
    ops: ops ? { stats: ops.stats ?? null } : null,
    transcriptPath: ops?.transcriptPath ?? newTranscriptPaths.at(-1) ?? null,
  };
}

function formatPercent(score) {
  return `${Math.round(score * 100)}%`;
}

function formatMetric(value, formatter = String) {
  return value === null || value === undefined ? 'n/a' : formatter(value);
}

const warnedHarnessFaults = new Set();
function warnHarnessFault(label, error) {
  if (warnedHarnessFaults.has(label)) return null;
  warnedHarnessFaults.add(label);
  console.warn(`[${label}] harness fault, metric degraded to n/a: ${error.message}`);
  return null;
}

/**
 * Record-only operator metrics. Trust is evaluated elsewhere against the
 * independently authored known-answer oracle; confidence, groundingStatus,
 * and evidence quantity are deliberately not acceptance inputs here.
 */
export function computeExtendedMetrics(caseResults) {
  const successCases = caseResults.filter(cr => cr.result != null);
  const count = successCases.length;
  if (count === 0) return null;

  const avgOf = values => (values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null);
  const round1 = value => (value === null ? null : Math.round(value * 10) / 10);
  const round3 = value => (value === null ? null : Math.round(value * 1000) / 1000);
  const medianOf = values => {
    if (values.length === 0) return null;
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  };

  const opsStats = successCases
    .map(cr => cr.ops?.stats)
    .filter(stats => stats && typeof stats === 'object');

  const transcriptCases = successCases.filter(cr => cr.transcriptMetrics);
  const avgToolTurns = round1(avgOf(successCases
    .map(cr => typeof cr.ops?.stats?.turns === 'number'
      ? cr.ops.stats.turns
      : typeof cr.transcriptMetrics?.assistantTurns === 'number'
        ? cr.transcriptMetrics.assistantTurns
        : null)
    .filter(value => value !== null)));
  const avgInternalTokensRaw = avgOf(opsStats.map(stats => stats.totalTokens).filter(value => typeof value === 'number'));

  const toolActivityCases = successCases.map(cr => {
    if (typeof cr.ops?.stats?.toolCalls === 'number') return cr.ops.stats.toolCalls;
    if (typeof cr.transcriptMetrics?.toolCalls === 'number') return cr.transcriptMetrics.toolCalls;
    if (!cr.result.searchCoverage) return null;
    const coverage = cr.result.searchCoverage;
    return (coverage.filesRead ?? 0) + (coverage.grepCalls ?? 0) +
      (coverage.listDirCalls ?? 0) + (coverage.symbolCalls ?? 0);
  }).filter(value => value !== null);
  const noToolExitRate = toolActivityCases.length > 0
    ? toolActivityCases.filter(value => value === 0).length / toolActivityCases.length
    : null;

  const evidenceCount = successCases.reduce((sum, cr) => sum + (cr.result.evidence?.length ?? 0), 0);
  const snippetCount = successCases.reduce((sum, cr) => {
    return sum + (cr.result.evidence ?? []).filter(item => typeof item.snippet === 'string' && item.snippet.trim()).length;
  }, 0);

  const avgTargets =
    successCases.reduce((sum, cr) => sum + (cr.result.targets?.length ?? 0), 0) / count;

  const avgBroadSearchCalls = transcriptCases.length > 0
    ? transcriptCases.reduce((sum, cr) => sum + Number(cr.transcriptMetrics.broadSearchCalls ?? 0), 0) / transcriptCases.length
    : null;
  const avgRepeatedToolPlanTurns = transcriptCases.length > 0
    ? transcriptCases.reduce((sum, cr) => sum + Number(cr.transcriptMetrics.repeatedToolPlanTurns ?? 0), 0) / transcriptCases.length
    : null;
  const safetyLimitCases = transcriptCases.filter(cr =>
    typeof cr.transcriptMetrics.safetyLimitCount === 'number');
  const safetyLimitIncidenceRate = safetyLimitCases.length > 0
    ? safetyLimitCases.filter(cr => cr.transcriptMetrics.safetyLimitCount > 0).length / safetyLimitCases.length
    : null;

  const effectCases = successCases.map(cr => cr.effectMetrics).filter(Boolean);
  const numericEffectValues = key => effectCases
    .map(metrics => metrics[key])
    .filter(value => typeof value === 'number' && Number.isFinite(value));
  const parentPayloadBytes = numericEffectValues('parentPayloadBytes');
  const avgParentPayloadBytes = avgOf(parentPayloadBytes);
  const medianParentPayloadBytes = medianOf(parentPayloadBytes);
  const avgResponsePayloadTokens = avgOf(numericEffectValues('responsePayloadTokens'));
  const avgCitedSourceTokens = avgOf(numericEffectValues('citedSourceTokens'));
  const avgTargetReadTokens = avgOf(numericEffectValues('targetReadTokens'));
  const avgParentContextTokens = avgOf(numericEffectValues('parentContextTokens'));
  const targetReadCases = effectCases.filter(metrics =>
    typeof metrics.targetReadRequired === 'boolean');
  const targetReadCaseRate = targetReadCases.length > 0
    ? targetReadCases.filter(metrics => metrics.targetReadRequired).length / targetReadCases.length
    : null;
  // Mean of per-case ratios (each case = one delegation decision), NOT pooled
  // avgCitedSourceTokens / avgResponsePayloadTokens — the two can differ.
  const avgContextSavingsRatio = avgOf(
    numericEffectValues('contextSavingsRatio'),
  );
  const avgParentEffectRatio = avgOf(
    numericEffectValues('parentEffectRatio'),
  );

  const allChecks = successCases.flatMap(cr => cr.citation?.checks ?? []);
  const countedChecks = allChecks.filter(check => !NEUTRAL_CITATION_STATUSES.has(check.status));
  const matchedChecks = countedChecks.filter(check => MATCH_CITATION_STATUSES.has(check.status));
  const citationAccuracy = countedChecks.length > 0
    ? round3(matchedChecks.length / countedChecks.length)
    : null;
  const weakCitationChecks = allChecks.filter(check => check.status === 'weak_match').length;
  const targetReadChecks = successCases.flatMap(cr => cr.targetRead?.checks ?? []);
  const matchedTargetReads = targetReadChecks.filter(check => check.status === 'match').length;
  const targetReadAccuracy = targetReadChecks.length > 0
    ? round3(matchedTargetReads / targetReadChecks.length)
    : null;
  const wrapperMetrics = computeWrapperDistinctnessMetrics(caseResults);

  return {
    avgToolTurns,
    avgInternalTokens: avgInternalTokensRaw === null ? null : Math.round(avgInternalTokensRaw),
    safetyLimitIncidenceRate: round3(safetyLimitIncidenceRate),
    noToolExitRate: round3(noToolExitRate),
    avgTargets: round1(avgTargets),
    evidenceSnippetRate: evidenceCount > 0
      ? round3(snippetCount / evidenceCount)
      : null,
    avgBroadSearchCalls: round1(avgBroadSearchCalls),
    avgRepeatedToolPlanTurns: round1(avgRepeatedToolPlanTurns),
    avgParentPayloadBytes: avgParentPayloadBytes === null ? null : Math.round(avgParentPayloadBytes),
    medianParentPayloadBytes: medianParentPayloadBytes === null
      ? null
      : Math.round(medianParentPayloadBytes),
    avgResponsePayloadTokens: avgResponsePayloadTokens === null ? null : Math.round(avgResponsePayloadTokens),
    avgCitedSourceTokens: avgCitedSourceTokens === null ? null : Math.round(avgCitedSourceTokens),
    avgTargetReadTokens: avgTargetReadTokens === null ? null : Math.round(avgTargetReadTokens),
    targetReadCaseRate: round3(targetReadCaseRate),
    targetReadAccuracy,
    avgParentContextTokens: avgParentContextTokens === null ? null : Math.round(avgParentContextTokens),
    avgContextSavingsRatio: avgContextSavingsRatio === null ? null : Math.round(avgContextSavingsRatio * 100) / 100,
    avgParentEffectRatio: avgParentEffectRatio === null ? null : Math.round(avgParentEffectRatio * 100) / 100,
    citationAccuracy,
    weakCitationChecks,
    wrapperCoverageRate: wrapperMetrics.wrapperCoverageRate,
    wrapperDistinctnessRate: wrapperMetrics.wrapperDistinctnessRate,
    wrapperScenarioPassRate: wrapperMetrics.wrapperScenarioPassRate,
    wrapperResults: wrapperMetrics.wrappers,
  };
}

function printCaseResult(caseResult, verbose) {
  const { caseDefinition, evaluation, elapsedMs, result } = caseResult;
  const status = evaluation.passed ? 'PASS' : 'FAIL';
  console.log(`${status} ${caseDefinition.id}  score=${formatPercent(evaluation.score)}  elapsed=${elapsedMs}ms`);
  console.log(`  ${caseDefinition.description}`);
  console.log(`  state=${result.state ?? 'n/a'} targets=${result.targets?.length ?? 0} evidence=${result.evidence?.length ?? 0}`);

  if (!verbose) return;

  for (const expectation of evaluation.expectations) {
    const matched = `${expectation.matchedCount}/${expectation.totalCount}`;
    console.log(`  [expect] ${expectation.label}: ${matched} groups`);
  }
  for (const check of evaluation.checks) {
    console.log(`  [check] ${check.label}: ${check.passed ? 'pass' : 'fail'} (actual=${check.actual})`);
  }
}

export function buildBenchmarkReport({
  suite,
  suitePath,
  repoRoot,
  summary,
  metrics,
  caseResults,
  provenance,
  generatedAt = new Date().toISOString(),
  cwd = process.cwd(),
}) {
  return sanitizeBenchmarkReport(
    {
      suite: {
        name: suite.name,
        description: suite.description ?? '',
        path: suitePath,
        repoRoot,
      },
      provenance,
      summary,
      metrics,
      cases: caseResults,
      generatedAt,
    },
    { repoRoot, cwd },
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const { path: suitePath, suite } = await loadSuite(options.suite);
  const repoRoot = path.resolve(options.repoRoot);

  // Spec 025 (FR-006): transcripts power the spec 007 metrics. If the operator
  // did not opt in, enable them into a temp dir for this run only.
  let tempTranscriptDir = null;
  if (!process.env.CEREBRAS_EXPLORER_LOG_PATH) {
    tempTranscriptDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cerebras-benchmark-transcripts-'));
    process.env.CEREBRAS_EXPLORER_LOG_PATH = tempTranscriptDir;
  }

  try {
    const selectedCases = options.caseId
      ? suite.cases.filter(item => item.id === options.caseId)
      : suite.cases;

    if (selectedCases.length === 0) {
      throw new Error(`No benchmark case matched: ${options.caseId}`);
    }

    const handleRequest = await createHandler(() => {});
    const provenance = options.output ? buildExecutionProvenance() : null;
    const caseResults = [];
    const displayRepoRoot = sanitizePathForReport(repoRoot, { repoRoot });
    const displaySuitePath = sanitizePathForReport(suitePath, { repoRoot });

    console.log(`Suite: ${suite.name}`);
    console.log(`Repo : ${displayRepoRoot}`);
    console.log(`File : ${displaySuitePath}`);
    console.log('');

    for (const suiteCase of selectedCases) {
      const caseDefinition = {
        ...suiteCase,
        passScore: suiteCase.passScore ?? suite.defaultPassScore ?? 0.7,
      };
      try {
        const {
          result,
          parentPayload,
          elapsedMs,
          ops,
          transcriptPath,
        } = await runCase(handleRequest, caseDefinition, repoRoot);
        const transcriptMetrics = transcriptPath
          ? await analyzeTranscriptFile(transcriptPath).catch(error => warnHarnessFault('transcript-metrics', error))
          : null;
        const effectMetrics = await computeCaseEffectMetrics({
          result,
          parentPayload,
          repoRoot,
        }).catch(error => warnHarnessFault('effect-metrics', error));
        const citation = await verifyCitations({ result, repoRoot }).catch(error => warnHarnessFault('citation-verification', error));
        const targetRead = await verifyTargetReads({ result, repoRoot })
          .catch(error => warnHarnessFault('target-read-verification', error));
        const evaluation = evaluateBenchmarkCase(caseDefinition, result);
        const caseResult = {
          caseDefinition,
          evaluation,
          result,
          elapsedMs,
          ops,
          transcriptMetrics,
          effectMetrics,
          citation,
          targetRead,
        };
        caseResults.push(caseResult);
        printCaseResult(caseResult, options.verbose);
      } catch (error) {
        const failed = {
          caseDefinition,
          elapsedMs: 0,
          result: null,
          evaluation: {
            id: caseDefinition.id,
            description: caseDefinition.description ?? '',
            score: 0,
            passScore: caseDefinition.passScore,
            passed: false,
            expectations: [],
            checks: [],
          },
          transcriptMetrics: null,
          ops: null,
          effectMetrics: null,
          citation: null,
          targetRead: null,
          error: error.message,
        };
        caseResults.push(failed);
        console.log(`FAIL ${caseDefinition.id}  score=0%  elapsed=0ms`);
        console.log(`  ${caseDefinition.description}`);
        console.log(`  error=${error.message}`);
      }
    }

    const summary = summarizeBenchmarkSuite(caseResults);
    const metrics = computeExtendedMetrics(caseResults);
    console.log('');
    console.log(
      `Summary: ${summary.passedCount}/${summary.caseCount} passed, average score ${formatPercent(summary.averageScore)}`,
    );
    if (metrics) {
      console.log(`  avg tool turns     : ${formatMetric(metrics.avgToolTurns)}`);
      console.log(`  avg internal tokens: ${formatMetric(metrics.avgInternalTokens)}`);
      console.log(`  safety-limit incid.: ${formatMetric(metrics.safetyLimitIncidenceRate, formatPercent)}`);
      console.log(`  no-tool exit rate  : ${formatMetric(metrics.noToolExitRate, formatPercent)}`);
      console.log(`  avg targets        : ${metrics.avgTargets}`);
      console.log(`  evidence snippets  : ${formatMetric(metrics.evidenceSnippetRate, formatPercent)}`);
      console.log(`  avg broad searches : ${formatMetric(metrics.avgBroadSearchCalls)}`);
      console.log(`  avg repeated plans : ${formatMetric(metrics.avgRepeatedToolPlanTurns)}`);
      console.log(`  parent payload     : ${formatMetric(metrics.avgParentPayloadBytes)} bytes avg; ${formatMetric(metrics.medianParentPayloadBytes)} median`);
      console.log(`  payload tokens     : ${formatMetric(metrics.avgResponsePayloadTokens)} avg/case`);
      console.log(`  cited source tokens: ${formatMetric(metrics.avgCitedSourceTokens)} avg/case (conservative native-read lower bound)`);
      console.log(`  target-read tokens : ${formatMetric(metrics.avgTargetReadTokens)} avg/case (${formatMetric(metrics.targetReadCaseRate, formatPercent)} required)`);
      console.log(`  target-read valid  : ${formatMetric(metrics.targetReadAccuracy, formatPercent)}`);
      console.log(`  context savings    : ${formatMetric(metrics.avgContextSavingsRatio, v => `${v}x`)}`);
      console.log(`  parent effect      : ${formatMetric(metrics.avgParentEffectRatio, v => `${v}x`)} after required target reads`);
      console.log(`  citation accuracy  : ${formatMetric(metrics.citationAccuracy, formatPercent)} (${metrics.weakCitationChecks} weak checks)`);
      console.log(`  wrapper coverage   : ${formatMetric(metrics.wrapperCoverageRate, formatPercent)}`);
      console.log(`  wrapper distinct   : ${formatMetric(metrics.wrapperDistinctnessRate, formatPercent)}`);
    }

    if (options.output) {
      const outputPath = path.resolve(options.output);
      const sanitizedReport = buildBenchmarkReport({
        suite,
        suitePath,
        repoRoot,
        summary,
        metrics,
        caseResults,
        provenance,
      });
      await fs.writeFile(
        outputPath,
        JSON.stringify(sanitizedReport, null, 2),
        'utf8',
      );
      console.log(`Saved JSON report to ${sanitizePathForReport(outputPath, { repoRoot })}`);
    }

    if (summary.failedCount > 0) {
      process.exitCode = 1;
    }
  } finally {
    if (tempTranscriptDir) {
      delete process.env.CEREBRAS_EXPLORER_LOG_PATH;
      if (options.keepTranscripts) {
        console.log(`Transcripts kept at ${tempTranscriptDir}`);
      } else {
        await fs.rm(tempTranscriptDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
          .catch(error => console.warn(`Transcript cleanup failed: ${error.message} (${tempTranscriptDir})`));
      }
    }
  }
}

function isDirectRun() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isDirectRun()) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
