# Tasks: trace_symbol usage cross-check enforcement

**Input**: Design documents from `/specs/026-trace-symbol-cross-check/`

**Prerequisites**: plan.md, spec.md, research.md (근원 원인·통합 지점 file:line — R1~R9), data-model.md (엔티티·상태 전이), contracts/critic-warning-usage-cross-check.md, quickstart.md (검증 절차)

**Tests**: 포함 — spec SC-002가 scripted 양방향 테스트를 요구하고 프로젝트 관례가 TDD(failing first)다. 모든 commit 전 `npm test` 0 fail (AGENTS.md).

**Organization**: user story별 독립 구현·검증. US1(gate)·US2(인덱서)·US3(프롬프트)는 서로 다른 프로덕션 파일을 수정하므로 스토리 간 의존이 없다. 단 US1과 US3가 `tests/runtime.mock.test.mjs`를 공유하므로 같은 파일을 동시에 편집하지 말 것(순차 권장).

**Line refs**: 모두 2026-06-10 working tree(`8cc9d66`) 기준 — 편집 전 내용으로 재확인 (T001).

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [ ] T001 Baseline 확인: `npm test` 0 fail 기록; research.md의 anchor들이 현재 트리와 일치하는지 재확인 — `src/explorer/repo-tools.mjs:1085`(maxResults:40)·`:48-51`(isCallableUsage)·`:1147,1161`(slice(0,20))·`:790-815,867`(rg 무정렬 선착순), `src/explorer/runtime.mjs:1473-1474`(관측 초기화 자리)·`:1655-1663`(관측 루프)·`:984-1014`(buildResultStatus)·`:1829-1837`(critic pass 호출부), `src/explorer/critic.mjs:358-428`(buildCriticWarnings)·`:395-402`(confidence_downgraded)·`:436-483`(runDeterministicCriticPass), `src/explorer/prompt.mjs:4,197-198,291`. 어긋나면 본 문서의 ref를 갱신.

---

## Phase 2: Foundational (Blocking Prerequisites)

**없음** — FR-001의 "판정 규칙 변경 전 원인 측정" 전제는 Phase 0 research(R1, 적대적 검증 confirmed)로 이미 충족·기록되었고, 세 user story는 서로 다른 프로덕션 파일을 수정한다. Setup(T001) 완료 즉시 어느 스토리든 시작 가능.

---

## Phase 3: User Story 1 - Honest completeness signal (Priority: P1) 🎯 MVP

**Goal**: `symbol_trace` 탐색이 usage cross-check 관측 없이 `verified`에 도달하면 `targeted_read_needed` 강등 + confidence high→medium cap + `usage_cross_check_missing` 경고 1건. 관측되면 무변경. 비대상 경로 byte-identical.

**Independent Test**: mock chat client 시나리오만으로 검증 — grep 없는 run은 강등+경고, 심볼 포함 grep run은 무변경 (quickstart §2).

### Tests for User Story 1 (failing first)

