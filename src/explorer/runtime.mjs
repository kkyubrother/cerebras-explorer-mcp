import fs from 'node:fs/promises';
import path from 'node:path';

import { CerebrasChatClient, extractFirstJsonObject } from './cerebras-client.mjs';
import {
  chooseAutoBudget,
  getBudgetConfig,
  getExplorerTemperature,
  getExplorerTopP,
  getExploreV2MaxCompactions,
  getExploreV2MaxExtraTurns,
  getExploreV2TurnMultiplier,
  getReasoningEffortForBudget,
  getModelForBudget,
  classifyTaskComplexity,
  isSecretPath,
  isTruthyEnv,
  loadProjectConfig,
  normalizeProjectConfig,
  resolveRepoRoot,
} from './config.mjs';
import {
  collectCandidatePathsFromToolResult,
  mergeCandidatePaths,
  RepoToolkit,
} from './repo-tools.mjs';
import { redactText, redactValue } from './redact.mjs';
import { globalRepoCache } from './cache.mjs';
import {
  buildExplorerSystemPrompt,
  buildExplorerUserPrompt,
  buildFinalizePrompt,
  buildFreeExploreSystemPrompt,
  buildFreeExploreUserPrompt,
  buildFreeExploreFinalizePrompt,
  buildFreeExploreV2SystemPrompt,
  buildCompactionSummaryPrompt,
  buildOutputContinuationPrompt,
  buildFreeExploreV2FinalizePrompt,
} from './prompt.mjs';
import {
  EXPLORE_RESULT_JSON_SCHEMA,
  normalizeExploreResult,
  validateExploreRepoArgs,
} from './schemas.mjs';
import {
  buildReportCritic,
  deriveTaskKindFromHints,
  runDeterministicCriticPass,
} from './critic.mjs';
import { createChatClient } from './providers/index.mjs';
import { createCompactToolTrace, createTranscriptRecorder } from './transcript.mjs';

// Maximum number of tool calls to execute in parallel within a single turn.
const TOOL_CONCURRENCY = 8;

/**
 * Estimate token count for a message array.
 * Uses a conservative 1 token ≈ 4 chars heuristic.
 */
function estimateTokens(messages) {
  let total = 0;
  for (const msg of messages) {
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? '');
    total += Math.ceil(content.length / 4);
    if (msg.tool_calls) total += Math.ceil(JSON.stringify(msg.tool_calls).length / 4);
    if (msg.reasoning) total += Math.ceil(msg.reasoning.length / 4);
  }
  return total;
}

/**
 * Compact old tool results when conversation approaches context window limit.
 * Preserves the most recent N messages (3 turns = ~6 messages) intact.
 * Older tool results are truncated to a short prefix + length note.
 *
 * @param {object[]} messages - The conversation messages array
 * @param {number} threshold - Token threshold to trigger compaction
 * @returns {object[]} Potentially compacted messages array
 */
function compactOldToolResults(messages, threshold) {
  if (!threshold || threshold <= 0) return messages;
  const estimated = estimateTokens(messages);
  if (estimated < threshold) return messages;

  // Preserve the last 8 messages (roughly 3-4 recent turns) untouched
  const preserveCount = 8;
  const compacted = [...messages];
  const compactUpTo = Math.max(0, compacted.length - preserveCount);

  for (let i = 0; i < compactUpTo; i++) {
    if (compacted[i].role === 'tool') {
      const content = compacted[i].content;
      if (typeof content === 'string' && content.length > 400) {
        compacted[i] = {
          ...compacted[i],
          content: content.slice(0, 300) + `\n... [truncated from ${content.length} chars to save context]`,
        };
      }
    }
  }
  return compacted;
}

/**
 * Preserve complete recent turns by slicing from the earliest of the last N
 * user messages. A turn is a user message and everything that follows it until
 * the next user message.
 */
function sliceRecentTurns(messages, keepLastUserTurns = 3) {
  if (!Array.isArray(messages) || messages.length <= 1) {
    return [];
  }

  if (!Number.isFinite(keepLastUserTurns) || keepLastUserTurns <= 0) {
    return messages.slice(1);
  }

  let userTurnsSeen = 0;
  let startIndex = 1;

  for (let i = messages.length - 1; i >= 1; i -= 1) {
    if (messages[i]?.role === 'user') {
      userTurnsSeen += 1;
      startIndex = i;
      if (userTurnsSeen >= keepLastUserTurns) {
        break;
      }
    }
  }

  return messages.slice(startIndex);
}

// ── freeExploreV2 utilities ───────────────────────────────────────────────────

/**
 * Per-tool result character budgets for V2.
 * Larger results are truncated with a preview to save context window.
 */
const TOOL_RESULT_CHAR_BUDGETS = {
  repo_read_file: 8000,
  repo_grep: 6000,
  repo_list_dir: 4000,
  repo_find_files: 4000,
  repo_git_log: 5000,
  repo_git_diff: 6000,
  repo_git_blame: 5000,
  repo_git_show: 6000,
  repo_symbols: 4000,
  repo_references: 5000,
  repo_symbol_context: 8000,
  _default: 6000,
};

/**
 * Apply per-tool character budget to a tool result.
 * If the serialized result exceeds the budget, returns a truncated preview.
 */
function applyToolResultCharBudget(toolName, toolResult) {
  const serialized = JSON.stringify(redactValue(toolResult).value);
  const budget = TOOL_RESULT_CHAR_BUDGETS[toolName] ?? TOOL_RESULT_CHAR_BUDGETS._default;
  if (serialized.length <= budget) return serialized;

  const preview = serialized.slice(0, budget - 120);
  return preview + `\n... [truncated: ${serialized.length} → ${budget} chars. Full data was inspected; key content preserved above.]`;
}

function redactToolResult(toolResult) {
  return redactValue(toolResult).value;
}

/**
 * LLM-based conversation compaction for V2.
 * Instead of simple truncation, asks the LLM to summarize findings so far,
 * then replaces old messages with the summary to free context window.
 *
 * @param {object} chatClient - The chat client instance
 * @param {object[]} messages - Current conversation messages
 * @param {number} threshold - Token threshold to trigger compaction
 * @param {object} opts - reasoningEffort, temperature, topP
 * @returns {Promise<{messages: object[], didCompact: boolean, usage: object|null}>}
 */
async function compactWithLlmSummary(chatClient, messages, threshold, opts) {
  const estimated = estimateTokens(messages);
  if (estimated < threshold) {
    return { messages, didCompact: false, usage: null };
  }

  // Ask the LLM to summarize exploration findings so far
  const summaryCompletion = await chatClient.createChatCompletion({
    messages: [
      ...messages,
      { role: 'user', content: buildCompactionSummaryPrompt() },
    ],
    reasoningEffort: opts.reasoningEffort ?? undefined,
    temperature: 0.3,
    topP: 1,
    maxCompletionTokens: 1000,
    parallelToolCalls: false,
    signal: opts.abortSignal,
  });

  const summaryText = summaryCompletion.message.content || 'No summary available.';
  const summaryUsage = summaryCompletion.usage ?? null;

  // Reconstruct: system prompt + summary as context + complete recent turns
  const systemMsg = messages[0];
  const recentMessages = sliceRecentTurns(messages, 3);

  const compactedMessages = [
    systemMsg,
    {
      role: 'user',
      content: `[Context recovered from previous exploration turns — original tool results have been summarized to save context window]\n\n${summaryText}\n\nContinue exploring based on these findings. Do not re-read files already covered unless you need different line ranges.`,
    },
    {
      role: 'assistant',
      content: 'Understood. I will build on the previous findings and continue exploring.',
    },
    ...recentMessages,
  ];

  return { messages: compactedMessages, didCompact: true, usage: summaryUsage };
}

