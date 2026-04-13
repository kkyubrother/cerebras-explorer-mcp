# Implementation Checklist (feedback_2_1 + feedback_2_2 기반)

> 작성일: 2026-04-10  
> 기준 문서: `plan/feedback_2_1.md`, `plan/feedback_2_2.md`

---

## 핵심 원칙

1. **도구 의미론 자체를 안정화** (cache, scope)
2. **runtime이 실패를 흡수**하게 만들기
3. **grounding / git evidence / confidence** 조정
4. **finalize / timeout / freeExplore** 정리
5. `confidence`는 반드시 맨 마지막에 — grounding 규칙이 바뀐 후에야 점수 조정 가능

---

## Phase 1 — P0: Cache Isolation

**수정 파일:** `src/explorer/cache.mjs`, `src/explorer/repo-tools.mjs`

### 목표
- cache key에 `repoRoot`, `baseScope`, `ignoreDirs`, `maxResults` 반영
- `read_file / grep / find_files / symbols / git_*` 전부 동일한 namespace 규칙 적용
- cache clear/reset API 추가 (테스트 편의)

### 체크리스트
- [x] `scopeFingerprint()` / `ignoreFingerprint()` 헬퍼 함수 추가 (`repo-tools.mjs` 내 `_baseScopeFingerprint`, `_ignoreDirsFingerprint`)
- [x] `RepoToolkit._scopedCacheKey(kind, parts)` 메서드 추가
- [x] `cacheKeyGrep` → `_scopedCacheKey('grep', { pattern, caseSensitive, scope, maxResults })`로 교체
- [x] `cacheKeyFindFiles` → `_scopedCacheKey('find_files', { pattern, scope, maxResults })`로 교체
- [x] `read_file` cache key에 `repoRoot`, `baseScope` 포함
- [x] `symbols` cache key에 `repoRoot`, `baseScope` 포함
- [x] `git_*` cache key에 `repoRoot` 포함
- [x] cache `clear()` 메서드 추가 (테스트용)

### 추가 테스트 (`tests/repo-tools.test.mjs`)
- [x] `cache isolates read_file results by repo root`
- [x] `cache does not reuse read_file across different base scopes`
- [x] `cacheKeyGrep includes maxResults`
- [x] `cacheKeyFindFiles includes maxResults`
- [x] `cache isolates repo_symbols results by repo root`

### 검증 포인트
- repo A에서 `src/a.js` 읽은 뒤 repo B 같은 경로 읽어도 A 결과 재사용 안 됨
- `scope=['src/**']` 캐시가 `scope=['docs/**']` 요청에 새지 않음
- `maxResults:1` 후 `maxResults:10` 호출 시 10개 경로 반환

---

## Phase 2 — P0: Scope Hard Boundary

**수정 파일:** `src/explorer/repo-tools.mjs`

### 목표
- `rg` 경로에서도 `initialize(scope)`의 base scope 항상 강제
- `extraIgnoreDirs` / `DEFAULT_IGNORE_DIRS`가 `rg` 경로에서도 적용
- `repo_symbols()`가 base scope 밖 파일 거부
- `repo_git_log/blame/diff`의 `path`가 base scope 밖이면 거부
- `repo_git_show()`는 changed files를 base scope로 필터링

### 체크리스트
- [ ] `_grepWithRipgrep()`: `walkFiles({ scope })`로 후보 파일 집합 먼저 생성 후 rg에 넘기기
- [ ] `_grepWithRipgrep()`: `extraIgnoreDirs` / `DEFAULT_IGNORE_DIRS` 적용
- [ ] `_assertWithinBaseScope(relativePath)` 헬퍼 추가
- [ ] `repo_symbols()`: `_assertWithinBaseScope()` 적용
- [ ] `repo_git_log()`: path 파라미터 scope 검증
- [ ] `repo_git_blame()`: path 파라미터 scope 검증
- [ ] `repo_git_diff()`: path 파라미터 scope 검증
- [ ] `repo_git_show()`: changed files를 base scope로 필터링

