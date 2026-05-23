# Legacy & Misalignment Audit — 2026-05-20

> 본 보고서는 코드 수정 없이 작성된 **감사 결과 스냅샷**이다. 코드가 한 번 바뀌면 본 문서는 즉시 stale이 되므로 지속 참조용 문서가 아니다.
> 2026-05-21 기준 후속 코드 수정으로 일부 지적 사항은 이미 해소되었다. 특히 compact schema 예시, stdio 예시, integration script 관련 항목은 현재 상태와 다를 수 있으므로 이 문서는 과거 감사 입력으로만 사용한다.
> 2026-05-21 문서 정리에서 `plan/README.md`는 남아 있는 계획 파일을 과거 기록으로 설명하도록 갱신되었다.

---

## 1. 프로젝트 목적 재확인 (Phase 1 요약)

`cerebras-explorer-mcp`는 Claude Code / Codex 같은 상위 코딩 에이전트가 파일 탐색에 메인 컨텍스트를 쓰지 않도록, **Cerebras 모델(기본 `zai-glm-4.7`)이 MCP 서버 내부에서 자율 탐색 루프를 돌리고 grounded evidence + 구조화 JSON / Markdown 보고서만 반환**하는 read-only explorer다. 공개 도구 표면은 `explore_repo` + 6개 목적형 wrapper(`find_relevant_code`, `trace_symbol`, `map_change_impact`, `explain_code_path`, `collect_evidence`, `review_change_context`) + 사람용 Markdown 보고서 `explore`로 구성된 기본 8개이며, `explore_v2`는 `CEREBRAS_EXPLORER_ENABLE_EXPLORE_V2=true`로만 노출되는 opt-in이다. zero-dependency / read-only / secret deny-list+redaction이라는 세 가지 설계 제약을 유지하며, `EXPLORER_PROVIDER`/`EXPLORER_FAILOVER`처럼 OpenAI-compat·failover 경로는 DESIGN.md에서 "내부 구현이며 공개 계약 아님"으로 명시되어 있다. 따라서 (1) 메인 에이전트에 raw 파일 도구를 노출하거나 (2) 옛 top-level 필드명을 쓰거나 (3) Cerebras 기반 explorer가 아닌 경로를 1급 시민처럼 다루는 코드/문서는 모두 1차 의심 대상이다.

---

## 2. Executive Summary

### 발견 건수 by 카테고리

| 카테고리 | 건수 | 비고 |
|---|---|---|
| DEAD | 0 | trace_symbol/grep 상호 검증에서 호출자 0 모듈은 발견 못함 |
| DEPRECATED | 0 | CHANGELOG / DESIGN에 명시적 "deprecated" 마커 0 |
| SUPERSEDED | 3 | 동일 책임의 신규 경로가 있으며 옛 키를 backward-compat shim으로 유지 |
| MISALIGNED | 5 | 동작은 하지만 현행 compact 계약·핵심 목적과 어긋남 |
| STALE_FIXTURE | 4 | 가리키는 코드/문서가 이미 사라졌거나 형식이 옛 스키마 |
| NOISE | 4 | **이미 `.gitignore`에 포함되어 git tracked 아님 — 작업 트리 한정** |
| 회색 지대 | 4 | 작성자 확인 필요 |

### 사용자 가정 정정 (중요)

본 작업 지시는 `bash.exe.stackdump`, `benchmark-report.json`, `.codex/`, `.claude/`를 "쓰레기/커밋되지 말았어야 할 산출물"로 분류했다. `git ls-files --error-unmatch`로 확인한 결과 **네 항목 모두 git에 추적되지 않는다**(`.gitignore` 11–15행에 이미 포함). 따라서 NOISE는 맞지만 "제거" 대상이 아니라 "확인 완료, 조치 불필요"다. 보고서 §3.6에서 자세히 다룬다.

### Top 5 제거/정리 우선순위