/**
 * Max output token recovery for V2.
 * When the model's output is cut short (finish_reason === 'length'),
 * asks it to continue from where it left off, up to MAX_RECOVERY_ATTEMPTS.
 */
const MAX_OUTPUT_RECOVERY_ATTEMPTS = 3;

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

/**
 * Build a natural-language trust summary for the parent model.
 * This replaces opaque confidence numbers with a human-readable verification statement.
 */
function buildTrustSummary(result, stats) {
  const evidenceCount = result.evidence?.length ?? 0;
  const exactCount = result.evidence?.filter(e => e.groundingStatus === 'exact').length ?? 0;
  const distinctFiles = new Set((result.evidence ?? []).map(e => e.path)).size;
  const parts = [];

  parts.push(`Verified: ${stats.filesRead ?? 0} files read`);
  if ((stats.grepCalls ?? 0) > 0) parts.push(`${stats.grepCalls} grep searches`);
  if ((stats.symbolCalls ?? 0) > 0) parts.push(`${stats.symbolCalls} symbol lookups`);
  if (evidenceCount > 0) {
    parts.push(`${exactCount}/${evidenceCount} evidence items grounded`);
  }
  if (distinctFiles >= 2) {
    parts.push(`cross-verified across ${distinctFiles} files`);
  }

  let suffix = '';
  if (result.confidence === 'high') {
    suffix = 'All evidence grounded in inspected code.';
  } else if (result.confidence === 'medium') {
    suffix = 'Evidence partially verified — results are reliable for most uses.';
  } else {
    suffix = 'Limited evidence found — consider follow-up exploration.';
  }

  return parts.join(', ') + '. ' + suffix;
}

function isOutsideRoot(root, targetPath) {
  const relative = path.relative(root, targetPath);
  return relative.startsWith('..') || path.isAbsolute(relative);
}

async function readEvidenceSnippet(repoRoot, evidenceItem, { maxLines = 12, maxChars = 1200 } = {}) {
  if (!repoRoot || !evidenceItem?.path) return '';
  if (!Number.isInteger(evidenceItem.startLine) || !Number.isInteger(evidenceItem.endLine)) return '';
  if ((evidenceItem.evidenceType ?? 'file_range') !== 'file_range') return '';
  if (isSecretPath(evidenceItem.path).matched) return '';

  const absolutePath = path.resolve(repoRoot, evidenceItem.path);
  if (isOutsideRoot(repoRoot, absolutePath)) return '';

  try {
    const stat = await fs.lstat(absolutePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 512 * 1024) return '';

    const realRoot = await fs.realpath(repoRoot);
    const realPath = await fs.realpath(absolutePath);
    if (isOutsideRoot(realRoot, realPath)) return '';

    const lines = (await fs.readFile(realPath, 'utf8')).split('\n');
    const startLine = Math.max(1, evidenceItem.startLine);
    const requestedEnd = Math.max(startLine, evidenceItem.endLine);
    const endLine = Math.min(requestedEnd, startLine + maxLines - 1, lines.length);
    const snippet = [];
    for (let lineNo = startLine; lineNo <= endLine; lineNo += 1) {
      snippet.push(`${lineNo}: ${lines[lineNo - 1] ?? ''}`);
    }
    if (requestedEnd > endLine) snippet.push('... [snippet truncated]');
    return snippet.join('\n').slice(0, maxChars);
  } catch {
    return '';
  }
}

async function attachEvidenceMetadata({ evidence, repoRoot }) {
  const result = [];
  for (const [index, item] of (evidence ?? []).entries()) {
    const id = typeof item.id === 'string' && item.id ? item.id : `E${index + 1}`;
    const snippet = item.snippet || await readEvidenceSnippet(repoRoot, item);
    result.push({
      ...item,
      id,
      ...(snippet ? { snippet } : {}),
    });
  }
  return result;
}

function hasEditIntent(task) {
  const text = String(task ?? '').toLowerCase();
  if (/\b(review change context|what changed|summarize changes|recent changes)\b/.test(text) ||
      /변경\s*(사항|내역|요약)|최근\s*변경|무엇이\s*변경/.test(text)) {
    return false;
  }
  return /\b(fix|modify|implement|refactor|migrate|patch|edit|editing)\b/.test(text) ||
    /\b(add|remove|update|change)\b.*\b(code|field|schema|behavior|implementation|tool|api|contract|output|input|config|metadata|dependency|dependencies|file|files|test|tests|doc|docs|readme)\b/.test(text) ||
    /수정|구현|추가|삭제|리팩터|마이그레이션|변경(해|하|되|해야|필요)/.test(text);
}

