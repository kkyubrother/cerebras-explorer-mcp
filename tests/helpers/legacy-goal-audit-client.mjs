function parseControlPacket(messages) {
  const content = messages.findLast(message =>
    message.role === 'user' && typeof message.content === 'string' &&
    message.content.includes('BEGIN_CONTROL_DATA_JSON'))?.content ?? '';
  const match = /BEGIN_CONTROL_DATA_JSON\n([\s\S]*?)\nEND_CONTROL_DATA_JSON/.exec(content);
  return match ? JSON.parse(match[1]) : null;
}

function controlKind(request) {
  const schema = request.responseFormat?.json_schema?.schema;
  const required = Array.isArray(schema?.required) ? schema.required : [];
  if (required.includes('taskSummary') && required.includes('subgoals')) return 'planner';
  if (required.includes('goals') && required.includes('uncoveredRequestParts')) return 'goal_audit';
  if (required.includes('claims')) return 'claim_synthesis';
  if (required.includes('verdicts') && required.includes('uncoveredRequestParts')) {
    return 'semantic_verifier';
  }
  return null;
}

function controlCompletion(value) {
  return {
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    finishReason: 'stop',
    message: { content: JSON.stringify(value), toolCalls: [] },
  };
}

function parseCompactResult(content) {
  if (typeof content !== 'string' || !content.trim()) return null;
  try {
    return JSON.parse(content);
  } catch {
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(content.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

/**
 * Test-only compatibility adapter for pre-spec-028 provider scripts. It keeps
 * those fixtures focused on the legacy exploration loop by supplying isolated
 * planner, auditor, claim, verifier, and single-repair controls. New trust-gate
 * tests must use explicit provider fixtures instead of this adapter.
 */
export function adaptLegacyGoalAuditClient(chatClient, { rejectedGoal = null } = {}) {
  if (!chatClient) return chatClient;
  let repairCalls = 0;
  let lastCompactResult = null;
  return new Proxy(chatClient, {
    get(target, property, receiver) {
      if (property !== 'createChatCompletion') {
        return Reflect.get(target, property, receiver);
      }
      return async request => {
        if (request.messages?.some(message =>
          message.role === 'user' && typeof message.content === 'string' &&
          message.content.includes('BEGIN_EVIDENCE_REPAIR_JSON'))) {
          if (request.messages.at(-1)?.role === 'tool') {
            return controlCompletion('Legacy loop fixture repair read complete.');
          }
          repairCalls += 1;
          if (repairCalls > 1) {
            throw new Error('Legacy runtime fixture observed more than one repair round.');
          }
          const path = lastCompactResult?.evidence?.find(item => typeof item?.path === 'string')?.path
            ?? lastCompactResult?.targets?.find(item => typeof item?.path === 'string')?.path
            ?? 'src/auth.js';
          return {
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
            finishReason: 'tool_calls',
            message: {
              content: '',
              toolCalls: [{
                id: 'legacy-test-repair-read',
                function: {
                  name: 'repo_read_file',
                  arguments: JSON.stringify({ path, startLine: 1, endLine: 20 }),
                },
              }],
            },
          };
        }
        const kind = controlKind(request);
        if (kind === 'planner') {
          const packet = parseControlPacket(request.messages);
          const task = packet?.control?.task ?? '';
          return controlCompletion({
            taskSummary: 'Legacy runtime behavior under test.',
            constraints: [],
            subgoals: [
              {
                id: 'legacy-test-goal',
                question: 'Complete the requested repository investigation.',
                originRefs: [`request:0-${task.length}`],
                claimType: 'positive',
                proofCondition: 'Observe repository evidence that answers the requested investigation.',
                constraints: [],
              },
              ...(rejectedGoal ? [{
                id: rejectedGoal.id,
                question: rejectedGoal.question,
                originRefs: [`request:0-${task.length}`],
                claimType: 'positive',
                proofCondition: rejectedGoal.proofCondition,
                constraints: [],
              }] : []),
            ],
          });
        }
        if (kind === 'goal_audit') {
          const packet = parseControlPacket(request.messages);
          return controlCompletion({
            goals: packet.proposals.map(goal => ({
              proposedGoalId: goal.id,
              verdict: goal.id === rejectedGoal?.id ? 'reject_untraceable' : 'ready',
              originRefs: goal.id === rejectedGoal?.id ? [] : [...goal.originRefs],
              missingRequestParts: [],
              reason: goal.id === rejectedGoal?.id
                ? rejectedGoal.reason
                : 'Retained for the legacy behavior test.',
            })),
            uncoveredRequestParts: [],
          });
        }
        if (kind === 'claim_synthesis') {
          const packet = parseControlPacket(request.messages);
          const subgoal = packet?.control?.requiredSubgoals?.[0];
          const evidenceRefs = (packet?.observations ?? [])
            .filter(observation => observation?.kind === 'source' ||
              String(observation?.kind ?? '').startsWith('git_'))
            .map(observation => observation.id);
          const text = typeof lastCompactResult?.directAnswer === 'string'
            ? lastCompactResult.directAnswer.trim()
            : '';
          return controlCompletion({
            claims: subgoal && evidenceRefs.length > 0 && text
              ? [{
                  id: 'legacy-test-claim',
                  subgoalId: subgoal.id,
                  text,
                  evidenceRefs,
                }]
              : [],
          });
        }
        if (kind === 'semantic_verifier') {
          const packet = parseControlPacket(request.messages);
          return controlCompletion({
            verdicts: (packet?.claims ?? []).map(claim => ({
              claimId: claim.id,
              result: 'supported',
              resolution: 'affirmed',
              supportingEvidenceRefs: [...claim.evidenceRefs],
              reasonCode: 'entailed',
              note: 'Legacy loop fixture preserves its pre-existing asserted result.',
            })),
            uncoveredRequestParts: [],
          });
        }
        const completion = await target.createChatCompletion({
          ...request,
          messages: request.messages?.filter(message =>
            !(message.role === 'user' && typeof message.content === 'string' &&
              message.content.includes('BEGIN_AUDITED_GOALS_JSON'))),
        });
        const parsed = parseCompactResult(completion?.message?.content);
        if (parsed && typeof parsed.directAnswer === 'string') lastCompactResult = parsed;
        return completion;
      };
    },
  });
}
