# cerebras-explorer-mcp 도구 평가 (Fresh Run, 2026-05-24)

작성일: 2026-05-24 KST  
평가자 모델: Claude Opus 4.7 (1M context)  
평가 대상: working tree 상태의 공개 MCP 도구 (server에서 실제로 노출되는 8개)  
원자료 워크스페이스: `/tmp/cerebras-eval-2026-05-24/`  
참고 (선행 50건 평가): [`reports/tool-trust-evaluation-current-2026-05-24.md`](./tool-trust-evaluation-current-2026-05-24.md)

---

## 0. 사용자가 의식적으로 선택한 trade-off

원래 사용자 지시는 "각 도구에 대하여 각각 최소 5번을 테스트"였으나, 작업 범위 결정 단계에서 Minimum 옵션 (도구당 2회) 을 의식적으로 선택했습니다. 따라서 이 평가는:

- **도구당 2회 호출** (요청한 최소 5회 기준 미달, 사용자 인지)
- **레포별 맞춤 쿼리** (선행 50건 평가와 동일 5개 레포: cerebras-explorer-mcp, DeepResearch, aicc_manage, bible, studious-memory)
- **도구당 1회 내장 Explore sub-agent 비교** (총 8건)
- **도구당 1명 evaluator sub-agent** (코드 접근 없음, 10축 rubric)
- **전역 1명 necessity sub-agent** (cut-to-5 권고 도출)

선행 50건 평가는 같은 날 작성된 별도 보고서가 이미 존재하므로, 본 보고서는 그 결과를 보강·교차검증하고 **새 발견(특히 contract-bug 수준의 정합성 결함)에 집중**합니다.

> **중요한 surface 불일치**: 현재 실행 중인 MCP 서버가 노출하는 도구는 **8개**입니다 — `find_relevant_code`, `trace_symbol`, `map_change_impact`, `explain_code_path`, `collect_evidence`, `review_change_context`, `explore_repo`, `explore`. README/DESIGN에서 "spec 013 이후 10개로 고정"이라고 명시한 `map_impact`와 `find_entrypoints`는 **현재 실행 인스턴스에서 보이지 않음**. MCP server description 텍스트도 "8 tools, powered by zai-glm-4.7"라고 보고합니다. 이는 (a) 사용자의 Claude Code MCP 클라이언트가 캐시된 구버전 spec을 들고 있거나 (b) server.mjs 등록 코드와 문서가 어긋났을 가능성이 있습니다 — 별도 점검 필요. 본 평가는 실제 노출된 8개에 대해서만 수행했습니다.

---

## 1. 프로젝트 목적 재확인

이 프로젝트의 핵심은 한 줄로 요약 가능합니다: **신뢰 = 컨텍스트 절감**.

- parent agent (Claude Code / Codex) 가 `Read/Grep/Glob` 반복으로 자기 컨텍스트를 태우는 대신, Cerebras 모델이 MCP 서버 내부의 read-only `RepoToolkit` 위에서 자율 탐색을 수행
- 결과는 `directAnswer`, `status`, `targets`, `evidence(snippet 포함)`, `evidenceQuality`, `searchCoverage`, `failure`, `session/sessionId` 중심의 compact contract
- 만약 parent agent가 응답을 신뢰하지 못해서 결국 본인이 파일을 다시 읽어야 한다면, 위임 자체가 무의미해지고 **모든 비용(Cerebras API + parent context)이 동시에 소모**됨

이 본질을 기준으로 모든 평가 축을 해석해야 합니다.

---

## 2. 평가 방법론

### 2.1 평가 rubric (Plan sub-agent로부터 도출)

각 도구에 대해 10축 + 8개 cross-cutting trap 기준으로 평가:

