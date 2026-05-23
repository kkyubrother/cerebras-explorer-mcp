# Implementation Plan: repo-specific ignore 정책 강화

**Branch**: `master` (직접 작업, 솔로 유지보수) | **Date**: 2026-05-24 | **Spec**: `specs/014-repo-specific-ignore/spec.md`

**Input**: Feature specification from `specs/014-repo-specific-ignore/spec.md`

## Summary

`RepoToolkit`의 ignore 평가에 두 가지를 더한다: (1) traversal 도중 발견한 nested `.gitignore`를 그 디렉토리 prefix 안에서만 적용하는 matcher, (2) `.cerebras-explorer.json`의 신규 `extraIgnorePatterns` 키로 path glob 단위 ignore. 두 변경 모두 backwards-compatible — 기존 `.gitignore`/config 없는 저장소는 동작이 변하지 않는다. secret deny-list와 scope 검증은 항상 더 강한 우선순위를 유지한다.

기술 접근은 기존 `loadGitignoreRules` / `buildGitignoreMatcher` / `shouldIgnorePath` 구조를 재사용한다. 매처 평가 순서는 spec FR-008의 8단계로 명시하고, nested matcher 배열을 `RepoToolkit` 내부 상태로 lazy-build한다. nested matcher의 빌드 시점은 traversal 첫 호출 시점이며, 이후 같은 RepoToolkit 인스턴스 내에서 캐시된다.

`extraIgnorePatterns`는 root `.gitignore`와 동일 시맨틱(`globToRegExp`/prefix 매치 두 가지 분기)으로 평가한다. config 로더(`normalizeProjectConfig`)는 기존 `extraIgnoreDirs` 정책 그대로 string-array 검증 + non-string filter.

## Technical Context

**Language/Version**: Node.js (ES modules, `.mjs`), 저장소 기본 런타임을 따른다.

**Primary Dependencies**: 추가 의존성 없음. `node:fs/promises`, `node:path`, 기존 helper(`globToRegExp`, `toPosix`).

**Storage**: N/A (코드 + 문서 + 단위 테스트)

**Testing**: `npm test` 전체, 핵심 회귀는 `node --test tests/repo-tools.test.mjs`, `node --test tests/project-config.test.mjs`.

**Target Platform**: Node.js 런타임.

**Project Type**: MCP 서버 라이브러리.

**Performance Goals**: nested matcher 평가는 path가 nested 디렉토리 prefix와 매치할 때만 매처 함수를 실행 — 평균 O(매치 nested 수) 추가 비용. 모노레포 일반 케이스(수십 개 nested `.gitignore`)에서 traversal 속도 저하 없음.

**Constraints**:
- secret deny-list와 scope 검증은 항상 ignore 정책보다 강하다.
- nested `.gitignore`의 부정 규칙(`!`)은 본 spec에서 silently dropped.
- 환경변수 표면 추가 금지 (spec 011 정책 계승).
- `.cerebras-explorer.json` 스키마 변경은 additive만 (기존 키 의미 불변).
- backwards-compatible — `.gitignore`/config 없는 저장소 결과 불변.

**Scale/Scope**: `src/explorer/repo-tools.mjs` ~60 라인 추가/수정, `src/explorer/config.mjs` ~10 라인 추가, `src/explorer/runtime.mjs`에서 config → toolkit 전달 ~3 라인, `tests/repo-tools.test.mjs` ~120 라인 신규 테스트, `tests/project-config.test.mjs` ~30 라인 신규, README + DESIGN ~20 라인 갱신.

## Constitution Check

본 저장소는 별도 constitution을 두지 않으므로 spec의 FR/SC와 spec 011·005 메모리, secret/scope 가드 정책을 게이트로 적용한다.

- **FR-001 ~ FR-004 게이트**: nested matcher 추가가 root matcher와 동일 파서 재사용. 부정 규칙 무시.
- **FR-005 ~ FR-007 게이트**: config 스키마 additive 확장. 기존 `extraIgnoreDirs` 동작 불변.
- **FR-008 ~ FR-010 게이트**: 평가 순서 명시 + secret/scope 우선순위 유지 + backwards-compatible.
- **FR-011 게이트**: 단위 테스트 5종 추가.
- **FR-012 게이트**: README/DESIGN 갱신.
- **FR-013 게이트**: `npm test` 0 failures.
- **FR-014 게이트**: backlog 갱신.
- **범위 게이트**: 환경변수 추가 금지, `.npmignore`/`.dockerignore` 자동 지원 안 함.

게이트 평가 결과: 위반 없음.

## Project Structure

### Documentation (this feature)

```text
specs/014-repo-specific-ignore/
├── spec.md
├── plan.md
└── tasks.md
```

### Source Code (repository root)

```text
src/explorer/repo-tools.mjs    # loadGitignoreRules 재사용 + nested matcher 빌드/평가 + extraIgnorePatterns 매처 + shouldIgnorePath 순서 갱신
src/explorer/config.mjs        # normalizeProjectConfig에 extraIgnorePatterns 인식 + JSDoc 갱신
src/explorer/runtime.mjs       # projectConfig.extraIgnorePatterns를 RepoToolkit 생성자에 전달 (3 라인)
tests/repo-tools.test.mjs      # nested gitignore + extraIgnorePatterns + secret 우선순위 단위 테스트
tests/project-config.test.mjs  # config 로더의 extraIgnorePatterns normalization 단위 테스트
README.md                      # "현재 제한 사항"의 .gitignore 문구 갱신
DESIGN.md                      # 정책 우선순위 도식 한 곳에 명시
plan/extension-backlog.md      # #3 진행 완료 표시
```

