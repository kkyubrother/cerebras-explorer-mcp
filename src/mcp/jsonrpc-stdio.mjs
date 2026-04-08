function parseHeaders(headerText) {
  const headers = {};
  const lines = headerText.split(/\r?\n/);
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
    this.useNdjson = false; // set to true when client uses NDJSON format
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
      // Detect transport format: Content-Length framing vs newline-delimited JSON (NDJSON)
      const firstByte = this.buffer.length > 0 ? this.buffer[0] : -1;
      const isNdjson = firstByte === 0x7b; // starts with '{'

      if (isNdjson) {
        this.useNdjson = true;
        // NDJSON: each message is a JSON object terminated by '\n'
        const newlinePos = this.buffer.indexOf('\n');
        if (newlinePos < 0) {
          return; // wait for more data
        }
        const body = this.buffer.subarray(0, newlinePos).toString('utf8').trim();
        this.buffer = this.buffer.subarray(newlinePos + 1);
        if (!body) continue;
        let message;
        try {
          message = JSON.parse(body);
        } catch (error) {
          this.logger(`Ignoring malformed NDJSON payload: ${error.message}`);
          continue;
        }
        await this.dispatchMessage(message);
      } else {
        // Content-Length framing (legacy)
        const crlfHeaderEnd = this.buffer.indexOf('\r\n\r\n');
        const lfHeaderEnd = this.buffer.indexOf('\n\n');
        const hasCrLfHeaders = crlfHeaderEnd >= 0 && (lfHeaderEnd < 0 || crlfHeaderEnd <= lfHeaderEnd);
        const headerEnd = hasCrLfHeaders ? crlfHeaderEnd : lfHeaderEnd;
        if (headerEnd < 0) {
          return;
        }

        const headerText = this.buffer.subarray(0, headerEnd).toString('utf8');
        const headers = parseHeaders(headerText);
        const contentLength = Number.parseInt(headers['content-length'] || '', 10);
        if (!Number.isFinite(contentLength)) {
          throw new Error('Missing or invalid Content-Length header.');
        }

        const messageStart = headerEnd + (hasCrLfHeaders ? 4 : 2);
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
    if (this.useNdjson) {
      process.stdout.write(json + '\n');
    } else {
      const message = `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\nContent-Type: application/json\r\n\r\n${json}`;
      process.stdout.write(message);
    }
  }
}
