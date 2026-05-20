# v0.2.0 Release Finalization Plan

> 상태: 과거 release-finalization 작업 계획입니다. 현재 backlog나 최신 검증 결과를 의미하지 않습니다.

## Scope

This is a release hygiene pass, not a feature implementation. It does not add protocol behavior or change the v0.2.x backlog.

## Steps

1. Audit current release state.
2. Add this lightweight spec folder for the release-finalization work.
3. Update package/server version metadata and changelog date.
4. Update install refs and integration tests to `#v0.2.0`.
5. Run release verification.
6. Record remaining manual release actions.

## Out Of Scope

- Creating or pushing git tags.
- Publishing to npm.
- Implementing v0.2.x backlog items.
