# feedback_1.md 기반 구현 계획서

> 작성일: 2026-04-10  
> 기준 문서: `plan/feedback_1.md`

---

## Phase 1 — P0 안정성 핵심 수정 (Critical)

가장 심각한 버그들을 수정합니다. 이 단계가 완료되기 전까지는 잘못된 결과가 사용자에게 전달될 수 있습니다.

### 체크리스트

- [x] **1-1. 전역 캐시 저장소 경계 격리** (`cache.mjs`, `repo-tools.mjs`)
  - `cacheKeyReadFile(repoRootReal, ...)` — 키에 repoRoot 추가
  - `cacheKeyGrep(repoRootReal, ..., maxResults, contextLines)` — 키에 repoRoot + maxResults + contextLines 추가
  - `cacheKeyFindFiles(repoRootReal, ..., maxResults)` — 신규 함수
  - `RepoToolkit.callTool()`에서 `this.repoRootReal`을 캐시 키 생성에 전달

- [x] **1-2. ripgrep fast-path scope 우회 수정** (`repo-tools.mjs`)
  - `_grepWithRipgrep()`이 `buildEffectiveScopeRules()`를 반영하도록 수정
  - ripgrep 결과를 `effectiveScope.matches()`로 후처리 필터링 추가
  - (또는) base scope가 비어있지 않으면 ripgrep fast-path 비활성화

- [x] **1-3. malformed tool arguments 격리** (`runtime.mjs`)
  - `safeJsonParse()` 호출을 `try/catch` 안으로 이동
  - 파싱 실패 시 `type: 'invalid_tool_arguments'` 로 변환, 전체 탐색 중단 방지
  - `runWithConcurrency()` 내부 worker도 모든 예외를 결과 객체로 변환

- [x] **1-4. macro tool grounding 연결** (`repo-tools.mjs`, `runtime.mjs`)
  - `repo_symbol_context` 반환값에 `observedRanges` 메타데이터 추가
  - `runtime.mjs`에서 `toolResult?.observedRanges`를 grounding ledger에 기록

- [x] **1-5. git evidence 검증 강화** (`runtime.mjs`)
  - `observedGit.commits` / `observedGit.blame` ledger 도입
  - `git_commit` / `git_blame` evidence는 ledger와 대조 후 통과 여부 결정

- [x] **1-6. freeExplore 배선 수정** (`runtime.mjs`)
  - `_initExploreContext()` 반환값에서 `repoToolkit` destructuring
  - assistant message field를 `tool_calls`(표준)로 통일
  - 마지막 content 대신 "tool call이 없는 content"만 최종 report로 취급

---

## Phase 2 — P1 단기 개선 (High)

안정성은 확보됐지만 품질 및 정확도 문제를 개선합니다.

### 체크리스트

- [ ] **2-1. defaultBudget 반영 순서 수정** (`runtime.mjs`)
  - `effectiveBudgetLabel` 계산을 `budgetConfig` 계산 이전으로 이동

- [ ] **2-2. finalization JSON 2단계 복구** (`runtime.mjs`, `prompt.mjs`)
  - parse 실패 시 "repair to schema" LLM 호출 추가
  - 그래도 실패 시 로컬 fallback으로 내려가는 2단계 구조

- [ ] **2-3. confidence scoring 재설계** (`schemas.mjs`, `runtime.mjs`, `prompt.mjs`)
  - task-aware base score (`locate`: 0.35, 기타: 0.15)
  - exact evidence count, distinctFiles, symbolCalls 반영
  - `reconcileConfidence()` 분리: locate+exact 1개면 model confidence 우선

- [ ] **2-4. evidence range tolerance 개선** (`runtime.mjs`)
  - "overlap 있으면 partial" 대신 "exact overlap" or "양 끝이 tolerance 안"만 partial
  - 범위 길이 고려 로직 추가

- [ ] **2-5. scope enforcement 통합** (`repo-tools.mjs`)
  - `_enforceScopedPath()` 헬퍼 추가
  - `readFile`, `symbols`, `_validateGitPath` 모두 이 함수 사용

- [ ] **2-6. skip telemetry 추가** (`repo-tools.mjs`, `config.mjs`)
  - grep/find/walk 결과에 `skipped: { largeFiles, binaryFiles, walkLimitReached }` 메타데이터 추가
  - `maxGrepFileBytes`, `maxReadFileBytes`를 budget config로 이동

- [ ] **2-7. symbol tools regex 정확도 개선** (`repo-tools.mjs`, `symbols.mjs`)
  - `escapeRegex()` 함수 추가, symbol 검색에 적용
  - arrow function, Python async def, Java constructor 패턴 추가

---

## Phase 3 — P2 중기 개선 (Medium)

코드 품질과 테스트 커버리지를 강화합니다.

### 체크리스트

- [ ] **3-1. checkpoint injection 문구 완화** (`runtime.mjs`)
  - "정확히 one call" 강제 문구 제거
  - evidence sufficiency 요약 + 최소 추가 액션 권고로 변경

- [ ] **3-2. detectStrategy weighted rule 전환** (`prompt.mjs`)
  - boolean regex → weighted rule 방식으로 변경
  - 점수화로 전략 우선순위 결정

- [ ] **3-3. 회귀 테스트 추가** (`tests/`)
  - cross-repo cache isolation 테스트
  - ripgrep base scope 준수 테스트
  - malformed tool args → tool error (not throw) 테스트
  - `repo_symbol_context` evidence grounding 테스트
  - `freeExplore` 실제 tool result 처리 테스트
  - `defaultBudget` → `budgetConfig` 반영 테스트
  - `freeExplore` 별도 테스트 파일 분리

---

## Phase 4 — P3 장기 개선 (Low)

선택적 개선 사항입니다.

### 체크리스트

- [ ] **4-1. Mermaid diagram 사실성 개선** (`runtime.mjs`)
  - 실제 import/reference edge 없으면 diagram 생략
  - `repo_references` / 정적 import 스캔 결과를 edge 소스로 사용

---

## 회귀 위험 체크포인트

각 Phase 완료 후 아래를 확인합니다.

- [ ] 캐시 키 변경 후 `npm test` 전체 통과
- [ ] scope enforcement 후 기존 탐색 범위 축소가 의도된 것인지 테스트로 확인
- [ ] grounding 엄격화와 confidence 재설계를 반드시 동시에 적용
- [ ] `freeExplore`는 `explore_repo`와 별도 회귀 세트로 검증