- [X] T002 [P] [US1] `tests/critic.test.mjs`에 unit 테스트 추가: ① `buildCriticWarnings`에 optional `usageCrossCheck={required:true,observed:false,symbol}` 전달 시 `usage_cross_check_missing` 경고 1건 — shape `{type, severity:'medium', message(심볼 포함), target:심볼, action(scope 밖 검색 비암시)}` (data-model E3); ② medium tier 경쟁: malformed dropped_evidence + confidence_downgraded + 새 경고 동시 존재 시 3개 예산 안에서 새 경고가 confidence_downgraded보다 **앞**에 생존 (R5 push 위치); ③ `observed:true` 또는 인자 생략(구 시그니처 — 기존 :208 테스트 무수정 green) 시 경고 없음; ④ `runDeterministicCriticPass`가 gate-fail 시 `finalConfidence`를 medium으로 cap(modelConfidence 'high' 보존 → `confidence_downgraded` 자동 발화)하고 gate-pass 시 무변경 — **low로 내리지 않음** 단언 (R4 제약).
- [X] T003 [P] [US1] `tests/runtime.mock.test.mjs`에 "spec 026" 시나리오 테스트 추가 (기존 MockChatClient 패턴 재사용): (a) `taskMode:'symbol_trace'` + `repo_symbol_context`+`repo_read_file`만(grep 0) → `status.verification==='targeted_read_needed'`, `status.confidence==='medium'`, `critic.warnings`에 `usage_cross_check_missing` **정확히 1개**, `nextAction.type==='read_target'`, `status.complete===true`; (b) 심볼 포함 `repo_grep` 수행 run → `verified` 유지·경고 없음; (c) 심볼 포함하지만 **0-match**인 grep도 충족 (attempt 기준 — args 기반 기록 검증); (d) `repo_references({symbol})` 호출로도 충족; (e) `scope:['src/sub/**']` + scope 내 grep → 충족 (narrow-scope, AC3); (f) critic **fail** 경로(tool_errors 등)에서는 gate 미발화 — `broad_search_needed` 유지 + `usage_cross_check_missing` 부재 (이중 경고 금지); (g) 비-`symbol_trace`(taskMode 'locate') 동일 시나리오 → 경고·강등 없음 (FR-007).
- [X] T004 [US1] `node --test tests/critic.test.mjs tests/runtime.mock.test.mjs` 실행, 신규 테스트 전부 FAIL 확인 (기존 테스트는 green 유지).

### Implementation for User Story 1

- [X] T005 [US1] `src/explorer/runtime.mjs` — 관측 기록: `observedRanges`/`observedGit` 초기화(:1473-1474) 옆에 `usageCrossCheck = { grepPatterns: new Set(), referenceSymbols: new Set() }` 추가; compact tool loop(:1655-1663)에서 **args 기반** 수집 — `repo_grep`→`toolArgs.pattern`, `repo_references`→`toolArgs.symbol` (결과 무관, 0-match 포함; bounded). `repo_symbol_context`는 기록하지 않음. report 루프(:2182-2230) 비변경 (data-model E1).
- [X] T006 [US1] `src/explorer/critic.mjs` — `buildCriticWarnings`(:358-428)에 optional `usageCrossCheck` 인자(default 비발화, 구 시그니처 호환) + `usage_cross_check_missing` push 블록을 confidence_downgraded(:395) **앞**에 추가; `runDeterministicCriticPass`(:436-483)가 같은 입력을 받아 gate-fail 시 `finalConfidence`를 medium cap (low 금지 — R4).
- [X] T007 [US1] `src/explorer/runtime.mjs` — gate 배선: 매칭 술어 `observed = [...grepPatterns].some(p => p.includes(symbol)) || referenceSymbols.has(symbol)`, `symbol = args.hints?.symbols?.[0]` (R3); `runDeterministicCriticPass` 호출부(:1829-1837)에 `usageCrossCheck={required: taskMode==='symbol_trace' && !!symbol, observed, symbol}` 전달; `buildResultStatus`(:984-1014)의 verified 확정 **이후** `required && !observed`이면 `verification='targeted_read_needed'` 강등 분기 추가 (critic fail :993·low confidence :995 분기가 선행하므로 그 경우 gate 미발화).
- [X] T008 [US1] `npm test` 전체 0 fail + R9 회귀 확인: `tests/mcp-server.test.mjs:401`(wrapper 테스트 — MockChatClient의 'requireAuth' grep이 충족되어 verified 유지, 1차 카나리아), `tests/runtime.mock.test.mjs:3291-3310`(symbol_trace+무관 grep — 강등돼도 기존 단언은 양쪽 허용·complete:true 유지 확인), `tests/schemas.test.mjs:214-216`(public hints taskMode 거부 유지).
- [X] T009 [US1] Commit: `feat(spec-026): deterministic usage cross-check gate for symbol_trace (US1)`.

**Checkpoint**: US1 단독으로 MVP — 과신 모드 제거가 mock 시나리오로 입증된 상태.

---

## Phase 4: User Story 2 - Reproduction finds the production callsite (Priority: P2)