| 순위 | 항목 | 카테고리 | 영향 대비 가치 | 제안 |
|---|---|---|---|---|
| 1 | `scripts/integration-test.mjs` 옛 필드 가정 | MISALIGNED | **높음** — `CEREBRAS_API_KEY`로 실제 호출되는 통합 회귀가 현행 compact 계약과 어긋남. 모든 check가 false가 될 수 있어 신호 가치 손상. | 옛 필드명을 새 계약(`directAnswer`, `status.confidence`, `evidenceQuality`, `targets[].path`)로 갱신. |
| 2 | `examples/expected-response.json` 옛 스키마 | MISALIGNED | 중간 — 사용자가 `expected-response`를 신뢰 가능한 계약 예시로 읽으면 잘못된 기대치 형성. | `schemaVersion`, `evidenceQuality`, `failure: null`, `session`, `searchCoverage`를 추가하고 "Discovered candidate path" → "Discovered path"로 통일. |
| 3 | `docs/superpowers/plans/` 3개 plan 문서 | STALE_FIXTURE | 중간 — checkboxes는 `[ ]`인데 commits는 모두 landed. plan/README.md는 "완료 plan 삭제" 정책. | 체크박스 일괄 `[x]` 처리 후 plan/ 또는 별도 `completed/` 디렉터리로 이동, 또는 정책대로 삭제. |
| 4 | `src/benchmark/evaluator.mjs` `candidatePaths` 호환 shim | SUPERSEDED | 낮음 — 신규 출력에는 `candidatePaths`가 없어 fallback이 항상 `targets[].path`로 떨어짐. 비용은 낮지만 신호 가치도 낮음. | `getCandidatePaths()`/`candidate_paths` 소스/`min_candidate_path_count` 체크 타입을 `targets` 직접 사용으로 단순화하거나 명시적 deprecation 주석 추가. |
| 5 | `examples/call-server-via-stdio.mjs` Content-Length only | MISALIGNED | 낮음 — 서버가 두 framing 모두 지원하므로 실동작 OK. 그러나 README.md 530–540행은 신형 NDJSON를 1급 시민으로 소개. | NDJSON 변형 예시 1개 추가 또는 현재 파일을 NDJSON 기반으로 교체. |

---

## 3. 카테고리별 상세

### 3.1 DEAD

확인 결과 본 카테고리에 분류 가능한 항목 없음.

- `src/explorer/{cache,transcript,security,redact,session,critic,symbols,schemas,repo-tools,prompt,cerebras-client,config}.mjs`, `src/explorer/providers/*`, `src/mcp/*`, `src/benchmark/*`의 모든 모듈은 `runtime.mjs` 또는 `server.mjs` 또는 활성 테스트에서 import된다.
- `prompt.mjs`, `critic.mjs`, `config.mjs`의 모든 named export는 `grep -E '^export'` 후 호출자 grep으로 확인 시 최소 1개 이상의 호출자가 있다(runtime/critic/tests 분포).
- 의심 대상이었던 `freeExplore`/`freeExploreV2`도 활성 (`src/mcp/server.mjs:700-792`, `src/explorer/runtime.mjs:1702`/`1974`에서 사용 중).

### 3.2 DEPRECATED

CHANGELOG.md 또는 DESIGN.md가 "deprecated"/"removed"/"replaced by"로 명시한 라이브 코드는 발견되지 않았다. CHANGELOG는 v0.2.0 변경분(Added/Security/Documentation)만 기록하고 폐기 표시는 없다.

### 3.3 SUPERSEDED

#### S-1. `src/benchmark/evaluator.mjs:20-27` `getCandidatePaths()` (backward-compat)

```js
function getCandidatePaths(result) {
  if (Array.isArray(result?.candidatePaths)) {
    return result.candidatePaths.filter(item => typeof item === 'string' && item.trim());
  }
  return (result?.targets ?? [])
    .map(item => item?.path)
    .filter(item => typeof item === 'string' && item.trim());
}
```

- **증거**: 현행 runtime은 `candidatePaths` 필드를 생성하지 않는다. `grep candidatePaths src/explorer/` → 0. `tests/regression.test.mjs:18`이 import하는 cache 헬퍼와 무관. `plan/checklist.md:32`도 "candidatePaths → targets" 마이그레이션을 명시.
- **영향 범위**: `tests/benchmark-evaluator.test.mjs`가 fallback 케이스를 검증할 수 있음 (`docs/superpowers/plans/completed/2026-05-19-first-pass-feedback-fixes.md` Task 3 Step 3에서 이 helper를 의도적으로 추가했다고 명시).
- **권고**: `keep-but-document` — 의도된 backward-compat shim이므로 함수 위에 "legacy benchmark JSON 호환용. 신규 runtime은 항상 targets만 생성." 한 줄 주석 추가.

