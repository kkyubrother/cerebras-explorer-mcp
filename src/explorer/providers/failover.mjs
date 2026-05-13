import { AbstractChatClient } from './abstract.mjs';

function createAbortError(message = 'Failover request cancelled.') {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

/**
 * FailoverChatClient — tries providers in order, advancing on failure.
 *
 * Each provider is attempted with an optional per-call timeout. If a provider
 * throws or times out, the next one is tried. If all providers fail the last
 * error is re-thrown.
 *
 * Environment variables (when using createChatClient()):
 *   EXPLORER_FAILOVER             — comma-separated provider names, e.g. "cerebras,openai-compat"
 *   EXPLORER_FAILOVER_TIMEOUT_MS  — per-provider timeout in ms (default: 30000)
 */
export class FailoverChatClient extends AbstractChatClient {
  /**
   * @param {object} opts
   * @param {AbstractChatClient[]} opts.providers - Ordered list of provider instances.
   * @param {number} [opts.timeoutMs] - Per-provider timeout in milliseconds.
   */
  constructor({ providers, timeoutMs = 30000 } = {}) {
    super();
    if (!Array.isArray(providers) || providers.length === 0) {
      throw new Error('FailoverChatClient requires at least one provider.');
    }
    this._providers = providers;
    this._timeoutMs = timeoutMs;
  }

  get model() {
    return this._providers[0]?.model ?? 'unknown';
  }

  async createChatCompletion(opts = {}) {
    const callerSignal = opts.signal ?? null;
    if (callerSignal?.aborted) {
      throw createAbortError();
    }

    let lastError;
    for (const provider of this._providers) {
      // Create a per-provider AbortController so we can actually cancel the
      // underlying HTTP request when the timeout fires, instead of just racing
      // a promise and leaving a ghost request running in the background.
      const controller = new AbortController();
      let timeoutId;
      let rejectCallerAbort;

      const timeoutPromise = new Promise((_resolve, reject) => {
        timeoutId = setTimeout(() => {
          controller.abort();
          reject(new Error(`Provider timed out after ${this._timeoutMs}ms`));
        }, this._timeoutMs);
      });

      const callerAbortPromise = callerSignal
        ? new Promise((_resolve, reject) => {
            rejectCallerAbort = () => {
              controller.abort();
              reject(createAbortError());
            };
            callerSignal.addEventListener('abort', rejectCallerAbort, { once: true });
          })
        : null;

      try {
        const providerPromise = provider.createChatCompletion({
          ...opts,
          signal: controller.signal,
        });
        const races = callerAbortPromise
          ? [providerPromise, timeoutPromise, callerAbortPromise]
          : [providerPromise, timeoutPromise];
        return await Promise.race(races);
      } catch (error) {
        if (callerSignal?.aborted) {
          throw (error?.name === 'AbortError' ? error : createAbortError());
        }
        lastError = error;
      } finally {
        clearTimeout(timeoutId);
        if (callerSignal && rejectCallerAbort) {
          callerSignal.removeEventListener('abort', rejectCallerAbort);
        }
      }
    }
    throw lastError ?? new Error('All providers failed with unknown errors.');
  }
}