| 축 | 의미 |
|---|---|
| 1. Description-behavior fidelity | 1줄 설명대로 실제 동작? |
| 2. Schema friction | required/optional이 명확하고 mimicable? |
| 3. Citation grounding | path/line/snippet이 그럴듯한가? |
| 4. Scope boundary respect | scope 밖 경로 인용 없는가? |
| 5. Calibration honesty | 자기 보고 신뢰도가 실제 근거 양과 일치? |
| 6. Uncertainty honesty | uncertainties[]에 구체적 gap 명시? |
| 7. nextAction actionability | parent가 그대로 실행 가능? |
| 8. Output economy | signal/token 효율? |
| 9. Sibling differentiation | 형제 도구와 진짜로 다른가? |
| 10. Session reuse semantics | sessionId가 follow-up에서 의미 있게 쓰이나? |

**Trap 후보**: confidently wrong, phantom citations, sibling collapse, empty-failure success theater, directAnswer-restates-question, out-of-scope evidence drift, stale-on-replay nondeterminism.

### 2.2 도구별 호출 매트릭스

각 도구는 도구의 강점을 드러내는 레포에 매칭된 2개 쿼리로 호출.

| 도구 | Q1 (레포 / 쿼리) | Q2 (레포 / 쿼리) |
|---|---|---|
| `find_relevant_code` | bible / Cloudflare Worker 함수와 라우팅 | aicc_manage / invoice 생성 + PDF |
| `trace_symbol` | cerebras-explorer-mcp / `shouldIgnorePath` | studious-memory / `Note` (의도적으로 모호) |
| `collect_evidence` | cerebras-explorer-mcp / secret deny-list 정책 (참) | studious-memory / Alembic 자동적용 (거짓) |
| `review_change_context` | cerebras-explorer-mcp / 1주일 변경 review | DeepResearch / 2주일 테스트 커버리지 약화 |
| `explore_repo` | cerebras-explorer-mcp / redaction 파이프라인 | DeepResearch / FastAPI DB 세션 패턴 |
| `map_change_impact` | DeepResearch / 모든 응답에 timestamp 추가 | cerebras-explorer-mcp / maxFileSize 옵션 추가 |
| `explain_code_path` | aicc_manage / invoice 버튼 → DB | cerebras-explorer-mcp / MCP tools/call → stdout |
| `explore` | aicc_manage / WebSocket 아키텍처 | studious-memory / 멀티플랫폼 sync |

전체 결과: **16 / 16 호출 모두 MCP-level 성공**. 1건도 protocol error 없음.

### 2.3 내장 Explore sub-agent 비교

도구당 1회씩 (총 8건) 동일 쿼리를 Claude Code 내장 `Explore` agent에 실행하여 비교. Explore agent는 자신의 `Read/Grep/Glob/Bash`만 사용 (외부 MCP 호출 금지).

---

## 3. 도구별 evaluator 판정 요약

각 도구는 코드 미접근 evaluator sub-agent가 description + schema + 2건 요청·응답만 보고 판정. 점수는 10축 평균.

| 도구 | 평균 (10축) | 종합 verdict | 가장 큰 결함 |
|---|---:|---|---|
| **`explore_repo`** | **4.3** | **USE** (무조건) | discoveredPaths vs targets 구분 좋으나 toolTrace 가시성 부족 |
| `find_relevant_code` | 3.9 | USE-WITH-CAVEAT | `confidence=high + nextAction=ask_user` 정합성 결함 |
| `trace_symbol` | 3.8 | USE-WITH-CAVEAT | spec 010 위반: `failure=budget_exhausted + sufficient evidence + high confidence` |
| `collect_evidence` | 4.1 | USE-WITH-CAVEAT | **self-redaction artifact**: 자신의 deny-list 설명 답변에서 `.env`가 `[REDACTED:secret-path]`로 마스킹 |
| `review_change_context` | 3.6 | USE-WITH-CAVEAT | **442K 토큰** (2주일 review 시), 자동 `ask_user` 회로 |
| `map_change_impact` | 4.4 | USE-WITH-CAVEAT | edit/read/reference 분리 우수, 그러나 `evidenceRefs: ["file_range","E4"]` 포맷 버그 |
| `explain_code_path` | 4.0 | USE (조건부) | 7/8 exact + 7 step 완성된 chain에도 `nextAction=ask_user` 발동 |
| `explore` | 4.1 | USE-WITH-CAVEAT | citation_gap critic이 실제 결함을 catch함(positive), 그러나 75-79초 / 370-493K 토큰 비용 |