#### S-2. `src/benchmark/evaluator.mjs:52-53` `candidate_paths` 소스

```js
case 'candidate_paths':
  return joinLines((result.targets ?? []).map(item => item.path));
case 'target_paths':
  return joinLines((result.targets ?? []).map(item => item.path));
```

- **증거**: 두 case는 동일 구현. `benchmarks/adoption.json`는 `target_paths`만 사용(`grep target_paths benchmarks/adoption.json` 결과 다수, `candidate_paths` 0). `candidate_paths`는 옛 벤치마크 suite 호환용.
- **영향 범위**: `benchmarks/adoption.json`만 사용하는 현재로서는 외부 영향 없음. 다만 외부 사용자가 옛 suite 파일을 갖고 있을 수 있음.
- **권고**: `consolidate-into-X` — `target_paths`로 통합 후 `candidate_paths`는 alias로 한 줄 코멘트와 함께 남기거나 삭제.

#### S-3. `src/benchmark/evaluator.mjs:116-119` `min_candidate_path_count` 체크 타입

```js
case 'min_candidate_path_count':
  actual = getCandidatePaths(result).length;
  passed = actual >= Number(check.value ?? 0);
  break;
```

- **증거**: `benchmarks/adoption.json`는 `min_target_count`만 사용. 현행 `min_candidate_path_count` 호출자 0.
- **영향 범위**: 외부 사용자가 옛 suite를 들고 있는 경우만 영향.
- **권고**: S-1과 함께 deprecation 주석 + 다음 메이저 버전에서 제거 고려.

### 3.4 MISALIGNED

#### M-1. `scripts/integration-test.mjs` 옛 top-level 필드 가정 (라인 47–72, 95–114)

- **증거**:
  - L47–50: `result.answer`, `result.confidence`, `result.confidenceScore`, `result.confidenceLevel`, `result.trustSummary` 사용.
  - L72: `checks.push(['candidatePaths is array', Array.isArray(result.candidatePaths)])`.
  - 현행 runtime은 `directAnswer`, `status.confidence`, `evidenceQuality.level`, `targets[].path`만 노출. `grep '^\s*answer:' src/explorer/runtime.mjs` → 0. `grep '\.confidence\b' src/explorer/runtime.mjs` → 모두 `result.status?.confidence` 형태. `result.candidatePaths` → 0.
  - 단, `result.trustSummary`는 `runtime.mjs:1670`에서 여전히 top-level로 설정되므로 동작은 함 (회색 지대 G-1 참고).
- **영향 범위**: `CEREBRAS_API_KEY`로 실제 호출되는 통합 회귀가 의미 있는 신호를 못 줌. 모든 `checks`가 false → 통합 테스트가 "통과"로 표시되어도 사실은 실패. README.md L503가 이 스크립트를 권장 통합 검증 경로로 안내함.
- **권고**: `delete` 후 재작성 — `explore_repo`/`explore`의 현행 compact 계약(`directAnswer`, `status.confidence`, `targets[].path`, `evidenceQuality`, `session`, `searchCoverage`, `failure`)에 맞춘 assertion으로 교체. 회귀 가치를 잃지 않으려면 `tests/mcp-server.test.mjs`와 동일한 필드를 검증 대상으로 사용.

#### M-2. `examples/expected-response.json` 옛 스키마

- **증거**:
  - L29: `"reason": "Discovered candidate path; ..."` — runtime은 현재 `"Discovered path; ..."` (`src/explorer/runtime.mjs:665`).
  - 전체 응답에 `schemaVersion`, `evidenceQuality`, `failure`, `session`, `searchCoverage`, `nextAction.type` 외 확장 필드가 누락.
  - DESIGN.md §9, README.md L194–254가 명시한 현행 compact 계약과 어긋남.
- **영향 범위**: README.md L194–254에 인라인 예시가 별도로 있으므로 직접 깨지지는 않으나, `examples/` 디렉터리를 보고 따라 구현하는 외부 사용자에게 잘못된 기대치 제공.
- **권고**: `consolidate-into-X` — README의 인라인 예시와 동일한 필드 셋으로 `examples/expected-response.json` 갱신.

#### M-3. `examples/call-server-via-stdio.mjs` Content-Length framing only

