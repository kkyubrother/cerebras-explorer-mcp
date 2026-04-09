# 패치 적용 체크리스트

> 기준 날짜: 2026-04-09  
> 기준 문서: README.md (분석 보고서), REAL_PLAN.md (실행 계획표)  
> 현재 코드 상태를 직접 확인 후 작성

범례: ✅ 이미 완료 | 🔲 미완료 (해야 함) | ⚠️ 부분 완료

---

## Phase 0 — 기준선/안전망 (PR-1 전에)

| 상태 | 항목 | 위치 | 비고 |
|------|------|------|------|
| ✅ | `tests/runtime.mock.test.mjs` 파일 존재 | tests/ | mock 기반 통합 테스트 |
| ✅ | `tests/cerebras-client.test.mjs` 파일 존재 | tests/ | client 단위 테스트 |
| ✅ | `scripts/run-benchmark.mjs` 파일 존재 | scripts/ | benchmark runner |
| ✅ | JSON parse 성공률 지표 추가 | `tests/runtime.mock.test.mjs` | Phase 0 metric 테스트 추가 |
| ✅ | strict schema 적합률 지표 추가 | `tests/runtime.mock.test.mjs` | `assertStrictSchema()` 헬퍼 + 3개 budget 검증 |
| ✅ | 평균 tool turns 지표 추가 | `scripts/run-benchmark.mjs` | `computeExtendedMetrics()` 함수 추가 |
| ✅ | budget exhaustion 비율 지표 추가 | `scripts/run-benchmark.mjs` | `stoppedByBudget` 활용 |
| ✅ | no-tool 종료 경로 비율 지표 추가 | `scripts/run-benchmark.mjs` | `toolCalls === 0` 기준 |
| ✅ | grounded evidence 개수 지표 추가 | `scripts/run-benchmark.mjs` | exact+partial 합산 |
| ✅ | deep budget 평균 total tokens 지표 추가 | `scripts/run-benchmark.mjs` | deep budget 케이스만 필터링 |
| 🔲 | 현재 main 브랜치 기준 결과 1회 저장 | `benchmarks/` | 비교 기준선 확보 (실제 API 실행 필요) |

---

## Phase 1 — 최종 출력 경로 단일화 (PR-1, 최우선)

### 핵심 문제
`runtime.mjs:427–438` — `toolCalls.length === 0`일 때 `extractFirstJsonObject()`로 바로 break.  
`finalizeAfterToolLoop()`는 budget 소진 시에만 호출됨. → **strict schema를 항상 거치지 못함.**

| 상태 | 항목 | 위치 | 구체적 변경 내용 |
|------|------|------|-----------------|
| ✅ | no-tool 종료 시 `finalizeAfterToolLoop()` 항상 호출 | `runtime.mjs:427–438` | `extractFirstJsonObject()` + break 대신 `finalizeAfterToolLoop()` 호출로 교체 |
| ✅ | `finalizeAfterToolLoop()` `maxCompletionTokens: 2500` 하드코딩 제거 | `runtime.mjs:591` | budget별 `finalizeMaxCompletionTokens` 읽도록 변경 |
| ✅ | `BUDGETS`에 `finalizeMaxCompletionTokens` 필드 추가 | `config.mjs:123–151` | quick: 1500, normal: 2000, deep: 3000 |
| ✅ | `buildFinalizePrompt()` 강화 | `prompt.mjs` | HARD REQUIREMENTS + SCHEMA REQUIREMENTS 명시 |
| ✅ | `extractFirstJsonObject()`를 최후 fallback으로만 사용 | `runtime.mjs`, `cerebras-client.mjs` | finalize 내부에서 structured output 실패 시에만 사용 |
| ✅ | 테스트: no-tool 종료도 strict finalize 통과 검증 | `tests/runtime.mock.test.mjs` | `Phase 1 — no-tool exit` 테스트 추가 |
| ✅ | 테스트: finalize prompt가 tool 호출 없이 끝남 검증 | `tests/runtime.mock.test.mjs` | `Phase 1 — finalize prompt` 테스트 추가 |
| ✅ | 테스트: malformed freeform content 입력 시에도 최종 JSON이 schema 준수 | `tests/runtime.mock.test.mjs` | `Phase 1 — malformed freeform` 테스트 추가 |

---