### 추가 테스트 (`tests/repo-tools.test.mjs`)
- [ ] `RepoToolkit grep with ripgrep respects initialize base scope` (skip if no rg)
- [ ] `RepoToolkit grep with ripgrep respects extraIgnoreDirs` (skip if no rg)
- [ ] `RepoToolkit symbols rejects out-of-scope paths`
- [ ] `RepoToolkit gitLog rejects out-of-scope path`
- [ ] `RepoToolkit gitBlame rejects out-of-scope path`
- [ ] `RepoToolkit gitDiff rejects out-of-scope path`
- [ ] `RepoToolkit gitShow filters changed files to current scope`

### 검증 포인트
- `initialize(['src/**'])` 후 `repo_grep('Auth')`가 `docs/auth.md` 반환 안 함
- `repo_symbols({ path: 'docs/auth.md' })`는 reject
- `repo_git_show(HEAD)`가 scope 밖 변경 파일 노출 안 함

---

## Phase 3 — P0: Malformed Tool Args / 병렬 Tool 실패 격리

**수정 파일:** `src/explorer/runtime.mjs`

### 목표
- `safeJsonParse()` 실패가 개별 tool error로 처리
- `runWithConcurrency()`가 worker 하나 실패해도 batch 전체 reject 안 함
- tool call 하나가 깨져도 그 turn 전체는 계속 진행

### 체크리스트
- [ ] `safeJsonParse()` 호출을 `try/catch` 블록 내부로 이동 (`stage: 'parse_or_exec'` 에러 포함)
- [ ] `runWithConcurrency()` worker에 개별 `try/catch` 추가, 실패 시 `{ error: true, message }` 반환
- [ ] tool error가 model context에 들어갈 때 recovery 안내 포함

### 추가 테스트 (`tests/runtime.mock.test.mjs`)
- [ ] `ExplorerRuntime continues when one tool call has invalid JSON arguments`
- [ ] `ExplorerRuntime continues when one parallel tool throws`
- [ ] `ExplorerRuntime preserves successful tool results even when one sibling tool fails`

### 검증 포인트
- 같은 turn에 tool 2개 중 하나의 args가 malformed여도 다른 tool 결과는 반영
- `explore()` 전체가 throw 되지 않음

---

## Phase 4 — P0: Observation Ledger 도입

**수정 파일:** `src/explorer/repo-tools.mjs`, `src/explorer/runtime.mjs`

### 목표
- runtime이 tool 이름으로 관찰 범위 추정 → tool result가 `observations[]` 직접 반환
- 다음 도구에 `observations[]` 추가:
  - `repo_read_file`, `repo_grep`, `repo_git_blame`, `repo_git_diff`, `repo_git_show`, `repo_symbol_context`
- observation에 `kind`, `path`, `startLine`, `endLine`, `source`, `sha` 포함

### 체크리스트
- [ ] observation 타입 정의: `{ kind, path, startLine, endLine, source, sha? }`
- [ ] `repo_read_file()` 반환값에 `observations[]` 추가
- [ ] `repo_grep()` 반환값에 `observations[]` 추가 (line-level)
- [ ] `repo_git_blame()` 반환값에 `observations[]` 추가
- [ ] `repo_git_diff()` 반환값에 `observations[]` 추가
- [ ] `repo_git_show()` 반환값에 `observations[]` 추가
- [ ] `repo_symbol_context()` 반환값에 `observations[]` 추가 (definition + callers)
- [ ] runtime: tool result의 `observations[]`를 `observedRanges`에 통합하는 로직 추가
- [ ] runtime: top-level tool name 분기로 range 추정하는 코드 제거/축소

### 추가 테스트
- (`tests/repo-tools.test.mjs`)
  - [ ] `repo_symbol_context returns observations for definition and callers`
  - [ ] `repo_grep returns line-level observations`
