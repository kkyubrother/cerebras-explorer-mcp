# Implementation Plan: Transcript-Based Adoption Metrics

**Branch**: `007-transcript-adoption-metrics` | **Date**: 2026-05-21 | **Spec**: `specs/007-transcript-adoption-metrics/spec.md`

**Input**: Feature specification from `specs/007-transcript-adoption-metrics/spec.md`

**Origin Plan**: `docs/superpowers/plans/2026-05-19-tool-quality-improvements.md` Task 7 (Add Transcript-Based Adoption Metrics)

## Summary

V2 백엔드 채택 여부를 정량 비교하기 위해 transcript JSONL에서 broad search, read, repeated tool plan, stoppedByBudget 같은 채택 신호를 추출하는 zero-dependency 모듈 `src/benchmark/transcript-metrics.mjs`를 신설한다. `scripts/run-benchmark.mjs`의 케이스 루프는 `result.transcriptPath`가 존재할 때만 분석 함수를 호출해 케이스별 `transcriptMetrics`를 채워 넣고, 같은 파일의 `computeExtendedMetrics()`는 transcript 메트릭이 있는 케이스만 모아 `avgBroadSearchCalls`/`avgRepeatedToolPlanTurns`(소수 1자리 반올림, 없으면 `null`)를 보고서에 노출한다. 보조로 `benchmarks/adoption.json`의 기존 케이스에 `min_evidence_snippet_count` 체크를 보강해 evidence 인용을 채택 점수에 반영한다. transcript 인프라(`src/explorer/transcript.mjs` `createTranscriptRecorder`, `src/explorer/runtime.mjs` 1949/2118/2197 라인의 기록 호출부)는 이미 존재하므로 본 작업에서는 재사용만 한다.

## Technical Context

**Language/Version**: Node.js 18+ (ESM, `node:fs/promises`, `node:test`)

**Primary Dependencies**: 없음 (zero-dep). 기존 모듈 `src/explorer/transcript.mjs`(transcript JSONL 작성)와 `scripts/run-benchmark.mjs`(케이스 루프 + `computeExtendedMetrics`)만 재사용.

**Storage**: transcript JSONL 파일(한 줄당 하나의 `{ type, turn, tool, toolCalls, error, stats, ... }` 엔트리). 본 작업은 읽기 전용.

**Testing**: `node --test tests/benchmark-transcript-metrics.test.mjs` (그리고 회귀 확인용 `npm test`).

**Target Platform**: 개발자 워크스테이션 + CI(Windows/macOS/Linux), 벤치마크 러너가 도는 동일 환경.

**Project Type**: Single project (MCP server + benchmark CLI). 본 변경은 `src/benchmark/`와 `scripts/`에만 영향.

**Performance Goals**: 케이스당 transcript 1개를 메모리에 읽어 라인 단위 파싱; 일반 transcript 크기(수십~수백 KB)에서 케이스당 수십 ms 이내. 벤치마크 전체 실행 시간 영향 무시 가능.

**Constraints**:
- transcript가 비활성화된 환경(`CEREBRAS_EXPLORER_TRANSCRIPT` 미설정)에서 `result.transcriptPath`가 `null`이면 분석 함수도 `null`을 돌려주고 평균 계산에서 제외해야 한다.
- JSON 파싱 오류는 케이스 단위로 격리해 다른 케이스 실행을 막지 않는다.
- 새 런타임 의존성 추가 금지. 표준 라이브러리만 사용.
- transcript 카테고리(`BROAD_SEARCH_TOOLS`, `READ_TOOLS`)는 V2 도구 명세와 함께 떠다닐 수 있으므로 상수 한 곳에 모아 변경 비용을 낮춘다.

**Scale/Scope**: `benchmarks/adoption.json`의 케이스 약 8건 + 향후 `benchmarks/evidence-preservation.json` 케이스. 분석 함수는 케이스 1건당 1회 호출.

## Constitution Check

본 저장소에는 별도 constitution 파일이 들어와 있지 않다. 그래도 본 작업이 지켜야 할 자체 가드레일은 다음과 같다.

