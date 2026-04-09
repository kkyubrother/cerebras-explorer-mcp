# Patch 적용 체크리스트

> 기준일: 2026-04-09
> 문서: `README.md` (분석 보고서) + `REAL_PLAN.md` (실행 계획표)
> 코드베이스 실제 상태와 대조 검증 완료

---

## 범례

- `[x]` 구현 완료 / 이미 존재
- `[-]` 부분 구현 (추가 작업 필요)
- `[ ]` 미구현
- `[~]` 계획에 기재되었으나 현재 코드와 불일치 또는 수정 필요
- `[!]` 계획의 기술적 오류 또는 주의사항

---

## Phase 1. Session semantics hardening

**목표**: 세션 계약을 명시적이고 예측 가능하게 고정
**상태**: ✅ 구현 완료
**난이도**: 낮음 | **가치**: 매우 높음

### 현재 상태 확인

- [x] `SessionStore.isExhausted()` 메서드 존재 (`src/explorer/session.mjs:153-156`)
- [x] `SessionStore.create(repoRoot)` 시 repoRoot 저장 (`src/explorer/session.mjs:74`)
- [x] 기본 `maxCalls=5` 설정 존재
- [x] `isExhausted()` 로직이 `validateForReuse()`를 통해 explore 경로에서 호출됨
- [x] 세션 재사용 시 `repoRoot` 검증 수행 (`validateForReuse`에서 `repo_mismatch` 반환)
- [x] invalid/expired/exhausted 세션 요청 시 명확한 에러로 거부 (silent 생성 방지)

### 구현 항목

- [x] `resolveSessionForExplore(sessionStore, requestedSessionId, repoRoot)` 헬퍼 추가
  - 파일: `src/explorer/runtime.mjs`
  - 반환: `{ sessionId, sessionData, sessionStatus: created | reused }`
  - 실패: `invalid_session | expired_session | exhausted_session | repo_mismatch`
- [x] repoRoot binding 검증 로직 추가
  - 파일: `src/explorer/session.mjs` (`validateForReuse()` 메서드)
  - 세션 재사용 시 저장된 repoRoot와 요청 repoRoot 비교
- [x] 결과 `stats`에 세션 상태 노출
  - `sessionStatus: "created" | "reused"`
  - `remainingCalls` 필드 추가
- [x] MCP error surface 정리
  - 파일: `src/mcp/server.mjs` (기존 `-32602` catch 블록으로 처리됨)
  - invalid session에 대해 명확한 에러 메시지 반환
  - 예: `Invalid session: expired_session`, `Invalid session: exhausted_session`, `Invalid session: repo_mismatch`

### 테스트

- [x] exhausted session 재사용 → 새 세션 silent 생성 방지 테스트
- [x] repo mismatch session 재사용 차단 테스트
- [x] 유효한 세션 정상 재사용 테스트
- [x] session 미지정 → 새 세션 생성 테스트
- 파일: `tests/session.test.mjs`, `tests/runtime.mock.test.mjs`

### 수정 대상 파일 (REAL_PLAN 기재 vs 실제)

| 계획 기재 파일 | 실제 존재 | 비고 |
|---|---|---|
| `src/explorer/runtime.mjs` | O | 핵심 수정 대상 |
| `src/explorer/session.mjs` | O | repoRoot 검증 추가 |
| `src/mcp/server.mjs` | O | 에러 surface |
| `tests/runtime.mock.test.mjs` | O | |
| `tests/session.test.mjs` | O | |

### 주의사항

- [!] REAL_PLAN에서 "자동 회전(auto-rotate) 미채택"이라고 명시 — 이 결정은 유지하는 것이 맞음
- [!] 현재 runtime의 세션 로직(`runtime.mjs:303-311`)은 `sessionStore.get()` 실패 시 단순히 새 세션 생성하는 구조 — 여기를 직접 수정해야 함

---

## Phase 2. Git confidence false-low fast-path stabilization

**목표**: git 기반 질문에서 구조적 false-low 현상 줄이기
**상태**: 미구현
**난이도**: 중간 | **가치**: 매우 높음

### 현재 상태 확인

