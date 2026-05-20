# v0.2.0 Release Finalization Tasks

> 상태: 과거 release-finalization 작업 기록입니다. 아래 Verification 수치는 2026-05-19 당시 완료 증거이며 현재 테스트 현황은 `TESTING.md`를 기준으로 확인합니다.

- [x] Audit version, changelog, and install-ref state.
- [x] Add release-finalization spec, plan, and task files.
- [x] Bump `package.json` version to `0.2.0`.
- [x] Bump MCP server info version to `0.2.0`.
- [x] Date `CHANGELOG.md` v0.2.0 as `2026-05-19`.
- [x] Update install refs in README and integration examples to `#v0.2.0`.
- [x] Update integration test expectations to `#v0.2.0`.
- [x] Run `npm test`.
- [x] Run `npm ls --depth=0 --json`.
- [x] Check for stale `v0.1.0` install refs and unreleased metadata.
- [x] Summarize final manual tag/publish steps.

## Verification

- `npm test`: 295 tests / 294 pass / 0 fail / 1 skip.
- `npm ls --depth=0 --json`: no runtime dependency tree entries.
- Stale active install refs and unreleased metadata check returned no matches.

## Remaining Manual Release Actions

- Commit the release-finalization changes.
- Create and push the `v0.2.0` git tag.
- Publish or draft GitHub release notes if desired.