- **증거**: L7 `Content-Length: ${...}\r\nContent-Type: application/json\r\n\r\n${json}`. NDJSON 변형 없음. README.md L532–537과 plan/checklist.md Phase 2가 NDJSON를 v2.1.94+ Claude Code 기본으로 명시.
- **영향 범위**: 서버가 두 framing 모두 지원하므로 동작은 정상. 사용자 학습 경로만 옛 framing에 묶임.
- **권고**: `consolidate-into-X` — NDJSON 변형을 추가하거나 현 파일을 NDJSON로 교체. 회귀는 `tests/integration/stdio-purity.test.mjs`가 양쪽 framing 모두 보장.

#### M-4. `examples/direct-runtime.mjs` 옛 print 가정

- **증거**: L12 `console.log(JSON.stringify(result, null, 2))` — `exploreRepository`의 raw runtime return을 그대로 출력. raw return에는 여전히 `trustSummary`, `recentActivity`, `_debug` 등 디버그 필드가 모두 포함되어 있으나, 사용자가 이 출력을 "공개 계약"으로 오해할 위험. MCP path와 직접 runtime path의 응답 형태가 다른 점을 안내하지 않음.
- **영향 범위**: 낮음. 예시 코드 한 파일.
- **권고**: `keep-but-document` — 파일 상단에 "이 출력은 raw runtime result이며 MCP `structuredContent`보다 디버그 필드를 더 포함합니다" 주석 추가.

#### M-5. README.md `recentActivity` 위치 표기와 runtime 동작 불일치

- **증거**: README.md L166 / L272는 `_debug.recentActivity`만 언급. 그러나 `src/explorer/runtime.mjs:1681`은 `normalized.recentActivity`를 top-level에도 동시 설정. `src/benchmark/evaluator.mjs:17`도 두 위치 모두 fallback.
- **영향 범위**: 문서·코드 표면 계약 드리프트. 상위 에이전트가 README만 보고 `_debug` 안만 찾으면 top-level의 동일 데이터를 못 보거나, 반대로 코드만 보고 README를 신뢰하지 못할 수 있음.
- **권고**: `verify-with-author` — top-level 노출이 의도된 것이면 README/DESIGN을 갱신, 의도 아니면 runtime에서 top-level 할당을 제거.

### 3.5 STALE_FIXTURE

#### F-1. `docs/superpowers/plans/2026-05-19-agent-facing-contract-improvements.md` (체크박스 47개 모두 `[ ]`)

- **증거**:
  - `git log --oneline`상 모든 task의 작업이 commit으로 landed: `52a0f37 feat: add safe retry recipes` (Task 2), `9124302 feat: route wrapper intent through task modes` (Task 3), `fb23168 feat: expose compact search coverage` (Task 4), `9db9ccc docs: recommend full explorer wrapper allowlist` (Task 1).
  - README.md / DESIGN.md / src/mcp/server.mjs / src/explorer/runtime.mjs 모두 plan이 명세한 contract를 이미 반영. 예: `searchCoverage`(README L267–270), `taskMode`(DESIGN L209–212), `failure.retry.args`(README L258–263).
  - `plan/README.md`는 "완료된 구현 계획은 2026-04-24 기준으로 삭제했다" 정책 명시.
- **영향 범위**: 작성자/리뷰어 혼란. unchecked plan이 "미완료 backlog"로 오인되어 중복 작업 위험.
- **권고**: `delete` 또는 별도 `docs/superpowers/plans/completed/`로 이동 + 체크박스 일괄 `[x]` 처리.

#### F-2. `docs/superpowers/plans/2026-05-19-top-level-session-contract.md`

- **증거**: 모든 체크박스 `[ ]`. commit `3821712 feat: add session output schema`, `95eba35 feat: expose session contract in mcp output`, `946c36d test: cover mcp session fallback contract`, `9ccf7b3 docs: document top-level session contract`로 4개 task 모두 landed. README L249–254, DESIGN L237–241에 contract 문서화 완료.
- **영향 범위**: F-1과 동일.
- **권고**: F-1과 동일.

#### F-3. `docs/superpowers/plans/2026-05-19-failure-evidence-quality-contract.md`

- **증거**: 모든 체크박스 `[ ]`. commit `fd29b2b feat: define failure evidence quality output schema`, `a7aa6f1 feat: derive evidence quality and failure signals`, `53ee8f1 feat: expose failure and evidence quality in mcp output`, `b3b893f docs: document failure and evidence quality contract`, `69deceb fix: distinguish invalid arguments from session failures`로 모두 landed. DESIGN §9, README L195–270이 `evidenceQuality`, `failure` contract를 문서화.
- **영향 범위**: F-1과 동일.
- **권고**: F-1과 동일.