- [x] `computeConfidenceScore()` 존재 (`src/explorer/schemas.mjs:204-273`)
- [x] `observedRanges` 수집 구조 존재 (`runtime.mjs:79-86`)
- [ ] `observedRanges`는 `repo_read_file`과 `repo_grep`에서만 기록됨 — git 도구 결과 미반영
- [ ] `parseDiffOutput()` (`repo-tools.mjs:301-322`) — hunk line range 추출 없음 (additions/deletions 카운트만)
- [ ] blame line 관측 추적 없음 — `_parseBlamePorcelain()` 존재하지만 `observedRanges`에 미반영
- [ ] git-only evidence에 대한 confidence floor 조정 없음

### 구현 항목

#### 2-1. blame line 관측 추가

- [ ] `repo_git_blame` 결과의 line 정보를 `observedRanges`에 반영
  - 파일: `src/explorer/runtime.mjs`
  - `_parseBlamePorcelain()` 결과에서 path + line 추출 → `recordObservedRange()` 호출

#### 2-2. diff/show hunk 파싱 추가

- [ ] `parseDiffOutput()`에 hunk line range 추출 기능 추가
  - 파일: `src/explorer/repo-tools.mjs`
  - `@@` 헤더 파싱으로 new-file 기준 start/end range 추출
  - 최소: new-file range만 — old/new 양쪽은 Phase 3에서

#### 2-3. `repo_git_log` 전용 질문 confidence 완화

- [ ] `computeConfidenceScore()`에서 git-only evidence floor 조정
  - 파일: `src/explorer/schemas.mjs`
  - 조건: `gitLogCalls > 0` + `recentActivity` 존재 + malformed 없음 + budget stop 아님
  - floor를 `0.1`에서 적정 수준으로 상향

#### 2-4. confidence factors에 git activity 힌트 추가

- [ ] `confidenceFactors`에 `gitLogCalls`, `gitDiffCalls`, `gitBlameCalls`, `gitGroundingHint` 추가

### 수정 대상 파일 (REAL_PLAN 기재 vs 실제)

| 계획 기재 파일 | 실제 존재 | 비고 |
|---|---|---|
| `src/explorer/runtime.mjs` | O | observedRanges 확장 |
| `src/explorer/repo-tools.mjs` | O | hunk 파싱 |
| `src/explorer/schemas.mjs` | O | scoring 조정 |
| `tests/runtime.mock.test.mjs` | O | |
| `tests/repo-tools.test.mjs` | O | |

### 주의사항

- [!] 이 Phase는 **임시 완화책** — Phase 3의 schema 확장으로 반드시 이어져야 함
- [!] diff hunk 파싱 edge case 많음: rename-only, file deletion, binary patch, merge commit combined diff(`@@@`), submodule diff 등 — 지원 범위를 명시적으로 정해야 함
- [!] `parseDiffOutput()` 현재 구현이 additions/deletions 카운트 위주라서, hunk header(`@@...@@`) 파싱은 새로 작성 필요

---

## Phase 3. Git evidence schema 확장 + scoring 분리

**목표**: git evidence를 first-class evidence type으로 승격
**상태**: 부분 구현 (schema에 evidenceType enum 존재, grounding/scoring 미구현)
**난이도**: 높음 | **가치**: 높음

### 현재 상태 확인

- [-] `evidenceType` enum 이미 존재: `['file_range', 'git_commit', 'git_blame']` (`schemas.mjs:118-121`)
  - 하지만 `git_diff_hunk`는 아직 없음
  - grounding 로직이 kind-aware하지 않음
- [-] `normalizeExploreResult()` 존재 (`schemas.mjs:311-349`) — evidenceType 보존하지만 kind별 처리 없음
- [ ] kind별 grounding 함수 분리 안 됨
- [ ] confidence drop reason 미분류 (`droppedUnsupported` / `droppedUngrounded` / `droppedMalformed` 구분 없음)

### 구현 항목

#### 3-1. `EXPLORE_RESULT_JSON_SCHEMA` 확장

- [ ] `git_diff_hunk` kind 추가
- [ ] git 관련 optional 필드 추가: `commit`, `author`, `oldPath`, `newPath`, `oldStartLine`, `oldEndLine`, `newStartLine`, `newEndLine`
- [ ] `kind` 없는 legacy evidence는 normalize에서 `file_range`로 간주
- 파일: `src/explorer/schemas.mjs`

#### 3-2. `normalizeExploreResult()` kind-aware 처리

- [ ] legacy evidence → `kind: file_range`
- [ ] `git_commit` → `commit`, `path?`, `why`
- [ ] `git_blame_line` → `path`, `line`, `commit`, `author?`, `why`
- [ ] `git_diff_hunk` → old/new range 허용

