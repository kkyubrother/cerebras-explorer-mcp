# cerebras-explorer-mcp 프롬프트/컨텍스트 안전성 리뷰 — 작업 계획 보고서

**작성일**: 2026-06-01
**대상 리뷰**: [`reports/chatgpt-cerebras-explorer-mcp-2026-06-01-review.md`](./chatgpt-cerebras-explorer-mcp-2026-06-01-review.md)
**검증 기준 트리**: `master` HEAD (`e665463`, v0.7.1 + post-release 커밋), 직접 `Read`/`Grep` 대조
**줄번호 표기**: 본 문서의 모든 `file:line`은 **현재 HEAD 기준 재검증** 값 (리뷰 원문은 별도 ZIP 스냅샷 기준이라 줄번호가 다름)

---

## 0. 요약 (TL;DR)

리뷰는 `cerebras-explorer-mcp-master(8).zip` 스냅샷 기준이고, 그 사이 **spec 023(prompt & contract hygiene)이 머지·릴리스 완료**(PR #28 → `v0.7.1`)되었으며 그 위로 보안 하드닝 커밋이 더 쌓였습니다. 따라서 리뷰 지적은 "코드와 일치하는가"가 아니라 **"HEAD 기준 아직 미해결이고, 의도된 trade-off가 아닌가"** 로 재판정해야 합니다.

판정 결과:

- **워딩 계열 지적(F4 라우팅, F5 untrusted-content)은 신규 작업이 아니다.** F5는 이미 양 경로 프롬프트에 반영되어 있고(spec 023 FR-006), F4의 "single known symbol or claim" 문구는 spec 023 FR-004가 **의도적으로 선택**한 결과다.
- **진짜 타당한 신규 작업은 런타임/컨텍스트 안전성 4건(+프롬프트 문구 1건)** 이다. 이들은 모두 spec 023이 명시적으로 제외한 **동작 변경**이므로 **신규 spec이 필요**하다.
- 우선순위: **AP-1(report fallback no-op 버그 — 가장 작고 명확)** → **AP-2(report citation line-range grounding)** → **AP-3(compact 경로 70% proactive compaction)** → **AP-4(estimateTokens chars/4)** → **AP-5(truncation marker 문구 — 저비용)**.

> 줄번호 매핑 주의: 리뷰의 `runtime.mjs:1931-1974`, `1918-1920`, `2094-2096` 등은 ZIP 기준이며 `95c9c3b chore: remove legacy explorer surfaces`로 줄이 이동했다. 본 문서는 HEAD 줄번호로 다시 검증했다(부록 A 참조).

---

## 1. 검증 방법과 기준

**타당성 기준** — 다음 셋을 모두 만족해야 "작업 대상(valid TODO)"으로 채택:

1. HEAD에서 **아직 미해결**일 것 (spec 023 또는 post-023 커밋이 이미 고치지 않았을 것)
2. **의도된 trade-off / 설계 선택이 아닐** 것
3. **현재 코드로 확증** 가능할 것 (file:line + 코드 인용)

**post-023 커밋 영향 점검** (리뷰 지적과 경로가 겹치는 커밋을 먼저 조사):

| 커밋 | 내용 | 리뷰 지적과의 관계 | 결론 |
| --- | --- | --- | --- |
| `95c9c3b` | remove legacy explorer surfaces | `runtime.mjs`/`prompt.mjs`/`server.mjs` 줄번호 대폭 이동, dead V1 prompt builder 제거 | 줄번호 재검증 필요(완료). 핵심 발견은 그대로 성립 |
| `86e365a` | bound blame evidence line ranges | `critic.mjs`의 **compact 경로** git blame evidence 범위 바운딩(`critic.mjs:109-160`) | **report critic(`critic.mjs:528+`)은 미변경** → AP-2 여전히 유효 |
| `a79d70b` | keep broad security searches incomplete on budget exhaustion | budget 소진 시 `searchCoverage` incomplete 처리(`isBroadInvestigationTask`, `evaluateEvidenceSufficiency`) | 리뷰의 finalize/budget 안전 우려를 **부분 완화**. 단, **컨텍스트 압축(AP-1~4)과는 무관** |
| `3133ab0` | preserve scope in budget retry recipes | budget retry scope 보존 | AP-1~5와 무관 |

---

## 2. 타당성 판정 표 (전체 triage)

| ID | 리뷰 출처 | 판정 | 범위 | 현재 코드 근거 (HEAD 검증) | 기존 조치 | 우선순위 |
| --- | --- | --- | --- | --- | --- | --- |
| **AP-1** | Top5 #3, §5(b)·6.4 | **확정 (버그)** | 동작변경(소) | `runtime.mjs:1953`·`1973`이 폴백을 `maxContextTokens`로 호출 vs `:80` no-op 조건 | 미해결 | **P0** |
| **AP-2** | Top5 #1, §3.3·6.5 | **확정** | 동작변경(중) | report: `runtime.mjs:2095`(path만)·`:2266`, `critic.mjs:563`(path-level) vs compact: `runtime.mjs:1588`(`recordObservedRange`) | 미해결 (`86e365a`는 compact만) | **P1** |
| **AP-3** | Top5 #2, §5(a) | **확정** | 동작변경(중) | compact 루프 `runtime.mjs:1430`은 100% threshold만, 70% proactive·LLM summary 없음 vs report `:1932` | 미해결 | **P1** |
| **AP-4** | Top5 #4, §5(b) | **확정** | 동작변경(소~중) | `runtime.mjs:57-66` 순수 `chars/4`, tokenizer 없음. `cerebras-client.mjs` post-023 미변경 | 미해결 | **P2** |
| **AP-5** | §5(c) 개선안 #5 | **확정** | 워딩(저비용) | `prompt.mjs:386` "key information is preserved" vs `runtime.mjs:93`(prefix-300), `:166`("evidence missing") | 미해결 | **P2** |
| T-1 | Top5 #5, §6.4 | 부분타당 / **의도된 설계** | 워딩(선택) | `server.mjs:752` "single known symbol or claim" | spec 023 FR-004 의도적 채택 | P3(선택) |
| T-2 | F5, §6.3 #5 | 정확하나 **조치 완료** | — | `prompt.mjs:125`·`367` UNTRUSTED CONTENT #5 (양 경로) | spec 023 FR-006 완료 | 조치완료 |
| T-3 | 단계 2 (리뷰 line 66) | 부분타당 / heuristic robustness | 동작변경(소, 보류) | `prompt.mjs:56-70`(weighted regex), `:197`·`:303`("switch once") | 미해결 / compound top-2(`:68-69`)가 부분 완화 | P3(보류) |
| N-1 | §5(b) finalize 안전 | **부분 완화됨** | — | `a79d70b` `broad_investigation_budget_exhausted` | post-023 부분 조치 | 모니터링 |

> "정확하지만 조치 완료/의도된 설계"인 T-1·T-2에는 재검증 에너지를 쓰지 않는다(리뷰 §6.3 #5도 F5를 "개선됨"으로 자평).

**단계 2의 중간+ 관찰 처리 내역(누락 방지)** — 위 표가 "전체 triage"임을 보장하기 위해, 리뷰 단계 2의 중간 이상 항목을 모두 다음과 같이 귀속했다:
- `detectStrategy()` "switch once" 제약(중간) → **T-3** (위에 신규 추가).
- `buildFreeExploreFinalizePrompt`의 main-loop cut-off 복구 부재(중간) → **§5 보류**(output continuation 항목에 흡수).
- `buildCompactionSummaryPrompt` LLM summary 손실성(중간) → **§5 보류**(summary lossiness 항목) + **AP-3**(deterministic ledger 병행 주입으로 부분 대응).
- output continuation overlap 미검증(중간) → **§5 보류**.
- 나머지(서버 instructions over-trigger, finalize 8개 제한 등)는 T-1 또는 "낮음~중간"으로 의도된 trade-off.

---

## 3. 작업 항목 상세

### AP-1 — report 경로 압축 폴백 no-op 수정 (P0, 가장 작고 명확)

- **문제**: report 루프는 추정 토큰이 70%(`compactionThreshold`)에 도달하면 압축을 시도한다(`runtime.mjs:1944`). 그러나 LLM 압축 횟수 상한 소진(`:1952`) 또는 summary 실패(`catch`, `:1972`) 시 폴백으로 `compactOldToolResults(messages, budgetConfig.maxContextTokens)`를 호출한다(`:1953`, `:1973`). `compactOldToolResults`는 `estimated < threshold`면 **그대로 반환(no-op)** 한다(`:80`). 폴백 threshold가 100%(`maxContextTokens`)이므로 **70%~100% 구간에서는 폴백이 아무것도 줄이지 않는다.**
- **근거 (검증됨)**:
  - `runtime.mjs:80` — `if (estimated < threshold) return messages;`
  - `runtime.mjs:1932` — `compactionThreshold = Math.floor((maxContextTokens ?? 100_000) * 0.70)`
  - `runtime.mjs:1953`·`1973` — 폴백이 `budgetConfig.maxContextTokens`(=100%) 전달
- **제안 수정**: 두 폴백 호출의 두 번째 인자를 `compactionThreshold`(70%)로 교체. 이렇게 하면 LLM summary가 불가능할 때도 단순 절단이 70%에서 실제로 발동한다.
- **범위/위험**: `runtime.mjs` 2줄 변경, 동작 변경이지만 매우 국소적. 위험 낮음. 기존 `runtime.mock.test.mjs`의 압축 단언과 충돌 가능 → 폴백 절단 발동 케이스 테스트 추가.
- **검증**: 70%~100% 구간에서 폴백 경로가 old tool result를 prefix-300으로 절단하는지 단위 테스트. `npm test` 0 fail.
- **대안 해석(주의)**: 폴백이 `maxContextTokens`(100%)를 쓰는 것이 **의도된 last-resort**("LLM summary cap을 소진했으니 100%까지는 두고 거기서 hard-truncate")일 가능성도 코드만으로는 배제 못 한다. 다만 70~100% 구간이 비관리로 자라는 현상은 실재하고, 폴백 인자를 `compactionThreshold`로 바꾸는 수정은 어느 해석에서도 개선이므로 우선순위는 유지한다.

### AP-2 — report citation의 line-range grounding 추가 (P1)

- **문제**: report 경로는 읽은 파일을 **경로 단위로만** 기록한다(`filesRead.add(safeToolResult.path)`, `runtime.mjs:2095`). `buildReportCritic`은 citation의 `path`가 `filesReadSet`에 있는지만 검사한다(`critic.mjs:563`). 즉 Markdown report의 `file:Lx-Ly` citation은 **"그 파일을 읽었다" 수준**까지만 검증되고, "그 line range를 실제로 읽었다"는 검증되지 않는다. compact 경로는 `recordObservedRange`로 관측 범위를 모으고(`runtime.mjs:1588`,`1593`,`1603`,`1619`,`1629`) deterministic critic이 line-range를 exact/partial/drop으로 판정한다(`critic.mjs:134-214`). **두 경로의 grounding 강도가 비대칭.**
- **근거 (검증됨)**:
  - report 기록: `runtime.mjs:2095`(path만), `:2266`(`buildReportCritic({ report, filesRead })` — 범위 미전달)
  - report critic: `critic.mjs:563`(path-level 검사만)
  - compact 대조: `runtime.mjs:1588`+`recordObservedRange`(`:1210`), `critic.mjs:134-214`(`groundEvidenceItem`/`groundEvidenceList`)
  - `86e365a`는 compact 경로 blame 범위만 손봄 → report critic 미변경 재확인
- **제안 수정**: report 루프에도 `observedRanges` 맵을 기록(compact의 `recordObservedRange` 재사용)하고, `buildReportCritic`에 넘겨 citation의 line-range가 관측 범위와 겹치는지(`checkEvidenceGrounding` 재사용) 검증. 불일치 시 `citation_gap` 경고 격상.
- **범위/위험**: `runtime.mjs`(report 루프) + `critic.mjs`(`buildReportCritic`) 변경. 중간 규모. report는 human-consumption 목적이라 false-positive 경고가 많아지지 않게 partial 허용 정책을 compact와 맞출 것.
- **검증**: report citation이 읽지 않은 line range를 가리킬 때 경고가 붙는 mock 테스트.
- **참고(잔여 이견, §6.4)**: report를 broad architecture 용도로만 쓰면 path-level로 "충분"하다는 관점도 있음. 따라서 **trust-critical handoff용 line-grounding을 옵션/sidecar로** 두는 절충도 검토 가치 있음.

### AP-3 — compact-JSON 경로에 70% proactive compaction 도입 (P1)

- **문제**: compact 루프는 매 턴 `compactOldToolResults(messages, budgetConfig.maxContextTokens)`만 호출한다(`runtime.mjs:1430`). 즉 **100% threshold 도달 전까지 사실상 방치**되고, report 경로가 가진 70% proactive LLM summary가 없다. 컨텍스트가 커지는 과정 자체의 관리가 약하다.
- **근거 (검증됨)**: `runtime.mjs:1430`(compact, 100%만) vs `runtime.mjs:1932`·`1944`(report, 70% LLM summary).
- **제안 수정**: compact 경로에도 70% proactive compaction을 추가하되, **LLM summary 단독이 아니라** 이미 기록 중인 `observedRanges`/`observedGit`(`runtime.mjs:1407-1408`,`1588-1654`) 기반 **deterministic evidence ledger(verified path:line + 짧은 snippet)** 를 final synthesis 전에 재주입한다. 이러면 tool result 절단 손실을 보상하면서 grounding 신호를 유지한다.
- **범위/위험**: `runtime.mjs`(compact 루프) 변경. 중간 규모. compact 경로의 강점(deterministic evidence grounding)을 해치지 않도록, LLM summary보다 ledger 재주입을 우선.
- **검증**: 70% 도달 시 ledger 재주입 + 토큰 감소를 확인하는 mock 테스트. critic의 evidence grounding 결과가 압축 전/후로 유지되는지.

### AP-4 — `estimateTokens`를 provider/model-aware로 보수화 (P2)

- **문제**: `estimateTokens`는 `Math.ceil(content.length / 4)` (+ tool_calls/4 + reasoning/4) 순수 문자수 휴리스틱이다(`runtime.mjs:57-66`). 주석은 "conservative"라 하지만, **한국어/CJK·비ASCII에서는 토큰당 문자수가 4보다 작아 오히려 토큰 수를 과소추정**한다. 그 결과 70%/100% threshold 판단이 늦어져 provider hard limit 전에 압축이 발동하지 않을 수 있다. (provider hard limit 실제 수치는 자료 부족 — §5 참조.)
- **근거 (검증됨)**: `runtime.mjs:57-66`. `cerebras-client.mjs`는 post-023 미변경(토크나이저 추가 없음).
- **제안 수정**: (a) 최소한 비ASCII 비율에 따른 safety margin 적용, 또는 (b) model-aware 토크나이저 기반 추정. 우선 (a)로 빠르게 보수화하고 (b)는 후속.
- **범위/위험**: `runtime.mjs`(또는 `cerebras-client.mjs`)의 추정 함수. 작음. 과대추정으로 바뀌면 불필요한 조기 압축이 늘 수 있으니 margin 계수 튜닝 필요.
- **검증**: 한글 위주 메시지에서 추정치가 ASCII 대비 상향되는지 단위 테스트.

### AP-5 — report 프롬프트의 truncation marker 문구 완화 (P2, 워딩-only)

- **문제**: `buildFreeExploreSystemPrompt`(report)는 `'- If you see "[summarized]" or "[truncated]" markers, the key information is preserved — work with what is available.'`라고 단정한다(`prompt.mjs:386`). 그러나 실제 절단은 핵심 정보 보존을 보장하지 않는다: `compactOldToolResults`는 prefix 300자만 남기고(`runtime.mjs:93`), `applyToolResultCharBudget` 마커는 "evidence가 빠졌으면 narrower query/read로 재조회하라"고 명시한다(`runtime.mjs:166`). **프롬프트가 후처리 동작을 과장**해, B가 누락 증거를 재조회하지 않을 수 있다.
- **근거 (검증됨)**: `prompt.mjs:386` vs `runtime.mjs:93`·`166`.
- **제안 수정**: "key information is preserved" → "content may be omitted; if expected evidence is missing, re-read narrower ranges or re-run a narrower query." (실제 마커 권고와 정합.)
- **범위/위험**: `prompt.mjs` 1줄. 동작 변경 없음, 위험 최소. spec 023 류 hygiene 후속으로 단독 처리 가능.
- **검증**: 프롬프트 문자열 단언 테스트(`runtime.mock.test.mjs`) 업데이트.

### T-1 (선택) — A-facing 라우팅 "단일 작업" 경계 예시 보강

- **현황**: `server.mjs:752`의 "single known symbol or claim" 도구 선호는 spec 023 FR-004가 **의도적으로** grep-then-read loop 기준으로 택한 문구다. 리뷰도 §6.4에서 "중간" 심각도의 **잔여 이견**으로 분류.
- **선택적 개선**: over/under-triggering을 줄이려면 라우팅 예시를 명시("single grep이면 수동, single claim evidence면 `collect_evidence`, known symbol callsites면 `trace_symbol`"). **버그 아님 — 우선순위 낮음(P3, 선택).** 채택 시 워딩-only.

### T-3 (보류) — `detectStrategy()` 오분류 + "switch once" 제약

- **현황**: `detectStrategy`는 가중 정규식 휴리스틱이다(`prompt.mjs:56-70`). compact user prompt(`:303`)와 strategy catalog(`:197`)는 "you may switch (to a complementary strategy) once if the evidence requires it"로 **전략 전환을 1회로 제한**한다. 리뷰는 오분류 시 탐색 회복이 제한될 수 있다고 지적(단계 2, 심각도 중간).
- **완화 요소(검증됨)**: `detectStrategy`는 상위 두 전략 점수가 근소하면 **둘 다 반환(compound)** 한다(`prompt.mjs:68-69`). 또 `:193`/`:394`에 "2회 연속 실패 시 다른 전략으로 전환" 규칙이 별도로 존재한다. 따라서 단일 "switch once"가 회복을 전면 차단하지는 않는다.
- **판정**: 부분 타당하나 **의도된 anti-thrashing 가드와 얽혀** 있고, compound 처리로 위험이 낮아진다. **AP-4와 동급의 heuristic-robustness 관찰**이지만 실측 데이터 없이 손대면 회귀 위험. → **보류(P3)**. 개선 시 spec 006(explore-router-heuristics) 후속으로 measure-first.

---

## 4. 권장 실행 순서 및 묶음

1. **즉시(핫픽스 가능)**: **AP-1** — `runtime.mjs` 2줄 + 테스트. `fix:` 커밋 단독 가능.
2. **신규 spec 제안 — spec 024 "context-window safety"**: **AP-2 + AP-3 + AP-4**. 셋 다 동작 변경이고 컨텍스트 안전성이라는 한 주제로 묶인다. spec 023이 "string/wording only, no behavior change"로 명시 제외했으므로 **반드시 신규 spec으로 분리**.
3. **워딩 hygiene 후속(spec 023 류)**: **AP-5** (+ 선택 시 **T-1**). 동작 변경 없음, 저비용.

> AP-1은 spec 024에 포함시켜도 되지만, 명확한 버그라 **선행 핫픽스**가 합리적.

---

## 5. 범위 밖 / 보류 (자료 부족 또는 trade-off)

- **provider hard context limit 실제 수치**: 코드/자료에 미제공. AP-4의 "실제 실패 임계"는 측정 전까지 단정 불가. (단, AP-1·AP-3의 구조적 결함은 수치와 무관하게 성립.)
- **output continuation overlap/consistency 검증**: `finishReason === 'length'` 복구는 최대 3회 이어쓰기뿐, deterministic overlap detection은 없음(리뷰 §5(b)). main loop에서 모델이 직접 report를 쓴 경우의 cut-off 복구도 없음. `output_recovery` 경고만 존재(`critic.mjs:602-608`). 필요성 대비 비용이 커 별도 검토 대상으로 보류.
- **LLM summary 손실성(report 경로)**: `compactWithLlmSummary`(`runtime.mjs:196-237`)는 temp 0.3·maxCompletionTokens 1000 생성물이고, 재구성 시 system + summary + ack + `sliceRecentTurns(3)`만 남겨 중간 tool result 원문을 버린다(citation 유실·환각 가능, 리뷰 §5(b)). **AP-3의 deterministic ledger 병행 주입**이 부분 대응이나, summary 품질 자체의 보장은 별도 과제로 보류.
- **prompt injection runtime 필터링**: UNTRUSTED CONTENT #5는 프롬프트 레벨 방어(모델 준수 의존). runtime 레벨 필터링 추가 여부는 위협 모델 정의가 선행되어야 함. T-2로 조치 완료된 부분 이상은 보류.
- **N-1(budget-exhaustion finalize 안전)**: `a79d70b`로 이미 부분 조치됨. 추가 작업 불필요, **모니터링**만.

---

## 부록 A — 리뷰(ZIP) ↔ HEAD 줄번호 매핑

| 항목 | 리뷰(ZIP) 줄번호 | HEAD 검증 줄번호 |
| --- | --- | --- |
| `estimateTokens` | `runtime.mjs:53-66` | `runtime.mjs:57-66` |
| `compactOldToolResults` no-op 조건 | `runtime.mjs:77-99` | `runtime.mjs:77-99` (`:80` no-op) |
| report 70% 압축 + 폴백 | `runtime.mjs:1931-1974` | `runtime.mjs:1932`·`1944`·`1953`·`1973` |
| compact 루프 압축 호출 | `runtime.mjs:1429-1430` | `runtime.mjs:1430` |
| report `filesRead` 기록 | `runtime.mjs:2094-2096` | `runtime.mjs:2095` |
| `buildReportCritic` | `critic.mjs:528-620` | `critic.mjs:528-622` (`:563` path-level) |
| compact `recordObservedRange` | `runtime.mjs:1587-1629` | `runtime.mjs:1588-1629` |
| UNTRUSTED CONTENT #5 | `prompt.mjs:119-125`·`362-368` | `prompt.mjs:125`·`367` |
| truncation marker 문구 | `prompt.mjs:384-388` | `prompt.mjs:385-386` |
| A-facing routing 문구 | `server.mjs:750-757` | `server.mjs:752` |

## 부록 B — 검증에 사용한 근거(요약)

- compact vs report grounding 비대칭: `runtime.mjs:1588`(compact `recordObservedRange`) vs `runtime.mjs:2095`(report path-only) / `critic.mjs:134-214`(line-range grounding) vs `critic.mjs:563`(path-level)
- 70% threshold는 report에만: `runtime.mjs:1932`(report) vs `runtime.mjs:1430`(compact 100%만)
- 폴백 no-op: `runtime.mjs:80` + `:1953`/`:1973`
- 토큰 추정 휴리스틱: `runtime.mjs:57-66`
- 프롬프트 과장 vs 실제 절단: `prompt.mjs:386` vs `runtime.mjs:93`/`:166`
- post-023 영향: `86e365a`(compact blame만), `a79d70b`(budget-exhaustion searchCoverage), `95c9c3b`(legacy 제거·줄이동)