#### F-4. `tests/regression.test.mjs:2` 사라진 문서 참조

```js
/**
 * Regression tests for P0/P1 issues from feedback_1.md
```

- **증거**: 저장소 어디에도 `feedback_1.md`가 없음 (`grep feedback_1` 결과는 이 파일 1건뿐). `plan/README.md`는 2026-04-24에 분석 보고서들을 삭제했다고 명시.
- **영향 범위**: 테스트 자체는 유효(현행 코드를 정확히 회귀 보장). 주석만 stale.
- **권고**: `keep-but-document` — 주석을 "Regression tests for prior P0/P1 fixes (original feedback doc removed 2026-04-24; tests retained for ongoing coverage)"로 갱신.

### 3.6 NOISE (작업 트리 한정, git tracked 아님)

본 작업 지시는 다음 항목을 "쓰레기"/"커밋되지 말았어야 할 산출물"로 분류했으나 **확인 결과 모두 이미 `.gitignore`에 포함되어 있고 `git ls-files`에 잡히지 않는다**. 즉 git 저장소 입장에서는 NOISE가 아니라 단순 working-tree 산출물이다.

| 항목 | `.gitignore` 위치 | 검증 | 권고 |
|---|---|---|---|
| `bash.exe.stackdump` | `.gitignore` L13 | `git ls-files --error-unmatch bash.exe.stackdump` → "did not match" | 조치 불필요. 사용자가 원하면 로컬에서 단순 삭제. |
| `benchmark-report.json` | `.gitignore` L14–15 | 동일 | `npm run benchmark`가 재생성하므로 신경 쓸 필요 없음. 단, 파일에 박힌 `benchmarks/core.json` 경로와 `explain_symbol` 도구명은 이미 사라진 옛 suite를 가리키므로 새 벤치마크를 한 번 돌려 덮어쓰기 권장. |
| `.claude/` | `.gitignore` L12 | 동일 | 로컬 Claude Code permissions 캐시. 그대로 둠. |
| `.codex/` | `.gitignore` L12 | 동일 | 로컬 Codex config (`mcp_servers.cerebras-docs`만). 그대로 둠. |

---

## 4. 회색 지대 (판단 보류, 작성자 확인 필요)

### G-1. `result.trustSummary` 의 공개 계약 위치

- **현재 상태**: `src/explorer/runtime.mjs:1670`는 `normalized.trustSummary`를 top-level에 설정. 그러나 DESIGN.md §9 반환 스키마에는 `trustSummary`가 등장하지 않고, README.md의 compact 계약 설명에도 빠짐. `scripts/integration-test.mjs:49`는 top-level `result.trustSummary`를 직접 사용.
- **모호한 이유**: 옛 contract의 잔재일 수 있으나, 일부 호출자가 의도적으로 사용 중일 수 있음.
- **확인 필요**: top-level `trustSummary`를 공개 계약으로 유지할 것인가, `_debug` 또는 `evidenceQuality.summary`로 일원화할 것인가.

### G-2. `OpenAICompatChatClient` / `FailoverChatClient` (`src/explorer/providers/`)

- **현재 상태**: 활성 — `createChatClient` 팩토리(`src/explorer/providers/index.mjs:48`)가 `EXPLORER_PROVIDER` / `EXPLORER_FAILOVER` 환경변수를 보고 분기. `tests/providers.test.mjs`로 회귀 보장. 단 DESIGN.md L89/L265는 "내부 구현, 공개 계약 아님"으로 명시하고 README.md L730도 같은 톤.
- **모호한 이유**: "공개 계약 아님"이라는 정책과 실제로 살아 있는 코드/테스트 사이의 회색지대. 제품 목표("Cerebras 기반 explorer")에 비추면 MISALIGNED 후보지만, 비상시 fallback 또는 dogfooding 용도일 수 있음.
- **확인 필요**: 유지하기로 한다면 README/DESIGN에 "internal-only, no support" 경고 명시. 폐기 시 모듈/테스트/환경변수 일괄 제거.

### G-3. `EXAMPLES/explore-request.json` 의 위치와 역할