#### 3-3. runtime grounding 분기

- [ ] kind별 grounding 함수 분리:
  - `groundFileRangeEvidence()`
  - `groundGitCommitEvidence()`
  - `groundGitDiffHunkEvidence()`
  - `groundGitBlameLineEvidence()`
- 파일: `src/explorer/runtime.mjs`

#### 3-4. confidence drop reason 분리

- [ ] `computeConfidenceScore()` 재구성:
  - `droppedUnsupported`, `droppedUngrounded`, `droppedMalformed`
  - 선택: `droppedOutOfScope`, `droppedRepoMismatch`

#### 3-5. prompt contract 정리

- [ ] git evidence type이 정당한 근거임을 모델에 명시
- [ ] history 질문: commit/hash/diff hunk/blame line evidence 허용
- [ ] current code semantics 주장 시: file read 보강 권장
- 파일: `src/explorer/prompt.mjs`

### 수정 대상 파일

| 계획 기재 파일 | 실제 존재 | 비고 |
|---|---|---|
| `src/explorer/schemas.mjs` | O | schema + normalize + scoring |
| `src/explorer/runtime.mjs` | O | grounding 분기 |
| `src/explorer/prompt.mjs` | O | contract 정리 |
| `src/explorer/repo-tools.mjs` | O | 필요 시 |
| `tests/runtime.mock.test.mjs` | O | |
| `tests/benchmark-evaluator.test.mjs` | O | |

### PR 분리 권장

- PR-3A: schema + normalize + grounding
- PR-3B: scoring + prompt contract

### 주의사항

- [!] `evidenceType` enum에 `git_diff_hunk` 추가 필요 — REAL_PLAN에서는 4종 kind를 언급하나 현재 schema는 3종만 존재
- [!] strict structured output JSON schema에서 `oneOf` 같은 복잡한 schema는 provider/model compliance 문제 가능 — 초기엔 느슨한 additive schema + runtime validation이 실용적
- [!] 내부 consumer migration 필요: SessionStore.update()의 evidencePaths, benchmark evaluator 등

---

## Phase 4. 공개 계약 정리 (`depth`, `similarity`, config)

**목표**: 작동하는 것만 약속하는 상태로 문서와 코드 정리
**상태**: 미구현
**난이도**: 중간 | **가치**: 높음

### 4-1. `repo_symbol_context.depth`

#### 현재 상태

- [x] schema에서 `depth: integer, minimum 1, maximum 3` 정의됨 (`repo-tools.mjs:1087`)
- [ ] `symbolContext()` 함수(`repo-tools.mjs:737`)가 depth를 받지만 사용하지 않음 — 항상 1-level 동작
- [ ] caller-chain depth tracing 없음
- [ ] `effectiveDepth` 반환 필드 없음

#### 구현 항목

- [ ] depth 입력은 유지하되 내부에서 `effectiveDepth = 1`로 clamp
- [ ] 반환에 `effectiveDepth: 1` additive field 추가
- [ ] description/README/DESIGN에 "currently only direct callers" 명시
- 파일: `src/explorer/repo-tools.mjs`, `README.md`, `DESIGN.md`

### 4-2. `find_similar_code.similarity`

#### 현재 상태

- [-] `FIND_SIMILAR_CODE_TOOL` 정의 존재 (`mcp/server.mjs:96-116`) — explore_repo wrapper
- [ ] RepoToolkit에 전용 도구 없음 — 탐색형 wrapper일 뿐
- [ ] 수치형 similarity 산식/엔진 없음

#### 구현 항목

- [ ] README 예시에서 numeric similarity 기대 제거
- [ ] DESIGN의 future item과 current behavior 구분
- [ ] tool description에 "natural-language reasoning-based similarity" 성격 명시
- [ ] 수치형 score는 별도 RFC로 분리 (이번 사이클 미포함)

### 4-3. Project config cleanup

#### 현재 상태

- [-] `entryPoints` 필드: config에서 로드됨 (`config.mjs:256, 299-300`), 정규화됨, 하지만 runtime에서 적극 활용 안 됨
  - runtime.mjs의 ENTRY_POINT_PATTERNS은 config가 아닌 하드코딩된 파일명 패턴 사용
