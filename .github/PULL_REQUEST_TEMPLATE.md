## Summary

<!-- 1-3 sentences on what this PR does and why. -->

## Changes

<!-- bullets of concrete changes -->

## Doc impact

<!-- Check each that applies. If you leave a row unchecked, the change does not touch that surface. See AGENTS.md §"문서-코드 동기화 매트릭스" for the full mapping. -->

- [ ] `README.md` updated
- [ ] `DESIGN.md` updated
- [ ] `examples/expected-response.json` updated (reflect new schema fields / response strings)
- [ ] `CHANGELOG.md` entry added
- [ ] `benchmarks/adoption.json` updated
- [ ] `integrations/*/README.md` or `*.json.example` updated (tool surface or install ref changed)
- [ ] `package.json` `version` bumped (release PR)
- [ ] Closed plan in `docs/superpowers/plans/` is marked `[x]` and moved to `completed/`, OR deleted per `plan/README.md`

## Test plan

- [ ] `npm test` passes locally
- [ ] (If touching runtime reasoning) `node scripts/integration-test.mjs` with `CEREBRAS_API_KEY` passes — note this costs API credits and is optional

<!-- For the doc-code sync rules and anti-patterns, see AGENTS.md at the repo root. -->