**Goal**: `symbolContext`의 caller 절단을 결정적·다양성 보존으로 교정 — 재현 fixture에서 프로덕션 호출처가 항상 callers에 포함되고, 동일 입력은 항상 동일 출력.

**Independent Test**: fixture 기반 단위 테스트 + quickstart §1 재현 스크립트(이 저장소에서 `buildReportCritic` 5회 — fix 전 baseline 포함 3/11회 → fix 후 5/5회).

### Tests for User Story 2 (failing first)

- [X] T010 [P] [US2] `tests/repo-tools.test.mjs`에 regression fixture 테스트 추가: temp fixture repo — `lib/def.js`(정의), `app/main.js`(프로덕션 호출 1개, 대형 파일), `tests/def.test.js`(매치 25개), `docs/*.md` 3개(산문 언급 합계 30개 — cap 초과 + 비코드 잠식을 결정적으로 유도). 단언: ① `symbolContext` callers에 `app/main.js` 호출처 포함(relation 'call'); ② 2회 연속 호출 결과 `deepEqual`(결정성); ③ callers의 파일당 항목 ≤3 (round-robin 다양성); ④ `definition` 항상 존재(`lib/def.js`); ⑤ `truncated`/`callerCount` 필드 의미 유지(스키마 불변 — data-model E5).
- [X] T011 [US2] 실행해 FAIL 확인 — 현 코드의 비결정성 때문에 flaky-fail이 아니라 **결정적 fail**이 되도록 fixture의 비코드 매치 수(30+25 > 40-cap)가 코드 호출처를 항상 밀어내는지 확인하고, 필요시 매치 수 조정.

### Implementation for User Story 2

- [X] T012 [US2] `src/explorer/repo-tools.mjs` — `symbolContext`(:1085 부근): 내부 grep `maxResults: 40` → `this.budgetConfig?.maxSearchResults ?? 80`; `callers.slice(0, 20)`(:1147, :1161) 전에 결정적 정렬 적용 — ① 코드 파일 우선(`detectLanguage(path) !== 'generic'`), ② relation 가중치(`call`/`member_call`/`constructor` > 기타 > `reference`), ③ 파일당 상한 3개 round-robin, ④ (path, line) 안정 정렬 (R2/data-model E5); 스테일 주석(:1815 "internally uses cached grep") 교정. 반환 필드 형태 불변.
- [X] T013 [US2] `node --test tests/repo-tools.test.mjs` green + `npm test` 0 fail; quickstart §1 재현 스크립트($env:TEMP, 실행 후 삭제)로 이 저장소에서 `buildReportCritic` 5회 — 5/5 동일 출력 + `src/explorer/runtime.mjs` 호출처(`call`) 포함 + definition 항상 존재를 확인하고 결과 수치를 본 파일 하단 Notes에 기록.
- [X] T014 [US2] Commit: `fix(spec-026): deterministic, diversity-preserving caller truncation in symbolContext (US2)`.

**Checkpoint**: US1+US2 — gate는 드물게 발화하고, 인덱서는 같은 입력에 같은 답.

---

## Phase 5: User Story 3 - Strategy steers the cross-check (Priority: P3)

**Goal**: symbol-first 전략 프롬프트가 "정의 확인 후 finalize 전에 bare symbol로 scope-wide grep 1회"를 지시하고, fallback 조건을 "If no result **or truncated**"로 확장 — gate 발화 빈도를 낮추는 비용 절감층.

**Independent Test**: 프롬프트 snapshot 테스트 (quickstart §3) + 라이브 벤치마크에서 grep 수행 관측 (Polish T021에서 통합 확인).

### Tests for User Story 3 (failing first)

- [X] T015 [P] [US3] `tests/runtime.mock.test.mjs`(기존 프롬프트 단언 블록 :2404-2429 부근)에 snapshot 테스트 추가: `buildExplorerUserPrompt`(strategy 'symbol-first')의 approach 문구에 ① cross-check 지시(bare symbol `repo_grep` + finalize 전) ② `truncated` fallback 문구 포함 단언; 시스템 프롬프트 전략 카탈로그(`buildExplorerSystemPrompt` 경유, prompt.mjs:197-198)와 `STRATEGY_DESCRIPTIONS`(:4)의 동기화 단언. 실행해 FAIL 확인.

