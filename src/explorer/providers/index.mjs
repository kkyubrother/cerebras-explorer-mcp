import { CerebrasChatClient } from '../cerebras-client.mjs';
import { getModelForBudget, isTruthyEnv } from '../config.mjs';
import { OpenAICompatChatClient } from './openai-compat.mjs';
import { FailoverChatClient } from './failover.mjs';

/**
 * Create a single provider instance by name.
 *
 * @param {string} name - Provider name: "cerebras", "openai-compat"
 * @param {object} opts
 * @param {string} [opts.budget]     - Budget label for budget-based model routing
 * @param {Function} [opts.fetchImpl]
 * @param {Function} [opts.logger]
 */
function createProviderByName(name, { budget, fetchImpl, logger } = {}) {
  switch (name.toLowerCase().trim()) {
    case 'cerebras':
      return new CerebrasChatClient({
        model: getModelForBudget(budget),
        fetchImpl,
        logger,
      });
    case 'openai-compat':
      return new OpenAICompatChatClient({ fetchImpl, logger });
    default:
      throw new Error(`Unknown provider: "${name}". Valid providers: cerebras, openai-compat`);
  }
}

/**
 * Factory function — creates the appropriate chat client based on environment
 * variables.
 *
 * Provider selection:
 *   1. If EXPLORER_FAILOVER is set, builds a FailoverChatClient from the chain.
 *   2. Otherwise reads EXPLORER_PROVIDER (default: "cerebras").
 *
 * The `budget` option is accepted for back-compat with internal callers but
 * is a no-op since spec 011: every explore call uses the single
 * CEREBRAS_EXPLORER_MODEL. Budget-specific model env vars
 * (_QUICK/_NORMAL/_DEEP) and CEREBRAS_EXPLORER_AUTO_ROUTE were permanently
 * removed; budget labels now represent internal resource guardrails only.
 *
 * @param {object} [opts]
 * @param {string} [opts.budget]     - accepted but ignored (spec 011)
 * @param {Function} [opts.fetchImpl]
 * @param {Function} [opts.logger]
 * @returns {import('./abstract.mjs').AbstractChatClient}
 */
export function createChatClient({ budget, fetchImpl, logger } = {}) {
  const failoverChain = process.env.EXPLORER_FAILOVER?.trim();

  if (failoverChain) {
    const names = failoverChain.split(',').filter(Boolean);
    const providers = names.map(name =>
      createProviderByName(name, { budget, fetchImpl, logger }),
    );
    const timeoutMs = Number(process.env.EXPLORER_FAILOVER_TIMEOUT_MS) || 30000;
    return new FailoverChatClient({ providers, timeoutMs });
  }

  const providerName = process.env.EXPLORER_PROVIDER?.trim().toLowerCase() || 'cerebras';
  return createProviderByName(providerName, { budget, fetchImpl, logger });
}

export { CerebrasChatClient, OpenAICompatChatClient, FailoverChatClient };
