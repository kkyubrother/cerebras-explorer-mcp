function parseHeaders(headerText) {
  const headers = {};
  const lines = headerText.split('\r\n');
  for (const line of lines) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    headers[key] = value;
  }
  return headers;
}

export class StdioJsonRpcServer {
  constructor({ logger = () => {}, handleRequest, handleNotification }) {
    this.logger = logger;
    this.handleRequest = handleRequest;
    this.handleNotification = handleNotification;
    this.buffer = Buffer.alloc(0);
  }

  start() {
    process.stdin.on('data', chunk => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.processBuffer().catch(error => {
        this.logger(`Failed to process MCP input: ${error.stack || error.message}`);
      });
    });

    process.stdin.on('end', () => {
      process.exit(0);
    });
  }

  async processBuffer() {
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) {
        return;
      }

      const headerText = this.buffer.subarray(0, headerEnd).toString('utf8');
      const headers = parseHeaders(headerText);
      const contentLength = Number.parseInt(headers['content-length'] || '', 10);
      if (!Number.isFinite(contentLength)) {
        throw new Error('Missing or invalid Content-Length header.');
      }

      const messageStart = headerEnd + 4;
      const messageEnd = messageStart + contentLength;
      if (this.buffer.length < messageEnd) {
        return;
      }

      const body = this.buffer.subarray(messageStart, messageEnd).toString('utf8');
      this.buffer = this.buffer.subarray(messageEnd);

      let message;
      try {
        message = JSON.parse(body);
      } catch (error) {
        this.logger(`Ignoring malformed JSON-RPC payload: ${error.message}`);
        continue;
      }

      await this.dispatchMessage(message);
    }
  }

  async dispatchMessage(message) {
    if (message && typeof message === 'object' && 'method' in message) {
      if ('id' in message) {
        const result = await this.handleRequest(message).catch(error => ({
          __error: true,
          code: error.code ?? -32603,
          message: error.message || 'Internal server error',
        }));

        if (result && result.__error) {
          this.send({
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: result.code,
              message: result.message,
            },
          });
          return;
        }

        this.send({
          jsonrpc: '2.0',
          id: message.id,
          result: result ?? {},
        });
        return;
      }

      if (this.handleNotification) {
        await this.handleNotification(message);
      }
    }
  }

  send(payload) {
    const json = JSON.stringify(payload);
    const message = `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\nContent-Type: application/json\r\n\r\n${json}`;
    process.stdout.write(message);
  }
}