function buildTargets({ evidence = [], candidatePaths = [] } = {}) {
  const targets = [];
  const byKey = new Map();

  function addTarget(target) {
    if (!target?.path) return;
    const key = `${target.path}:${target.startLine ?? ''}:${target.endLine ?? ''}:${target.role}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.evidenceRefs = [...new Set([...(existing.evidenceRefs ?? []), ...(target.evidenceRefs ?? [])])];
      return;
    }
    byKey.set(key, target);
    targets.push(target);
  }

  for (const item of evidence) {
    if (!item.path) continue;
    const hasRange = Number.isInteger(item.startLine) && Number.isInteger(item.endLine);
    addTarget({
      path: item.path,
      ...(hasRange ? { startLine: item.startLine, endLine: item.endLine } : {}),
      role: 'read',
      reason: item.why || 'Grounded evidence target.',
      evidenceRefs: item.id ? [item.id] : [],
    });
  }

  const evidencePaths = new Set(evidence.map(item => item.path).filter(Boolean));
  for (const candidatePath of candidatePaths) {
    if (!candidatePath || evidencePaths.has(candidatePath)) continue;
    addTarget({
      path: candidatePath,
      role: 'reference',
      reason: 'Discovered candidate path; read only if the cited evidence does not answer the edit or verification need.',
      evidenceRefs: [],
    });
  }

  return targets.slice(0, 20);
}

function targetKey(target) {
  return `${target.path}:${target.startLine ?? ''}:${target.endLine ?? ''}`;
}

function targetRolePriority(role) {
  return {
    edit: 60,
    test: 50,
    config: 45,
    context: 40,
    read: 30,
    reference: 10,
  }[role] ?? 0;
}

function mergeTargets(...targetGroups) {
  const targets = [];
  const byKey = new Map();

  function addTarget(target) {
    if (!target?.path) return;
    const key = targetKey(target);
    const existing = byKey.get(key);
    if (!existing) {
      const next = {
        ...target,
        role: target.role ?? 'read',
        reason: target.reason ?? '',
        evidenceRefs: Array.isArray(target.evidenceRefs) ? [...target.evidenceRefs] : [],
      };
      byKey.set(key, next);
      targets.push(next);
      return;
    }

    existing.evidenceRefs = [...new Set([
      ...(existing.evidenceRefs ?? []),
      ...(target.evidenceRefs ?? []),
    ])];
    if (!existing.reason && target.reason) existing.reason = target.reason;
    if (targetRolePriority(target.role) > targetRolePriority(existing.role)) {
      existing.role = target.role;
    }
  }

  for (const group of targetGroups) {
    for (const target of group ?? []) addTarget(target);
  }
  return targets.slice(0, 20);
}

function buildUncertainties(result, stats) {
  const warnings = (result.critic?.warnings ?? []).map(warning => warning.message).filter(Boolean);
  const followups = (result.followups ?? [])
    .filter(item => item.priority === 'recommended')
    .map(item => item.description)
    .filter(Boolean);
  const uncertainties = [...warnings, ...followups];
  if ((result.evidence?.length ?? 0) === 0) {
    uncertainties.push('No grounded evidence was retained.');
  }
  if (stats.stoppedByBudget) {
    uncertainties.push('Exploration stopped at the turn budget before all possible follow-up checks were exhausted.');
  }
  if (stats.stoppedByErrors) {
    uncertainties.push('Exploration stopped after repeated tool errors.');
  }
  if (stats.stoppedByAbort) {
    uncertainties.push('Exploration was cancelled before completion.');
  }
  return [...new Set(uncertainties)];
}

function buildResultStatus(result, stats, { task } = {}) {
  const criticStatus = result.critic?.status ?? 'caution';
  const warnings = (result.critic?.warnings ?? []).map(warning => warning.message).filter(Boolean);
  const hasEvidence = (result.evidence?.length ?? 0) > 0;
  const hasEditTarget = (result.targets ?? []).some(target => target.role === 'edit');
  const editPlanning = hasEditIntent(task);
  let verification = 'verified';

  if (!hasEvidence || criticStatus === 'fail' || stats.stoppedByErrors || stats.stoppedByAbort) {
    verification = 'broad_search_needed';
  } else if (criticStatus === 'caution' || result.confidence === 'low' || stats.stoppedByBudget) {
    verification = 'follow_up_needed';
  } else if (hasEditTarget || editPlanning) {
    verification = 'targeted_read_needed';
  }

  return {
    confidence: result.confidence ?? 'low',
    verification,
    complete: verification === 'verified' || verification === 'targeted_read_needed',
    warnings,
  };
}

function buildNextAction(result) {
  const verification = result.status?.verification;
  if (verification === 'targeted_read_needed') {
    const target = (result.targets ?? []).find(item => item.role === 'edit') ??
      (result.targets ?? []).find(item => item.role === 'read') ??
      result.targets?.[0];
    const targetReason = target?.role === 'edit' ? 'before editing' : 'before final verification';
    return {
      type: 'read_target',
      reason: target ? `Read ${target.path}${target.startLine ? `:${target.startLine}-${target.endLine}` : ''} ${targetReason}.` : 'Read the cited target before editing.',
      ...(target ? { target } : {}),
    };
  }
  if (verification === 'follow_up_needed' || verification === 'broad_search_needed') {
    const followup = (result.followups ?? []).find(item => item.priority === 'recommended') ?? result.followups?.[0];
    return {
      type: followup ? 'explore_followup' : 'ask_user',
      reason: followup?.description ?? 'The retained evidence is not sufficient for a complete answer.',
      ...(followup?.query
        ? { query: followup.query }
        : followup?.description
          ? { query: followup.description }
          : {}),
    };
  }
  return { type: 'stop', reason: 'Explorer result is complete for the requested read-only investigation.' };
}

function attachDebug(result, { stats, codeMap, diagram, recentActivity, toolTrace }) {
  result._debug = {
    ...(result._debug ?? {}),
    confidenceScore: result.confidenceScore,
    confidenceFactors: result.confidenceFactors,
    stats,
    ...(toolTrace ? { toolTrace } : {}),
    ...(codeMap ? { codeMap } : {}),
    ...(diagram ? { diagram } : {}),
    ...(recentActivity ? { recentActivity } : {}),
  };
  return result;
}

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

function isAbortError(error) {
  return error?.name === 'AbortError';
}

function buildCancelledExploreObject(lastAssistantContent = '') {
  const message = typeof lastAssistantContent === 'string' && lastAssistantContent.trim()
    ? lastAssistantContent.trim()
    : 'Exploration was cancelled before a final answer was produced.';
  return {
    answer: message,
    summary: message,
    confidence: 'low',
    evidence: [],
    candidatePaths: [],
    followups: [],
  };
}

function buildCancelledReport(report = '') {
  if (typeof report === 'string' && report.trim()) {
    return report;
  }
  return 'Exploration was cancelled before a final report was produced.';
}

/**
 * Attempt to extract a JSON object from prose-wrapped content.
 * Handles common patterns like ```json\n{...}\n``` or plain text with a JSON block.
 * Returns the parsed object or null if no valid JSON object is found.
 */
function tryLooseRepair(content) {
  if (!content || typeof content !== 'string') return null;

  // Try code fence patterns: ```json ... ``` or ``` ... ```
  const fenceMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1]); } catch { /* continue */ }
  }

  // Try finding the first { ... } block that spans multiple lines
  const braceStart = content.indexOf('{');
  const braceEnd = content.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    try { return JSON.parse(content.slice(braceStart, braceEnd + 1)); } catch { /* continue */ }
  }

  return null;
}

/**
 * Validate a tool call name. If the model hallucinated a non-existent tool,
 * return an error result with clear feedback so the model switches strategy.
 */
function validateToolName(toolName, knownToolNames) {
  if (knownToolNames.has(toolName)) return null; // valid
  return {
    error: true,
    stage: 'validation',
    type: 'unknown_tool',
    message: `Tool "${toolName}" does not exist. Available tools: ${[...knownToolNames].join(', ')}. Choose one of these.`,
    tool: toolName,
  };
}

/** Max consecutive all-error turns before forcing early exit. */
const MAX_CONSECUTIVE_ERROR_TURNS = 3;
const ERROR_RECOVERY_GUIDANCE_TURNS = Math.max(1, MAX_CONSECUTIVE_ERROR_TURNS - 1);

const TOOL_STAT_FIELD_MAP = Object.freeze({
  repo_read_file: 'filesRead',
  repo_grep: 'grepCalls',
  repo_find_files: 'findFileCalls',
  repo_list_dir: 'listDirCalls',
  repo_git_log: 'gitLogCalls',
  repo_git_blame: 'gitBlameCalls',
  repo_git_diff: 'gitDiffCalls',
  repo_git_show: 'gitShowCalls',
  repo_symbols: 'symbolCalls',
  repo_references: 'symbolCalls',
  repo_symbol_context: 'symbolCalls',
});

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
  const statField = TOOL_STAT_FIELD_MAP[toolName];
  if (statField) {
    stats[statField] += 1;
  }
}

function buildAssistantMessage(completionMessage) {
  const content = redactText(completionMessage.content || '').text;
  const assistantMessage = {
    role: 'assistant',
    content: content || null,
  };

  if (completionMessage.reasoning) {
    assistantMessage.reasoning = redactText(completionMessage.reasoning).text;
  }

  if (completionMessage.toolCalls?.length > 0) {
    assistantMessage.tool_calls = completionMessage.toolCalls.map(call => ({
      id: call.id,
      type: 'function',
      function: {
        name: call.function.name,
        arguments: redactText(call.function.arguments ?? '').text,
      },
    }));
  }

  return assistantMessage;
}

function fingerprintToolCalls(toolCalls) {
  return JSON.stringify(
    toolCalls
      .map(call => [call.function?.name ?? '', call.function?.arguments ?? ''])
      .sort(),
  );
}

/**
 * Resolve session for an explore() call.
 * Returns { ok, sessionId, sessionData, sessionStatus, remainingCalls } on success,
 * or { ok: false, reason } when an explicitly requested session is invalid.
 *
 * When no session is requested (or sessionStore is null), a new session is created.
 * Recoverable failures (exhausted_session, expired_session) silently fall back to
 * a new session — sessionStatus will be 'fallback' to signal this in stats.
 * Non-recoverable failures (invalid_session, repo_mismatch) still reject with an error.
 */
function resolveSessionForExplore(sessionStore, requestedSessionId, repoRoot) {
  if (!sessionStore) {
    return { ok: true, sessionId: null, sessionData: null, sessionStatus: null, remainingCalls: null };
  }

  const trimmedId = requestedSessionId && typeof requestedSessionId === 'string'
    ? requestedSessionId.trim()
    : '';

  if (trimmedId) {
    // Explicit session requested — validate it
    const validation = sessionStore.validateForReuse(trimmedId, repoRoot);
    if (!validation.ok) {
      // Recoverable: session ran out of calls or expired — silently start a fresh one
      if (validation.reason === 'exhausted_session' || validation.reason === 'expired_session') {
        const newId = sessionStore.create(repoRoot);
        const newData = sessionStore.get(newId);
        return {
          ok: true,
          sessionId: newId,
          sessionData: newData,
          sessionStatus: 'fallback',
          remainingCalls: sessionStore.getRemainingCalls(newId),
        };
      }
      // Non-recoverable (invalid_session, repo_mismatch): propagate error
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
    remainingCalls: sessionStore.getRemainingCalls(newId),
  };
}

function syncRemainingCallsStat(stats, sessionStore, sessionId) {
  if (!stats || !sessionStore || !sessionId || typeof sessionStore.getRemainingCalls !== 'function') {
    return;
  }

  const remainingCalls = sessionStore.getRemainingCalls(sessionId);
  if (Number.isFinite(remainingCalls)) {
    stats.remainingCalls = remainingCalls;
  }
}

function recordObservedRange(observedRanges, targetPath, startLine, endLine, source = 'read') {
  if (!targetPath) {
    return;
  }
  const current = observedRanges.get(targetPath) ?? [];
  current.push({ startLine, endLine, source });
  observedRanges.set(targetPath, current);
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
  const pathToId = new Map();
  for (const node of nodes) {
    pathToId.set(node.path, node.id);
    if (node.isEntry) {
      lines.push(`  ${node.id}[["${node.label}"]];`);
    } else {
      lines.push(`  ${node.id}["${node.label}"];`);
    }
  }

  // Only render dependency edges when they are backed by observed relationship data.
  const observedEdges = Array.isArray(codeMap.edges) ? codeMap.edges : [];
  for (const edge of observedEdges) {
    const fromId = pathToId.get(edge?.from);
    const toId = pathToId.get(edge?.to);
    if (!fromId || !toId || fromId === toId) {
      continue;
    }
    lines.push(`  ${fromId} --> ${toId};`);
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
  async _initExploreContext({ budgetLabel, repoRootArg, scope, hints, session, taskText, sessionStore }) {
    const repoRoot = await resolveRepoRoot(repoRootArg);

    const rawProjectConfig = await loadProjectConfig(repoRoot);
    const projectConfig = normalizeProjectConfig(rawProjectConfig);

    const budgetSource = budgetLabel
      ? 'argument'
      : projectConfig.defaultBudget
        ? 'project_config'
        : 'auto';
    const effectiveBudgetLabel = budgetLabel ?? projectConfig.defaultBudget ?? chooseAutoBudget({ task: taskText, scope, hints });
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
      budgetSource,
      chatClient, sessionId, sessionData, sessionStatus, remainingCalls,
      repoToolkit, tools, reasoningEffort, temperature, topP,
    };
  }

  /**
   * @param {object} args - explore_repo arguments (validated by validateExploreRepoArgs)
   * @param {object} [callOpts]
   * @param {Function}      [callOpts.onProgress]    - Called with {progress, total, message}
   * @param {object}        [callOpts.sessionStore]  - SessionStore instance for session management
   * @param {AbortSignal}   [callOpts.abortSignal]   - Signal to abort exploration gracefully
   */
  async explore(args, { onProgress = null, sessionStore = null, abortSignal = null } = {}) {
    validateExploreRepoArgs(args);

    const {
      budgetConfig, repoRoot, projectConfig, effectiveScope, projectContext, keyFiles,
      budgetSource,
      chatClient, sessionId, sessionData, sessionStatus, remainingCalls,
      repoToolkit, tools, reasoningEffort, temperature, topP,
    } = await this._initExploreContext({
      budgetLabel: args.budget,
      repoRootArg: args.repo_root,
      scope: args.scope,
      hints: args.hints,
      session: args.session,
      taskText: args.task,
      sessionStore,
    });

    const startedAt = nowMs();
    const knownToolNames = new Set(tools.map(tool => tool.function?.name).filter(Boolean));

    let messages = [
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
      budgetSource,
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
    const toolTrace = createCompactToolTrace();

    // Checkpoint interval: inject a self-assessment message every N turns.
    // Only active for budgets with enough turns to benefit (>6).
    const CHECKPOINT_INTERVAL = 4;
    const checkpointEnabled = budgetConfig.maxTurns > 6;

    // Stagnation tracking: detect repeated identical tool plans
    let lastFingerprint = null;
    let repeatedTurns = 0;
    let consecutiveAllErrorTurns = 0;

    for (let turnIndex = 0; turnIndex < budgetConfig.maxTurns; turnIndex += 1) {
      // Abort check: gracefully stop if signal was triggered
      if (abortSignal?.aborted) {
        stats.stoppedByAbort = true;
        break;
      }

      // Context window management: compact old tool results when approaching limit
      messages = compactOldToolResults(messages, budgetConfig.maxContextTokens);

      // Checkpoint: every CHECKPOINT_INTERVAL turns, ask the model to self-assess.
      if (checkpointEnabled && turnIndex > 0 && turnIndex % CHECKPOINT_INTERVAL === 0) {
        messages.push({
          role: 'user',
          content: 'Checkpoint: If evidence is sufficient, finalize now. Otherwise choose the smallest next step (1–2 tool calls max) that closes a specific missing fact.',
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

      let completion;
      try {
        completion = await chatClient.createChatCompletion({
          messages,
          tools,
          reasoningEffort,
          temperature,
          topP,
          maxCompletionTokens: budgetConfig.maxCompletionTokens,
          parallelToolCalls: true,
          signal: abortSignal,
        });
      } catch (error) {
        if (abortSignal?.aborted && isAbortError(error)) {
          stats.stoppedByAbort = true;
          break;
        }
        throw error;
      }

      stats.turns += 1;
      Object.assign(stats, summarizeUsage(stats, completion.usage));

      const assistantMessage = buildAssistantMessage(completion.message);
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
        let finalized;
        try {
          finalized = await this.finalizeAfterToolLoop({
            chatClient,
            messages,
            reasoningEffort,
            temperature,
            topP,
            budgetConfig,
            abortSignal,
          });
        } catch (error) {
          if (abortSignal?.aborted && isAbortError(error)) {
            stats.stoppedByAbort = true;
            break;
          }
          throw error;
        }
        finalObject = finalized.result;
        Object.assign(stats, summarizeUsage(stats, finalized.usage));
        break;
      }

      // Stagnation detection: fingerprint the tool plan for this turn
      {
        const fingerprint = fingerprintToolCalls(completion.message.toolCalls);
        if (fingerprint === lastFingerprint) {
          repeatedTurns += 1;
        } else {
          repeatedTurns = 0;
          lastFingerprint = fingerprint;
        }
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

      // Execute up to TOOL_CONCURRENCY tool calls in parallel
      const toolCallResults = await runWithConcurrency(
        completion.message.toolCalls,
        TOOL_CONCURRENCY,
        async (toolCall) => {
          let toolName = toolCall.function?.name ?? '(unknown)';
          let toolArgs = {};
          let toolResult;

          // Validate tool name first — catch hallucinated tools early
          const validationError = validateToolName(toolName, knownToolNames);
          if (validationError) {
            return { toolCall, toolName, toolArgs, toolResult: validationError };
          }

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
        const safeToolResult = redactToolResult(toolResult);
        incrementToolStats(stats, toolName);
        toolTrace.record({
          turn: turnIndex + 1,
          tool: toolName,
          args: toolArgs,
          result: safeToolResult,
        });

        candidatePaths = mergeCandidatePaths(
          candidatePaths,
          collectCandidatePathsFromToolResult(toolName, safeToolResult),
        );

        if (toolName === 'repo_read_file' && !safeToolResult?.error) {
          recordObservedRange(observedRanges, safeToolResult.path, safeToolResult.startLine, safeToolResult.endLine, 'read');
        }

        if (toolName === 'repo_grep' && Array.isArray(safeToolResult?.matches)) {
          for (const match of safeToolResult.matches) {
            recordObservedRange(observedRanges, match.path, match.line, match.line, 'grep');
          }
        }

        // Record blame lines as observed ranges
        if (toolName === 'repo_git_blame' && !safeToolResult?.error && Array.isArray(safeToolResult?.lines)) {
          const blamePath = toolArgs.path ?? null;
          if (blamePath) {
            for (const entry of safeToolResult.lines) {
              if (typeof entry.line === 'number') {
                recordObservedRange(observedRanges, blamePath, entry.line, entry.line, 'blame');
              }
            }
          }
        }

        // Record diff/show hunk ranges as observed ranges
        if ((toolName === 'repo_git_diff' || toolName === 'repo_git_show') && !safeToolResult?.error) {
          const diffFiles = safeToolResult?.files ?? [];
          for (const file of diffFiles) {
            if (file.path && Array.isArray(file.hunks)) {
              for (const hunk of file.hunks) {
                // Skip deletion-only hunks (newLines === 0): they add no lines to the
                // new file, so recording [newStart, newStart-1] would create an inverted
                // range that can never match any evidence item.
                if (hunk.newLines === 0) continue;
                recordObservedRange(observedRanges, file.path, hunk.newStart, hunk.newStart + hunk.newLines - 1, 'diff_hunk');
              }
            }
          }
        }

        // Record observedRanges from macro tools (e.g. repo_symbol_context)
        // Each observation carries its own source field ('symbol_context_definition', 'symbol_context_usage', etc.)
        if (Array.isArray(safeToolResult?.observedRanges)) {
          for (const observed of safeToolResult.observedRanges) {
            recordObservedRange(observedRanges, observed.path, observed.startLine, observed.endLine, observed.source ?? 'macro_tool');
          }
        }

        if (toolName === 'repo_git_log' && !safeToolResult?.error) {
          capturedGitLogs.push({ ...safeToolResult, path: toolArgs.path ?? null });
          // Record observed commit hashes for git evidence validation
          // gitLog() returns commits with 'hash' field (not 'sha')
          if (Array.isArray(safeToolResult.commits)) {
            for (const commit of safeToolResult.commits) {
              const h = commit.hash ?? commit.sha;
              if (h) observedGit.commits.add(h);
            }
          }
        }

        if (toolName === 'repo_git_show' && !safeToolResult?.error) {
          // gitShow() returns 'hash' field (not 'sha')
          const h = safeToolResult.hash ?? safeToolResult.sha;
          if (h) observedGit.commits.add(h);
        }

        if (toolName === 'repo_git_blame' && !safeToolResult?.error && Array.isArray(safeToolResult.lines)) {
          const blamePath = toolArgs.path ?? null;
          for (const entry of safeToolResult.lines) {
            if (blamePath && typeof entry.line === 'number' && entry.hash) {
              observedGit.blame.add(`${blamePath}:${entry.line}:${entry.hash}`);
            }
          }
        }

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(safeToolResult),
        });
      }

      // Check all-error turn
      const allErrors = toolCallResults.every(r => r.toolResult?.error);
      if (allErrors) {
        consecutiveAllErrorTurns += 1;
      } else {
        consecutiveAllErrorTurns = 0;
      }

      // Circuit breaker: force exit after too many consecutive all-error turns
      if (consecutiveAllErrorTurns >= MAX_CONSECUTIVE_ERROR_TURNS) {
        stats.stoppedByErrors = true;
        break;
      }

      // Inject recovery guidance when stagnating (same plan repeated or all tools failing)
      const shouldInjectErrorRecovery =
        consecutiveAllErrorTurns >= ERROR_RECOVERY_GUIDANCE_TURNS
        && consecutiveAllErrorTurns < MAX_CONSECUTIVE_ERROR_TURNS;
      if (repeatedTurns >= 2 || shouldInjectErrorRecovery) {
        messages.push({
          role: 'user',
          content: 'You are repeating the same failing or unproductive tool calls. Either finalize with your current findings (even if incomplete), or choose a completely different tool or path that addresses a specific gap you have not explored yet.',
        });
        // Reset the repeated-plan counter after injecting guidance. Keep the
        // consecutive error counter intact so the circuit breaker remains reachable.
        repeatedTurns = 0;
      }
    }

    if (!finalObject && stats.stoppedByAbort) {
      finalObject = buildCancelledExploreObject(lastAssistantContent);
    } else if (!finalObject) {
      stats.stoppedByBudget = !stats.stoppedByErrors && !stats.stoppedByAbort;
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
        abortSignal,
      });
      finalObject = finalized.result;
      Object.assign(stats, summarizeUsage(stats, finalized.usage));
    }

    stats.elapsedMs = nowMs() - startedAt;
    Object.assign(stats, globalRepoCache.stats());

    let normalized = normalizeExploreResult(finalObject, stats);
    normalized.candidatePaths = mergeCandidatePaths(normalized.candidatePaths, candidatePaths).slice(0, 80);

    const taskKind = deriveTaskKindFromHints(args.hints);
    const criticPass = runDeterministicCriticPass({
      normalized,
      observedRanges,
      observedGit,
      stats,
      taskKind,
    });
    normalized = criticPass.result;
    normalized.evidence = await attachEvidenceMetadata({
      evidence: normalized.evidence,
      repoRoot,
    });

    if (criticPass.grounding.droppedUngrounded + criticPass.grounding.droppedMalformed > 0) {
      normalized.followups = mergeCandidatePaths(normalized.followups, [{
        description: 'Some evidence items were dropped because they were not grounded in inspected line ranges.',
        priority: 'optional',
      }]);
    }

    if (!normalized.summary) normalized.summary = normalized.answer;
    if (!normalized.answer) {
      normalized.answer = lastAssistantContent || 'Explorer did not return a final answer.';
      normalized.confidence = 'low';
      normalized.confidenceLevel = 'low';
    }
    normalized.directAnswer = normalized.directAnswer || normalized.answer;
    normalized.targets = mergeTargets(
      normalized.targets,
      buildTargets({
        evidence: normalized.evidence,
        candidatePaths: normalized.candidatePaths,
      }),
    );
    normalized.uncertainties = buildUncertainties(normalized, stats);
    normalized.status = buildResultStatus(normalized, stats, { task: args.task });
    normalized.nextAction = buildNextAction(normalized);
    if (stats.sessionId) normalized.sessionId = stats.sessionId;

    // Trust summary — a natural-language sentence the parent model can rely on
    normalized.trustSummary = buildTrustSummary(normalized, stats);

    // codeMap + Mermaid diagram
    const codeMap = buildCodeMap(observedRanges, projectConfig.entryPoints ?? []);
    let diagram = null;
    if (codeMap) {
      normalized.codeMap = codeMap;
      const strategy = args.hints?.strategy ?? null;
      if (!strategy || strategy === 'breadth-first') {
        diagram = buildMermaidDiagram(codeMap);
        if (diagram) normalized.diagram = diagram;
      }
    }

    // recentActivity from git_log
    const recentActivity = buildRecentActivity(capturedGitLogs);
    if (recentActivity) normalized.recentActivity = recentActivity;
    attachDebug(normalized, { stats, codeMap, diagram, recentActivity, toolTrace: toolTrace.toJSON() });

    // Update session with this call's result
    if (sessionStore && sessionId) {
      sessionStore.update(sessionId, normalized);
      syncRemainingCallsStat(stats, sessionStore, sessionId);
    }

    return normalized;
  }

  /**
   * Phase 5: Free-form exploration — produces a human-readable Markdown report.
   *
   * @param {object} args - { prompt, thoroughness?, scope?, repo_root?, session?, language?, context? }
   * @param {object} [callOpts]
   * @param {Function}      [callOpts.onProgress]
   * @param {object}        [callOpts.sessionStore]
   * @param {AbortSignal}   [callOpts.abortSignal]
   */
  async freeExplore(args, { onProgress = null, sessionStore = null, abortSignal = null } = {}) {
    if (!args || typeof args.prompt !== 'string' || !args.prompt.trim()) {
      const err = new Error('prompt is required and must be a non-empty string.');
      err.code = -32602;
      throw err;
    }

    const thoroughnessMap = { quick: 'quick', normal: 'normal', deep: 'deep' };
    const budgetLabel = args.thoroughness ? thoroughnessMap[args.thoroughness] : undefined;

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

    let messages = [
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
    const toolTrace = createCompactToolTrace();
    let report = '';

    for (let turnIndex = 0; turnIndex < budgetConfig.maxTurns; turnIndex += 1) {
      // Abort check
      if (abortSignal?.aborted) {
        stats.stoppedByAbort = true;
        break;
      }

      // Context window management: compact old tool results when approaching limit
      messages = compactOldToolResults(messages, budgetConfig.maxContextTokens);

      stats.turns += 1;

      if (onProgress) {
        onProgress({ progress: turnIndex, total: budgetConfig.maxTurns, message: `Turn ${turnIndex + 1}/${budgetConfig.maxTurns}` });
      }

      let completion;
      try {
        completion = await chatClient.createChatCompletion({
          messages,
          tools,
          reasoningEffort,
          temperature,
          topP,
          maxCompletionTokens: budgetConfig.maxCompletionTokens,
          parallelToolCalls: true,
          signal: abortSignal,
        });
      } catch (error) {
        if (abortSignal?.aborted && isAbortError(error)) {
          stats.stoppedByAbort = true;
          break;
        }
        throw error;
      }

      Object.assign(stats, summarizeUsage(stats, completion.usage));

      if (!completion.message.toolCalls || completion.message.toolCalls.length === 0) {
        if (completion.message.content) {
          report = completion.message.content;
        }
        break;
      }

      const assistantMessage = buildAssistantMessage(completion.message);
      // Do NOT set report here — only set it when there are no tool calls (final answer)
      messages.push(assistantMessage);

      // Execute tool calls in parallel (same concurrency as explore)
      const toolCallResults = await runWithConcurrency(
        completion.message.toolCalls,
        TOOL_CONCURRENCY,
        async (toolCall) => {
          const toolName = toolCall.function?.name ?? '(unknown)';
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
        const safeToolResult = redactToolResult(toolResult);
        stats.toolCalls += 1;
        toolsUsed.add(toolName);
        toolTrace.record({
          turn: turnIndex + 1,
          tool: toolName,
          args: toolArgs,
          result: safeToolResult,
        });

        if (toolName === 'repo_read_file' && !safeToolResult?.error) {
          filesRead.add(safeToolResult.path);
          stats.filesRead += 1;
        }

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(safeToolResult),
        });
      }
    }

    // Finalize when: budget exhausted (regardless of interim report), report empty, or "None" quirk
    const budgetExhausted = stats.turns >= budgetConfig.maxTurns;
    const reportIsEmpty = !report || report.trim() === '' || report.trim().toLowerCase() === 'none';
    if (stats.stoppedByAbort) {
      report = buildCancelledReport(report);
    } else if (budgetExhausted || reportIsEmpty) {
      stats.stoppedByBudget = budgetExhausted;
      try {
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
          signal: abortSignal,
        });
        Object.assign(stats, summarizeUsage(stats, finalized.usage));
        report = finalized.message.content || 'Explorer could not produce a report.';
      } catch (error) {
        if (abortSignal?.aborted && isAbortError(error)) {
          stats.stoppedByAbort = true;
          report = buildCancelledReport(report);
        } else {
          throw error;
        }
      }
    }

    stats.elapsedMs = nowMs() - startedAt;
    Object.assign(stats, globalRepoCache.stats());
    const reportFilesRead = [...filesRead];
    const critic = buildReportCritic({ report, filesRead: reportFilesRead, stats });

    // Update session with report summary (mode-neutral)
    if (sessionStore && sessionId) {
      const summaryLine = report.split('\n').find(l => l.trim())?.slice(0, 400) ?? '';
      sessionStore.update(sessionId, {
        candidatePaths: [...filesRead],
        evidence: [],
        summary: summaryLine,
        followups: [],
      });
      syncRemainingCallsStat(stats, sessionStore, sessionId);
    }

    return {
      report,
      filesRead: reportFilesRead,
      toolsUsed: [...toolsUsed],
      stats,
      critic,
      toolTrace: toolTrace.toJSON(),
    };
  }

  // ── freeExploreV2 ───────────────────────────────────────────────────────────

  /**
   * V2 free-form exploration with three advanced techniques:
   * 1. Tool Result Budgeting — per-tool character limits to conserve context
   * 2. LLM-based Conversation Compaction — intelligent summarization instead of truncation
   * 3. Max Output Recovery — multi-attempt continuation when output is cut short
   *
   * @param {object} args - { prompt, thoroughness?, scope?, repo_root?, session?, language?, context? }
   * @param {object} [callOpts]
   */
  async freeExploreV2(args, { onProgress = null, sessionStore = null, abortSignal = null } = {}) {
    if (!args || typeof args.prompt !== 'string' || !args.prompt.trim()) {
      const err = new Error('prompt is required and must be a non-empty string.');
      err.code = -32602;
      throw err;
    }

    const thoroughnessMap = { quick: 'quick', normal: 'normal', deep: 'deep' };
    const budgetLabel = args.thoroughness ? thoroughnessMap[args.thoroughness] : undefined;

    const {
      budgetConfig: baseBudgetConfig, repoRoot, effectiveScope, projectContext, keyFiles,
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

    // V2: extend the turn budget, but keep it bounded by configurable caps.
    const requestedV2Turns = Math.max(
      baseBudgetConfig.maxTurns,
      Math.round(baseBudgetConfig.maxTurns * getExploreV2TurnMultiplier()),
    );
    const maxAllowedV2Turns = baseBudgetConfig.maxTurns + getExploreV2MaxExtraTurns();
    const budgetConfig = {
      ...baseBudgetConfig,
      maxTurns: Math.min(requestedV2Turns, maxAllowedV2Turns),
    };

    const startedAt = nowMs();
    const knownToolNames = new Set(tools.map(tool => tool.function?.name).filter(Boolean));

    // Transcript recording (opt-in via CEREBRAS_EXPLORER_TRANSCRIPT=true)
    const transcript = createTranscriptRecorder({
      repoRoot,
      tool: 'explore_v2',
      task: args.prompt,
      logger: this.logger,
    });
    const toolTrace = createCompactToolTrace();

    let messages = [
      {
        role: 'system',
        content: buildFreeExploreV2SystemPrompt({
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
      llmCompactions: 0,
      toolResultsTruncated: 0,
      outputRecoveries: 0,
      repoRoot,
      sessionId,
      sessionStatus,
      remainingCalls,
    };

    const filesRead = new Set();
    const toolsUsed = new Set();
    let report = '';

    // Stagnation tracking
    let lastFingerprint = null;
    let repeatedTurns = 0;
    let consecutiveAllErrorTurns = 0;

    // Checkpoint interval (same as explore)
    const CHECKPOINT_INTERVAL = 4;
    const checkpointEnabled = budgetConfig.maxTurns > 6;

    // Compaction threshold: trigger LLM summary at 70% of context window
    const compactionThreshold = Math.floor((budgetConfig.maxContextTokens ?? 100_000) * 0.70);
    const maxLlmCompactions = getExploreV2MaxCompactions();

    for (let turnIndex = 0; turnIndex < budgetConfig.maxTurns; turnIndex += 1) {
      // Abort check
      if (abortSignal?.aborted) {
        stats.stoppedByAbort = true;
        break;
      }

      // ── Technique 2: LLM-based conversation compaction ──
      const estimated = estimateTokens(messages);
      if (estimated >= compactionThreshold && messages.length > 6) {
        if (onProgress) {
          onProgress({
            progress: turnIndex,
            total: budgetConfig.maxTurns,
            message: `Compacting context (${Math.round(estimated / 1000)}K tokens)...`,
          });
        }
        if (stats.llmCompactions >= maxLlmCompactions) {
          messages = compactOldToolResults(messages, budgetConfig.maxContextTokens);
        } else {
          try {
            const compactResult = await compactWithLlmSummary(
              chatClient,
              messages,
              compactionThreshold,
              { reasoningEffort, abortSignal },
            );
            if (compactResult.didCompact) {
              messages = compactResult.messages;
              stats.llmCompactions += 1;
              Object.assign(stats, summarizeUsage(stats, compactResult.usage));
            }
          } catch (error) {
            if (abortSignal?.aborted && isAbortError(error)) {
              stats.stoppedByAbort = true;
              break;
            }
            // Compaction failed — fall back to simple truncation
            messages = compactOldToolResults(messages, budgetConfig.maxContextTokens);
          }
        }
      }

      // Checkpoint: self-assess every N turns
      if (checkpointEnabled && turnIndex > 0 && turnIndex % CHECKPOINT_INTERVAL === 0) {
        messages.push({
          role: 'user',
          content: 'Checkpoint: If you have gathered enough evidence, stop calling tools and write your final report now. Otherwise, choose the most impactful next step.',
        });
      }

      stats.turns += 1;

      if (onProgress) {
        onProgress({
          progress: turnIndex,
          total: budgetConfig.maxTurns,
          message: turnIndex === 0
            ? 'Starting V2 exploration...'
            : `Turn ${turnIndex + 1}/${budgetConfig.maxTurns}: exploring...`,
        });
      }

      let completion;
      try {
        completion = await chatClient.createChatCompletion({
          messages,
          tools,
          reasoningEffort,
          temperature,
          topP,
          maxCompletionTokens: budgetConfig.maxCompletionTokens,
          parallelToolCalls: true,
          signal: abortSignal,
        });
      } catch (error) {
        if (abortSignal?.aborted && isAbortError(error)) {
          stats.stoppedByAbort = true;
          break;
        }
        throw error;
      }

      Object.assign(stats, summarizeUsage(stats, completion.usage));

      // No tool calls — model wants to produce its report
      if (!completion.message.toolCalls || completion.message.toolCalls.length === 0) {
        if (completion.message.content) {
          report = completion.message.content;
        }
        break;
      }

      const assistantMessage = buildAssistantMessage(completion.message);
      messages.push(assistantMessage);
      transcript.record('assistant', {
        content: assistantMessage.content,
        toolCalls: completion.message.toolCalls.map(c => c.function?.name),
        turn: turnIndex,
      });

      // Stagnation detection
      {
        const fingerprint = fingerprintToolCalls(completion.message.toolCalls);
        if (fingerprint === lastFingerprint) {
          repeatedTurns += 1;
        } else {
          repeatedTurns = 0;
          lastFingerprint = fingerprint;
        }
      }

      // Execute tool calls in parallel
      const toolCallResults = await runWithConcurrency(
        completion.message.toolCalls,
        TOOL_CONCURRENCY,
        async (toolCall) => {
          const toolName = toolCall.function?.name ?? '(unknown)';
          let toolArgs = {};
          let toolResult;

          // Validate tool name — catch hallucinated tools early
          const validationError = validateToolName(toolName, knownToolNames);
          if (validationError) {
            return { toolCall, toolName, toolArgs, toolResult: validationError };
          }

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

      let allErrors = true;
      for (const { toolCall, toolName, toolArgs, toolResult } of toolCallResults) {
        const safeToolResult = redactToolResult(toolResult);
        stats.toolCalls += 1;
        toolsUsed.add(toolName);
        toolTrace.record({
          turn: turnIndex + 1,
          tool: toolName,
          args: toolArgs,
          result: safeToolResult,
        });

        if (toolName === 'repo_read_file' && !safeToolResult?.error) {
          filesRead.add(safeToolResult.path);
          stats.filesRead += 1;
        }
        if (!safeToolResult?.error) allErrors = false;

        // ── Technique 1: Tool Result Budgeting ──
        const serialized = applyToolResultCharBudget(toolName, safeToolResult);
        if (serialized.includes('[truncated:')) {
          stats.toolResultsTruncated += 1;
        }

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: serialized,
        });
        transcript.record('tool', {
          tool: toolName,
          error: toolResult?.error ?? false,
          resultChars: serialized.length,
          turn: turnIndex,
        });
      }

      // Consecutive error tracking
      if (allErrors) {
        consecutiveAllErrorTurns += 1;
      } else {
        consecutiveAllErrorTurns = 0;
      }

      // Circuit breaker: force exit after too many consecutive all-error turns
      if (consecutiveAllErrorTurns >= MAX_CONSECUTIVE_ERROR_TURNS) {
        stats.stoppedByErrors = true;
        break;
      }

      // Stagnation recovery
      const shouldInjectErrorRecovery =
        consecutiveAllErrorTurns >= ERROR_RECOVERY_GUIDANCE_TURNS
        && consecutiveAllErrorTurns < MAX_CONSECUTIVE_ERROR_TURNS;
      if (repeatedTurns >= 2 || shouldInjectErrorRecovery) {
        messages.push({
          role: 'user',
          content: 'You are repeating the same failing or unproductive tool calls. Either write your report now with current findings, or try a completely different search approach.',
        });
        repeatedTurns = 0;
      }
    }

    // ── Finalization with Technique 3: Max Output Recovery ──
    const budgetExhausted = stats.turns >= budgetConfig.maxTurns;
    const reportIsEmpty = !report || report.trim() === '' || report.trim().toLowerCase() === 'none';

    if (stats.stoppedByAbort) {
      report = buildCancelledReport(report);
    } else if (budgetExhausted || reportIsEmpty) {
      stats.stoppedByBudget = budgetExhausted;

      if (onProgress) {
        onProgress({
          progress: budgetConfig.maxTurns - 1,
          total: budgetConfig.maxTurns,
          message: 'Synthesizing final report...',
        });
      }

      // Initial finalization
      const finalizeMessages = [
        ...messages,
        { role: 'user', content: buildFreeExploreV2FinalizePrompt() },
      ];

      let finalized;
      try {
        finalized = await chatClient.createChatCompletion({
          messages: finalizeMessages,
          reasoningEffort,
          temperature,
          topP,
          maxCompletionTokens: budgetConfig.finalizeMaxCompletionTokens ?? 3000,
          parallelToolCalls: false,
          signal: abortSignal,
        });
      } catch (error) {
        if (abortSignal?.aborted && isAbortError(error)) {
          stats.stoppedByAbort = true;
          report = buildCancelledReport(report);
          finalized = null;
        } else {
          throw error;
        }
      }
      if (finalized) {
        Object.assign(stats, summarizeUsage(stats, finalized.usage));
        report = finalized.message.content || '';
      }

      // Max output recovery: if output was cut short, ask to continue
      if (finalized?.finishReason === 'length' && report.length > 0) {
        let recoveryMessages = [
          ...finalizeMessages,
          { role: 'assistant', content: report },
        ];
        let recoveryCount = 0;

        while (recoveryCount < MAX_OUTPUT_RECOVERY_ATTEMPTS) {
          recoveryCount += 1;
          stats.outputRecoveries += 1;

          if (onProgress) {
            onProgress({
              progress: budgetConfig.maxTurns,
              total: budgetConfig.maxTurns,
              message: `Output recovery attempt ${recoveryCount}/${MAX_OUTPUT_RECOVERY_ATTEMPTS}...`,
            });
          }

          recoveryMessages.push({
            role: 'user',
            content: buildOutputContinuationPrompt(),
          });

          let continuation;
          try {
            continuation = await chatClient.createChatCompletion({
              messages: recoveryMessages,
              reasoningEffort,
              temperature,
              topP,
              maxCompletionTokens: budgetConfig.finalizeMaxCompletionTokens ?? 3000,
              parallelToolCalls: false,
              signal: abortSignal,
            });
          } catch (error) {
            if (abortSignal?.aborted && isAbortError(error)) {
              stats.stoppedByAbort = true;
              report = buildCancelledReport(report);
              break;
            }
            throw error;
          }
          Object.assign(stats, summarizeUsage(stats, continuation.usage));

          const continuedText = continuation.message.content || '';
          if (continuedText) {
            report += '\n' + continuedText;
            recoveryMessages.push({ role: 'assistant', content: continuedText });
          }

          // If the model finished normally this time, stop recovery
          if (continuation.finishReason !== 'length' || !continuedText) {
            break;
          }
        }
      }
    } else if (report) {
      // Report from the main loop — also check for cut-off recovery
      // (when model stops calling tools and writes report directly)
      // Check by looking at whether the report ends mid-sentence
      // For now, trust the model's natural stop — recovery only during finalize
    }

    if (!report || report.trim() === '') {
      report = 'Explorer V2 could not produce a report.';
    }

    stats.elapsedMs = nowMs() - startedAt;
    Object.assign(stats, globalRepoCache.stats());
    const reportFilesRead = [...filesRead];
    const critic = buildReportCritic({ report, filesRead: reportFilesRead, stats });

    // Finalize transcript
    await transcript.finalize(stats);

    // Update session
    if (sessionStore && sessionId) {
      const summaryLine = report.split('\n').find(l => l.trim())?.slice(0, 400) ?? '';
      sessionStore.update(sessionId, {
        candidatePaths: [...filesRead],
        evidence: [],
        summary: summaryLine,
        followups: [],
      });
      syncRemainingCallsStat(stats, sessionStore, sessionId);
    }

    return {
      report,
      filesRead: reportFilesRead,
      toolsUsed: [...toolsUsed],
      stats,
      critic,
      transcriptPath: transcript.filePath,
      toolTrace: toolTrace.toJSON(),
    };
  }

  async finalizeAfterToolLoop({ chatClient, messages, reasoningEffort, temperature, topP, budgetConfig, abortSignal = null }) {
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
      signal: abortSignal,
    });

    // 1) Primary: clean JSON parse
    const structured = extractFirstJsonObject(completion.message.content);
    if (structured) {
      return { result: structured, usage: completion.usage ?? null };
    }

    // 2) Local salvage: extract JSON wrapped in prose (e.g., ```json ... ```)
    const loose = tryLooseRepair(completion.message.content);
    if (loose) {
      return { result: loose, usage: completion.usage ?? null };
    }

    // 3) No-tools repair pass: ask model to produce clean JSON within conversation context
    try {
      const repairMessages = [
        ...messages,
        { role: 'assistant', content: redactText(completion.message.content || '').text },
        { role: 'user', content: 'Repair your previous response into exactly one JSON object matching the schema. Do not add new facts. Do not call tools.' },
      ];
      const repair = await chatClient.createChatCompletion({
        messages: repairMessages,
        responseFormat: { type: 'json_schema', json_schema: EXPLORE_RESULT_JSON_SCHEMA },
        reasoningEffort: 'none',
        temperature: 0,
        topP: 1,
        maxCompletionTokens: Math.min(1000, maxCompletionTokens),
        parallelToolCalls: false,
        signal: abortSignal,
        // Explicitly omit tools to prevent the model from requesting more tool calls
      });
      const repaired = extractFirstJsonObject(repair.message.content) ?? tryLooseRepair(repair.message.content);
      if (repaired) {
        return { result: repaired, usage: repair.usage ?? completion.usage ?? null };
      }
    } catch { /* repair failed, fall through to local fallback */ }

    // 4) Last resort: raw text as low-confidence answer
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
  const { onProgress, sessionStore, abortSignal, ...runtimeOptions } = options;
  const runtime = new ExplorerRuntime(runtimeOptions);
  return runtime.explore(args, { onProgress, sessionStore, abortSignal });
}

export async function freeExploreRepository(args, options = {}) {
  const { onProgress, sessionStore, abortSignal, ...runtimeOptions } = options;
  const runtime = new ExplorerRuntime(runtimeOptions);
  return runtime.freeExplore(args, { onProgress, sessionStore, abortSignal });
}

export async function freeExploreRepositoryV2(args, options = {}) {
  const { onProgress, sessionStore, abortSignal, ...runtimeOptions } = options;
  const runtime = new ExplorerRuntime(runtimeOptions);
  return runtime.freeExploreV2(args, { onProgress, sessionStore, abortSignal });
}