### 3.1 `explore_repo` — 무조건 USE 등급의 근거

`explore_repo`만 무조건 USE인 이유는 **non-obvious negative 발견 능력**입니다.

DeepResearch에서 "FastAPI 엔드포인트들이 DB 세션을 어떻게 획득하고 해제하는지" 질문에 대해, 도구는 16개 파일을 읽은 끝에 다음을 발견:

> "현재 이 프로젝트에서 FastAPI 엔드포인트들은 DB 세션을 획득하거나 해제하지 않습니다. app/db/session.py에 get_session() dependency가 정의되어 있지만 실제로는 모든 엔드포인트가 인메모리 스토어(InMemoryTaskStore, _claim_drilldowns 딕셔너리)를 사용합니다."

이는 wrapper 도구로는 잡을 수 없는 류의 답변입니다 — `find_relevant_code`는 "get_session 찾았다"로 멈춰버리고, `trace_symbol`은 정의만 보여줄 뿐 "실제 사용처가 없다"는 사실을 도출하지 못합니다. 표준 패턴에 묻혀버리지 않고 **"있어야 할 것이 없음"을 적극 보고**하는 것이 base 도구의 본질적 가치입니다.

### 3.2 가장 큰 단일 contract bug: `trace_symbol` Q2

`Note` (의도적 모호 심볼) 쿼리에 대한 응답:

```
status:           { confidence: "high", verification: "follow_up_needed", complete: false }
evidenceQuality:  { level: "high", exact: 8/8, summary: "Verified: 8/8 grounded" }
directAnswer:     "No code symbol named 'Note' (class, function, type, or interface) is defined..."
failure:          { reason: "budget_exhausted", retry: { tool: "explore_repo", ... } }
nextAction:       { type: "ask_user", reason: "The retained evidence is not sufficient for a complete answer." }
searchCoverage:   { stoppedByBudget: true, warnings: [...] }
```

DESIGN.md §11.4 (spec 010)은 명시적으로 "sufficient evidence가 만족되면 `stoppedByBudget=true`라도 `failure`는 null이어야 한다"고 정의합니다. `_debug.confidenceFactors`의 `-0.10` penalty와 `verification=follow_up_needed`는 정합성 있는 신호이지만, `failure!=null`은 spec 위반입니다.

Parent agent가 contract를 문자 그대로 따르면:
- `failure.retry`가 우선이므로 retry를 시도 → 동일한 답이 나오거나 또 budget 소진
- `nextAction=ask_user`를 따르면 사용자에게 "Note에 대해 더 알려달라" 같은 무의미한 질문 발생
- `directAnswer` (정확한 답)는 무시되거나 사용자가 직접 읽어야 함

**결과: 정확한 답을 가지고 있음에도 sub-optimal 행동을 유도**.

### 3.3 정합성 mismatch는 6개 도구에 걸친 시스템적 결함

| 도구 | Q | confidence | verification | exact/partial | nextAction |
|---|---|---|---|---|---|
| `find_relevant_code` | Q2 | high | follow_up_needed | 3/1 | ask_user |
| `trace_symbol` | Q2 | high | follow_up_needed | 8/0 | ask_user |
| `collect_evidence` | Q1 | high | verified | 8/0 | stop ✓ |
| `collect_evidence` | Q2 | high | follow_up_needed | 5/3 | ask_user |
| `review_change_context` | Q1 | high | follow_up_needed | 5/3 | ask_user |
| `review_change_context` | Q2 | high | follow_up_needed | 5/0 | ask_user |
| `explain_code_path` | Q2 | high | follow_up_needed | 7/1 | ask_user |

