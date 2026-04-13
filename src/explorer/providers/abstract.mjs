/**
 * AbstractChatClient — interface contract for all chat providers.
 *
 * Every concrete provider must implement `createChatCompletion` and expose
 * a `model` property. The return shape is used throughout the explorer
 * runtime, so deviating from it will break exploration.
 */
export class AbstractChatClient {
  /** @returns {string} The model identifier in use. */
  get model() {
    throw new Error('AbstractChatClient.model must be overridden.');
  }

  /**
   * Send a chat completion request and return a normalised response.
   *
   * @param {object} opts
   * @param {Array}  opts.messages             - Chat history (role/content pairs)
   * @param {Array}  [opts.tools]              - Tool definitions (OpenAI function-call format)
   * @param {object} [opts.responseFormat]     - Structured-output schema
   * @param {string} [opts.reasoningEffort]    - Provider-specific reasoning control
   * @param {string} [opts.reasoningFormat]    - parsed|raw|hidden when supported
   * @param {boolean}[opts.clearThinking]      - Preserve prior reasoning when supported
   * @param {number} [opts.temperature]        - Sampling temperature
   * @param {number} [opts.topP]               - Nucleus sampling parameter
   * @param {number} [opts.maxCompletionTokens]
   * @param {boolean}[opts.parallelToolCalls]  - Allow simultaneous tool calls
   * @param {AbortSignal} [opts.signal]        - Cancellation signal; aborts the underlying HTTP request
   *
   * @returns {Promise<{
   *   id: string,
   *   usage: object|null,
   *   finishReason: string|null,
   *   message: {
   *     role: string,
   *     content: string,
   *     rawContent: any,
   *     reasoning?: string,
   *     rawReasoning?: any,
   *     toolCalls: Array<{id, type, function: {name, arguments}}>
   *   }
   * }>}
   */
  async createChatCompletion(_opts) {
    throw new Error('AbstractChatClient.createChatCompletion must be overridden.');
  }
}
