import { OpenAICompatChatClient } from './openai-compat.mjs';

/**
 * Ollama local-model client.
 *
 * Uses Ollama's OpenAI-compatible `/v1/chat/completions` endpoint
 * (available in Ollama ≥ 0.1.29). No authentication is required.
 *
 * Environment variables (when using createChatClient()):
 *   EXPLORER_OLLAMA_BASE_URL  — default: http://localhost:11434/v1
 *   EXPLORER_OLLAMA_MODEL     — default: llama3
 */
export class OllamaChatClient extends OpenAICompatChatClient {
  constructor({
    baseUrl = process.env.EXPLORER_OLLAMA_BASE_URL || 'http://localhost:11434/v1',
    model = process.env.EXPLORER_OLLAMA_MODEL || 'llama3',
    fetchImpl = globalThis.fetch,
    logger = () => {},
  } = {}) {
    super({
      apiKey: 'ollama',  // Ollama doesn't validate the auth header, but the field is required
      baseUrl,
      model,
      fetchImpl,
      logger,
    });
  }
}