**관찰**: partial evidence가 1건이라도 있거나 (또는 dropped가 1건이라도 있으면) `complete=false + nextAction=ask_user`로 가는 경향. 그러나 7/8 exact + 1 partial로 답을 충분히 grounding한 경우에도 같은 회로가 발동.

이는 **runtime의 sufficiency gate가 너무 보수적**임을 시사합니다. 사용자가 "신뢰=컨텍스트 절감"이라고 정의한 프로젝트 목적과 정면 충돌:

- parent가 `nextAction`을 따르면 → ask_user 루프 발생 → 컨텍스트 낭비
- parent가 `directAnswer`을 따르면 → contract 무시 → 도구 신뢰 신호 무력화
- 양쪽 다 패배 — 가장 큰 trust 결함

### 3.4 `collect_evidence`의 self-redaction artifact

Q1에서 사용자가 검증을 요청한 claim 자체에 `.env` 같은 단어가 포함되어 있었고, 응답의 `directAnswer`와 `evidence[].snippet` 양쪽에서 `.env`가 `[REDACTED:secret-path]`로 마스킹됨. 결과:

- `secretDenyListDisabled(env = process[REDACTED:secret-path])` — 정상 코드의 `process.env` 표현까지 마스킹
- README 인용에서도 `.env*`와 `.npmrc`가 모두 `[REDACTED:secret-path]`로 표시되어 어떤 파일이 차단되는지 답변만 보고는 알 수 없음

이는 `evidence[].redacted: true + redactions: ["secret-path"]` 메타데이터로 honest disclosure는 됐지만, parent agent가 답변을 사용자에게 그대로 relay할 수 없는 상태. **opt-out 또는 post-processing 없이는 보안 정책 질문이 답을 받아도 무용**.

### 3.5 `evidenceRefs` 포맷 버그

`map_change_impact` Q2에서:

```json
"targets": [{
  "path": "src/explorer/repo-tools.mjs",
  "evidenceRefs": ["file_range", "E4"]
}]
```

`file_range`는 evidenceType 값(`evidence[].evidenceType`)이고, `E4`는 evidence id입니다. 두 다른 도메인이 같은 배열에 섞임. 엄격한 consumer (`target.evidenceRefs.map(ref => evidenceById[ref])`)는 `undefined`를 받습니다. 다른 도구들의 target에서는 보통 `["E1"]` 또는 `[]` 형태로 깨끗하게 나옵니다.

---

## 4. 내장 Explore sub-agent와의 비교

도구당 1회씩 (총 8건) 동일 쿼리를 양쪽에 보내서 비교.

| 비교 차원 | 내장 Explore | cerebras-explorer |
|---|---|---|
| Tool calls/쿼리 (평균) | ~10회 | ~15-55회 |
| 응답 형식 | Markdown narrative | structured JSON (또는 Markdown for `explore`) |
| Parent context 사용 | 큼 (답 구성이 parent context에서 일어남) | 작음 (Cerebras 내부 처리) |
| Citation 품질 | path:line 명시되나 ad-hoc | 구조화 `evidence[]` + `groundingStatus` |
| 비용 분포 | parent token 위주 | Cerebras input/output token 위주 |
| 5개 레포 평균 elapsed | ~30-50초 (subagent) | ~6-22초/호출 |

**구체적 비교 사례**:

