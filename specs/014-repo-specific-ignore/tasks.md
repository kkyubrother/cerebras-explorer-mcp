---
description: "Task list for spec 014 — repo-specific ignore 정책 강화"
---

# Tasks: repo-specific ignore 정책 강화

**Input**: Design documents from `specs/014-repo-specific-ignore/`

**Prerequisites**: `specs/014-repo-specific-ignore/spec.md`, `specs/014-repo-specific-ignore/plan.md`

**Tests**: Required. nested matcher + extraIgnorePatterns + secret 우선순위 유지를 단위 테스트로 가드한다.

**Organization**: User story 단위.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 다른 파일을 만지고 선행 의존성이 없으면 병렬 가능
- **[Story]**: US1 = nested `.gitignore`, US2 = `extraIgnorePatterns`, US3 = secret/scope 우선순위 가드
- 모든 경로는 저장소 루트 기준 상대 경로.

## Path Conventions

- 단일 프로젝트, 신규 모듈 없음.
- 코드: `src/explorer/repo-tools.mjs`, `src/explorer/config.mjs`, `src/explorer/runtime.mjs`.
- 테스트: `tests/repo-tools.test.mjs`, `tests/project-config.test.mjs`.
- 문서: `README.md`, `DESIGN.md`, `plan/extension-backlog.md`.

---

## Phase 1: Setup

- [x] T001 master 작업 트리가 깨끗한지 확인 (`git status` clean). 기존 단위 테스트가 0 failures인지 baseline 확인 (`npm test`).

---

## Phase 2: User Story 1 — Nested `.gitignore` (P1)

- [x] T002 [US1] `src/explorer/repo-tools.mjs`에서 `loadGitignoreRules(root)`를 `loadGitignoreRulesAt(absDir)`로 분리한다. 기존 함수는 `loadGitignoreRulesAt(root)`로 위임하는 한 줄. 부정 규칙(`!`로 시작) 라인은 silently filter out.

- [x] T003 [US1] `buildGitignoreMatcher` 옆에 `buildNestedGitignoreMatcher(prefix, rules)` helper 추가. prefix는 POSIX 상대 디렉토리 경로(끝에 `/` 포함). matcher는 `relPath.startsWith(prefix)` 단락 검사 후 prefix 제거한 inner path에 기존 `buildGitignoreMatcher` 결과 적용.

- [x] T004 [US1] `RepoToolkit` 생성자에 `this.nestedGitignoreMatchers = []`, `this.nestedGitignoreBuiltFor = new Set()` 추가. traversal walker(`walkFiles`/`walkDirectories`)가 `.gitignore` 파일을 만날 때 `loadGitignoreRulesAt(absDir)` + `buildNestedGitignoreMatcher(relativeDirPrefix, rules)`로 matcher를 build해서 list에 push. 같은 디렉토리 중복 build 방지(Set으로).

- [x] T005 [US1] `shouldIgnorePath`에 nested matcher 평가 단계 추가 (root matcher 다음). `for (const m of nestedMatchers) if (m(relPath)) return true;`.

- [x] T006 [US1] `tests/repo-tools.test.mjs`에 신규 단위 테스트 추가: (a) `packages/foo/.gitignore`의 `build/`가 `packages/foo/build/output.txt`를 제외하고 `packages/bar/build/output.txt`는 그대로 노출됨, (b) root `.gitignore`의 `*.log`와 nested `.gitignore`의 `build/`가 동시에 적용됨, (c) 부정 규칙(`!keep`)이 silently dropped (matcher에 포함되지 않음).

- [x] T007 [US1] `node --test tests/repo-tools.test.mjs` 단독 실행으로 신규 3개 테스트가 모두 PASS함을 확인.

**Checkpoint**: nested `.gitignore`가 단위 가드로 검증된 채 동작.

---

## Phase 3: User Story 2 — `extraIgnorePatterns` (P2)

- [x] T008 [US2] `src/explorer/config.mjs`의 `normalizeProjectConfig`에 `extraIgnorePatterns` 인식 추가. 기존 `extraIgnoreDirs` 정책 그대로 (string array, non-string entry filter). JSDoc 갱신.

- [x] T009 [US2] `RepoToolkit` 생성자에 `extraIgnorePatterns` 인자 받기. `this.extraPatternMatcher = patterns.length > 0 ? buildGitignoreMatcher(patterns) : null`. 기본값 `[]`.

