import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function read(relPath) {
  return fs.readFile(path.join(ROOT, relPath), 'utf8');
}

test('JSON integration examples are parseable', async () => {
  const examples = [
    'integrations/claude/.mcp.json.example',
    'integrations/claude-desktop/claude_desktop_config.json.example',
    'integrations/cursor/mcp.json.example',
    'integrations/gemini/settings.json.example',
    'integrations/opencode/opencode.json.example',
  ];

  for (const relPath of examples) {
    const raw = await read(relPath);
    assert.doesNotThrow(() => JSON.parse(raw), `${relPath} must parse as JSON`);
  }
});

test('Gemini example documents required env and a narrow tool allowlist', async () => {
  const settings = JSON.parse(await read('integrations/gemini/settings.json.example'));
  const server = settings.mcpServers?.['cerebras-explorer'];
  assert.ok(server, 'Gemini server alias should be cerebras-explorer');
  assert.equal(server.command, 'npx');
  assert.deepEqual(server.args, ['-y', 'github:kkyubrother/cerebras-explorer-mcp#v0.1.0']);
  assert.equal(server.env?.CEREBRAS_API_KEY, '$CEREBRAS_API_KEY');
  assert.deepEqual(server.includeTools, [
    'explore_repo',
    'find_relevant_code',
    'trace_symbol',
    'map_change_impact',
  ]);

  const readme = await read('integrations/gemini/README.md');
  assert.match(readme, /\*KEY\*/);
  assert.match(readme, /CEREBRAS_API_KEY/);
  assert.match(readme, /excludeTools/);
  assert.match(readme, /cerebras-explorer/);
  assert.match(readme, /cerebras_explorer.*피하세요/);
  assert.doesNotMatch(JSON.stringify(settings), /cerebras_explorer/);
});

test('Codex example uses npx and tool allowlist controls', async () => {
  const toml = await read('integrations/codex/config.toml.example');
  assert.match(toml, /command = "npx"/);
  assert.match(toml, /github:kkyubrother\/cerebras-explorer-mcp#v0\.1\.0/);
  assert.match(toml, /startup_timeout_sec = 60/);
  assert.match(toml, /tool_timeout_sec = 60/);
  assert.match(toml, /enabled_tools = \[/);
  assert.match(toml, /disabled_tools = \["explore_v2"\]/);
  assert.match(toml, /CEREBRAS_API_KEY = "\$\{CEREBRAS_API_KEY\}"/);
  assert.doesNotMatch(toml, /absolute\/path/);

  const agents = await read('integrations/codex/AGENTS.md.example');
  assert.match(agents, /enabled_tools/);
  assert.match(agents, /disabled_tools/);
});

test('documented install refs do not point at missing main branch', async () => {
  const docs = [
    'README.md',
    'integrations/claude-desktop/README.md',
    'integrations/continue/README.md',
    'integrations/cursor/README.md',
    'integrations/gemini/README.md',
    'integrations/opencode/README.md',
  ];

  for (const relPath of docs) {
    assert.doesNotMatch(await read(relPath), /github:kkyubrother\/cerebras-explorer-mcp#main\b/, relPath);
  }
});

test('Continue YAML example keeps the expected MCP shape', async () => {
  const yaml = await read('integrations/continue/config.yaml.example');
  assert.match(yaml, /^mcpServers:/m);
  assert.match(yaml, /name: cerebras-explorer/);
  assert.match(yaml, /command: npx/);
  assert.match(yaml, /github:kkyubrother\/cerebras-explorer-mcp#v0\.1\.0/);
  assert.match(yaml, /CEREBRAS_API_KEY/);
});