### Implementation for User Story 3

- [X] T016 [US3] `src/explorer/prompt.mjs` — :291의 symbol-first approach를 확장("Start with repo_symbol_context(symbol). After confirming the definition and before finalizing, run one scope-wide repo_grep for the bare symbol name to cross-check usages. If no result **or the result reports truncated: true**, fall back to repo_grep(symbol) → repo_read_file for top matches." 취지); `STRATEGY_DESCRIPTIONS`(:4)와 시스템 카탈로그(:197-198) 한 줄 동기화 (R7).
- [X] T017 [US3] 테스트 green + `npm test` 0 fail; Commit: `feat(spec-026): symbol-first strategy cross-check instruction (US3)`.

**Checkpoint**: 세 스토리 모두 독립 검증 완료.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T018 [P] 벤치마크 check type: `tests/benchmark-evaluator.test.mjs`에 `critic_warning_absent` 테스트 먼저(경고 존재→fail / 부재→pass / 기존 unknown-type throw 경로 비충돌) → `src/benchmark/evaluator.mjs`(:103-153 switch)에 type 추가 (contracts §2, R8). 구현 후 green.
- [X] T019 [P] `benchmarks/adoption.json`에 케이스 `trace-symbol-cross-check` 추가: tool `trace_symbol`, `args.symbol='buildReportCritic'`, `scope:["src/**","tests/**"]`; expectations — `target_paths`에 `src/explorer/runtime.mjs` 그룹(프로덕션 호출처) + `combined_text` 키워드 그룹(정의/호출처 서술); checks — `min_grounded_evidence_count`, `critic_warning_absent`(`usage_cross_check_missing`). 기존 `trace-symbol` 케이스는 무변경(추이 연속성 — R8).
- [X] T020 [P] 문서 (FR-010): `DESIGN.md` §11.3 경고 카탈로그에 `usage_cross_check_missing` 추가·§11.4에 symbol_trace gate 합류 서술; `CHANGELOG.md`에 `## v0.8.5 - Unreleased` 섹션(인덱서 결정성 fix + gate/warning + 프롬프트, surface 불변 명시); README는 벤치마크 케이스 언급이 필요한 경우만 최소 갱신.
- [X] T021 통합 검증 (quickstart §4-§5, 실 API — operator 단계): ① `scripts/integration-test.mjs` 5/5; ② SC-001 — `trace_symbol(symbol='buildReportCritic')` 라이브 5회: `verified`+`high`인데 cross-check 관측 0인 응답 **0건** 기록; ③ 벤치마크 `--case trace-symbol-cross-check` + 전체 스위트: 기존 trace-symbol pass 비회귀(SC-003), `avgToolTurns` +2 이내·내부 토큰 +25% 이내(SC-004, v0.8.4 baseline 대비); 결과 수치를 본 파일 Notes에 기록.
- [X] T022 마무리: `npm test` 최종 0 fail; Polish 변경 commit(`docs(spec-026)`/`feat(spec-026): benchmark reflection`); 브랜치 정리 후 PR 생성 준비 (머지 시 landing: spec.md Status → implemented + 검증 수치, CHANGELOG 날짜는 다음 릴리즈).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 즉시 시작 가능.
- **Foundational (Phase 2)**: 없음 — T001 완료 즉시 모든 스토리 시작 가능.
- **User Stories (Phase 3-5)**: 상호 독립 (프로덕션 파일 disjoint: US1=runtime/critic, US2=repo-tools, US3=prompt). 우선순위 순차(P1→P2→P3) 권장 — US1과 US3가 `tests/runtime.mock.test.mjs`를 공유하므로 병렬 시 같은 테스트 파일 충돌 주의.
- **Polish (Phase 6)**: T018/T019/T020은 US1 완료 후 가능([P] — 서로 다른 파일); T021은 모든 스토리 + T018/T019 완료 후; T022 마지막.

### Within Each User Story