- [ ] `languages` 필드: 로드/보존되지만 실제 코드에서 미사용
- [ ] `customSymbolPatterns` 필드: 로드되지만 미사용 — `symbols.mjs`는 하드코딩된 패턴만 사용

#### 구현 항목

- [ ] `entryPoints`를 `buildCodeMap()`과 architecture 질문에 실제 연결
  - codeMap entry point 추정 시 config 우선
  - breadth-first 탐색 시 entry file seed로 사용
- [ ] `languages`, `customSymbolPatterns`를 문서/주석에서 제거
  - `normalizeProjectConfig()`에서도 정리 검토
- 파일: `src/explorer/config.mjs`, `src/explorer/runtime.mjs`, `tests/project-config.test.mjs`, `README.md`, `DESIGN.md`

### 주의사항

- [!] `depth > 1` 실제 구현은 regex 기반 아키텍처와 맞지 않음 — caller graph 구축 문제에 해당하므로 정직한 축소가 맞음
- [!] `find_similar_code`에 수치 score를 넣으면 가짜 precision이 됨 — 자연어 설명 중심 유지

---

## Phase 5. `explore` 코어(beta) 도입

**목표**: 자유형 탐색 도구를 공유 runtime 대수술 없이 코어만 도입
**상태**: 미착수
**난이도**: 중간 | **가치**: 높음

### 현재 상태 확인

- [x] `explore_repo`가 유일한 코어 도구 (`mcp/server.mjs:14-20`)
- [x] 4개 specialized tools (`explain_symbol`, `trace_dependency`, `summarize_changes`, `find_similar_code`)는 explore_repo wrapper
- [ ] `freeExplore()` 메서드 없음
- [ ] 별도 `explore` 도구 없음
- [ ] beta feature flag (`CEREBRAS_EXPLORER_ENABLE_EXPLORE`) 없음
- [x] `CEREBRAS_EXPLORER_EXTRA_TOOLS` 환경변수는 존재 (`mcp/server.mjs:121-124`)

### 구현 항목

#### 5-1. 입력 스키마 정의

- [ ] 필수 파라미터: `prompt`, `thoroughness`, `scope`, `repo_root`, `session`
- [ ] 초기 포함 권장: `language`, `context` (README.md 분석 보고서 권고)
- 파일: `src/explorer/schemas.mjs` 또는 별도 파일

#### 5-2. 출력 스키마 정의

- [ ] `content`: text report (markdown)
- [ ] `structuredContent`: `{ report, filesRead, toolsUsed, elapsedMs, sessionId, stats }`
- [ ] `outputSchema` 정의 (MCP 생태계 예측 가능성)

#### 5-3. 새 프롬프트 추가

- [ ] 사실/해석/불확실성 구분 지시
- [ ] 주요 주장에 file path/line 또는 git artifact 근거 요구
- [ ] stop rule 포함: "더 읽어야 결론이 바뀔 가능성이 낮으면 멈추라"
- [ ] exit checklist 포함 (README.md 분석 보고서 권고)
- 파일: `src/explorer/prompt.mjs`

#### 5-4. runtime 메서드 추가

- [ ] `freeExplore()` public 메서드 분리
  - thoroughness → budget mapping
  - freeform prompt builder
  - text report 추출
  - structuredContent metadata 구성
- [ ] 내부 공통 조각은 `explore()`와 공유 (복제하지 않음)
- 파일: `src/explorer/runtime.mjs`

#### 5-5. SessionStore mode-neutral 정리

- [ ] `SessionStore.update()` → mode-agnostic packet 지원
  - `explore`는 report 요약만 session memory에 저장
  - 기존 structured mode의 `candidatePaths/evidence/summary/followups`와 분리
- 파일: `src/explorer/session.mjs`

#### 5-6. MCP server 등록

- [ ] `explore` 도구 등록
- [ ] 도구 역할 분리 설명:
  - `explore_repo`: structured JSON for automation
  - `explore`: human-readable report
- [ ] beta feature flag 고려 (`CEREBRAS_EXPLORER_ENABLE_EXPLORE`)
- 파일: `src/mcp/server.mjs`

### 이번 Phase에서 하지 않을 것

- 병렬 tool 실행
- 복잡한 auto-thoroughness
- 고급 format 옵션
- `explore_repo`와 공용 loop 대수술

### 수정 대상 파일

