#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

import { createMcpRequestHandler } from '../src/mcp/server.mjs';
import { evaluateBenchmarkCase, summarizeBenchmarkSuite } from '../src/benchmark/evaluator.mjs';

function parseArgs(argv) {
  const options = {
    suite: 'benchmarks/core.json',
    repoRoot: process.cwd(),
    output: null,
    caseId: null,
    verbose: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--suite') options.suite = argv[++index];
    else if (arg === '--repo-root') options.repoRoot = argv[++index];
    else if (arg === '--output') options.output = argv[++index];
    else if (arg === '--case') options.caseId = argv[++index];
    else if (arg === '--verbose') options.verbose = true;
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
      '  --suite <path>      Benchmark suite JSON file. Default: benchmarks/core.json',
      '  --repo-root <path>  Repository root to benchmark. Default: current working directory',
      '  --case <id>         Run only one benchmark case',
      '  --output <path>     Write full JSON results to a file',
      '  --verbose           Print per-expectation details',
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
      clientInfo: { name: 'benchmark-runner', version: '0.1.0' },
    },
  });
  return handleRequest;
}

async function runCase(handleRequest, caseDefinition, repoRoot) {
  const startedAt = Date.now();
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

  return {
    elapsedMs: Date.now() - startedAt,
    result: response.structuredContent,
  };
}

function formatPercent(score) {
  return `${Math.round(score * 100)}%`;
}

function printCaseResult(caseResult, verbose) {
  const { caseDefinition, evaluation, elapsedMs, result } = caseResult;
  const status = evaluation.passed ? 'PASS' : 'FAIL';
  console.log(`${status} ${caseDefinition.id}  score=${formatPercent(evaluation.score)}  elapsed=${elapsedMs}ms`);
  console.log(`  ${caseDefinition.description}`);
  console.log(`  confidence=${result.confidence} confidenceScore=${result.confidenceScore ?? 'n/a'} evidence=${result.evidence?.length ?? 0}`);

  if (!verbose) return;

  for (const expectation of evaluation.expectations) {
    const matched = `${expectation.matchedCount}/${expectation.totalCount}`;
    console.log(`  [expect] ${expectation.label}: ${matched} groups`);
  }
  for (const check of evaluation.checks) {
    console.log(`  [check] ${check.label}: ${check.passed ? 'pass' : 'fail'} (actual=${check.actual})`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const { path: suitePath, suite } = await loadSuite(options.suite);
  const repoRoot = path.resolve(options.repoRoot);
  const selectedCases = options.caseId
    ? suite.cases.filter(item => item.id === options.caseId)
    : suite.cases;

  if (selectedCases.length === 0) {
    throw new Error(`No benchmark case matched: ${options.caseId}`);
  }

  const handleRequest = await createHandler(() => {});
  const caseResults = [];

  console.log(`Suite: ${suite.name}`);
  console.log(`Repo : ${repoRoot}`);
  console.log(`File : ${suitePath}`);
  console.log('');

  for (const suiteCase of selectedCases) {
    const caseDefinition = {
      ...suiteCase,
      passScore: suiteCase.passScore ?? suite.defaultPassScore ?? 0.7,
    };
    try {
      const { result, elapsedMs } = await runCase(handleRequest, caseDefinition, repoRoot);
      const evaluation = evaluateBenchmarkCase(caseDefinition, result);
      const caseResult = { caseDefinition, evaluation, result, elapsedMs };
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
        error: error.message,
      };
      caseResults.push(failed);
      console.log(`FAIL ${caseDefinition.id}  score=0%  elapsed=0ms`);
      console.log(`  ${caseDefinition.description}`);
      console.log(`  error=${error.message}`);
    }
  }

  const summary = summarizeBenchmarkSuite(caseResults);
  console.log('');
  console.log(
    `Summary: ${summary.passedCount}/${summary.caseCount} passed, average score ${formatPercent(summary.averageScore)}`,
  );

  if (options.output) {
    const outputPath = path.resolve(options.output);
    await fs.writeFile(
      outputPath,
      JSON.stringify(
        {
          suite: {
            name: suite.name,
            description: suite.description ?? '',
            path: suitePath,
            repoRoot,
          },
          summary,
          cases: caseResults,
          generatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      'utf8',
    );
    console.log(`Saved JSON report to ${outputPath}`);
  }

  if (summary.failedCount > 0) {
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
