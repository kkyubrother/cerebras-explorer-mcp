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
  buildFreeExploreSystemPrompt,
  buildFreeExploreUserPrompt,
  buildFreeExploreFinalizePrompt,
} from './prompt.mjs';
import {
  EXPLORE_RESULT_JSON_SCHEMA,
  computeConfidenceScore,
  reconcileConfidence,
  normalizeExploreResult,
  validateExploreRepoArgs,
} from './schemas.mjs';
import { createChatClient } from './providers/index.mjs';

// Evidence items whose line range is within this many lines of an observed
// range are kept as "partial" matches rather than being dropped entirely.
const EVIDENCE_LINE_TOLERANCE = 2;

// Maximum number of tool calls to execute in parallel within a single turn.
const TOOL_CONCURRENCY = 4;

/**
 * Run async tasks from an array in parallel, capped at `limit` concurrent.
 * Returns results in the same order as the input items.
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, index: number) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
async function runWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  const queue = items.map((item, i) => ({ item, i }));

  async function worker() {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) break;
      const { item, i } = next;
      try {
        results[i] = await fn(item, i);
      } catch (error) {
        // Isolate individual worker failures so one bad item can't abort the batch
        results[i] = { error: true, stage: 'worker', message: error.message };
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

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

/**
 * Resolve session for an explore() call.
 * Returns { ok, sessionId, sessionData, sessionStatus, remainingCalls } on success,
 * or { ok: false, reason } when an explicitly requested session is invalid.
 *
 * When no session is requested (or sessionStore is null), a new session is created.
 * When a session is explicitly requested but fails validation, we reject rather
 * than silently creating a new one.
 */
function resolveSessionForExplore(sessionStore, requestedSessionId, repoRoot) {
  if (!sessionStore) {
    return { ok: true, sessionId: null, sessionData: null, sessionStatus: null, remainingCalls: null };
  }

  const trimmedId = requestedSessionId && typeof requestedSessionId === 'string'
    ? requestedSessionId.trim()
    : '';

  if (trimmedId) {
    // Explicit session requested — validate it strictly
    const validation = sessionStore.validateForReuse(trimmedId, repoRoot);
    if (!validation.ok) {
      return { ok: false, reason: validation.reason };
    }
    return {
      ok: true,
      sessionId: trimmedId,
      sessionData: validation.session,
      sessionStatus: 'reused',
      remainingCalls: validation.remainingCalls,
    };
  }

  // No session requested — create a new one
  const newId = sessionStore.create(repoRoot);
  const newData = sessionStore.get(newId);
  return {
    ok: true,
    sessionId: newId,
    sessionData: newData,
    sessionStatus: 'created',
    remainingCalls: sessionStore._maxCalls,
  };
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
    const exactOverlap =
      evidenceItem.startLine <= range.endLine && evidenceItem.endLine >= range.startLine;
    if (exactOverlap) {
      return { overlaps: true, partial: false };
    }
    // Partial matching: allow evidence items that are adjacent to (but not overlapping)
    // the read range, PROVIDED the evidence range itself is short. This prevents long
    // ranges (e.g. 50-99) from sneaking through when only one endpoint is near the
    // read range (e.g. 100-110). Short ranges (e.g. 5-6 adjacent to 1-4) are still
    // accepted as plausible off-by-one / line-count mismatches.
    const evidenceLength = evidenceItem.endLine - evidenceItem.startLine + 1;
    const distanceToRange = Math.max(
      range.startLine - evidenceItem.endLine,   // evidence is before the range
      evidenceItem.startLine - range.endLine,   // evidence is after the range
      0,
    );
    if (distanceToRange <= EVIDENCE_LINE_TOLERANCE && evidenceLength <= 10) {
      return { overlaps: true, partial: true };
    }
  }
  return { overlaps: false, partial: false };
}