- [x] T010 [US2] `src/explorer/runtime.mjs`에서 `projectConfig.extraIgnorePatterns ?? []`를 `RepoToolkit` 생성자에 전달. (3 라인 변경)

- [x] T011 [US2] `shouldIgnorePath`에 extraPattern matcher 평가 단계 추가 (nested matcher 다음). `if (this.extraPatternMatcher && this.extraPatternMatcher(relPath)) return true;`.

- [x] T012 [US2] `tests/repo-tools.test.mjs`에 신규 단위 테스트 추가: (a) `.cerebras-explorer.json`에 `extraIgnorePatterns: ["tmp/**"]`가 있으면 `tmp/anything.txt`는 제외되지만 `tmp.txt`는 노출됨, (b) `"**/*.snapshot.json"` 패턴이 깊이 다른 위치의 `.snapshot.json`을 모두 제외함, (c) `extraIgnorePatterns`가 비어 있거나 키 자체가 없으면 결과가 spec 014 변경 전과 정확히 동일함.

- [x] T013 [US2] `tests/project-config.test.mjs`(없으면 새로 생성)에 `normalizeProjectConfig`가 `extraIgnorePatterns`의 non-string entry를 filter하고 array가 아닌 값을 silently drop하는지 단위 테스트 추가.

- [x] T014 [US2] `node --test tests/repo-tools.test.mjs tests/project-config.test.mjs` 실행으로 신규 4개 테스트가 모두 PASS함을 확인.

**Checkpoint**: `extraIgnorePatterns`가 단위 가드로 검증된 채 동작.

---

## Phase 4: User Story 3 — secret/scope 우선순위 가드 (P1)

- [x] T015 [US3] `tests/repo-tools.test.mjs`에 우선순위 가드 단위 테스트 추가: (a) `extraIgnorePatterns`에 빈 값을 둔 상태에서 `.env`가 secret deny-list로 자동 제외, (b) `extraIgnorePatterns`에 부정 표현(예: `!.env`) 시도해도 `.env`는 여전히 제외, (c) scope를 `["src/**"]`로 좁힌 호출에서 scope 밖 path는 본 spec의 어떤 ignore 정책 변화와도 무관하게 거부됨.

- [x] T016 [US3] `node --test tests/repo-tools.test.mjs --test-name-pattern "secret|priority|scope.*ignore"` 실행으로 신규 3개 가드가 PASS함을 확인.

**Checkpoint**: 보안 경계가 본 spec 변경 아래에서도 그대로 유지됨이 단위 가드로 검증.

---

## Phase 5: Documentation + backlog

- [x] T017 `README.md`의 "현재 제한 사항" 단락에서 "`.gitignore`는 루트 파일만 단순 반영합니다"를 갱신: nested `.gitignore`도 처리하며 부정 규칙(`!`)은 지원하지 않는다는 한 줄 + `.cerebras-explorer.json`의 `extraIgnorePatterns`로 path glob 단위 ignore 가능하다는 한 줄.

- [x] T018 `DESIGN.md`의 보안/탐색 단락에 spec FR-008 정책 우선순위 도식을 한 곳에 명시한다. 도식: symlink → secret deny-list → ignoreDirs → DEFAULT_IGNORE_FILE_SUFFIXES → root `.gitignore` → nested `.gitignore` → `extraIgnorePatterns` → keep.

- [x] T019 `plan/extension-backlog.md`의 #3 항목 옆에 "→ spec 014로 완료"를 한 줄 추가.

---

## Phase 6: Wrap-up

- [x] T020 `npm test` 전체 실행으로 0 failures 확인. 기존 단위 테스트와 신규 10여 개 테스트가 함께 통과해야 한다.

- [x] T021 (선택) `npm run benchmark`로 본 spec 변경이 기존 benchmark 결과를 바꾸지 않는지 확인. benchmark fixture에 `.cerebras-explorer.json`이나 nested `.gitignore`가 없으면 결과 불변 예상.

- [x] T022 본 spec의 변경분을 단일 commit으로 묶는다. 메시지: `feat(spec-014): nested .gitignore + extraIgnorePatterns for repo-specific ignore`. 변경 파일: `src/explorer/repo-tools.mjs`, `src/explorer/config.mjs`, `src/explorer/runtime.mjs`, `tests/repo-tools.test.mjs`, `tests/project-config.test.mjs`, `README.md`, `DESIGN.md`, `plan/extension-backlog.md`, `specs/014-repo-specific-ignore/`.