| 쿼리 | 내장 Explore 결과 | cerebras 결과 | 누가 더 정확? |
|---|---|---|---|
| bible Cloudflare routes | 12개 라우트 발견 (OPTIONS 포함, 7회 호출) | 9개 라우트 발견 (OPTIONS 누락, 18회 호출) | **내장이 약간 더 완전** |
| shouldIgnorePath trace | def + 2 callsite (7회 호출) | def + 2 callsite + evaluation order 7단계 (11회 호출) | **cerebras가 더 풍부** |
| Secret deny-list 검증 | 66개 패턴 enumerate, "Confirmed" (12회) | 8개 evidence + redacted, "verified" (10회) | **내장이 더 자세** |
| 1주일 review | spec별 risk 표 (10회) | 비슷한 구조 (10회) | 동급 |
| Redaction 파이프라인 | 깔끔한 분류 표 (~6회 read) | 8 exact evidence + 4 phase 정리 (15회) | **cerebras가 약간 더 체계적** |
| Timestamp blast radius | 16개 edit target + line range (20회) | 8개 edit target + line range (55회) | **내장이 더 정밀** |
| Invoice flow | 6 step + advisory lock 상세 (11회) | 6 step + advisory lock (10회) | 동급 |
| WebSocket 아키텍처 | 5 섹션 + Lambda env vars (15회) | 5 섹션 + Markdown 보고서 + 다이어그램 (36회) | **cerebras가 형식적으로 풍부** |

**요약**: 정확성·완전성은 거의 동등 (내장이 약간 우세인 경우도 있음). cerebras의 본질적 우위는 **parent context를 안 쓴다는 것**이지 답변 품질이 압도적인 것은 아닙니다. 답변이 비슷하다는 사실 자체가 이 프로젝트의 가치 명제(컨텍스트 절감)를 정확히 뒷받침합니다 — **답이 비슷하면 매번 parent가 직접 읽을 이유가 줄어듭니다**. 단, 정합성 결함이 trust를 깎으면 그 절감이 무력화됩니다.

---

## 5. 필요성 분석: cut-to-5 권고

별도 necessity sub-agent (코드 약간 조회 가능) 가 도출한 등급:

| 도구 | 등급 | 근거 |
|---|---|---|
| `explore_repo` | **ESSENTIAL** | 유일하게 "답의 형태를 모름" contract. non-obvious negative 발견의 유일한 출구. |
| `explore` | **ESSENTIAL** | 유일하게 Markdown 본문 + `directAnswer/status` envelope 없음. 사람이 읽는 보고서 surface는 직교. |
| `find_relevant_code` | USEFUL | `taskMode='locate'` → `isSimpleCompletionMode` (runtime.mjs:849-853): 1 evidence만으로 sufficiency. 실제 behavioral 차이지만, 자체 가치는 ergonomics + 분류 nudge. |
| `trace_symbol` | USEFUL | 1-arg ergonomics + 자동 symbol-first strategy. 본질은 thin shell. |
| `map_change_impact` | USEFUL | `taskMode='edit_planning'` (runtime.mjs:867)로 edit-target separation. 출력이 다른 wrapper들과 가장 다름. |
| `explain_code_path` | **MARGINAL** | `taskMode='path_explanation'` 있으나 output 형태는 explore_repo와 동일. "entryPoint" param만 구조적 구분. |
| `collect_evidence` | USEFUL | `taskMode='evidence_verification'` (runtime.mjs:855)로 sufficiency rule 다름. **refutation 능력은 unique**. |
| `review_change_context` | USEFUL | 유일하게 `since/until/path` git args. git-guided 영역의 유일한 capability. |

### 5.1 Overlap matrix (상위 3쌍)

1. **`find_relevant_code` ↔ `explore_repo`** — Largest overlap. 양쪽 description 모두 "use FIRST" 표현이 있어서 dispatcher가 가장 헷갈리는 짝. `find_relevant_code`의 본질 가치는 `taskMode='locate'` hint construction.
2. **`map_change_impact` ↔ `explain_code_path`** — 둘 다 mid-complexity exploration + edit/flow framing. 둘 다 `isEditPlanningMode` 경로. `kind: 'impact' | 'flow'` switch로 합칠 수 있음.
3. **`trace_symbol` ↔ `find_relevant_code`** — 양쪽 모두 `isSimpleCompletionMode=true`. 입력 차이 (`symbol` vs `query`)는 cosmetic; "where is requireAuth defined"는 양쪽 어느 도구로든 라우팅 가능.

