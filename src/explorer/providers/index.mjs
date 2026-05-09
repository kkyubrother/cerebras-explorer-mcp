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
 * variables and the optional budget hint.
 *
 * Provider selection:
 *   1. If EXPLORER_FAILOVER is set, builds a FailoverChatClient from the chain.
 *   2. Otherwise reads EXPLORER_PROVIDER (default: "cerebras").
 *
 * Budget-based model routing (Cerebras only):
 *   Reads CEREBRAS_EXPLORER_MODEL_QUICK / _NORMAL / _DEEP according to `budget`.
 *   Requires CEREBRAS_EXPLORER_AUTO_ROUTE=true or explicit budget env vars to differ.
 *
 * @param {object} [opts]
 * @param {string} [opts.budget]     - "quick"|"normal"|"deep" for model routing
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
