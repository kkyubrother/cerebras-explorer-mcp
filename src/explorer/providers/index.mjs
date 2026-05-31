import { CerebrasChatClient } from '../cerebras-client.mjs';
import { getExplorerModel } from '../config.mjs';
import { OpenAICompatChatClient } from './openai-compat.mjs';
import { FailoverChatClient } from './failover.mjs';

/**
 * Create a single provider instance by name.
 *
 * @param {string} name - Provider name: "cerebras", "openai-compat"
 * @param {object} opts
 * @param {Function} [opts.fetchImpl]
 * @param {Function} [opts.logger]
 */
function createProviderByName(name, { fetchImpl, logger } = {}) {
  switch (name.toLowerCase().trim()) {
    case 'cerebras':
      return new CerebrasChatClient({
        model: getExplorerModel(),
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
 * @param {object} [opts]
 * @param {Function} [opts.fetchImpl]
 * @param {Function} [opts.logger]
 * @returns {import('./abstract.mjs').AbstractChatClient}
 */
export function createChatClient({ fetchImpl, logger } = {}) {
  const failoverChain = process.env.EXPLORER_FAILOVER?.trim();

  if (failoverChain) {
    const names = failoverChain.split(',').filter(Boolean);
    const providers = names.map(name =>
      createProviderByName(name, { fetchImpl, logger }),
    );
    const timeoutMs = Number(process.env.EXPLORER_FAILOVER_TIMEOUT_MS) || 30000;
    return new FailoverChatClient({ providers, timeoutMs });
  }

  const providerName = process.env.EXPLORER_PROVIDER?.trim().toLowerCase() || 'cerebras';
  return createProviderByName(providerName, { fetchImpl, logger });
}

export { CerebrasChatClient, OpenAICompatChatClient, FailoverChatClient };