- (`tests/runtime.mock.test.mjs`)
  - [ ] `ExplorerRuntime records observations from macro tools`

### 검증 포인트
- `repo_symbol_context()`만 호출했는데 definition evidence가 grounding에서 살아남음
- runtime 내부 top-level tool name 분기 코드가 줄어듦

---

## Phase 5 — P0: Source-aware Grounding + Git Evidence 실관찰 검증

**수정 파일:** `src/explorer/runtime.mjs`

### 목표
- `checkEvidenceGrounding()`을 source-aware로 변경
- `grep`로 본 1줄이 넓은 `file_range`를 exact로 만들지 못하게
- `repo_symbol_context`에서 읽은 definition body는 exact grounding
- `git_commit`, `git_blame`, `git_diff_hunk`는 실제 관찰한 artifact와 일치할 때만 통과

### 체크리스트
- [ ] `recordObservedRange()`: `source` 파라미터 추가 (`'read'`, `'grep'`, `'symbol_context_definition'` 등)
- [ ] exact 판정 로직: "완전 포함" 기준으로 변경, source-aware
- [ ] `observedGit` 추적 구조 추가: `{ commits: Set, blame: Map, diffHunks: Map }`
- [ ] `repo_git_log` 실행 후 `observedGit.commits`에 hash 기록
- [ ] `repo_git_show` 실행 후 `observedGit.commits`에 hash 기록
- [ ] `repo_git_blame` 실행 후 `observedGit.blame`에 line:sha 기록
- [ ] `repo_git_diff` 실행 후 `observedGit.diffHunks`에 기록
- [ ] grounding 시 `git_commit` evidence: `observedGit.commits` 확인 필수
- [ ] grounding 시 `git_blame` evidence: `observedGit.blame` 확인 필수
- [ ] grounding 시 `git_diff_hunk` evidence: `observedGit.diffHunks` 확인 필수

### 추가 테스트 (`tests/runtime.mock.test.mjs`)
- [ ] `grep-only observation does not exact-ground a wide file range`
- [ ] `read_file observation exact-grounds matching file range`
- [ ] `symbol_context-backed evidence is retained`
- [ ] `hallucinated git_commit evidence is dropped`
- [ ] `git_commit evidence matching observed git_log hash is retained`
- [ ] `git_blame evidence with mismatched sha is dropped`
- [ ] `git_diff_hunk evidence must match observed hunk range`

### 검증 포인트
- `repo_grep` 한 줄만 보고 `L1-L200` evidence가 `exact`면 실패
- git tool을 한 번도 안 썼는데 `git_commit` evidence가 남아 있으면 실패

---

## Phase 6 — P1: Loop Stagnation 감지 + Checkpoint 문구 완화

**수정 파일:** `src/explorer/runtime.mjs`, `src/explorer/prompt.mjs`

### 목표
- 동일한 tool plan 반복 감지
- "같은 실패/cache-hit만 반복"되는 turn에 recovery prompt 삽입
- 기존 checkpoint의 `exactly one more tool call` 문구 제거
- `1–2 tool calls max` 또는 `smallest next step` 정도로 완화

### 체크리스트
- [ ] `fingerprint` = `JSON.stringify(toolCalls sorted by [name, args])` 로 turn 비교
- [ ] `repeatedTurns` 카운터 추가 (`fingerprint === lastFingerprint` 시 증가)
- [ ] `consecutiveAllErrorTurns` 카운터 추가
- [ ] `repeatedTurns >= 2` 또는 `consecutiveAllErrorTurns >= 2` 시 recovery prompt 삽입
- [ ] checkpoint 문구 변경: `'exactly one more tool call'` → `'1–2 tool calls max'`
- [ ] stagnation 감지 후 recovery prompt 내용 작성