- 읽기 전용 신뢰 경계 유지: transcript 분석은 파일을 새로 읽기만 하며 어떤 쓰기/편집도 하지 않는다.
- 공개 도구 표면 변화 없음: MCP `tools/list`/`tools/call` 응답에는 영향이 없고, 변화는 벤치마크 보고서 객체 한정.
- Zero-dep 원칙 유지(`node:fs/promises`, `node:test`만 사용).
- 기존 transcript 스키마 재사용. `type: 'assistant' | 'tool' | 'meta'`, `turn`, `tool`, `toolCalls`, `error`, `stats` 키만 사용한다. 추가 필드는 무시한다.
- 비활성/오류 경로의 fail-safe: transcript 메트릭이 빈 케이스에서도 벤치마크는 그대로 통과해야 한다.

위 가드레일을 모두 만족하므로 별도 Complexity Tracking 항목은 비어 있다.

## Project Structure

### Documentation (this feature)

```text
specs/007-transcript-adoption-metrics/
├── plan.md              # 본 문서 (speckit-plan 산출물)
├── spec.md              # 입력 사양 (Draft)
└── tasks.md             # 후속 speckit-tasks 산출물 (이 plan에서는 생성하지 않음)
```

### Source Code (repository root)

```text
src/
└── benchmark/
    └── transcript-metrics.mjs    # 신규: analyzeTranscriptEntries / analyzeTranscriptFile

scripts/
└── run-benchmark.mjs             # 수정: result.transcriptPath 분석 + computeExtendedMetrics 평균 필드

benchmarks/
└── adoption.json                 # 수정: 기존 케이스에 min_evidence_snippet_count 체크 보강

src/
└── benchmark/
    └── report.mjs                # 검토만: 경로 sanitization 영향 없는지 확인 (수정 없음)

src/
└── explorer/
    ├── transcript.mjs            # 참고: createTranscriptRecorder, 268라인 근처 (수정 없음)
    └── runtime.mjs               # 참고: 1949/2118/2197 라인의 record 호출부 (수정 없음)

tests/
└── benchmark-transcript-metrics.test.mjs  # 신규: 합성 entries 두 종 단위 테스트
```

**Structure Decision**: 신규 모듈 1개(`src/benchmark/transcript-metrics.mjs`)와 신규 테스트 1개(`tests/benchmark-transcript-metrics.test.mjs`)를 만들고, `scripts/run-benchmark.mjs`와 `benchmarks/adoption.json`만 수정한다. 원본 plan은 보고서 평균 필드를 `src/benchmark/report.mjs::computeExtendedMetrics`에 추가한다고 적혀 있지만, 현재 저장소에서는 `computeExtendedMetrics`가 `scripts/run-benchmark.mjs` 안에 정의돼 있다. 본 plan은 실제 위치에 맞춰 `scripts/run-benchmark.mjs` 내부의 `computeExtendedMetrics()`를 확장하고, `report.mjs`는 변경하지 않는다(필요 시 후속 작업으로 `report.mjs`로 이전 가능).

## Implementation Outline

(a) `src/benchmark/transcript-metrics.mjs`에 두 함수 export:
- `analyzeTranscriptEntries(entries)`: 빈 배열 안전, `assistantTurns`, `toolCalls`, `broadSearchCalls`, `readCalls`, `toolErrorCalls`, `repeatedToolPlanTurns`, `stoppedByBudget` 7개 스칼라 필드를 가진 평면 객체를 반환.
- `analyzeTranscriptFile(filePath)`: `filePath`가 falsy면 `null`. `node:fs/promises`로 읽어 `\n` 분리 → 빈 줄 무시 → `JSON.parse` → `analyzeTranscriptEntries`에 위임.

(b) repeated tool plan 비교 알고리즘: `assistant` 엔트리만 추출해 `toolCalls`를 `[...].filter(Boolean).sort().join('|')`로 정규화. 직전 turn의 정규화된 plan과 동일하면 `repeatedToolPlanTurns += 1`. 빈 plan(`''`)은 비교 대상에서 제외해 잘못된 반복 카운트를 만들지 않는다.