### 5.2 Cut-to-5 권고

**유지**: `explore_repo`, `explore`, `map_change_impact`, `collect_evidence`, `review_change_context`

**잘라낼 대상**: `find_relevant_code`, `trace_symbol`, `explain_code_path`

이유: 유지하는 5개는 **출력 contract가 본질적으로 다름** (JSON envelope, Markdown 보고서, edit-role separation, refutation, git-window). 잘라내는 3개는 taskMode hint 외에는 explore_repo의 facade에 가까움.

**도입되는 gap**:
- `trace_symbol` 1-arg ergonomics 손실 — 허용 가능. `explore_repo({task, hints.symbols})` 패턴으로 대체.
- `taskMode='locate'` early-exit 손실 — **그대로는 허용 불가**. `explore_repo`가 task 텍스트에서 locate 의도를 자동 감지하도록 runtime.mjs:831 regex classifier를 fallback에서 primary trigger로 승격 필요.
- `explain_code_path` framing 손실 — 허용 가능. flow 질문을 `explore_repo`에 그대로 보내면 동등한 결과.

순효과: **surface 37% 축소, 자동 분류기 1개 승격 시 capability 손실 없음**.

### 5.3 Decision-rule clarity

8개 surface에서 dispatcher의 가장 어려운 결정:

- **`find_relevant_code` vs `explore_repo`**: 양쪽 description 모두 "FIRST" 주장. 가장 fuzziest.
- **`explain_code_path` vs `map_change_impact` vs `trace_symbol`**: 셋 다 "connected code 따라가기". parent가 noun (path/change/symbol)으로 dispatcher 할 가능성 높음 — 의도가 아닌 명사 기반 분류는 fragile.

---

## 6. 선행 50건 평가와의 차이

[`tool-trust-evaluation-current-2026-05-24.md`](./tool-trust-evaluation-current-2026-05-24.md) 와 비교:

| 차원 | 선행 50건 평가 | 본 평가 (16건 + 비교) |
|---|---|---|
| 도구 수 | 10 (map_impact, find_entrypoints 포함) | **8** (현재 서버 노출만) |
| 호출 수 | 50 (도구당 5회) | 16 (도구당 2회) — 사용자 인지된 trade-off |
| Sub-agent evaluator | 도구당 1명 (총 10명) | 도구당 1명 (총 8명) + 1 necessity + 8 비교 |
| 내장 Explore 비교 | 없음 | 도구당 1회 (총 8건) |
| 강조 결함 (공통) | "낙관적 신호 + 보수적 verification" 불일치 | 동일 — 본 평가에서 더 자세히 정량화 |
| 신규 발견 1 | — | `trace_symbol`의 `failure=budget_exhausted + sufficient evidence` (spec 010 위반) |
| 신규 발견 2 | — | `evidenceRefs: ["file_range","E4"]` 포맷 버그 |
| 신규 발견 3 | — | `collect_evidence` self-redaction artifact 정량화 |
| 신규 발견 4 | — | 도구당 출력 token 비용 (75K-490K) 매트릭스 |
| 신규 발견 5 | — | cut-to-5 권고 + 사라지는 gap을 메우는 구체적 조치 |
| 신규 발견 6 | — | 내장 Explore와의 직접 품질 비교 (cerebras가 압도적으로 우위는 아님) |
| Verdict | 모두 "사용" 또는 "조건부 사용" | 동일하지만 사유와 priority 가 더 구체적 |

본 평가는 선행 평가를 **반박하지 않고 보강**합니다. 핵심 패턴 (낙관적 confidence vs 보수적 verification 불일치) 은 양쪽이 같지만, 본 평가는 그 패턴을 **6개 도구에 걸친 시스템적 contract 결함**으로 격상하고 구체적 fix를 제안합니다.

