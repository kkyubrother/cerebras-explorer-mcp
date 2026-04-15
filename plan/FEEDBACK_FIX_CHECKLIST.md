# Feedback Fix Checklist (2026-04-15 검증 기준)

> 작성일: 2026-04-15
> 기준: 2026-04-15 피드백 사실 여부 검증 결과
> 범위: 실제로 수정이 필요한 항목만 포함

---

## 메모

- `"explore_repo 전용 catch가 단순 중복"`이라는 원래 피드백 문구는 부정확하다.
- 실제 수정 포인트는 `explore_repo` 실행 실패를 `Invalid arguments`로 오분류하는 문제다.

---

## Phase 1 — P0: Runtime Loop Safety

**수정 파일:** `src/explorer/runtime.mjs`, `tests/runtime.mock.test.mjs`

### 목표

- consecutive all-error circuit breaker를 실제로 동작시킨다.
- LLM compaction 이후에도 tool-calling message sequence를 깨지 않는다.

### 체크리스트

- [x] `explore()`에서 `consecutiveAllErrorTurns`와 recovery guidance 순서를 재정의한다.
- [x] `freeExploreV2()`에도 동일한 circuit breaker 규칙을 적용한다.
- [x] circuit breaker 발동 기준과 recovery 주입 기준을 코드와 주석으로 명확히 고정한다.
- [x] recovery guidance 주입 시 breaker 관련 카운터가 무조건 0으로 초기화되지 않도록 조정한다.
- [x] `compactWithLlmSummary()`를 "최근 N개 메시지"가 아니라 "최근 N개 turn" 기준 보존으로 바꾼다.
- [x] preserve 구간의 첫 메시지가 `tool`이 되지 않도록 보장한다.
- [x] preserved `assistant.tool_calls`와 후속 `tool` 메시지가 짝을 잃지 않도록 보장한다.

### 추가 테스트

- [x] `consecutive all-error turns can trip circuit breaker`
- [x] `stagnation recovery does not make circuit breaker unreachable`
- [x] `LLM compaction never returns orphaned tool message`
- [x] `LLM compaction preserves assistant/tool_call/tool result blocks`

---

## Phase 2 — P0: Output Correctness

**수정 파일:** `src/explorer/runtime.mjs`, `tests/runtime.mock.test.mjs`

### 목표

- Mermaid 다이어그램이 실제로 관찰된 관계만 표현하게 만든다.
- 관계 근거가 없으면 그럴듯한 가짜 엣지를 만들지 않는다.

### 체크리스트

- [ ] `buildMermaidDiagram()`에서 entry -> all modules fanout 생성을 제거한다.
- [ ] 실제 edge 정보를 만들 수 있는 근거가 있을 때만 dependency edge를 출력한다.
- [ ] edge 근거가 없으면 nodes-only 다이어그램 또는 `null` 반환 중 하나로 정책을 고정한다.
- [ ] entry point 강조와 dependency edge 의미를 분리해서 코드와 주석에 반영한다.

### 추가 테스트

- [ ] 근거 없는 synthetic fanout edge가 생성되지 않는다.
- [ ] edge 데이터가 없을 때 선택한 fallback 정책이 유지된다.

---

## Phase 3 — P1: Error Surface and Diagnostics

**수정 파일:** `src/mcp/server.mjs`, `tests/mcp-server.test.mjs`

### 목표

- validation 에러와 runtime/execution 에러를 구분한다.
- `explore_repo` 실패가 잘못된 이유로 사용자에게 노출되지 않게 한다.

### 체크리스트

- [ ] `error.code === -32602`는 argument validation 에러에만 사용되도록 정리한다.
- [ ] `name === 'explore_repo'` fallback catch를 제거하거나 범위를 좁힌다.
- [ ] runtime/provider 실패는 `Invalid arguments`가 아닌 실행 실패로 응답하게 한다.
- [ ] 사용자-facing 에러 문구가 실제 실패 원인과 맞는지 정리한다.

### 추가 테스트

- [ ] `explore_repo` validation failure는 invalid arguments로 반환된다.
- [ ] `explore_repo` runtime failure는 invalid arguments로 오분류되지 않는다.

---

## Phase 4 — P1: Cost and Performance Controls

**수정 파일:** `src/explorer/cache.mjs`, `src/explorer/repo-tools.mjs`, `src/explorer/runtime.mjs`, `src/explorer/config.mjs`

### 목표

- avoidable serialization 비용을 줄인다.
- V2의 추가 turn 예산을 하드코딩 대신 제어 가능하게 만든다.

### 체크리스트

- [ ] `LruCache.set()`에 `sizeBytes`를 외부에서 전달할 수 있는 경로를 추가하거나 동등한 최적화를 넣는다.
- [ ] 이미 직렬화 길이를 알고 있는 호출자가 있으면 그 값을 재사용할 수 있게 한다.
- [ ] cache size 추정 방식과 정확도 한계를 코드 주석 또는 문서에 명시한다.
- [ ] `freeExploreV2()`의 `maxTurns * 2`를 config/env 기반 multiplier 또는 명시적 상한으로 치환한다.
- [ ] compaction 횟수 또는 추가 turn 소모에 대한 상한 정책을 정한다.

### 추가 테스트

- [ ] cache size precompute 경로가 기존 eviction 동작을 깨지 않는다.
- [ ] V2 turn multiplier 기본값과 override가 의도대로 동작한다.

---

## Phase 5 — P2: Maintainability Cleanup

**수정 파일:** `src/explorer/runtime.mjs`, `src/explorer/repo-tools.mjs`

### 목표

- tool metadata의 단일 소스를 만든다.
- 반복 로직을 필요한 만큼만 줄인다.

### 체크리스트

- [ ] tool name의 권위 있는 소스를 하나로 통합한다.
- [ ] `KNOWN_TOOL_NAMES`를 별도 literal set으로 유지하지 않도록 정리한다.
- [ ] `incrementToolStats()`의 if-chain을 lookup table 기반으로 바꾼다.
- [ ] `explore()`, `freeExplore()`, `freeExploreV2()`에서 정말로 공통인 블록만 helper로 추출한다.
- [ ] finalization/compaction/reporting처럼 모드별 차이가 큰 부분은 억지로 합치지 않는다.

### 추가 테스트

- [ ] 새 tool 추가 시 validation 목록과 정의 목록이 자동으로 함께 갱신된다.

---

## Done 기준

- [ ] P0 항목이 모두 완료되고 회귀 테스트가 추가된다.
- [ ] P1 항목이 완료되고 에러 문구 및 예산 정책이 문서화된다.
- [ ] P2 리팩토링은 동작 변경 없이 머지 가능한 크기로 분리된다.