(c) 도구 카테고리 분류는 모듈 상단 상수로 고정:
- `BROAD_SEARCH_TOOLS = new Set(['repo_grep', 'repo_find_files', 'repo_list_dir'])`
- `READ_TOOLS = new Set(['repo_read_file', 'repo_symbol_context', 'repo_symbols', 'repo_references'])`
`tool` 엔트리만 모아 카테고리별 카운트를 계산. 분류에 속하지 않는 도구는 어느 카운터에도 더하지 않는다.

(d) `scripts/run-benchmark.mjs` 케이스 루프(현재 235라인 근처 `const caseResult = { caseDefinition, evaluation, result, elapsedMs };`) 직전에 다음을 추가:
```js
const transcriptMetrics = result.transcriptPath
  ? await analyzeTranscriptFile(result.transcriptPath).catch(() => null)
  : null;
const caseResult = { caseDefinition, evaluation, result, elapsedMs, transcriptMetrics };
```
모듈 상단에 `import { analyzeTranscriptFile } from '../src/benchmark/transcript-metrics.mjs';`를 추가.

(e) 같은 파일의 `computeExtendedMetrics(caseResults)` 끝에서 transcript 가진 케이스만 모아 두 평균을 계산하고, 반환 객체에 다음을 추가:
```js
avgBroadSearchCalls:
  transcriptCases.length > 0
    ? Math.round((sumBroad / transcriptCases.length) * 10) / 10
    : null,
avgRepeatedToolPlanTurns:
  transcriptCases.length > 0
    ? Math.round((sumRepeated / transcriptCases.length) * 10) / 10
    : null,
```
콘솔 요약 블록(현재 267~278라인 근처 `if (metrics) { ... }`)에 두 줄을 추가해 운영자가 즉시 비교할 수 있게 한다.

(f) `benchmarks/adoption.json`의 기존 케이스 중 evidence가 있는 워크플로(`map-change-impact`, `review-change-context` 등 현재 `min_evidence_snippet_count` 체크가 빠진 케이스)에 다음 체크를 보강:
```json
{ "label": "Citations or evidence snippets present",
  "type": "min_evidence_snippet_count", "value": 1, "weight": 0.1 }
```
`min_citation_count`는 Task 3에서 추가될 report-mode 케이스에서 사용하므로 본 작업에서는 손대지 않는다. weight 합이 1을 넘지 않도록 기존 체크 weight를 재조정한다(주변 weight를 0.05씩 줄이는 최소 변경).

(g) `tests/benchmark-transcript-metrics.test.mjs`에 다음 두 케이스 + 보강 케이스 추가:
1. 요약 케이스: 단일 broad search + 두 read + meta `stats.stoppedByBudget: false` → 7개 필드 정확히 검증(`assistantTurns: 2`, `broadSearchCalls: 1`, `readCalls: 2`, `repeatedToolPlanTurns: 0`).
2. 반복 plan 케이스: 두 assistant 턴이 동일 `['repo_grep']`을 사용 + 한 tool 결과 `error: true` → `repeatedToolPlanTurns === 1`, `toolErrorCalls === 1`.
3. (옵션) `analyzeTranscriptFile(null) === null` 보강 케이스.

## Risks & Mitigations