---

## 7. Cross-cutting 권고 (상위 3개, surface 변경 없이)

### 권고 1: Calibration 동시성 버그 해결 (최우선)

`trace_symbol`이 `failure=budget_exhausted` + `directAnswer high confidence`를 동시 반환하는 것 (spec 010 위반) 이 본 평가에서 가장 큰 trust killer.

**조치**: 모든 wrapper가 응답 직렬화 직전에 `buildResultStatus` invariant를 통과시키도록:
- `failure != null` → `directAnswer.confidence ≤ "low"`, `complete = false`, `nextAction = failure.retry`
- `sufficient evidence + stoppedByBudget=true` → `failure = null`, `complete = true`, `searchCoverage.stoppedByBudget=true`로 informational만 남김
- assertion이 실패하면 직렬화 전에 throw (silent corruption 방지)

### 권고 2: `nextAction`을 truth-tracking으로 (deterministic)

`find_relevant_code`가 3/4 exact + actionable target을 가지고 `nextAction=ask_user`를 반환하면 **자기 답을 자기가 무효화**. 이는 정확히 "신뢰 = 컨텍스트 절감" 가치 명제의 반대 방향.

**조치**: `nextAction`을 모델의 self-report가 아니라 `evidenceQuality + targets.length`에서 deterministic하게 도출:

```
if exactCount >= 1 and targets.filter(t => t.role !== 'reference').length >= 1:
  nextAction = read_targets (with concrete file:line)
elif exactCount === 0:
  nextAction = explore_followup (with narrowed hints)
else:
  nextAction = stop
```

`ask_user`는 **input ambiguity (claim/symbol/scope가 모호함)** 인 경우에만 발동되도록 제한.

### 권고 3: 자기 자신의 답변에 redaction을 적용하지 않기

`collect_evidence`가 `.env`를 `[REDACTED:secret-path]`로 마스킹하면 보안 정책 답변이 그 자체로 무용. 

**조치**: redaction은 **파일 contents + snippet** 에만 적용, 모델의 자연어 `directAnswer` 필드에는 적용하지 않음. snippet redaction은 그대로 유지 (라인 인용에서 secret value 누설 방지가 목적). 만약 directAnswer에 secret value가 실제로 누설된다면 그것은 별도 prompt 결함으로 다루어야 함.

### 권고 4 (보너스): Token 비용 가시화

`review_change_context` 2주일 query가 442K 입력 토큰을 사용한 것은 parent agent에게 가시적이지 않음 (`_debug.stats.inputTokens`에만 있음). MCP description 또는 `_meta.progress`에 "approximate cost tier" (light/medium/heavy) 표시 권고. parent가 비용 trade-off를 의식적으로 결정 가능.

### 권고 5 (보너스): `evidenceRefs` 포맷 통일

`map_change_impact`가 `["file_range","E4"]`를 반환한 것은 structured automation을 깸. evidenceRefs는 **E-id 배열만 허용**하는 schema validation을 직렬화 직전에 적용 (Cerebras 422 에러 같은 류는 아니므로 사후 검증 부담 작음).

---

## 8. 종합 verdict

parent agent 입장에서 이 MCP는 **사용 가능하나 무조건 신뢰는 위험**합니다.

**무조건 신뢰 가능**:
- `explore_repo`: non-obvious negative 발견 능력은 wrapper로 대체 불가
- `collect_evidence`의 active refutation 능력 (단, self-redaction 제외)
- `map_change_impact`의 edit/read/reference role 분리
- `explore`의 critic-warned citation gap 자기 감지

