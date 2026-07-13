import fs from 'node:fs/promises';

// Keep this benchmark classification aligned with the README/DESIGN internal tool inventory.
const BROAD_SEARCH_TOOLS = new Set(['repo_grep', 'repo_find_files', 'repo_list_dir']);
const READ_TOOLS = new Set(['repo_read_file', 'repo_symbol_context', 'repo_symbols', 'repo_references']);

function createEmptyMetrics() {
  return {
    assistantTurns: 0,
    toolCalls: 0,
    broadSearchCalls: 0,
    readCalls: 0,
    toolErrorCalls: 0,
    repeatedToolPlanTurns: 0,
    safetyLimitCount: 0,
  };
}

function getToolCallName(toolCall) {
  if (typeof toolCall === 'string') return toolCall;
  if (typeof toolCall?.name === 'string') return toolCall.name;
  if (typeof toolCall?.function?.name === 'string') return toolCall.function.name;
  return '';
}

function normalizeToolPlan(toolCalls) {
  if (!Array.isArray(toolCalls)) return '';
  return toolCalls
    .map(getToolCallName)
    .filter(Boolean)
    .sort()
    .join('|');
}

export function analyzeTranscriptEntries(entries) {
  const metrics = createEmptyMetrics();
  const normalizedEntries = Array.isArray(entries) ? entries : [];
  let previousToolPlan = '';

  for (const entry of normalizedEntries) {
    if (!entry || typeof entry !== 'object') continue;

    if (entry.type === 'assistant') {
      metrics.assistantTurns += 1;
      const currentToolPlan = normalizeToolPlan(entry.toolCalls);
      if (currentToolPlan) {
        if (currentToolPlan === previousToolPlan) {
          metrics.repeatedToolPlanTurns += 1;
        }
        previousToolPlan = currentToolPlan;
      }
      continue;
    }

    if (entry.type === 'tool') {
      const toolName = typeof entry.tool === 'string' ? entry.tool : '';
      metrics.toolCalls += 1;
      if (BROAD_SEARCH_TOOLS.has(toolName)) metrics.broadSearchCalls += 1;
      if (READ_TOOLS.has(toolName)) metrics.readCalls += 1;
      if (entry.error === true) metrics.toolErrorCalls += 1;
      continue;
    }

    if (entry.type === 'safety_limit') {
      metrics.safetyLimitCount += 1;
    }
  }

  return metrics;
}

export async function analyzeTranscriptFile(filePath) {
  if (!filePath) return null;
  const raw = await fs.readFile(filePath, 'utf8');
  const entries = raw
    .split(/\r?\n/)
    .filter(line => line.trim())
    .map(line => JSON.parse(line));
  return analyzeTranscriptEntries(entries);
}