### 추가 테스트 (`tests/runtime.mock.test.mjs`)
- [ ] `ExplorerRuntime injects recovery guidance after repeated identical tool plans`
- [ ] `Checkpoint prompt does not force exactly one more tool call`
- [ ] `Runtime finalizes after repeated unproductive turns instead of just spinning`

### 검증 포인트
- mock client가 같은 tool call만 계속 내보낼 때 후반 turn의 message에 recovery guidance 포함

---

## Phase 7 — P1: Finalize 강건화

**수정 파일:** `src/explorer/runtime.mjs`, `src/explorer/cerebras-client.mjs`

### 목표
- `extractFirstJsonObject()` 실패 시:
  1. local loose repair
  2. no-tools repair pass 1회
- repair pass는 절대 tools 허용 안 함
- raw text low-confidence fallback은 최후의 최후로만 사용

### 체크리스트
- [ ] `tryLooseRepair(text)` 헬퍼 함수 추가 (prose-wrapped JSON 추출)
- [ ] `finalizeAfterToolLoop()`: 1차 parse 실패 시 `tryLooseRepair()` 시도
- [ ] `finalizeAfterToolLoop()`: 2차 실패 시 no-tools repair pass (tools 없이 재요청)
- [ ] repair pass: `parallelToolCalls: false`, tools 파라미터 비어있게
- [ ] raw text fallback은 3차 실패 후에만 사용

### 추가 테스트 (`tests/runtime.mock.test.mjs`)
- [ ] `finalizeAfterToolLoop repairs malformed JSON with a second no-tool pass`
- [ ] `finalizeAfterToolLoop salvages prose-wrapped JSON locally`
- [ ] `repair pass does not request tools`

### 검증 포인트
- 1차 finalize가 malformed JSON이어도 2차 repair로 구조화 결과 살아남
- `candidatePaths`/`evidence`가 빈 배열로 무조건 붕괴하면 실패

---

## Phase 8 — P1: freeExplore 안정화

**수정 파일:** `src/explorer/runtime.mjs`

### 목표
- `_initExploreContext()` destructuring에 `repoToolkit` 추가
- `freeExplore`에서도 malformed tool args를 개별 tool error로 격리
- budget 소진 시 interim markdown이 있어도 finalize 수행
- `stoppedByBudget`와 최종 finalize 경로를 일관되게 맞춤

### 체크리스트
- [x] `_initExploreContext()` 반환값에 `repoToolkit` 포함 확인
- [x] `freeExplore()` destructuring에 `repoToolkit` 추가
- [x] `freeExplore()` tool call에 Phase 3의 malformed args 격리 적용
- [x] `freeExplore()` finalize 조건: `budgetExhausted || reportIsEmpty` (interim text 있어도 budget 소진 시 finalize)
- [x] `stoppedByBudget` 플래그 일관성 확보

### 추가 테스트 (신규 `tests/free-explore.test.mjs`)
- [x] `freeExplore executes tool calls without repoToolkit ReferenceError`
- [x] `freeExplore continues after malformed tool arguments`
- [x] `freeExplore finalizes when budget exhausted even if interim text exists`
- [x] `freeExplore sets stoppedByBudget when budget is exhausted`

### 검증 포인트
- "조용히 tool error로 먹히는 ReferenceError"가 테스트로 고정됨

---

## Phase 9 — P1: Provider Timeout / Abort / Retry

**수정 파일:** `src/explorer/cerebras-client.mjs`, `src/explorer/providers/openai-compat.mjs`, `src/explorer/providers/failover.mjs`

### 목표
- concrete client에 `AbortController` 기반 HTTP timeout 추가
- timeout 시 underlying request 실제 abort
- 429/5xx에 한정된 짧은 retry 추가
- failover에서 timeout된 provider 뒤로 정상 진행