- **R1. transcript가 비활성화돼 `transcriptPath`가 `null`인 환경**: `analyzeTranscriptFile`이 falsy 입력에서 `null`을 돌려주고, 케이스 루프도 `result.transcriptPath` 체크로 호출 자체를 건너뛴다. `computeExtendedMetrics`는 transcript 가진 케이스만 필터링해 `null` 평균을 보고한다. 단위 테스트의 `null` 경로와 보고서 평균 `null` 케이스로 보호한다.
- **R2. transcript JSONL이 부분적으로 깨진 줄을 포함**: `JSON.parse` 실패는 케이스 단위로 격리(`.catch(() => null)`). 다른 케이스 분석/벤치마크 전체 실행은 계속 진행되며 콘솔에는 해당 케이스 transcript 메트릭이 `null`로 표시된다. spec Acceptance Scenario US2.3 그대로다.
- **R3. `meta` 엔트리가 여러 번 등장(시작/중단/종료)**: 가장 마지막에 등장한 `meta` 중 `stats` 필드를 가진 엔트리를 기준으로 한다(`entries.slice().reverse().find(...)`). 단위 테스트에 마지막 우선 케이스를 명시 가정.
- **R4. `toolCalls` 필드가 누락되거나 배열이 아닌 assistant 엔트리**: `Array.isArray` 가드로 빈 plan 취급, 빈 plan은 직전과의 비교에서 제외해 잘못된 반복 카운트를 만들지 않는다.
- **R5. 도구 카테고리 stale(repo_* 도구 추가/삭제)**: broad/read 도구 집합을 모듈 상단 상수 한 곳에 고정하고 README/DESIGN의 도구 표와 같은 파일을 가까이 둔다(코드 코멘트로 출처 명시). 도구 추가 시 본 모듈만 수정하면 된다.
- **R6. `computeExtendedMetrics` 위치 불일치**: 원본 plan은 `src/benchmark/report.mjs`를 가리키지만 실제 함수는 `scripts/run-benchmark.mjs`에 정의돼 있다. 본 plan은 실제 위치에 맞춰 수정한다. 만약 후속 리팩터로 `report.mjs`로 이전된다면, transcript 메트릭 필드 이름과 라운딩 규칙을 그대로 유지해 호환을 깨지 않는다.

## Test Strategy

- **단위 테스트(`tests/benchmark-transcript-metrics.test.mjs`, 신규)**:
  1. 합성 transcript fixture 1 — 요약 시나리오: 두 assistant 턴, broad search 1회, read 2회, meta `stoppedByBudget: false`. 7개 필드를 전부 deep-equal로 비교해 누락 필드를 방지한다(SC-002 직접 보호).
  2. 합성 transcript fixture 2 — 반복 plan + tool error 시나리오: `repeatedToolPlanTurns === 1`, `toolErrorCalls === 1` 검증.
  3. `analyzeTranscriptFile(null)`이 `null`을 돌려주는지 검증(Edge Case + FR-006 보호).
- **회귀(`npm test`)**: 다른 벤치마크/MCP 테스트가 transcript 인프라를 건드리지 않는지 확인. `scripts/run-benchmark.mjs` 변경이 기존 `summarizeBenchmarkSuite`/`computeExtendedMetrics` 출력 형태(기존 필드)를 깨지 않음을 콘솔 요약 통합 테스트(이미 있는 `tests/integrations.test.mjs` 또는 신설 통합 테스트)로 가볍게 보호한다. 통합 테스트 추가는 본 plan 범위 밖이지만 회귀 신호로 활용한다.
- **수동/Provider 의존 검증(옵션)**: `npm run benchmark`을 실제 provider 키가 있는 환경에서 실행해 결과 JSON에 `avgBroadSearchCalls`/`avgRepeatedToolPlanTurns`가 등장하는지 확인. transcript가 꺼진 환경(`CEREBRAS_EXPLORER_TRANSCRIPT` 미설정)에서는 두 값이 `null`로 보고되는지 시각 점검(SC-003).
- **transcript 없는 케이스 경로 보호**: `caseResults` 전체가 `transcriptMetrics: null`일 때 `computeExtendedMetrics`의 평균 두 필드가 모두 `null`인지 확인하는 가벼운 단위/통합 테스트를 추가하는 것이 이상적이다(SC-003 보강). 본 plan에서는 우선순위 P2 단위 테스트에 같은 입력 가정을 명시한다.

## Complexity Tracking

> Constitution 위반 없음. 새 의존성 도입 없음. 본 표는 비어 있다.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| (none)    | (n/a)      | (n/a)                                |