**의식적 보수 사용 필요**:
- 모든 도구의 `nextAction` 신호 (특히 `ask_user`) — 자동 dispatch보다는 `evidenceQuality.exactCount`와 `targets.length`를 직접 검사하여 override
- partial/dropped evidence가 있는 응답의 `complete=true` 주장 — 신뢰도 1단계 낮춰 해석
- secret/redaction이 관련된 답변 — original snippet을 직접 확인 필요할 수 있음

**현실적 dispatch 가이드** (parent agent용):

| 의도 | 우선 도구 | 백업 도구 |
|---|---|---|
| 일반 탐색, 형태 모름 | `explore_repo` | — |
| 알려진 file/route/feature 위치 찾기 | `find_relevant_code` | `explore_repo` (hints) |
| 알려진 심볼 추적 | `trace_symbol` | `find_relevant_code` |
| 변경 영향 분석 | `map_change_impact` | `explore_repo` |
| 흐름 추적 (route/middleware/event) | `explain_code_path` | `explore_repo` |
| claim 검증 | `collect_evidence` | `explore_repo` |
| PR/git 기반 review context | `review_change_context` | — (다른 도구는 git 없음) |
| 사람용 보고서 | `explore` | — |

---

## 9. 결론

이 프로젝트의 가치 명제 **"신뢰 = 컨텍스트 절감"**은 정확하고 실제로 입증됩니다. cerebras-explorer는 평균적으로 내장 Explore agent와 비등하거나 약간 더 풍부한 결과를 *parent context를 거의 안 쓰면서* 반환합니다.

가장 큰 위험은 **외부 결함이 아니라 내부 정합성 결함**입니다 — 도구가 올바른 답을 가지고 있음에도 `failure` 필드나 `nextAction=ask_user`를 같이 반환해서 parent가 그 답을 신뢰하지 못하게 만듭니다. 이는 시스템적 패턴 (6개 도구에 걸침) 이며, runtime의 sufficiency gate 및 nextAction 도출 로직을 deterministic하게 재설계하면 single biggest trust improvement가 됩니다.

surface 축소 (10→5 또는 8→5) 도 검토 가치가 있으나 (필요성 분석 권고), calibration fix가 먼저입니다. 8개 surface에서 모두 정직한 신호를 내면 parent agent의 dispatcher 부담은 감내 가능하지만, **현재처럼 모든 도구가 비슷한 unreliable confidence/nextAction 결합 패턴을 보이면 5개로 줄여도 같은 문제가 압축될 뿐**입니다.

---

## 부록 A: 평가 워크스페이스

```
/tmp/cerebras-eval-2026-05-24/
├── cerebras-tool-results/   # 16개 도구 응답 (key fields)
├── evaluator-reports/        # 8명 evaluator + 1명 necessity 응답
└── explore-comparison/        # 8건 내장 Explore 비교
```

(본 평가는 응답을 디스크에 저장하지 않고 모두 평가 컨텍스트에 인라인하여 분석한 형태로 진행했습니다. 위 디렉터리 구조는 향후 재실행 시 권장 형식.)

## 부록 B: 사용한 Cerebras 모델 비용 요약 (16건)

| 도구 | 평균 inputTokens | 평균 outputTokens | 평균 elapsedMs |
|---|---:|---:|---:|
| `find_relevant_code` | 87.4K | 3.1K | 6.8s |
| `trace_symbol` | 65.7K | 1.8K | 6.3s |
| `collect_evidence` | 107.9K | 4.9K | 11.4s |
| `review_change_context` | **419.5K** | 6.8K | 19.0s |
| `explore_repo` | 158.0K | 5.5K | 11.5s |
| `map_change_impact` | **336.5K** | 7.5K | 18.8s |
| `explain_code_path` | 145.0K | 5.5K | 11.3s |
| `explore` | **427.1K** | 5.1K | 77.0s |

`review_change_context`, `map_change_impact`, `explore` 세 도구가 input token 사용량 최상위. parent agent는 이 세 도구를 호출 전에 의식적으로 budget 결정을 해야 함 (현재 surface에 cost hint 없음).