## Phase 2 — Cerebras/GLM-4.7 파라미터 정렬 (PR-2)

### 현재 상태 확인
- `DEFAULT_EXPLORER_TEMPERATURE = 1` ✅ (`config.mjs:6`)
- `DEFAULT_EXPLORER_TOP_P = 0.95` ✅ (`config.mjs:7`)
- `getExplorerClearThinking()` → GLM-4.7에서 `false` 반환 ✅ (`config.mjs:54–60`)
- `getReasoningEffortForBudget()` → quick: `'none'`, normal/deep: `undefined` ✅ (`config.mjs:197–211`)
- `cerebras-client.mjs` — `top_p`, `clear_thinking`, `reasoning_format` 페이로드 포함 ✅
- `message.reasoning` 추출 ✅ (`cerebras-client.mjs:210`)
- reasoning round-trip (`assistantMessage.reasoning`) ✅ (`runtime.mjs:413–415`)

### 미완료 항목

| 상태 | 항목 | 위치 | 구체적 변경 내용 |
|------|------|------|-----------------|
| ✅ | budget별 temperature 차별화 | `config.mjs` + `runtime.mjs:351` | quick: 0.3 / normal: 0.8 / deep: 1.0 — BUDGETS에 temperature 필드 추가 |
| ✅ | budget별 top_p 명시 | `config.mjs` | 세 budget 모두 `topP: 0.95` 명시 |
| ✅ | runtime에서 global temperature 대신 budget별 temperature 사용 | `runtime.mjs:351–352` | `budgetConfig.temperature ?? getExplorerTemperature()` |
| ✅ | 테스트: quick budget payload에 `reasoning_effort: 'none'` 포함 검증 | `tests/cerebras-client.test.mjs` | Phase 2 테스트 추가 |
| ✅ | 테스트: normal/deep payload에 `clear_thinking: false` 포함 검증 | `tests/cerebras-client.test.mjs` | Phase 2 테스트 추가 |
| ✅ | 테스트: budget별 temperature 값이 payload에 올바르게 들어가는지 검증 | `tests/cerebras-client.test.mjs` | Phase 2 테스트 추가 |
| ✅ | 테스트: assistant reasoning이 다음 turn에 round-trip되는지 검증 | `tests/runtime.mock.test.mjs` | 기존 "forwards assistant reasoning" 테스트가 커버 (temperature assertion 업데이트) |

---

## Phase 3 — 프롬프트 구조 재배치 + 전략 유연화 (PR-3)

### 현재 상태
`prompt.mjs` system prompt 순서: `역할 → 핵심 원칙 → 전략 가이드 → 도구 설명 → 프로젝트 컨텍스트 → JSON shape → budget`  
→ GLM-4.7 권장 순서 아님. hard constraint가 뒤쪽에 분산됨.

| 상태 | 항목 | 위치 | 구체적 변경 내용 |
|------|------|------|-----------------|
| ✅ | system prompt 순서 재배치 | `prompt.mjs:buildExplorerSystemPrompt()` | 역할 → HARD REQUIREMENTS → FINAL OUTPUT CONTRACT → LANGUAGE RULE → TOOL ORDER POLICY → QUALITY TARGETS → STRATEGY CATALOG → PROJECT CONTEXT |
| ✅ | HARD REQUIREMENTS / QUALITY TARGETS 두 층 분리 | `prompt.mjs` | ##HARD REQUIREMENTS (실패) vs ##QUALITY TARGETS (soft 목표) 명시 |
| ✅ | default language를 system prompt에도 명시 | `prompt.mjs` | language 파라미터 추가 + LANGUAGE RULE 섹션, runtime.mjs에서 args.language 전달 |
| ✅ | tool-order를 decision policy 형태로 변경 | `prompt.mjs` | ##TOOL ORDER POLICY 섹션 추가 |
| ✅ | user prompt의 `Follow the {strategy} strategy above.` 완화 | `prompt.mjs:buildExplorerUserPrompt()` | "Initial strategy suggestion" + "1회 전환 허용" 문구 |
| ✅ | 전략 복합 감지 지원 | `prompt.mjs:detectStrategy()` | matches[] 누적 → 단일 string 또는 string[] 반환 |
| ✅ | 테스트: system prompt 앞 30줄 내 hard rule 배치 검증 | `tests/runtime.mock.test.mjs` | Phase 3 테스트 추가 |
| ✅ | 테스트: 한국어 task에서 answer/summary language 일관성 검증 | `tests/runtime.mock.test.mjs` | LANGUAGE RULE 섹션 + explicit language 테스트 추가 |

