import { CerebrasChatClient, extractFirstJsonObject } from './cerebras-client.mjs';
import {
  getBudgetConfig,
  getExplorerTemperature,
  getExplorerTopP,
  getReasoningEffortForBudget,
  getRepoRoot,
  getModelForBudget,
  classifyTaskComplexity,
  isTruthyEnv,
  loadProjectConfig,
  normalizeProjectConfig,
} from './config.mjs';
import {
  collectCandidatePathsFromToolResult,
  mergeCandidatePaths,
  RepoToolkit,
} from './repo-tools.mjs';
import { globalRepoCache } from './cache.mjs';
import {
  buildExplorerSystemPrompt,
  buildExplorerUserPrompt,
  buildFinalizePrompt,
} from './prompt.mjs';
import {
  EXPLORE_RESULT_JSON_SCHEMA,
  computeConfidenceScore,
  normalizeExploreResult,
  validateExploreRepoArgs,
} from './schemas.mjs';
import { createChatClient } from './providers/index.mjs';

// Evidence items whose line range is within this many lines of an observed
// range are kept as "partial" matches rather than being dropped entirely.
const EVIDENCE_LINE_TOLERANCE = 2;

// Common entry-point filename patterns (used to identify codeMap.entryPoints)
const ENTRY_POINT_PATTERNS = /^(index|main|app|server|cli|start|entry)\.(m?[jt]s|py|go|rb|rs)$/i;

function nowMs() {
  return Date.now();
}

function safeJsonParse(input) {
  if (typeof input !== 'string') {
    return {};
  }
  try {
    return JSON.parse(input);
  } catch (error) {
    throw new Error(`Failed to parse tool arguments: ${error.message}`);
  }
}

function summarizeUsage(existing, usage) {
  if (!usage) {
    return existing;
  }
  return {
    inputTokens: (existing.inputTokens || 0) + (usage.prompt_tokens || 0),
    outputTokens: (existing.outputTokens || 0) + (usage.completion_tokens || 0),
    totalTokens: (existing.totalTokens || 0) + (usage.total_tokens || 0),
  };
}

function incrementToolStats(stats, toolName) {
  stats.toolCalls += 1;
  if (toolName === 'repo_read_file') stats.filesRead += 1;
  if (toolName === 'repo_grep') stats.grepCalls += 1;
  if (toolName === 'repo_find_files') stats.findFileCalls += 1;
  if (toolName === 'repo_list_dir') stats.listDirCalls += 1;
  if (toolName === 'repo_git_log') stats.gitLogCalls += 1;
  if (toolName === 'repo_git_blame') stats.gitBlameCalls += 1;
  if (toolName === 'repo_git_diff') stats.gitDiffCalls += 1;
  if (toolName === 'repo_git_show') stats.gitShowCalls += 1;
  if (toolName === 'repo_symbols' || toolName === 'repo_references' || toolName === 'repo_symbol_context') stats.symbolCalls += 1;
}

function recordObservedRange(observedRanges, targetPath, startLine, endLine) {
  if (!targetPath) {
    return;
  }
  const current = observedRanges.get(targetPath) ?? [];
  current.push({ startLine, endLine });
  observedRanges.set(targetPath, current);
}

/**
 * Check whether an evidence item's line range overlaps with any observed read
 * range for that file. Returns an object with:
 *   - overlaps: boolean — true if within EVIDENCE_LINE_TOLERANCE
 *   - partial: boolean — true when overlap is only within tolerance (not exact)
 */
function checkEvidenceGrounding(observedRanges, evidenceItem) {
  const ranges = observedRanges.get(evidenceItem.path);
  if (!ranges || ranges.length === 0) {
    return { overlaps: false, partial: false };
  }
  for (const range of ranges) {
    if (evidenceItem.startLine <= range.endLine && evidenceItem.endLine >= range.startLine) {
      return { overlaps: true, partial: false };
    }
    const toleratedStart = evidenceItem.startLine - EVIDENCE_LINE_TOLERANCE;
    const toleratedEnd = evidenceItem.endLine + EVIDENCE_LINE_TOLERANCE;
    if (toleratedStart <= range.endLine && toleratedEnd >= range.startLine) {
      return { overlaps: true, partial: true };
    }
  }
  return { overlaps: false, partial: false };
}