### 체크리스트
- [x] `cerebras-client.mjs`: `AbortController` + `CEREBRAS_EXPLORER_HTTP_TIMEOUT_MS` 환경변수 지원
- [x] `cerebras-client.mjs`: 429/5xx retry 로직 추가 (횟수 제한)
- [x] `openai-compat.mjs`: 동일하게 `AbortController` + retry 적용
- [x] `failover.mjs`: timeout된 provider를 catch하고 다음 provider로 넘어가는 로직 수정
- [x] non-retryable 에러 (400 등) 구분

### 추가 테스트
- (`tests/cerebras-client.test.mjs`)
  - [x] `CerebrasChatClient aborts timed-out requests`
  - [x] `CerebrasChatClient retries on 429 and then succeeds`
- (`tests/providers.test.mjs`)
  - [x] `OpenAICompatChatClient aborts timed-out requests`
  - [x] `FailoverChatClient falls back after provider timeout`
  - [x] `Non-retryable 400 errors are not retried`

### 검증 포인트
- mock fetch가 영원히 resolve되지 않을 때 timeout error 발생
- retry 대상/비대상 구분 명확

---

## Phase 10 — P1: Confidence Recalibration

**수정 파일:** `src/explorer/schemas.mjs`, `src/explorer/runtime.mjs`

### 목표
- base 0.5 시작을 낮추고 exact/partial 구분 반영
- distinct files, observed reads, stoppedByBudget, dropped evidence를 현실적으로 반영
- `high`는 최소 조건: exact grounded evidence 2개 이상 + 2개 이상 파일
- model confidence는 참고용, 최종 label은 rule-based score 우선

### 체크리스트
- [x] base score 변경: `0.5` → task-aware base (`0.35` for locate, `0.15` for default)
- [x] `exactCount * 0.18 + partialCount * 0.05` 방식으로 점수 계산
- [x] `distinctFiles >= 2` 보너스 추가 (`+0.12`)
- [x] `grepCalls > 0 || symbolCalls > 0` 보너스 (`+0.05`)
- [x] `stoppedByBudget` 패널티 추가 (`-0.15`)
- [x] `dropped evidence` 패널티 추가 (`-0.25`)
- [x] `high` 조건: exact evidence >= 2 AND distinctFiles >= 2 (hard gate 적용)
- [x] `symbolSearchUsed` 체크 로직: `grepCalls`뿐 아니라 `symbolCalls`도 포함
- [x] model confidence를 최종 label에 직접 섞는 코드 제거/분리 (`reconcileConfidence` 함수로 분리)

### 추가 테스트
- (신규 `tests/schemas.test.mjs`)
  - [x] `computeConfidenceScore requires at least two exact evidence items for high`
  - [x] `partial-only evidence cannot become high`
  - [x] `single exact evidence caps at medium`
  - [x] `stoppedByBudget lowers confidence`
- (`tests/runtime.mock.test.mjs`)
  - [x] `runtime downgrades model high confidence to computed medium when evidence is weak`

### 검증 포인트
- 점수 로직 테스트와 runtime 최종 confidence 테스트를 분리

---

## 머지 게이트 순서

| PR 범위 | 실행할 테스트 |
|---------|------------|
| Phase 1~2 | `tests/repo-tools.test.mjs` |
| Phase 3~8 | `tests/repo-tools.test.mjs`, `tests/runtime.mock.test.mjs`, `tests/free-explore.test.mjs` |
| Phase 9 | 위 3개 + `tests/cerebras-client.test.mjs`, `tests/providers.test.mjs` |
| Phase 10 | 모두 + `tests/schemas.test.mjs` |
| 최종 | `node --test` 전체 |

---

## 분리해야 할 조합 (묶지 말 것)

- **cache 수정 + confidence 수정**: 원인 분리 불가
- **scope hardening + finalize repair**: 성격이 다름 (tool semantics vs synthesis)
- **explore loop 수정 + freeExplore 수정**: 같은 파일이지만 동작 모드가 달라 별도 PR이 안전
