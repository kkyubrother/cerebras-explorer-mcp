import { DEFAULT_PROTOCOL_VERSION, getExplorerModel } from '../explorer/config.mjs';
import { exploreRepository } from '../explorer/runtime.mjs';
import { EXPLORE_REPO_INPUT_SCHEMA, validateExploreRepoArgs } from '../explorer/schemas.mjs';
import { StdioJsonRpcServer } from './jsonrpc-stdio.mjs';

const SERVER_INFO = {
  name: 'cerebras-explorer-mcp',
  version: '0.1.0',
};

const TOOL_DEFINITION = {
  name: 'explore_repo',
  title: 'Autonomous repository explorer',
  description:
    'Delegates read-only codebase exploration to a standalone Cerebras explorer agent. The parent model gives one high-level task; the explorer performs its own search/read loop and returns structured findings.',
  inputSchema: EXPLORE_REPO_INPUT_SCHEMA,
  outputSchema: {
    type: 'object',
    properties: {
      answer: { type: 'string' },
      summary: { type: 'string' },
      confidence: { type: 'string' },
      evidence: { type: 'array' },
      candidatePaths: { type: 'array' },
      followups: { type: 'array' },
      stats: { type: 'object' },
    },
    required: ['answer', 'summary', 'confidence', 'evidence', 'candidatePaths', 'followups', 'stats'],
  },
};

export function createMcpRequestHandler({ logger = () => {}, runtimeOptions = {} } = {}) {
  let negotiatedProtocolVersion = DEFAULT_PROTOCOL_VERSION;

  async function handleRequest(message) {
    switch (message.method) {
      case 'initialize': {
        const requestedVersion = message.params?.protocolVersion;
        if (typeof requestedVersion === 'string' && requestedVersion.trim()) {
          negotiatedProtocolVersion = requestedVersion;
        }
        return {
          protocolVersion: negotiatedProtocolVersion,
          capabilities: {
            tools: {
              listChanged: false,
            },
          },
          serverInfo: SERVER_INFO,
          instructions:
            `This MCP server exposes one high-level tool, explore_repo. It uses the Cerebras ${getExplorerModel()} model and performs an internal read-only repository exploration loop before returning a structured answer.`,
        };
      }
      case 'ping':
        return {};
      case 'tools/list':
        return { tools: [TOOL_DEFINITION] };
      case 'tools/call': {
        const name = message.params?.name;
        if (name !== 'explore_repo') {
          const error = new Error(`Unknown tool: ${name}`);
          error.code = -32601;
          throw error;
        }

        const args = message.params?.arguments ?? {};
        try {
          validateExploreRepoArgs(args);
        } catch (error) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `Invalid explore_repo arguments: ${error.message}`,
              },
            ],
          };
        }

        const result = await exploreRepository(args, { logger, ...runtimeOptions });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
          structuredContent: result,
        };
      }
      default: {
        const error = new Error(`Method not found: ${message.method}`);
        error.code = -32601;
        throw error;
      }
    }
  }

  async function handleNotification(message) {
    if (
      message.method === 'notifications/initialized' ||
      message.method === 'notifications/cancelled'
    ) {
      return;
    }
    logger(`Ignoring notification: ${message.method}`);
  }

  return {
    handleRequest,
    handleNotification,
  };
}

export function startMcpServer({ logger = () => {}, runtimeOptions = {} } = {}) {
  const { handleRequest, handleNotification } = createMcpRequestHandler({
    logger,
    runtimeOptions,
  });

  const transport = new StdioJsonRpcServer({
    logger,
    handleRequest,
    handleNotification,
  });

  transport.start();
  return transport;
}