function buildCodeMap(observedRanges) {
  const paths = [...observedRanges.keys()];
  if (paths.length === 0) {
    return null;
  }

  const entryPoints = [];
  const keyModules = [];

  for (const filePath of paths) {
    const basename = filePath.split('/').pop() ?? filePath;
    const isEntry = ENTRY_POINT_PATTERNS.test(basename);
    if (isEntry) {
      entryPoints.push(filePath);
    }
    const ranges = observedRanges.get(filePath) ?? [];
    const linesRead = ranges.reduce((sum, r) => sum + (r.endLine - r.startLine + 1), 0);
    keyModules.push({ path: filePath, role: guessModuleRole(filePath), linesRead });
  }

  return { entryPoints, keyModules };
}

function guessModuleRole(filePath) {
  const lower = filePath.toLowerCase();
  if (/test|spec/.test(lower)) return 'test';
  if (/route|controller/.test(lower)) return 'route/controller';
  if (/middleware|auth/.test(lower)) return 'middleware';
  if (/model|schema|entity/.test(lower)) return 'data model';
  if (/service|handler/.test(lower)) return 'service';
  if (/util|helper|common/.test(lower)) return 'utility';
  if (/config|setting/.test(lower)) return 'configuration';
  if (/index|main|app|server/.test(lower)) return 'entry point';
  if (/client|api/.test(lower)) return 'API client';
  if (/cache/.test(lower)) return 'cache';
  if (/prompt/.test(lower)) return 'prompt';
  if (/session/.test(lower)) return 'session';
  if (/provider/.test(lower)) return 'provider';
  return 'module';
}

function buildMermaidDiagram(codeMap) {
  if (!codeMap || codeMap.keyModules.length < 2 || codeMap.keyModules.length > 12) {
    return null;
  }

  const entrySet = new Set(codeMap.entryPoints);
  const nodes = codeMap.keyModules.map(m => {
    const id = m.path.replace(/[^a-zA-Z0-9]/g, '_');
    const label = m.path.split('/').pop() ?? m.path;
    return { id, label, path: m.path, isEntry: entrySet.has(m.path) };
  });

  const lines = ['graph TD'];
  for (const node of nodes) {
    if (node.isEntry) {
      lines.push(`  ${node.id}[["${node.label}"]];`);
    } else {
      lines.push(`  ${node.id}["${node.label}"];`);
    }
  }

  const entries = nodes.filter(n => n.isEntry);
  const nonEntries = nodes.filter(n => !n.isEntry);
  for (const entry of entries) {
    for (const mod of nonEntries) {
      lines.push(`  ${entry.id} --> ${mod.id};`);
    }
  }

  return lines.join('\n');
}

function buildRecentActivity(capturedGitLogs) {
  if (capturedGitLogs.length === 0) {
    return null;
  }

  const allCommits = [];
  const fileCommitCounts = new Map();
  const authorSet = new Set();

  for (const logResult of capturedGitLogs) {
    if (!logResult || !Array.isArray(logResult.commits)) {
      continue;
    }
    for (const commit of logResult.commits) {
      allCommits.push(commit);
      if (typeof commit.author === 'string') {
        authorSet.add(commit.author);
      }
    }
    if (typeof logResult.path === 'string' && logResult.path && Array.isArray(logResult.commits)) {
      fileCommitCounts.set(logResult.path, (fileCommitCounts.get(logResult.path) ?? 0) + logResult.commits.length);
    }
  }

  if (allCommits.length === 0) {
    return null;
  }

  const seen = new Set();
  const uniqueCommits = [];
  for (const commit of allCommits) {
    if (commit.hash && !seen.has(commit.hash)) {
      seen.add(commit.hash);
      uniqueCommits.push(commit);
    }
  }

  const hotFiles = [...fileCommitCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([file, count]) => `${file} (${count} commits)`);

  const recentCommits = uniqueCommits.slice(0, 5).map(c => ({
    hash: c.hash ?? '',
    message: c.subject ?? c.message ?? '',
    author: c.author ?? '',
    date: c.date ?? '',
  }));

  return {
    hotFiles,
    recentAuthors: [...authorSet].slice(0, 10),
    lastModified: recentCommits.length > 0 ? recentCommits[0].date : '',
    recentCommits,
  };
}