| 계획 기재 파일 | 실제 존재 | 비고 |
|---|---|---|
| `src/explorer/runtime.mjs` | O | freeExplore() 추가 |
| `src/explorer/prompt.mjs` | O | 새 프롬프트 |
| `src/explorer/schemas.mjs` | O | 새 스키마 |
| `src/explorer/session.mjs` | O | mode-neutral 정리 |
| `src/mcp/server.mjs` | O | 도구 등록 |
| `tests/mcp-server.test.mjs` | O | |
| `tests/runtime.mock.test.mjs` | O | |

### 주의사항

- [!] README.md 분석 보고서에서 지적: `filesExamined`보다 `filesRead`가 더 정직한 이름 — `observedRanges.keys()` 기준이므로
- [!] 도구 이름 `explore`가 MCP 다중 서버 환경에서 너무 generic할 수 있음 — `explore_report` 등 대안 검토
- [!] SessionStore.update()가 structured explore 결과 shape에 의존 중 — mode-neutral 정리 필수 선행

---

## Phase 6. 공용 runtime 리팩터링 + 제한적 병렬화

**목표**: core runtime refactor + bounded parallel execution
**상태**: 미착수
**난이도**: 높음 | **가치**: 중간

### 구현 항목

#### 6-A. 공용 orchestration 추출

- [ ] `runtime.mjs`에서 공용 부분을 helper로 분리:
  - repo init
  - tool loop
  - stats
  - candidate path tracking
  - observed artifact tracking
- [ ] `explore()`와 `freeExplore()`가 같은 core loop를 공유하도록 구조화

#### 6-B. bounded concurrency 병렬화

- [ ] concurrency cap 3~4
- [ ] `Promise.allSettled` 사용
- [ ] 원래 tool call 순서대로 messages append
- [ ] duplicate file read dedupe
- [ ] 부분 실패 허용

#### 6-C. 안전한 도구부터 병렬화

- [ ] 1차 대상: `repo_read_file`, `repo_list_dir`, cached lookup, 독립 symbol lookup
- [ ] git 계열 async subprocess 전환은 후속 과제

### 수정 대상 파일

| 계획 기재 파일 | 실제 존재 | 비고 |
|---|---|---|
| `src/explorer/runtime.mjs` | O | 핵심 수정 대상 |
| `src/explorer/repo-tools.mjs` | O | 병렬화 대상 |
| `src/explorer/cache.mjs` | O | 확인 완료 — 파일 존재 |
| `tests/runtime.mock.test.mjs` | O | |

### 주의사항

- [!] 현재 git/grep 일부가 `execFileSync` 기반 — `Promise.all`만으로는 진짜 병렬 안 됨, event loop blocking
- [!] Phase 5 안정 후 진행 권장 — `runtime.mjs` blast radius가 가장 큼
- [!] 이 Phase를 Explorer Mode Phase B에 묶지 말고 독립 항목으로 관리할 것

---

## Phase 7. docs / benchmark / examples 최종 정리

**목표**: 외부 사용자에게 정확하게 보이도록 마무리
**상태**: 기반 인프라 존재, 콘텐츠 갭 있음
**난이도**: 중간 | **가치**: 높음

### 현재 상태 확인

- [x] `benchmarks/core.json` 존재
- [x] `benchmarks/baseline-2026-04-09.json` 존재 (최근 baseline)
- [x] `scripts/run-benchmark.mjs` 존재
- [x] `src/benchmark/evaluator.mjs` 존재
- [x] `examples/expected-response.json` 존재
- [x] `examples/explore-request.json` 존재
- [ ] git-guided false-low regression 벤치마크 케이스 없음
- [ ] blame-guided grounding 케이스 없음
- [ ] `explore` 관련 예시 없음

### 구현 항목

#### 7-1. README / DESIGN 최종 동기화

- [ ] session invalid/exhausted semantics 반영
- [ ] `repo_symbol_context.depth` 실제 동작 반영
- [ ] `find_similar_code`가 score를 주지 않는다는 점 반영
- [ ] project config에서 실제 지원하는 필드만 기재
- [ ] `explore`와 `explore_repo`의 역할 차이 설명
- [ ] `explore` beta 여부 명시

#### 7-2. examples 갱신

- [ ] `examples/expected-response.json` 업데이트
- [ ] `examples/explore-request.json` 업데이트
- [ ] 새 `explore` 예시 추가

#### 7-3. benchmark 강화

