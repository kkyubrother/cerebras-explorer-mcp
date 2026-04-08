import { CerebrasChatClient, extractFirstJsonObject } from './cerebras-client.mjs';
import { getBudgetConfig, getRepoRoot } from './config.mjs';
import {
  collectCandidatePathsFromToolResult,
  mergeCandidatePaths,
  RepoToolkit,
} from './repo-tools.mjs';
import {
  buildExplorerSystemPrompt,
  buildExplorerUserPrompt,
  buildFinalizePrompt,
} from './prompt.mjs';
import {
  EXPLORE_RESULT_JSON_SCHEMA,
  normalizeExploreResult,
  validateExploreRepoArgs,
} from './schemas.mjs';

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
}

function recordObservedRange(observedRanges, targetPath, startLine, endLine) {
  if (!targetPath) {
    return;
  }
  const current = observedRanges.get(targetPath) ?? [];
  current.push({ startLine, endLine });
  observedRanges.set(targetPath, current);
}

function overlapsRecordedRange(observedRanges, evidenceItem) {
  const ranges = observedRanges.get(evidenceItem.path);
  if (!ranges || ranges.length === 0) {
    return false;
  }
  return ranges.some(range => evidenceItem.startLine <= range.endLine && evidenceItem.endLine >= range.startLine);
}

export class ExplorerRuntime {
  constructor({
    chatClient = new CerebrasChatClient(),
    logger = () => {},
  } = {}) {
    this.chatClient = chatClient;
    this.logger = logger;
  }

  async explore(args) {
    validateExploreRepoArgs(args);

    const budgetConfig = getBudgetConfig(args.budget);
    const repoRoot = getRepoRoot(args.repo_root);
    const repoToolkit = new RepoToolkit({
      repoRoot,
      budgetConfig,
      logger: this.logger,
    });
    await repoToolkit.initialize(args.scope ?? []);

    const startedAt = nowMs();
    const tools = repoToolkit.buildToolDefinitions();
    const messages = [
      {
        role: 'system',
        content: buildExplorerSystemPrompt({ repoRoot, budgetConfig }),
      },
      {
        role: 'user',
        content: buildExplorerUserPrompt({
          task: args.task,
          scope: args.scope,
          budget: budgetConfig.label,
          hints: args.hints,
        }),
      },
    ];

    const stats = {
      model: this.chatClient.model,
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
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      elapsedMs: 0,
      stoppedByBudget: false,
      repoRoot,
    };

    let candidatePaths = [];
    let finalObject = null;
    let lastAssistantContent = '';
    const observedRanges = new Map();

    for (let turnIndex = 0; turnIndex < budgetConfig.maxTurns; turnIndex += 1) {
      const completion = await this.chatClient.createChatCompletion({
        messages,
        tools,
        reasoningEffort: budgetConfig.reasoningEffort,
        temperature: 0.1,
        maxCompletionTokens: budgetConfig.maxCompletionTokens,
        parallelToolCalls: true,
      });

      stats.turns += 1;
      Object.assign(stats, summarizeUsage(stats, completion.usage));

      const assistantMessage = {
        role: 'assistant',
        content: completion.message.content || null,
      };

      if (completion.message.toolCalls.length > 0) {
        assistantMessage.tool_calls = completion.message.toolCalls.map(call => ({
          id: call.id,
          type: 'function',
          function: {
            name: call.function.name,
            arguments: call.function.arguments,
          },
        }));
      }

      messages.push(assistantMessage);

      if (completion.message.toolCalls.length === 0) {
        lastAssistantContent = completion.message.content || '';
        finalObject = extractFirstJsonObject(lastAssistantContent);
        break;
      }

      for (const toolCall of completion.message.toolCalls) {
        const toolName = toolCall.function.name;
        const toolArgs = safeJsonParse(toolCall.function.arguments || '{}');
        incrementToolStats(stats, toolName);

        let toolResult;
        try {
          toolResult = await repoToolkit.callTool(toolName, toolArgs);
        } catch (error) {
          toolResult = {
            error: true,
            message: error.message,
            tool: toolName,
          };
        }

        candidatePaths = mergeCandidatePaths(
          candidatePaths,
          collectCandidatePathsFromToolResult(toolName, toolResult),
        );

        if (toolName === 'repo_read_file' && !toolResult?.error) {
          recordObservedRange(
            observedRanges,
            toolResult.path,
            toolResult.startLine,
            toolResult.endLine,
          );
        }

        if (toolName === 'repo_grep' && Array.isArray(toolResult?.matches)) {
          for (const match of toolResult.matches) {
            recordObservedRange(observedRanges, match.path, match.line, match.line);
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
      const finalized = await this.finalizeAfterToolLoop({
        messages,
        reasoningEffort: budgetConfig.reasoningEffort,
      });
      finalObject = finalized.result;
      Object.assign(stats, summarizeUsage(stats, finalized.usage));
    }

    stats.elapsedMs = nowMs() - startedAt;

    const normalized = normalizeExploreResult(finalObject, stats);
    normalized.candidatePaths = mergeCandidatePaths(
      normalized.candidatePaths,
      candidatePaths,
    );
    normalized.candidatePaths = normalized.candidatePaths.slice(0, 80);
    normalized.evidence = normalized.evidence
      .map(item => ({
        ...item,
        path: item.path.replace(/^\.\//, ''),
      }))
      .filter(item => item.path && item.why)
      .filter(item => overlapsRecordedRange(observedRanges, item));

    if (Array.isArray(finalObject?.evidence) && normalized.evidence.length < finalObject.evidence.length) {
      normalized.confidence = 'low';
      normalized.followups = mergeCandidatePaths(
        normalized.followups,
        ['Some evidence items were dropped because they were not grounded in inspected line ranges.'],
      );
    }

    if (!normalized.summary) {
      normalized.summary = normalized.answer;
    }
    if (!normalized.answer) {
      normalized.answer = lastAssistantContent || 'Explorer did not return a final answer.';
      normalized.confidence = 'low';
    }

    return normalized;
  }

  async finalizeAfterToolLoop({ messages, reasoningEffort }) {
    const completion = await this.chatClient.createChatCompletion({
      messages: [
        ...messages,
        {
          role: 'user',
          content: buildFinalizePrompt(),
        },
      ],
      responseFormat: {
        type: 'json_schema',
        json_schema: EXPLORE_RESULT_JSON_SCHEMA,
      },
      reasoningEffort,
      temperature: 0.1,
      maxCompletionTokens: 2500,
      parallelToolCalls: false,
    });

    const structured = extractFirstJsonObject(completion.message.content);
    if (structured) {
      return {
        result: structured,
        usage: completion.usage ?? null,
      };
    }

    return {
      result: {
        answer: completion.message.content || 'Explorer could not synthesize a final answer.',
        summary: completion.message.content || '',
        confidence: 'low',
        evidence: [],
        candidatePaths: [],
        followups: ['Inspect cited files manually if higher confidence is required.'],
      },
      usage: completion.usage ?? null,
    };
  }
}

export async function exploreRepository(args, options = {}) {
  const runtime = new ExplorerRuntime(options);
  return await runtime.explore(args);
}