---

## Phase 4 — 멀티턴 안정화 장치 (PR-4)

| 상태 | 항목 | 위치 | 구체적 변경 내용 |
|------|------|------|-----------------|
| 🔲 | Checkpoint message 삽입 (4~5턴마다) | `runtime.mjs` agentic loop | "지금까지 근거로 답 가능한가? 불가능하면 다음 tool 1개만 선택" user 메시지 삽입 |
| 🔲 | critic-lite verify pass 추가 | `runtime.mjs:finalizeAfterToolLoop()` 또는 별도 단계 | finalize 직전 "unsupported claim 있으면 confidence 낮춤" 1회 pass |
| 🔲 | evidence ledger 프롬프트 규칙 추가 | `prompt.mjs` | 탐색 중 `{path, startLine, endLine, why}` 후보를 내부 관리하도록 명시 |
| 🔲 | too-early stop 방지 규칙 추가 | `prompt.mjs` | why/bug/root-cause → 독립 근거 2개 이상 권장, locate/define → 1개 허용 |
| 🔲 | 테스트: deep budget에서 budget exhaustion 비율 감소 확인 | `scripts/run-benchmark.mjs` | Phase 0 기준선과 비교 |
| 🔲 | 테스트: confidence=high인데 evidence 1개뿐인 케이스 감소 확인 | `tests/runtime.mock.test.mjs` | |

---

## Phase 5 — evidence/schema/context 고도화 (PR-5)

| 상태 | 항목 | 위치 | 구체적 변경 내용 |
|------|------|------|-----------------|
| 🔲 | evidence union type 확장 | `schemas.mjs` | `file_range`, `git_commit`, `git_blame` 타입 추가 |
| 🔲 | `sessionCandidatePaths` 구조화 | `session.mjs` | `string[]` → `{ path: string, why: string }[]` |
| 🔲 | 오래된 tool result compaction 도입 | `runtime.mjs` | checkpoint마다 raw tool JSON을 summary로 축약, 토큰 절약 |
| 🔲 | strategy별 동적 tool 노출 검토 | `runtime.mjs:buildToolDefinitions()` 호출부 | deep/context-heavy 세션에서 불필요 tool 제외 |
| 🔲 | 테스트: git/blame 중심 질문에서 evidence 타입 검증 | `tests/runtime.mock.test.mjs` | |
| 🔲 | 테스트: session 재사용 시 candidatePaths가 `{path, why}` 형태 | `tests/session.test.mjs` | |

---

## 지금 당장 할 수 있는 핫픽스 (PR 없이 즉시)

설정 핫픽스 — Phase 2에서 budget별 temperature 분리가 오래 걸린다면, 아래만 먼저 반영:

```js
// config.mjs BUDGETS 수정안
quick:  { ..., temperature: 0.3, topP: 0.95 },
normal: { ..., temperature: 0.8, topP: 0.95 },
deep:   { ..., temperature: 1.0, topP: 0.95 },
```

그리고 `runtime.mjs:351`에서:
```js
// before
const temperature = getExplorerTemperature();
const topP = getExplorerTopP();

// after
const temperature = budgetConfig.temperature ?? getExplorerTemperature();
const topP = budgetConfig.topP ?? getExplorerTopP();
```

---

## PR 단위 요약

| PR | Phase | 핵심 |
|----|-------|------|
| PR-1 | Phase 0 + 1 | 기준선 확보 + 출력 경로 단일화 |
| PR-2 | Phase 2 | budget별 temperature + 파라미터 정렬 |
| PR-3 | Phase 3 | 프롬프트 구조 재배치 + 전략 유연화 |
| PR-4 | Phase 4 | Checkpoint / critic-lite / evidence ledger |
| PR-5 | Phase 5 | Schema/context 확장 |

> **코드 착수 1순위**: `runtime.mjs:427–438` — no-tool 종료 경로를 `finalizeAfterToolLoop()`로 통일  
> **설정 핫픽스 1순위**: `BUDGETS`에 per-budget `temperature` 추가
