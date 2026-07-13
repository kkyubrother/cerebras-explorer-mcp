import { createHash } from 'node:crypto';

const ACTION_ARGUMENT_LABEL = Object.freeze({
  explore_repo: 'task',
  find_relevant_code: 'query',
  trace_symbol: 'symbol',
  map_change_impact: 'change',
  explain_code_path: 'pathQuery',
  collect_evidence: 'claim',
});

function formatToolAction(prefix, action) {
  const argumentKey = ACTION_ARGUMENT_LABEL[action.tool];
  return `${prefix}: ${action.tool} — ${action.arguments[argumentKey]}`;
}

function formatTarget(target) {
  const location = Number.isInteger(target.startLine)
    ? `${target.path}:${target.startLine}${Number.isInteger(target.endLine) ? `-${target.endLine}` : ''}`
    : target.path;
  return `Target: ${location} — ${target.reason}`;
}

export function formatParentHandoffText(handoff) {
  if (handoff.state === 'complete') return handoff.directAnswer;

  const lines = [];
  if (handoff.directAnswer) lines.push(handoff.directAnswer, '');
  lines.push(`State: ${handoff.state}`);

  for (const target of handoff.targets ?? []) lines.push(formatTarget(target));
  for (const gap of handoff.gaps ?? []) {
    lines.push(`Gap: ${gap.question} — ${gap.reason}`);
  }
  if (handoff.followUp?.type === 'tool') {
    lines.push(formatToolAction('Follow-up', handoff.followUp));
  } else if (handoff.followUp?.type === 'ask_user') {
    lines.push(`Follow-up: ${handoff.followUp.question}`);
  } else if (handoff.followUp?.type === 'external_verification') {
    lines.push(`Follow-up: ${handoff.followUp.requirement}`);
  }
  if (handoff.failure) {
    lines.push(`Failure: ${handoff.failure.reason}`);
    if (handoff.failure.retry) lines.push(formatToolAction('Retry', handoff.failure.retry));
  }
  return lines.join('\n');
}

export function buildParentPayload(parentHandoff) {
  return {
    content: [{ type: 'text', text: formatParentHandoffText(parentHandoff) }],
    structuredContent: parentHandoff,
  };
}

export function measureParentPayload(parentPayload) {
  if (!parentPayload || typeof parentPayload !== 'object' ||
      !Array.isArray(parentPayload.content) ||
      !parentPayload.structuredContent || typeof parentPayload.structuredContent !== 'object') {
    throw new TypeError('Parent payload requires content and structuredContent.');
  }
  const contentJson = JSON.stringify(parentPayload.content);
  const structuredContentJson = JSON.stringify(parentPayload.structuredContent);
  const contentBytes = Buffer.byteLength(contentJson, 'utf8');
  const structuredContentBytes = Buffer.byteLength(structuredContentJson, 'utf8');
  return {
    encoding: 'utf8',
    contentBytes,
    structuredContentBytes,
    parentPayloadBytes: contentBytes + structuredContentBytes,
    sha256: createHash('sha256')
      .update(contentJson)
      .update('\0')
      .update(structuredContentJson)
      .digest('hex'),
  };
}