- [ ] git-guided false-low regression 케이스
- [ ] blame-guided grounding 케이스
- [ ] diff/show evidence retention 케이스
- [ ] `explore` smoke benchmark (format/sanity 위주)

#### 7-4. tool description 재점검

- [ ] `server.mjs` 설명문 — MCP 클라이언트 tool selection에 직접 영향
- [ ] `explore_repo` vs `explore` 선택 기준 명확화
  1. narrow task → specialized tool
  2. automation → `explore_repo`
  3. human report → `explore`

---

## 병렬 진행 가능 / 불가 정리

### 병렬 진행 비권장

| 조합 | 이유 |
|---|---|
| Phase 2 + Phase 5 | 둘 다 `runtime.mjs` 깊게 수정 |
| Phase 3 + Phase 6 | evidence/grounding + shared loop refactor 얽힘 |
| Phase 5 + Phase 6 | `explore` core 안정 전 병렬화하면 원인 추적 불가 |

### 부분 병렬 가능

| 가능한 병렬 | 시점 |
|---|---|
| Phase 4 문서 정리 초안 | Phase 3 후반부터 |
| benchmark 케이스 설계 | Phase 2부터 병행 |
| `entryPoints` 테스트 작성 | Phase 3 후반과 병행 |

---

## 권장 PR 순서

| PR | 내용 | Phase |
|---|---|---|
| PR-1 | Session enforcement + repoRoot validation + tests | 1 |
| PR-2 | Git confidence fast-path stabilization + tests | 2 |
| PR-3A | Git evidence schema expansion + normalize/grounding | 3 |
| PR-3B | Confidence scoring split + prompt contract update | 3 |
| PR-4 | Contract cleanup (`depth`, `similarity`, config/entryPoints) | 4 |
| PR-5 | `explore` core(beta) | 5 |
| PR-6 | Shared runtime refactor + bounded parallel execution | 6 |
| PR-7 | Docs / benchmark / examples final sweep | 7 |

---

## 패치 문서 정확성 검증 결과

### README.md (분석 보고서)

| 항목 | 정확성 | 비고 |
|---|---|---|
| SessionStore.isExhausted() 미사용 진단 | **정확** | explore 경로에서 실제 미호출 |
| repoRoot 미검증 진단 | **정확** | cross-repo contamination 가능 |
| depth=1 실질 동작 진단 | **정확** | schema는 1-3이나 항상 1-level |
| find_similar_code wrapper 진단 | **정확** | explore_repo wrapper일 뿐 |
| config 필드 미사용 진단 | **대체로 정확** | entryPoints는 패턴 매칭으로 부분 사용 중이나 config에서 읽지는 않음 |
| parseDiffOutput hunk 미추출 진단 | **정확** | additions/deletions 카운트만 |
| observedRanges file-read 전용 진단 | **정확** | repo_read_file, repo_grep만 |
| sync subprocess 병렬화 제약 진단 | **확인 필요** | execFileSync 사용 여부 추가 확인 권장 |

### REAL_PLAN.md (실행 계획표)

| 항목 | 정확성 | 비고 |
|---|---|---|
| Phase 순서 및 의존 관계 | **정확** | 합리적 순서 |
| 수정 대상 파일 경로 | **모두 정확** | 전체 존재 확인 완료 |
| `evidenceType` 미존재 전제 | **부분 오류** | enum은 이미 존재 (`file_range`, `git_commit`, `git_blame`) — `git_diff_hunk`만 누락 |
| `normalizeExploreResult()` 미존재 전제 | **오류** | 이미 존재 (`schemas.mjs:311-349`) — kind-aware 처리가 없을 뿐 |
| `computeConfidenceScore()` 위치 | **정확** | `schemas.mjs` |
| Phase 5 `explore` 관련 SessionStore 분석 | **정확** | structured mode 결과 shape에 의존 중 |
| Phase 6 `cache.mjs` 참조 | **정확** | 파일 존재 확인 |

---

## 요약: 최우선 실행 순서

> **Session 고정 (Phase 1)** → **Git 신뢰도 정상화 (Phase 2-3)** → **공개 계약 정리 (Phase 4)** → **`explore` 코어(beta) (Phase 5)** → **공용 runtime 병렬화 (Phase 6)** → **최종 문서/벤치마크 정리 (Phase 7)**

핵심 원칙: 새 기능보다 먼저 이미 약속한 것들을 더 정직하게 만들 것.