- 테스트 먼저 작성 → FAIL 확인 → 구현 → green → `npm test` 전체 → commit (story당 commit 1개, 프로젝트 관례).

### Parallel Opportunities

- T002 ∥ T003 (다른 테스트 파일), T010 ∥ (US1 진행 중 — 다른 파일), T015 ∥ T010, T018 ∥ T019 ∥ T020 (evaluator+test / adoption.json / docs).

## Parallel Example: User Story 1

```text
# 동시 착수 가능 (다른 파일):
Task: "T002 critic unit tests in tests/critic.test.mjs"
Task: "T003 runtime gate scenarios in tests/runtime.mock.test.mjs"
# 이후 순차: T004(FAIL 확인) → T005(runtime 관측) → T006(critic) → T007(배선) → T008(검증) → T009(commit)
```

## Implementation Strategy

- **MVP**: Phase 1 + Phase 3 (US1)만으로 과신 모드 제거 — 단독 출하 가능.
- **Incremental**: US1 검증 → US2(인덱서 — 발화 빈도 감소) → US3(프롬프트 — 비용 절감) → Polish(벤치·문서·라이브 SC 검증). 각 checkpoint에서 독립 검증.
- **실행 방식**: subagent-driven(task당 fresh subagent + 2단계 리뷰) 권장 — spec 025와 동일 절차.

## Notes

- (T013/T021 실측 수치 기록 자리)

### T013 실측 수치 (2026-06-10)

`buildReportCritic` 5-run 검증 결과 (`src/explorer/repo-tools.mjs` US2 fix 적용 후):

- **5/5 identical**: true (결정적 출력 확인)
- **definition**: 항상 존재 (`src/explorer/critic.mjs:576`)
- **callerCount**: 68 (grep maxResults=80으로 전체 58→68 매치 수집, 모두 반환)
- **callers.length**: 20 (round-robin diversity cap 적용 후 선택)
- **truncated**: true (68 callable usages > 20 선택 슬롯)
- **`src/explorer/runtime.mjs` 포함**: true (`:2435 [call]` — 프로덕션 호출처)
- fix 전 3/11회 → fix 후 5/5회 결정적 포함

### T021 실측 수치 (2026-06-10, 실 API)

**① 통합 테스트**: 5/5 PASS (explore_repo quick/normal, freeExplore 기본/advanced, tool validation).

**② SC-001 라이브 (`trace_symbol(symbol='buildReportCritic')` 5회)**:
- **violations(verified+high인데 grep 관측 0): 0건** — SC-001 PASS.
- 5/5 모두 `verified`/`high`이면서 **grepCalls=1**(cross-check 수행) → gate 미발화(`usage_cross_check_missing` 0건). 즉 US3 프롬프트 유도가 cross-check를 실행시켜 US1 gate가 조용한 정상 경로.
- 5/5 모두 **`src/explorer/runtime.mjs` 프로덕션 호출처가 targets에 포함**(US2 인덱서 fix + US3 유도 효과). 과거 프로브의 과신 모드(grep=0 + runtime.mjs 누락)가 라이브에서 재현되지 않음.
- gate의 *부정* 동작(미관측 시 강등+경고)은 결정적 mock 테스트(SC-002, tests/runtime.mock.test.mjs)가 담당 — 라이브는 "조용한 과신 0건"만 검증.

**③ 벤치마크 (adoption suite, record-only)**: 9/9 PASS, 평균 94%.
- **SC-003 (회귀)**: 기존 `trace-symbol` 케이스 **score=1.0** — 비회귀 PASS.
- 새 `trace-symbol-cross-check` 케이스: pass(0.867) — `target_paths` runtime.mjs 1/1, `critic_warning_absent`(usage_cross_check_missing) check PASS, grounded evidence 8.
- **SC-004 (비용, per-case)**: `trace-symbol` turns=5/tokens=40858/grep=1, `trace-symbol-cross-check` turns=6/tokens=49236/grep=1 — 두 케이스 모두 cross-check를 정확히 grep 1회로 수행, +2턴 한도 내. (record-only 정책상 게이트 아님; 수치는 정보용.)
