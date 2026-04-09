# GLM 4.7 migration notes for cerebras-explorer-mcp-master

## Files changed
- `src/explorer/config.mjs`
- `src/explorer/cerebras-client.mjs`
- `src/explorer/providers/openai-compat.mjs`
- `src/explorer/providers/abstract.mjs`
- `src/explorer/runtime.mjs`
- `README.md`
- `DESIGN.md`
- `tests/cerebras-client.test.mjs`
- `tests/providers.test.mjs`
- `tests/runtime.mock.test.mjs`

## Functional changes
1. **GLM 4.7 reasoning control alignment**
   - `quick` budget now sends `reasoning_effort="none"`
   - `normal` / `deep` budgets omit `reasoning_effort` for GLM 4.7 instead of sending unsupported `low` / `medium`
   - GPT-OSS still uses the `low` / `medium` / `high` ladder

2. **Preserved thinking support**
   - `clear_thinking=false` is enabled by default for `zai-glm-4.7`
   - assistant `reasoning` is captured from responses and forwarded into later turns

3. **Sampling defaults updated**
   - explorer default `temperature` changed to `1`
   - explorer default `top_p` changed to `0.95`

4. **Reasoning parsing**
   - GLM 4.7 requests now explicitly use parsed reasoning handling
   - normalized response objects expose `reasoning` / `rawReasoning`

5. **Cross-provider safety**
   - OpenAI-compatible provider strips assistant `reasoning` before sending messages to providers that do not accept it

6. **Docs fixes**
   - removed stale `zai-glm-4.6` references in design notes
   - corrected `clear_thinking` support notes
   - documented optional env overrides for temperature, top_p, and clear_thinking

## Validation
- Test suite result: **96 / 96 passing**