function buildCodeMap(observedRanges, configEntryPoints = []) {
  const paths = [...observedRanges.keys()];
  if (paths.length === 0) {
    return null;
  }

  // Phase 4: config entryPoints take priority over pattern-based detection
  const configEntrySet = new Set(configEntryPoints);
  const entryPoints = [];
  const keyModules = [];

  for (const filePath of paths) {
    const basename = filePath.split('/').pop() ?? filePath;
    const isEntry = configEntrySet.has(filePath) || ENTRY_POINT_PATTERNS.test(basename);
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
   * Shared setup for explore() and freeExplore().
   * Returns all the common infrastructure: budgetConfig, repoRoot, projectConfig,
   * session data, repoToolkit, chatClient, tools, and timing helpers.
   */
  async _initExploreContext({ budgetLabel, repoRootArg, scope, session, taskText, sessionStore }) {
    const repoRoot = getRepoRoot(repoRootArg);

    const rawProjectConfig = await loadProjectConfig(repoRoot);
    const projectConfig = normalizeProjectConfig(rawProjectConfig);

    const effectiveBudgetLabel = budgetLabel ?? projectConfig.defaultBudget ?? 'normal';
    const budgetConfig = getBudgetConfig(effectiveBudgetLabel);
    const effectiveScope = scope ?? projectConfig.defaultScope ?? [];
    const projectContext = projectConfig.projectContext ?? null;
    const keyFiles = projectConfig.keyFiles ?? [];
    const extraIgnoreDirs = projectConfig.extraIgnoreDirs ?? [];

    const modelBudget = resolveModelBudget(taskText, effectiveBudgetLabel);
    const chatClient = this._explicitChatClient ?? createChatClient({ budget: modelBudget });

    const sessionResolution = resolveSessionForExplore(sessionStore, session, repoRoot);
    if (!sessionResolution.ok) {
      const err = new Error(`Invalid session: ${sessionResolution.reason}`);
      err.code = -32602;
      err.sessionError = sessionResolution.reason;
      throw err;
    }
    const { sessionId, sessionData, sessionStatus, remainingCalls } = sessionResolution;

    const repoToolkit = new RepoToolkit({
      repoRoot,
      budgetConfig,
      logger: this.logger,
      cache: globalRepoCache,
      extraIgnoreDirs,
    });
    await repoToolkit.initialize(effectiveScope);

    const tools = repoToolkit.buildToolDefinitions();
    const reasoningEffort = getReasoningEffortForBudget(chatClient.model, budgetConfig.label);
    const temperature = budgetConfig.temperature ?? getExplorerTemperature();
    const topP = budgetConfig.topP ?? getExplorerTopP();

    return {
      budgetConfig, repoRoot, projectConfig, effectiveScope, projectContext, keyFiles,
      chatClient, sessionId, sessionData, sessionStatus, remainingCalls,
      repoToolkit, tools, reasoningEffort, temperature, topP,
    };
  }

  /**
   * @param {object} args - explore_repo arguments (validated by validateExploreRepoArgs)
   * @param {object} [callOpts]
   * @param {Function} [callOpts.onProgress]    - Called with {progress, total, message}
   * @param {object}   [callOpts.sessionStore]  - SessionStore instance for session management
   */
  async explore(args, { onProgress = null, sessionStore = null } = {}) {
    validateExploreRepoArgs(args);

    const {
      budgetConfig, repoRoot, projectConfig, effectiveScope, projectContext, keyFiles,
      chatClient, sessionId, sessionData, sessionStatus, remainingCalls,
      repoToolkit, tools, reasoningEffort, temperature, topP,
    } = await this._initExploreContext({
      budgetLabel: args.budget,
      repoRootArg: args.repo_root,
      scope: args.scope,
      session: args.session,
      taskText: args.task,
      sessionStore,
    });

    const startedAt = nowMs();

    const messages = [
      {
        role: 'system',
        content: buildExplorerSystemPrompt({
          repoRoot,
          budgetConfig,
          language: args.language,
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
          sessionCandidatePaths: sessionData?.candidatePathsWithContext ?? sessionData?.candidatePaths ?? [],
          language: args.language,
        }),
      },
    ];

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
      sessionStatus,
      remainingCalls,
    };

    let candidatePaths = [];
    let finalObject = null;
    let lastAssistantContent = '';
    const observedRanges = new Map();
    const capturedGitLogs = [];
    const observedGit = { commits: new Set(), blame: new Set() };

    // Checkpoint interval: inject a self-assessment message every N turns.
    // Only active for budgets with enough turns to benefit (>6).
    const CHECKPOINT_INTERVAL = 4;
    const checkpointEnabled = budgetConfig.maxTurns > 6;

    for (let turnIndex = 0; turnIndex < budgetConfig.maxTurns; turnIndex += 1) {
      // Checkpoint: every CHECKPOINT_INTERVAL turns, ask the model to self-assess.
      if (checkpointEnabled && turnIndex > 0 && turnIndex % CHECKPOINT_INTERVAL === 0) {
        messages.push({
          role: 'user',
          content: 'Checkpoint: briefly reassess what is already proven, what is still missing, and whether another tool call is necessary. Prefer the smallest next step; use multiple calls only if they are clearly independent.',
        });
      }

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

      // Phase 6-B: execute up to TOOL_CONCURRENCY tool calls in parallel
      const toolCallResults = await runWithConcurrency(
        completion.message.toolCalls,
        TOOL_CONCURRENCY,
        async (toolCall) => {
          let toolName = toolCall.function?.name ?? '(unknown)';
          let toolArgs = {};
          let toolResult;
          try {
            toolArgs = safeJsonParse(toolCall.function?.arguments ?? '{}');
            toolResult = await repoToolkit.callTool(toolName, toolArgs);
          } catch (error) {
            toolResult = {
              error: true,
              stage: 'parse_or_exec',
              type: error.message.startsWith('Failed to parse tool arguments')
                ? 'invalid_tool_arguments'
                : 'tool_execution_error',
              message: error.message,
              tool: toolName,
            };
          }
          return { toolCall, toolName, toolArgs, toolResult };
        },
      );

      for (const { toolCall, toolName, toolArgs, toolResult } of toolCallResults) {
        incrementToolStats(stats, toolName);

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

        // Phase 2: record blame lines as observed ranges
        if (toolName === 'repo_git_blame' && !toolResult?.error && Array.isArray(toolResult?.lines)) {
          const blamePath = toolArgs.path ?? null;
          if (blamePath) {
            for (const entry of toolResult.lines) {
              if (typeof entry.line === 'number') {
                recordObservedRange(observedRanges, blamePath, entry.line, entry.line);
              }
            }
          }
        }

        // Phase 2: record diff/show hunk ranges as observed ranges
        if ((toolName === 'repo_git_diff' || toolName === 'repo_git_show') && !toolResult?.error) {
          const diffFiles = toolResult?.files ?? [];
          for (const file of diffFiles) {
            if (file.path && Array.isArray(file.hunks)) {
              for (const hunk of file.hunks) {
                recordObservedRange(observedRanges, file.path, hunk.newStart, hunk.newStart + hunk.newLines - 1);
              }
            }
          }
        }

        // Record observedRanges from macro tools (e.g. repo_symbol_context)
        if (Array.isArray(toolResult?.observedRanges)) {
          for (const observed of toolResult.observedRanges) {
            recordObservedRange(observedRanges, observed.path, observed.startLine, observed.endLine);
          }
        }

        if (toolName === 'repo_git_log' && !toolResult?.error) {
          capturedGitLogs.push({ ...toolResult, path: toolArgs.path ?? null });
          // Record observed commit SHAs for git evidence validation
          if (Array.isArray(toolResult.commits)) {
            for (const commit of toolResult.commits) {
              if (commit.sha) observedGit.commits.add(commit.sha);
            }
          }
        }

        if (toolName === 'repo_git_show' && !toolResult?.error) {
          if (toolResult.sha) observedGit.commits.add(toolResult.sha);
        }

        if (toolName === 'repo_git_blame' && !toolResult?.error && Array.isArray(toolResult.lines)) {
          const blamePath = toolArgs.path ?? null;
          for (const entry of toolResult.lines) {
            if (blamePath && typeof entry.line === 'number' && entry.sha) {
              observedGit.blame.add(`${blamePath}:${entry.line}:${entry.sha}`);
            }
          }
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

    // Ground evidence — kind-aware grounding (Phase 3)
    const totalEvidenceBefore = normalized.evidence.length;
    let droppedUngrounded = 0;
    let droppedMalformed = 0;
    normalized.evidence = normalized.evidence
      .map(item => ({ ...item, path: item.path.replace(/^\.\//, '') }))
      .filter(item => {
        if (!item.path || !item.why) {
          droppedMalformed++;
          return false;
        }
        return true;
      })
      .map(item => {
        const kind = item.evidenceType ?? 'file_range';

        // git_commit: validate against observed commit SHAs
        if (kind === 'git_commit') {
          const sha = item.sha ?? item.commit ?? '';
          if (!sha || !observedGit.commits.has(sha)) {
            droppedUngrounded++;
            return null;
          }
          return { ...item, groundingStatus: 'exact' };
        }
        // git_blame: validate against observed blame entries
        if (kind === 'git_blame') {
          const blameKey = `${item.path}:${item.startLine}:${item.sha ?? ''}`;
          const endKey = `${item.path}:${item.endLine}:${item.sha ?? ''}`;
          if (!observedGit.blame.has(blameKey) && !observedGit.blame.has(endKey)) {
            droppedUngrounded++;
            return null;
          }
          return { ...item, groundingStatus: 'exact' };
        }
        // git_diff_hunk: grounded via diff/show hunk observation
        if (kind === 'git_diff_hunk') {
          const { overlaps, partial } = checkEvidenceGrounding(observedRanges, item);
          if (!overlaps) {
            // Still keep if sha present — git tool produced it
            if (item.sha) return { ...item, groundingStatus: 'partial' };
            droppedUngrounded++;
            return null;
          }
          return { ...item, groundingStatus: partial ? 'partial' : 'exact' };
        }
        // file_range (default): must match observed read ranges
        const { overlaps, partial } = checkEvidenceGrounding(observedRanges, item);
        if (!overlaps) {
          droppedUngrounded++;
          return null;
        }
        return { ...item, groundingStatus: partial ? 'partial' : 'exact' };
      })
      .filter(Boolean);

    // Derive task kind from strategy hint for task-aware confidence scoring
    const strategyHint = args.hints?.strategy ?? null;
    const taskKind = (strategyHint === 'symbol-first') ? 'locate' : (strategyHint ?? 'default');

    // Confidence scoring (task-aware)
    const { score: confidenceScore, level: confidenceLevel, factors: confidenceFactors } =
      computeConfidenceScore(normalized.evidence, totalEvidenceBefore, stats, taskKind);
    confidenceFactors.droppedUngrounded = droppedUngrounded;
    confidenceFactors.droppedMalformed = droppedMalformed;
    normalized.confidenceScore = confidenceScore;
    normalized.confidenceLevel = confidenceLevel;
    normalized.confidenceFactors = confidenceFactors;

    if (totalEvidenceBefore > normalized.evidence.length) {
      normalized.followups = mergeCandidatePaths(normalized.followups, [{
        description: 'Some evidence items were dropped because they were not grounded in inspected line ranges.',
        priority: 'optional',
        suggestedCall: null,
      }]);
    }

    // Reconcile model-reported confidence with computed level
    const exactEvidence = normalized.evidence.filter(e => e.groundingStatus === 'exact').length;
    normalized.confidence = reconcileConfidence({
      modelConfidence: normalized.confidence,
      computedLevel: confidenceLevel,
      taskKind,
      exactEvidence,
      droppedEvidence: droppedUngrounded + droppedMalformed,
      stoppedByBudget: stats.stoppedByBudget ?? false,
    });
    normalized.confidenceLevel = normalized.confidence;

    if (!normalized.summary) normalized.summary = normalized.answer;
    if (!normalized.answer) {
      normalized.answer = lastAssistantContent || 'Explorer did not return a final answer.';
      normalized.confidence = 'low';
    }

    // codeMap + Mermaid diagram
    const codeMap = buildCodeMap(observedRanges, projectConfig.entryPoints ?? []);
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

  /**
   * Phase 5: Free-form exploration — produces a human-readable Markdown report.
   *
   * @param {object} args - { prompt, thoroughness?, scope?, repo_root?, session?, language?, context? }
   * @param {object} [callOpts]
   * @param {Function} [callOpts.onProgress]
   * @param {object}   [callOpts.sessionStore]
   */
  async freeExplore(args, { onProgress = null, sessionStore = null } = {}) {
    if (!args || typeof args.prompt !== 'string' || !args.prompt.trim()) {
      const err = new Error('prompt is required and must be a non-empty string.');
      err.code = -32602;
      throw err;
    }

    const thoroughnessMap = { quick: 'quick', normal: 'normal', deep: 'deep' };
    const budgetLabel = thoroughnessMap[args.thoroughness] ?? 'normal';

    const {
      budgetConfig, repoRoot, effectiveScope, projectContext, keyFiles,
      chatClient, sessionId, sessionData, sessionStatus, remainingCalls,
      tools, reasoningEffort, temperature, topP, repoToolkit,
    } = await this._initExploreContext({
      budgetLabel,
      repoRootArg: args.repo_root,
      scope: args.scope,
      session: args.session,
      taskText: args.prompt,
      sessionStore,
    });

    const startedAt = nowMs();

    const messages = [
      {
        role: 'system',
        content: buildFreeExploreSystemPrompt({
          repoRoot,
          budgetConfig,
          language: args.language,
          projectContext,
          keyFiles,
          previousSummaries: sessionData?.summaries ?? [],
        }),
      },
      {
        role: 'user',
        content: buildFreeExploreUserPrompt({
          prompt: args.prompt,
          scope: effectiveScope,
          budget: budgetConfig.label,
          context: args.context,
        }),
      },
    ];

    const stats = {
      model: chatClient.model,
      budget: budgetConfig.label,
      turns: 0,
      toolCalls: 0,
      filesRead: 0,
      elapsedMs: 0,
      stoppedByBudget: false,
      repoRoot,
      sessionId,
      sessionStatus,
      remainingCalls,
    };

    const filesRead = new Set();
    const toolsUsed = new Set();
    let report = '';

    for (let turnIndex = 0; turnIndex < budgetConfig.maxTurns; turnIndex += 1) {
      stats.turns += 1;

      if (onProgress) {
        onProgress({ progress: turnIndex, total: budgetConfig.maxTurns, message: `Turn ${turnIndex + 1}/${budgetConfig.maxTurns}` });
      }

      const completion = await chatClient.createChatCompletion({
        messages,
        tools,
        reasoningEffort,
        temperature,
        topP,
        maxCompletionTokens: budgetConfig.maxCompletionTokens,
        parallelToolCalls: false,
      });

      Object.assign(stats, summarizeUsage(stats, completion.usage));

      if (!completion.message.toolCalls || completion.message.toolCalls.length === 0) {
        if (completion.message.content) {
          report = completion.message.content;
        }
        break;
      }

      const assistantMessage = {
        role: 'assistant',
        content: completion.message.content || null,
        tool_calls: completion.message.toolCalls.map(call => ({
          id: call.id,
          type: 'function',
          function: { name: call.function.name, arguments: call.function.arguments },
        })),
      };
      // Do NOT set report here — only set it when there are no tool calls (final answer)
      messages.push(assistantMessage);

      for (const toolCall of completion.message.toolCalls) {
        const toolName = toolCall.function.name;
        stats.toolCalls += 1;
        toolsUsed.add(toolName);

        let toolArgs = {};
        let toolResult;
        try {
          toolArgs = safeJsonParse(toolCall.function.arguments ?? '{}');
          toolResult = await repoToolkit.callTool(toolName, toolArgs);
        } catch (error) {
          toolResult = {
            error: true,
            type: error.message.startsWith('Failed to parse tool arguments')
              ? 'invalid_tool_arguments'
              : 'tool_execution_error',
            message: error.message,
            tool: toolName,
          };
        }

        if (toolName === 'repo_read_file' && !toolResult?.error) {
          filesRead.add(toolResult.path);
          stats.filesRead += 1;
        }

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(toolResult),
        });
      }
    }

    // If budget exhausted without a final report, ask for one
    // Also treat bare "None" as an empty report (zai-glm-4.7 quirk)
    const reportIsEmpty = !report || report.trim() === '' || report.trim().toLowerCase() === 'none';
    if (reportIsEmpty || (stats.turns >= budgetConfig.maxTurns && report === '')) {
      stats.stoppedByBudget = true;
      const finalized = await chatClient.createChatCompletion({
        messages: [
          ...messages,
          { role: 'user', content: buildFreeExploreFinalizePrompt() },
        ],
        reasoningEffort,
        temperature,
        topP,
        maxCompletionTokens: budgetConfig.finalizeMaxCompletionTokens ?? 2000,
        parallelToolCalls: false,
      });
      Object.assign(stats, summarizeUsage(stats, finalized.usage));
      report = finalized.message.content || 'Explorer could not produce a report.';
    }

    stats.elapsedMs = nowMs() - startedAt;
    Object.assign(stats, globalRepoCache.stats());

    // Update session with report summary (mode-neutral)
    if (sessionStore && sessionId) {
      const summaryLine = report.split('\n').find(l => l.trim())?.slice(0, 400) ?? '';
      sessionStore.update(sessionId, {
        candidatePaths: [...filesRead],
        evidence: [],
        summary: summaryLine,
        followups: [],
      });
    }

    return {
      report,
      filesRead: [...filesRead],
      toolsUsed: [...toolsUsed],
      stats,
    };
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

    // repair pass: ask the model to convert its broken output into the exact schema
    try {
      const repair = await chatClient.createChatCompletion({
        messages: [
          { role: 'system', content: 'Repair the following into the exact explore_repo_result JSON schema. Do not add new facts.' },
          { role: 'user', content: completion.message.content || '' },
        ],
        responseFormat: { type: 'json_schema', json_schema: EXPLORE_RESULT_JSON_SCHEMA },
        reasoningEffort: 'none',
        temperature: 0,
        topP: 1,
        maxCompletionTokens: Math.min(1000, maxCompletionTokens),
        parallelToolCalls: false,
      });
      const repaired = extractFirstJsonObject(repair.message.content);
      if (repaired) {
        return { result: repaired, usage: repair.usage ?? completion.usage ?? null };
      }
    } catch { /* repair failed, fall through to local fallback */ }

    // local fallback: unstructured content that could not be parsed as JSON
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

export async function freeExploreRepository(args, options = {}) {
  const { onProgress, sessionStore, ...runtimeOptions } = options;
  const runtime = new ExplorerRuntime(runtimeOptions);
  return runtime.freeExplore(args, { onProgress, sessionStore });
}
