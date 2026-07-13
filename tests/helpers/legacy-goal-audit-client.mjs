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
  return null;
}

function controlCompletion(value) {
  return {
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    finishReason: 'stop',
    message: { content: JSON.stringify(value), toolCalls: [] },
  };
}

/**
 * Lets pre-spec-028 provider scripts keep testing the exploration loop while
 * the real runtime still executes its required isolated planner and auditor.
 */
export function adaptLegacyGoalAuditClient(chatClient) {
  if (!chatClient) return chatClient;
  return new Proxy(chatClient, {
    get(target, property, receiver) {
      if (property !== 'createChatCompletion') {
        return Reflect.get(target, property, receiver);
      }
      return async request => {
        const kind = controlKind(request);
        if (kind === 'planner') {
          const packet = parseControlPacket(request.messages);
          const task = packet?.control?.task ?? '';
          return controlCompletion({
            taskSummary: 'Legacy runtime behavior under test.',
            constraints: [],
            subgoals: [{
              id: 'legacy-test-goal',
              question: 'Complete the requested repository investigation.',
              originRefs: [`request:0-${task.length}`],
              claimType: 'positive',
              proofCondition: 'Observe repository evidence that answers the requested investigation.',
              constraints: [],
            }],
          });
        }
        if (kind === 'goal_audit') {
          const packet = parseControlPacket(request.messages);
          return controlCompletion({
            goals: packet.proposals.map(goal => ({
              proposedGoalId: goal.id,
              verdict: 'ready',
              originRefs: [...goal.originRefs],
              missingRequestParts: [],
              reason: 'Retained for the legacy behavior test.',
            })),
            uncoveredRequestParts: [],
          });
        }
        return target.createChatCompletion({
          ...request,
          messages: request.messages?.filter(message =>
            !(message.role === 'user' && typeof message.content === 'string' &&
              message.content.includes('BEGIN_AUDITED_GOALS_JSON'))),
        });
      };
    },
  });
}