- **현재 상태**: `examples/explore-request.json`은 단순한 `task`/`repo_root`/`hints` 입력 예시. README 어디서도 명시적으로 인용하지 않음(`grep examples/ README.md` → L365 디렉터리 트리 한 줄만).
- **모호한 이유**: 더 이상 문서가 가리키지 않으면 STALE_FIXTURE 후보지만, MCP request 입력 예시는 README 인라인에도 있어 보존 가치가 낮음.
- **확인 필요**: `examples/` 디렉터리의 4개 파일을 (a) README 한 곳에서 명시 참조하도록 보강할지, (b) 모두 삭제하고 README 인라인 예시만 유지할지 결정.

### G-4. v0.2.0 release 후 잔존하는 `plan/v0.2.0-release-plan.md` / `plan/checklist.md`

- **현재 상태**: 두 문서 모두 Phase 0–6 체크박스가 100% `[x]`. CHANGELOG.md는 "v0.2.0 - Unreleased"로 표기. tag 기준은 README L17이 `#v0.1.0`. v0.2.0가 아직 release되지 않은 상태라면 둘 다 "활성 backlog"로 살아있을 만함.
- **모호한 이유**: `plan/README.md`는 "현재 활성 backlog 문서는 없습니다"라고 단언. 그러나 v0.2.0-release-plan은 활성 검수 문서로 보이므로 `plan/README.md`와 모순.
- **확인 필요**: v0.2.0 tag가 push되는 시점에 두 파일을 어디로 옮길지(`plan/completed/`?), 또는 `plan/README.md`를 갱신할지.

---

## 5. 후속 작업 제안

### 묶어서 정리하면 좋은 PR 단위

1. **PR-A: `scripts/integration-test.mjs` 현행 계약 동기화** (M-1)
   - 옛 필드(`answer`, `confidence`, `confidenceLevel`, `confidenceScore`, `candidatePaths`)를 현행 compact 필드로 교체
   - 회귀 가치 보전을 위해 최소 다음 assertion 추가: `directAnswer`, `status.confidence`, `evidenceQuality.level`, `targets[].path`, `session.id`, `searchCoverage.summary`
2. **PR-B: `examples/` 현행화** (M-2, M-3, M-4)
   - `expected-response.json` 갱신, `call-server-via-stdio.mjs` NDJSON 변형 추가, `direct-runtime.mjs` 주석으로 raw vs MCP 구분 명시
3. **PR-C: 완료 plan 정리** (F-1, F-2, F-3)
   - 3개 plan의 모든 체크박스를 `[x]`로 업데이트
   - `plan/README.md` 정책에 맞춰 삭제 또는 `docs/superpowers/plans/completed/`로 이동
   - 같은 PR에 F-4 주석 갱신 포함
4. **PR-D: 벤치마크 evaluator 정리** (S-1, S-2, S-3)
   - `getCandidatePaths`, `candidate_paths` source, `min_candidate_path_count` check를 명시적 deprecation 주석으로 표시
   - 다음 메이저 버전에서 제거 예정 안내
5. **PR-E: `recentActivity` 계약 정합화** (M-5)
   - top-level 노출 유지/제거 결정 후 runtime·README·DESIGN 동시 갱신

### 제거 전에 추가해야 할 회귀 테스트

- **scripts/integration-test.mjs 재작성 시**: 현재 `tests/mcp-server.test.mjs`가 sea-level handshake와 `structuredContent` 핵심 필드를 충분히 검증하지만, "실제 Cerebras API 호출 후 `directAnswer`/`evidence`/`searchCoverage` 정합성"은 통합 테스트만 가능. 새 스크립트는 (a) `searchCoverage.scopeLimited`, (b) `status.verification` 분기, (c) `failure: null` 경로를 별도 case로 검증.
- **`candidatePaths` shim 제거 전**: `tests/benchmark-evaluator.test.mjs`에 "옛 suite JSON 입력 시 명확한 에러 메시지" assertion 추가 후 shim 제거.
- **`recentActivity` top-level 제거 시(만약)**: `tests/runtime.mock.test.mjs:946`의 `'recentActivity' in result || result.recentActivity === undefined` 식 약한 assertion을 명확한 위치 검증으로 강화.
- **plan 문서 삭제/이동 시**: `tests/integrations.test.mjs`에 "활성 plan README 경로만 존재" assertion 추가하여 향후 stale plan 재유입 차단.
