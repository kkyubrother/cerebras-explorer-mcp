# Quickstart: Explorer Trust and Surface Hygiene

## Verify Red Phase

Run targeted tests after adding the new assertions and before production changes:

```bash
node --test tests/critic.test.mjs tests/schemas.test.mjs tests/runtime.mock.test.mjs tests/mcp-server.test.mjs tests/transcript.test.mjs tests/providers.test.mjs
```

Expected before implementation: new tests fail for grep/blame exactness, malformed range coercion, trust caveats, `critic.warnings`, discovered path omission signaling, compact transcript diagnostics, and failover attribution.

## Verify Green Phase

After implementation and docs/examples updates:

```bash
npm test
```

If `CEREBRAS_API_KEY` is set and runtime inference paths changed, optionally run:

```bash
node scripts/integration-test.mjs
```

## Manual Checks

- `package.json` still has no `dependencies` or `devDependencies`.
- Public tools remain exactly: `explore_repo`, six wrappers, and `explore`.
- `explore_repo` input schema still has no `budget`.
- README, DESIGN, and `examples/expected-response.json` match the compact response contract.
- Stderr ops summary no longer prints the full local transcript path by default.