**Structure Decision**: 단일 프로젝트, 신규 모듈 없음. nested matcher는 `RepoToolkit` 인스턴스 상태로만 보관.

## Implementation Outline

(a) **`loadGitignoreRules`를 재사용 가능하게 분리**: 기존 함수는 `path.join(root, '.gitignore')`만 본다. 새 helper `loadGitignoreRulesAt(absDir)`를 추출해서 임의 디렉토리에서도 호출 가능하게 한다. 기존 `loadGitignoreRules(root)`는 `loadGitignoreRulesAt(root)`로 위임.

(b) **`buildGitignoreMatcher` 확장**: 기존 함수가 받는 rules를 prefix-aware matcher로 만드는 helper 추가. `buildNestedGitignoreMatcher(prefix, rules)` — prefix는 POSIX 상대 디렉토리 경로(끝에 `/` 포함), matcher는 `(relPath) => relPath.startsWith(prefix) && innerMatch(relPath.slice(prefix.length))`.

(c) **`RepoToolkit`에 nested matcher 목록 추가**: 생성자에 `this.nestedGitignoreMatchers = []`. `initialize()` 또는 traversal 첫 호출 시 walk 함수가 `.gitignore` 파일을 만날 때마다 그 디렉토리 prefix와 rules로 matcher를 build해서 list에 push. 같은 디렉토리에 대한 중복 build 방지를 위해 build된 prefix Set를 함께 관리.

(d) **`extraIgnorePatterns` 매처**: 생성자에 `extraIgnorePatterns` 인자를 받고 root와 동일한 `buildGitignoreMatcher`로 묶어 단일 matcher 저장(`this.extraPatternMatcher`). 빈 배열이면 `null`.

(e) **`shouldIgnorePath` 순서 갱신**: 현재 분기에 다음 두 단계 추가 (root matcher 다음):
   - nested matcher 평가: for each nested matcher: `if (m(relPath)) return true`.
   - extraPattern matcher 평가: `if (this.extraPatternMatcher && this.extraPatternMatcher(relPath)) return true`.

(f) **`config.mjs`의 `normalizeProjectConfig` 확장**: `extraIgnorePatterns` 키를 string array로 인식, 기존 `extraIgnoreDirs` 정책 그대로 (filter, drop non-string). JSDoc 갱신.

(g) **`runtime.mjs`에서 RepoToolkit 생성자 호출 갱신**: `projectConfig.extraIgnorePatterns ?? []`를 `RepoToolkit({ extraIgnorePatterns, ... })`로 전달.

(h) **부정 규칙 silent drop**: `loadGitignoreRulesAt`에서 `!`로 시작하는 라인은 `filter(line => !line.startsWith('!'))`로 제거. 이는 root에도 동일하게 적용되지만 root에서는 이미 거의 영향 없음.

(i) **단위 테스트 5종 추가**:
   - nested matcher prefix-bounded: `packages/foo/.gitignore`의 `build/`가 `packages/bar/build/`에 영향 X.
   - root + nested 공존: 두 매처 모두 활성.
   - `extraIgnorePatterns` glob: `tmp/**`, `**/*.snapshot.json` 등 매치.
   - secret deny-list 우선순위: `extraIgnorePatterns` 부정 표현 시도해도 `.env` 등은 여전히 제외.
   - backwards-compatible: `.gitignore`/config 없는 fixture는 본 spec 변경 후에도 결과 동일.

(j) **README + DESIGN 갱신**: README "현재 제한 사항"의 `.gitignore` 한 줄을 nested + extraIgnorePatterns 안내로 갱신. DESIGN.md 보안/탐색 단락에 spec FR-008 정책 우선순위 도식 추가.

(k) **`plan/extension-backlog.md` 갱신**: #3 항목 옆에 "→ spec 014로 완료" 한 줄 추가.

(l) **검증**: `npm test` 전체 0 failures. (옵션) `npm run benchmark`로 benchmark 결과가 본 spec 변경 후에도 동일한지 확인.

(m) **커밋**: 단일 commit. 메시지: `feat(spec-014): nested .gitignore + extraIgnorePatterns for repo-specific ignore`.

## Complexity Tracking

- **Nested matcher의 prefix 매칭 비용**: 모노레포의 모든 nested `.gitignore`가 단일 list에 들어가 path마다 매처를 평가. 매처는 prefix 검사를 먼저 하므로 평균적으로 빠르게 단락. 매처 수가 수천 개로 늘면 회귀 가능성 있지만 본 spec 범위 밖.
- **`!negation` 무시의 사용자 혼란**: nested `.gitignore`에 `!keep` 같은 라인이 있으면 git과 본 도구의 결과가 다를 수 있다. README/DESIGN에 "부정 규칙은 본 도구 범위 밖" 한 줄 명시로 대응.
- **`extraIgnorePatterns`의 잘못된 패턴**: glob syntax가 아닌 raw text가 들어가면 `buildGitignoreMatcher`가 prefix 매치로 떨어진다 (기존 동작 계승). 잘못된 정규식 throw는 발생하지 않음.
- **회귀 가드**: 기존 benchmark가 본 변경의 영향을 받지 않는지 확인. benchmark fixture에 `.cerebras-explorer.json`이나 nested `.gitignore`가 없으면 결과 불변. fixture 검토 후 필요시 회귀 benchmark 추가.