function resolveModelBudget(task, budgetLabel) {
  if (!isTruthyEnv(process.env.CEREBRAS_EXPLORER_AUTO_ROUTE)) {
    return budgetLabel;
  }
  const complexity = classifyTaskComplexity(task);
  if (complexity === 'simple') return 'quick';
  if (complexity === 'complex') return 'deep';
  return budgetLabel;
}

/**
 * Describe the tool calls that are about to be executed, for progress messages.
 */
function describePendingTools(toolCalls) {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return '';
  const names = [...new Set(toolCalls.map(c => c.function?.name ?? 'unknown'))];
  const displayed = names.slice(0, 3).join(', ');
  return names.length > 3 ? `${displayed} (+${names.length - 3} more)` : displayed;
}

export class ExplorerRuntime {
  /**
   * @param {object} [opts]
   * @param {object}   [opts.chatClient]   - Pre-built chat client (overrides factory).
   * @param {Function} [opts.logger]
   */
  constructor({ chatClient = null, logger = () => {} } = {}) {
    this._explicitChatClient = chatClient;
    this.logger = logger;
  }

  /**
   * @param {object} args - explore_repo arguments (validated by validateExploreRepoArgs)
   * @param {object} [callOpts]
   * @param {Function} [callOpts.onProgress]    - Called with {progress, total, message}
   * @param {object}   [callOpts.sessionStore]  - SessionStore instance for session management
   */
  async explore(args, { onProgress = null, sessionStore = null } = {}) {
    validateExploreRepoArgs(args);

    const budgetConfig = getBudgetConfig(args.budget);
    const repoRoot = getRepoRoot(args.repo_root);

    // Load .cerebras-explorer.json project config
    const rawProjectConfig = await loadProjectConfig(repoRoot);
    const projectConfig = normalizeProjectConfig(rawProjectConfig);

    // Apply project config defaults (explicit args take priority)
    const effectiveBudgetLabel = args.budget ?? projectConfig.defaultBudget ?? 'normal';
    const effectiveScope = args.scope ?? projectConfig.defaultScope ?? [];
    const projectContext = projectConfig.projectContext ?? null;
    const keyFiles = projectConfig.keyFiles ?? [];
    const extraIgnoreDirs = projectConfig.extraIgnoreDirs ?? [];

    const modelBudget = resolveModelBudget(args.task, effectiveBudgetLabel);
    const chatClient = this._explicitChatClient ?? createChatClient({ budget: modelBudget });

    // Session integration
    let sessionId = null;
    let sessionData = null;
    if (sessionStore) {
      if (args.session && args.session.trim()) {
        sessionData = sessionStore.get(args.session);
      }
      if (!sessionData) {
        sessionId = sessionStore.create(repoRoot);
        sessionData = sessionStore.get(sessionId);
      } else {
        sessionId = args.session;
      }
    }

    const repoToolkit = new RepoToolkit({
      repoRoot,
      budgetConfig,
      logger: this.logger,
      cache: globalRepoCache,
      extraIgnoreDirs,
    });
    await repoToolkit.initialize(effectiveScope);

    const startedAt = nowMs();
    const tools = repoToolkit.buildToolDefinitions();

    const messages = [
      {
        role: 'system',
        content: buildExplorerSystemPrompt({
          repoRoot,
          budgetConfig,
          projectContext,
          keyFiles,
          previousSummaries: sessionData?.summaries ?? [],
        }),
      },
      {
        role: 'user',
        content: buildExplorerUserPrompt({
          task: args.task,
          scope: effectiveScope,
          budget: budgetConfig.label,
          hints: args.hints,
          sessionCandidatePaths: sessionData?.candidatePaths ?? [],
          language: args.language,
        }),
      },
    ];

    const reasoningEffort = getReasoningEffortForBudget(chatClient.model, budgetConfig.label);
    const temperature = budgetConfig.temperature ?? getExplorerTemperature();
    const topP = budgetConfig.topP ?? getExplorerTopP();

    const stats = {
      model: chatClient.model,
      budget: budgetConfig.label,
      turns: 0,
      toolCalls: 0,
      listDirCalls: 0,
      findFileCalls: 0,
      grepCalls: 0,
      filesRead: 0,
      gitLogCalls: 0,
      gitBlameCalls: 0,
      gitDiffCalls: 0,
      gitShowCalls: 0,
      symbolCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      elapsedMs: 0,
      stoppedByBudget: false,
      repoRoot,
      sessionId,
    };

    let candidatePaths = [];
    let finalObject = null;
    let lastAssistantContent = '';
    const observedRanges = new Map();
    const capturedGitLogs = [];

    for (let turnIndex = 0; turnIndex < budgetConfig.maxTurns; turnIndex += 1) {
      // Progress: starting a new turn
      if (onProgress) {
        onProgress({
          progress: turnIndex,
          total: budgetConfig.maxTurns,
          message: turnIndex === 0
            ? 'Starting exploration...'
            : `Turn ${turnIndex + 1}/${budgetConfig.maxTurns}: continuing...`,
        });
      }

      const completion = await chatClient.createChatCompletion({
        messages,
        tools,
        reasoningEffort,
        temperature,
        topP,
        maxCompletionTokens: budgetConfig.maxCompletionTokens,
        parallelToolCalls: true,
      });

      stats.turns += 1;
      Object.assign(stats, summarizeUsage(stats, completion.usage));

      const assistantMessage = {
        role: 'assistant',
        content: completion.message.content || null,
      };

      if (completion.message.reasoning) {
        assistantMessage.reasoning = completion.message.reasoning;
      }

      if (completion.message.toolCalls.length > 0) {
        assistantMessage.tool_calls = completion.message.toolCalls.map(call => ({
          id: call.id,
          type: 'function',
          function: { name: call.function.name, arguments: call.function.arguments },
        }));
      }

      messages.push(assistantMessage);

      if (completion.message.toolCalls.length === 0) {
        // No more tool calls — route through finalizeAfterToolLoop() so strict schema
        // validation always runs, regardless of exit path.
        if (onProgress) {
          onProgress({
            progress: budgetConfig.maxTurns - 1,
            total: budgetConfig.maxTurns,
            message: 'Synthesizing findings...',
          });
        }
        lastAssistantContent = completion.message.content || '';
        const finalized = await this.finalizeAfterToolLoop({
          chatClient,
          messages,
          reasoningEffort,
          temperature,
          topP,
          budgetConfig,
        });
        finalObject = finalized.result;
        Object.assign(stats, summarizeUsage(stats, finalized.usage));
        break;
      }

      // Progress: describe which tools are about to run
      if (onProgress) {
        const toolDesc = describePendingTools(completion.message.toolCalls);
        onProgress({
          progress: turnIndex + 1,
          total: budgetConfig.maxTurns,
          message: `Turn ${turnIndex + 1}/${budgetConfig.maxTurns}: ${toolDesc}`,
        });
      }

      for (const toolCall of completion.message.toolCalls) {
        const toolName = toolCall.function.name;
        const toolArgs = safeJsonParse(toolCall.function.arguments || '{}');
        incrementToolStats(stats, toolName);

        let toolResult;
        try {
          toolResult = await repoToolkit.callTool(toolName, toolArgs);
        } catch (error) {
          toolResult = { error: true, message: error.message, tool: toolName };
        }

        candidatePaths = mergeCandidatePaths(
          candidatePaths,
          collectCandidatePathsFromToolResult(toolName, toolResult),
        );

        if (toolName === 'repo_read_file' && !toolResult?.error) {
          recordObservedRange(observedRanges, toolResult.path, toolResult.startLine, toolResult.endLine);
        }

        if (toolName === 'repo_grep' && Array.isArray(toolResult?.matches)) {
          for (const match of toolResult.matches) {
            recordObservedRange(observedRanges, match.path, match.line, match.line);
          }
        }

        if (toolName === 'repo_git_log' && !toolResult?.error) {
          capturedGitLogs.push({ ...toolResult, path: toolArgs.path ?? null });
        }

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(toolResult),
        });
      }
    }

    if (!finalObject) {
      stats.stoppedByBudget = true;
      if (onProgress) {
        onProgress({
          progress: budgetConfig.maxTurns,
          total: budgetConfig.maxTurns,
          message: 'Budget exhausted — synthesizing partial answer...',
        });
      }
      const finalized = await this.finalizeAfterToolLoop({
        chatClient,
        messages,
        reasoningEffort,
        temperature,
        topP,
        budgetConfig,
      });
      finalObject = finalized.result;
      Object.assign(stats, summarizeUsage(stats, finalized.usage));
    }

    stats.elapsedMs = nowMs() - startedAt;
    Object.assign(stats, globalRepoCache.stats());

    const normalized = normalizeExploreResult(finalObject, stats);
    normalized.candidatePaths = mergeCandidatePaths(normalized.candidatePaths, candidatePaths).slice(0, 80);

    // Ground evidence
    const totalEvidenceBefore = normalized.evidence.length;
    normalized.evidence = normalized.evidence
      .map(item => ({ ...item, path: item.path.replace(/^\.\//, '') }))
      .filter(item => item.path && item.why)
      .map(item => {
        const { overlaps, partial } = checkEvidenceGrounding(observedRanges, item);
        if (!overlaps) return null;
        return { ...item, groundingStatus: partial ? 'partial' : 'exact' };
      })
      .filter(Boolean);

    // Confidence scoring
    const { score: confidenceScore, level: confidenceLevel, factors: confidenceFactors } =
      computeConfidenceScore(normalized.evidence, totalEvidenceBefore, stats);
    normalized.confidenceScore = confidenceScore;
    normalized.confidenceLevel = confidenceLevel;
    normalized.confidenceFactors = confidenceFactors;

    if (totalEvidenceBefore > normalized.evidence.length) {
      normalized.confidence = 'low';
      normalized.followups = mergeCandidatePaths(normalized.followups, [{
        description: 'Some evidence items were dropped because they were not grounded in inspected line ranges.',
        priority: 'optional',
        suggestedCall: null,
      }]);
    }

    const LEVEL_ORDER = { low: 0, medium: 1, high: 2 };
    if (LEVEL_ORDER[normalized.confidence] > LEVEL_ORDER[confidenceLevel]) {
      normalized.confidence = confidenceLevel;
    }

    if (!normalized.summary) normalized.summary = normalized.answer;
    if (!normalized.answer) {
      normalized.answer = lastAssistantContent || 'Explorer did not return a final answer.';
      normalized.confidence = 'low';
    }

    // codeMap + Mermaid diagram
    const codeMap = buildCodeMap(observedRanges);
    if (codeMap) {
      normalized.codeMap = codeMap;
      const strategy = args.hints?.strategy ?? null;
      if (!strategy || strategy === 'breadth-first') {
        const diagram = buildMermaidDiagram(codeMap);
        if (diagram) normalized.diagram = diagram;
      }
    }

    // recentActivity from git_log
    const recentActivity = buildRecentActivity(capturedGitLogs);
    if (recentActivity) normalized.recentActivity = recentActivity;

    // Update session with this call's result
    if (sessionStore && sessionId) {
      sessionStore.update(sessionId, normalized);
    }

    return normalized;
  }

  async finalizeAfterToolLoop({ chatClient, messages, reasoningEffort, temperature, topP, budgetConfig }) {
    const maxCompletionTokens = budgetConfig?.finalizeMaxCompletionTokens ?? 2000;
    const completion = await chatClient.createChatCompletion({
      messages: [
        ...messages,
        { role: 'user', content: buildFinalizePrompt() },
      ],
      responseFormat: {
        type: 'json_schema',
        json_schema: EXPLORE_RESULT_JSON_SCHEMA,
      },
      reasoningEffort,
      temperature,
      topP,
      maxCompletionTokens,
      parallelToolCalls: false,
    });

    // structured output path — primary
    const structured = extractFirstJsonObject(completion.message.content);
    if (structured) {
      return { result: structured, usage: completion.usage ?? null };
    }

    // fallback: unstructured content that could not be parsed as JSON
    return {
      result: {
        answer: completion.message.content || 'Explorer could not synthesize a final answer.',
        summary: completion.message.content || '',
        confidence: 'low',
        evidence: [],
        candidatePaths: [],
        followups: [],
      },
      usage: completion.usage ?? null,
    };
  }
}

export async function exploreRepository(args, options = {}) {
  const { onProgress, sessionStore, ...runtimeOptions } = options;
  const runtime = new ExplorerRuntime(runtimeOptions);
  return runtime.explore(args, { onProgress, sessionStore });
}
