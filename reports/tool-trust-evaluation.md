# Cerebras Explorer MCP — Tool Trust Evaluation Report

**작성일**: 2026-05-24
**평가 범위**: 공개 MCP 도구 10개 × 5개 레포지토리 = 50회 테스트
**평가자 구성**: 도구별 1명의 sub-agent (코드 미열람, 응답 신호만으로 신뢰성 판단) × 10명
**대상 버전**: `cerebras-explorer-mcp` v0.4.1 (default model: `zai-glm-4.7`)

---

## 1. 요약

> **이 보고서의 한 줄 결론**: 10개 도구는 *대부분* parent agent (Claude Code / Codex)가 신뢰하고 호출할 만한 신호 품질을 보였다. 가장 강력한 신뢰 신호는 응답이 자기 한계를 정직하게 드러낸다는 점 — `evidenceQuality.partialCount`, capped confidence, `failure.reason='budget_exhausted'`, `critic.status='caution'`이 일관되게 작동했다. 한편 **즉시 수정 필요한 production 버그 1건**과 **공통 risk 패턴 5가지**를 발견했다.

### 평가 결과 한눈에 보기

| 도구 | 신뢰 등급 | 주요 강점 | 주요 위험 |
|------|----------|-----------|-----------|
| `explore_repo` | ⭐ 신뢰 | 4-8 exact evidence + 일관된 status 다운그레이드 (verification, complete) | 비용 변동 큼 (~70K → ~672K tokens) |
| `find_relevant_code` | ⭐ 신뢰 | budget 소진 시 partial 결과를 명시적으로 라벨링 | partial 근거인 `edit` 타겟이 가장 위험 |
| `trace_symbol` | ⚠ 조건부 | exactCount=0/partialCount=high일 때 confidence 자기-cap | "39+ callers" 같은 집계 수치가 근거 행보다 큼 |
| `map_change_impact` | ⭐ 신뢰 | **틀린 전제 거부** (OAuth client_secret 없음 사례), cron 보존 같은 비명시 위험 surface | 자료 sprawl이 클 때 외부 CI/CD 미탐색 |
| `explain_code_path` | ⭐ 신뢰 | `[INTENDED]` 태그로 demo/미구현 구간을 정직하게 표시 | 산문이 evidence 행수보다 더 많은 hop을 명시할 수 있음 |
| `collect_evidence` | ⭐⭐ 강력 신뢰 | 5/5에서 정확한 verdict, FALSE claim 3개를 line:range 반증으로 격파 | 비용 편차 크고, "그럴듯해 보이는 잘못된 claim"은 미테스트 |
| `review_change_context` | ⚠ 조건부 | git_show 실패에서 per-file git_diff로 자동 복구 | 다중 커밋 prompt에서 evidence drop 집중 (~7/8 dropped) |
| `map_impact` | ⭐ 신뢰 | AST 파서, path 별칭 같은 refactor-blocking 의존성 발견 | high-fanout anchor (32+/54+ importers)는 line-range로 집계 |
| `find_entrypoints` | 🛑 **수정 필요** | 부정 결과(cron 0개)에 대한 근거별 분류 우수 | **production 버그: `hints.strategy='auto'`는 schema validator가 거부** |
| `explore` | ⭐ 신뢰 | citation_gap critic이 잘못된 인용 1건씩 정확히 지목 | 1/5에서 meta-narrative ("I now have sufficient evidence...") 누출 |

### 평가 환경

- **5개 테스트 레포** (모두 사용자 작업물):
  - `cerebras-explorer-mcp` (이 레포 자체; Node.js MCP 서버)
  - `DeepResearch` (Python FastAPI + LangGraph orchestrator)
  - `aicc_manage` (Next.js TypeScript + AWS Lex/Bedrock)
  - `bible` (Vite + React TypeScript SPA + Cloudflare)
  - `studious-memory` (Python FastAPI + MCP 서버)
- **테스트 분포**: 각 도구당 5개 레포에 1회씩 호출 (총 50회)
- **MCP 노출 현황**: 현재 Claude Code에 등록된 cerebras-explorer는 8개 도구만 노출. README/DESIGN이 명시한 10개 중 `map_impact`와 `find_entrypoints` 2개는 사용자 환경에서 미노출. 이 2개는 `src/explorer/runtime.mjs`를 직접 import하는 Node 헬퍼 스크립트로 호출했다.
- **각 sub-agent의 평가 입력**: 도구 description + input schema + 5개 테스트 transcript. **소스 코드는 보지 못한다.**
- **테스트 transcript 저장 위치**: `reports/transcripts/<tool>__<repo>.md` (50개)

---

## 2. 🚨 즉시 조치 필요: production 버그 1건

### `find_entrypoints` — `hints.strategy='auto'` 입력이 schema validator에 거부됨

**현황**:
- `src/mcp/server.mjs:573` — `buildFindEntrypointsArgs`가 `const hints = { strategy: 'auto' };`로 설정
- `src/explorer/schemas.mjs:391-394` — validator 허용 enum: `['symbol-first', 'reference-chase', 'git-guided', 'breadth-first', 'blame-guided', 'pattern-scan']` (`'auto'` 없음)
- 결과: MCP 노출 환경에서 `find_entrypoints`를 호출하면 매번 `Error: hints.strategy must be one of: ...`로 실패

**증거**: 본 평가에서 처음 직접-호출 스크립트가 같은 오류를 재현. `strategy` 필드를 제거해 우회.

**제안 수정**:
```js
// src/mcp/server.mjs buildFindEntrypointsArgs
- const hints = { strategy: 'auto' };
+ const hints = {};
  if (regex.length > 0) hints.regex = regex;
```
또는 `'auto'`를 schema enum에 추가하고 runtime에서 strategy 자동 감지로 변환.

**왜 지금까지 안 드러났나**: 사용자 Claude Code MCP 등록 시점에 8-tool surface였고, 10-tool surface로 가는 새 등록을 시도하면 처음으로 이 도구가 호출됨. README는 `find_entrypoints`를 공개 surface로 명시하지만 production path에는 도달하지 못한다.

**영향**: spec 013/015 (HTTP/CLI/cron/MCP/event entry point 자동 감지)이 사용자에게 도달하지 않음.

---

## 3. 도구별 평가 상세

### 3.1 `explore_repo` ⭐ 신뢰

**평가자 결론**: "Yes, I would call `explore_repo` again as a parent agent."

5개 레포 전부에서 4-8개의 exact evidence + 일관된 status 다운그레이드. 가장 인상적인 한 가지: aicc_manage 테스트에서 6개 evidence 중 1개가 partial이라 `confidence=high`임에도 `verification=follow_up_needed, complete=false`로 자기 다운그레이드 — "calibrated self-doubt"이 신뢰의 핵심 신호로 기능.

| 레포 | confidence | verification | exactCount | partialCount | failure |
|------|-----------|--------------|------------|--------------|---------|
| cerebras-explorer-mcp | high | verified | 4 | 0 | null |
| DeepResearch | high | verified | 7 | 0 | null |
| aicc_manage | high | follow_up_needed | 5 | 1 | null |
| bible | high | verified | 8 | 0 | null |
| studious-memory | high | verified | 8 | 0 | null |

**위험 신호**:
- 비용 변동 폭이 크다 (70K → 672K tokens). `_debug.stats.totalTokens`로 트래킹.
- 비용이 크면 보통 evidence count도 많지만, "exactCount가 directAnswer claim 수와 맞는지" sanity-check 필요.
- 5개 테스트 모두 TS/Python — Rust/Go/JVM 단독 레포에서는 별도 검증 필요.

### 3.2 `find_relevant_code` ⭐ 신뢰

5/5 응답이 grounded line-ranged citations + 정직한 status 필드. 2개가 budget exhausted였지만 `failure.reason='budget_exhausted'`로 명시되어 caller가 partial이라는 사실을 놓치지 않음.

**위험 신호**:
- **partial-grounded `edit` 타겟이 가장 위험**: aicc_manage에서 grep-grounded인 confirm-billing/route.ts 라인이 `role=edit`으로 라벨됨. caller가 partial 표기를 무시하고 edit 진행 시 위험.
- "confidence=high이지만 verification=follow_up_needed"는 caller가 둘 다 봐야 한다는 신호. confidence만 보고 진행하면 over-trust.
- budget-exhausted 응답에서 confidence=high가 "발견된 것은 정확하지만 완전성은 아니다"를 의미 — 쉽게 오해됨.

### 3.3 `trace_symbol` ⚠ 조건부 신뢰

3/5는 깨끗한 win (Tests 3, 4 + 일부 1). **2개에서 자기-과장 경향 포착**:

- **Test 2 (DeepResearch / build_graph)**: directAnswer가 "18 nodes"라고 명시했지만 evidence는 모두 partial (grep-only 1-line snippets). 모델이 confidence를 medium으로 self-cap한 것은 잘했으나, 산문은 부분 증거가 뒷받침할 수 없는 수치 주장.
- **Test 5 (studious-memory / scoped_tool)**: "39+ callers" 주장. evidence에는 2개만 인용. fileCount=1로 모든 caller가 정의 파일 내부 (decorator 사용)이지만 산문은 "used extensively"로 분포된 인상을 줌.

**위험 신호**:
- **집계 수치를 evidence 행보다 큰 N으로 주장**: "18 nodes", "39+ callers", "32+ files" 같은 수치는 산문에만 있고 exact evidence는 그보다 적음. caller는 "산문 N > evidence 행 수"일 때 재검색.
- partial-only 결과는 grep-equivalent로 취급.

### 3.4 `map_change_impact` ⭐ 신뢰

5/5 모두에서 blast radius를 actionable한 카테고리(edit/read/test/config)로 분해. **가장 인상적인 특성**: studious-memory에서 "rotate MCP OAuth client secret"이라는 *틀린 전제* 거부 — `MCP_OAUTH_*` 설정에 `CLIENT_SECRET`가 없음을 line:range로 증명하고 (`config.py:235-243`), `clear_oauth_jwks_cache()` 대안을 제시.

또 aicc_manage에서 "Toss 3DS 전환" 요청에 대해 "초기 구독 vs 정기 결제를 구분하고, cron renewal route는 반드시 chargeBillingKey를 유지해야 한다"라는 비명시 위험을 surface — 실수했으면 결제 시스템이 깨질 위치.

**위험 신호**:
- 비용 큼 (10-29 toolCalls, 13-19s, ~289K tokens). "one-line known-file edit"에는 호출 금지 (description에 이미 명시).
- "uncertainties" 배열을 directAnswer만 보지 말고 반드시 읽어야 함. aicc_manage 4번 케이스의 `?? plaintext` fallback은 uncertainties에만 나옴.
- **틀린 전제 거부는 *opportunistic*이다** — 항상 보장되지 않음. 의존하려면 directAnswer가 실제로 dispute하는지 확인.

### 3.5 `explain_code_path` ⭐ 신뢰

5/5 unbroken file:line chains, 각 hop이 evidence row로 뒷받침. **가장 인상적**: DeepResearch 테스트에서 "Celery task enqueue" 단계에 `[INTENDED]` 태그를 명시 — 실제 코드는 InMemoryTaskStore만 사용하고 Celery delay()/apply_async() grep이 0개임을 확인 후 "demo implementation" 디스클로저를 남김.

**위험 신호**:
- **산문 vs evidence 미스매치 위험**: aicc_manage 테스트에서 directAnswer는 `chargeBillingKey`를 언급하지만 8개 evidence slot에 없음. 8개 고정 budget 안에서 secondary hop이 밀려나는 패턴.
- **확신 필드 vs 정직 표시**: 모든 테스트가 `confidence=high, verification=verified`를 보이고, DeepResearch의 demo-vs-prod 다운그레이드는 *산문 + uncertainties*에만 나타남. consumer는 status 필드만 보면 over-trust.
- 단일 경로 가정 — 에러/재시도/HITL 분기는 별도 호출 필요.

### 3.6 `collect_evidence` ⭐⭐ 강력 신뢰

**5/5 정확한 verdict.** false claim 3개를 외과적 정밀도로 격파:
- cerebras-explorer-mcp의 "always include both fields" → FALSE (조건부 spread 인용)
- bible의 "service worker pre-caches all JSON" → FALSE (globPatterns가 .json 제외 인용)
- studious-memory의 "MCP scope filtering uses OR" → FALSE (MCP=AND vs HTTP API=OR 명시적 구분)

aicc_manage 테스트에서 (TRUE claim) **adjacent risk를 spot한 보너스**: encryption 검증 중 `?? billingResult.billingKey` plaintext fallback을 uncertainties에 surface.

**위험 신호**:
- **5개 테스트는 "true/false/over-broad qualifier"만 커버하고 "그럴듯해 보이는데 잘못 귀속된" claim은 미테스트**. 예: "off-by-one in a quantifier" 또는 "맞는 동사 + 틀린 주어"는 검증 안 됨.
- 비용 편차 큼 (67K → 672K tokens, 5 → 18 turns). 자기참조 레포(`cerebras-explorer-mcp`)에서 가장 비싸짐.

### 3.7 `review_change_context` ⚠ 조건부 신뢰

3/5는 reviewer-grade 통찰을 surface (aicc_manage가 billing 경로와 변경 파일 사이 import chain이 없음을 *증명*; DeepResearch가 mock data + 하드코딩 timestamp를 review flag로 surface).

**가장 약한 결과**: bible 테스트에서 confidence를 high → **low**로 자기-cap (7개 evidence가 dropped). directAnswer는 3개 커밋을 자세히 서술하지만 정작 grounded evidence는 1개뿐. parent가 status.warnings를 무시하면 *과장된 narrative*를 신뢰.

**위험 신호**:
- **다중 커밋 review goal은 evidence-sufficiency gate를 무리하게 한다**. 단일 커밋 prompt가 안전.
- 큰 커밋 (>40 files)에서 `git_show: stdout maxBuffer length exceeded` 발생 — DeepResearch 테스트는 per-file `git_diff`로 자동 복구. 좋지만 toolCalls 14개로 비용 ↑.
- 빈 `git_show` 결과 (merge commit) 처리는 *조용히* 이전 커밋으로 fallback. 사용자가 특정 SHA를 지정했다면 mislead 가능.

### 3.8 `map_impact` ⭐ 신뢰

5/5 anchor 입력 (3 symbol + 2 file)을 올바르게 reference chase. **가장 인상적**: studious-memory 테스트에서 `scoped_tool` 리팩토링이 `scripts/generate_contract_snapshot.py` (AST parser)를 silently 깰 위험을 surface — parent agent가 정상적인 import grep으로는 찾기 어려웠을 의존성.

또 bible 테스트에서 `tsconfig.json`/`vite.config.js`의 `@/*` path alias를 config-dependency로 식별 — refactor-blocker.

**위험 신호**:
- high-fanout anchor (32+ importer, 54+ usage)는 line-range로 *집계되며 enumerate되지 않음*. exhaustive edit list가 필요하면 follow-up `find_relevant_code` 호출.
- bible 테스트의 "9 types exported" 주장은 exact evidence가 없음. 타입 수 등 numeric claim은 verify.
- 모든 5개가 `verification=targeted_read_needed` — parent는 여전히 edit-target line range를 spot-check해야 함.
- **이 도구는 현재 사용자의 MCP 등록에 노출되지 않음** (8/10). production 패리티는 직접-호출에서 *assert*되었으나 *verify*되지 않음.

### 3.9 `find_entrypoints` 🛑 production bug 수정 후 ⭐ 신뢰

**위 §2의 버그 수정이 선행되어야 함.** 그 외 5개 테스트 모두에서:

가장 인상적인 결과: **bible 테스트 (entryKind='cron', 기대값 0)** — 6개의 setInterval 매치를 *모두* UI 타이머로 분류하고 각 매치에 "캐러셀 자동 슬라이드" / "exam timer" / "storage poll" / "버튼 반복" 등 *개별 사유*를 명시. `wrangler.jsonc`도 사전 검사해 Cloudflare cron triggers 부재 확인. **정확히 부정 결과 처리의 정석.**

studious-memory 테스트는 `supervisor.spawn()` 같은 regex bundle 밖 패턴까지 LLM이 cron으로 *확장 분류* — 유용한 의미적 확장이지만 완전성을 audit할 수 없음 (`description`에 따르면 detection은 regex-based).

**위험 신호**:
- **🛑 strategy='auto' 버그** (§2 참조).
- 집계 수치는 individually grounded되지 않음 ("Billing 36 / Admin 32", "150+ FastAPI routes", "45 MCP tools").
- regex 밖 의미 확장 (supervisor.spawn as cron)은 가설로 취급.
- `partialCount=2`인데 `evidenceQuality.level=high` (studious-memory 테스트) — level만 보는 consumer는 grep-only grounding을 over-weight.

### 3.10 `explore` (Markdown report) ⭐ 신뢰

5/5에서 inline citation × structuredContent.citations[] × targets[]가 1:1로 평행하고, critic이 결함 있는 인용 2건을 정확히 지목 (aicc_manage `chat/route.ts:L10-L52` 누락 prefix; studious-memory `api_key.py:L10-L15` 미열람).

**1개 의미 있는 결함**: studious-memory 응답이 "I now have sufficient evidence to provide a comprehensive architecture overview. Let me compile the report."라는 planner monologue로 시작 — meta-narrative leak. 사용자에게 forward하기 전 strip 필요.

**위험 신호**:
- **Meta-narrative leak**: 모델의 thinking이 final Markdown에 남는 경우가 있음 (5개 중 1개). prompt 또는 후처리에서 "no first-person planning" 강제 필요.
- **Inline cite typo**: 본문에는 잘못된 link가 남고 critic만 잡음. parent는 critic.warnings[].target을 사용자에게 함께 렌더하지 않으면 사용자가 잘못된 link를 따라감.
- 비용 편차 큼 (~9s/177K → ~77s/409K). chat-fronted UX에서는 지연 예측 안 됨.
- Suggestions 섹션은 사용자에게 *commit*처럼 읽힐 수 있음. 도구 description 또는 report header에 advisory로 명시 필요.

---

## 4. 공통 risk 패턴 5가지

5개 레포 × 10개 도구의 사용자 입장에서 반복적으로 나타난 패턴.

### Pattern 1: 산문 N > evidence 행 수

산문에서 "39+ callers", "150+ routes", "9 types exported"라고 주장하지만 evidence 배열에는 일부만. parent agent는 `_debug.stats.exactCount`/`partialCount`와 `evidence.length`가 directAnswer가 주장하는 N과 매칭되는지 확인해야 함.

### Pattern 2: confidence=high가 *완전성*을 의미하지 않음

`status.confidence=high`는 "찾은 것은 정확하다"는 의미이지 "다 찾았다"가 아님. 완전성 신호는 `status.complete`, `status.verification`, `failure.reason='budget_exhausted'`. parent가 confidence만 보면 over-trust.

### Pattern 3: partial 근거가 `edit` 역할에 붙으면 위험

`role=edit`인 target이 `groundingStatus=partial`이면 *수정 전 반드시 실제 line range를 열어 확인*해야 함. 본 평가에서 가장 위험한 콤보 (aicc_manage의 confirm-billing/route.ts:122-160).

### Pattern 4: uncertainties는 hint가 아닌 *복구 경로*

`uncertainties`/`searchCoverage.warnings`/`status.warnings`/`critic.warnings`는 일부 도구가 가장 actionable한 위험을 우선 surface하는 채널 (예: aicc_manage encryption의 plaintext fallback, bible idb→Cache 마이그레이션의 7개 API 격차). directAnswer만 읽고 uncertainties를 skip하면 review-grade 인사이트의 50%를 놓침.

### Pattern 5: 자기 참조 비용 폭증

테스트 중 가장 비싼 호출은 `cerebras-explorer-mcp` 자체에 대한 `collect_evidence` (672K tokens, 18 turns). 자기참조 레포에서는 모델이 spec/transcript/legacy plan 등 메타 콘텐츠를 광범위 탐색. parent agent는 자기 참조 시 `scope`를 좁히거나 `knownFiles`로 anchor.

---

## 5. 결론 및 권장 사항

### 5.1 parent agent로서 이 MCP를 쓸 것인가

**Yes, 9/10에 대해 — production bug 1건 수정을 전제로.**

이 도구들의 가장 큰 장점은 *자기 한계를 정직하게 신호한다*는 점이다. budget exhausted, partial evidence, capped confidence, citation_gap critic, [INTENDED] 태그가 일관되게 작동하므로, parent agent가 status 필드만 정확히 읽으면 over-trust를 회피할 수 있다. 특히 `collect_evidence`와 `map_change_impact`의 *premise rejection* 행동(틀린 claim/전제 거부)은 단순 검색 도구가 아닌 *검증 도구*로서의 가치를 입증한다.

### 5.2 도구별 호출 권장 시나리오 (parent agent의 decision rule)

| 시나리오 | 추천 도구 | 이유 |
|----------|-----------|------|
| 자동화 / 편집 계획 / follow-up 검증 | `explore_repo` | 구조화 JSON, status 다운그레이드가 가장 신뢰 |
| 알려진 심볼의 정의 + caller | `trace_symbol` | exactCount>0/partialCount=0일 때 즉시 사용; partial-only면 재grep |
| 변경 *설명*만 알 때 (자연어) | `map_change_impact` | premise rejection + cross-file linkage |
| 변경 *anchor*가 정해진 깊은 chain | `map_impact` | high-fanout anchor에서는 follow-up 1회 필요 |
| 흐름 추적 (route/event/CLI) | `explain_code_path` | demo gap을 [INTENDED]로 표시; uncertainties도 읽기 |
| claim 검증 (TRUE/FALSE) | `collect_evidence` | **가장 강력 신뢰**. PR comment에 그대로 인용 가능한 verdict |
| PR review / 최근 변경 | `review_change_context` | 단일 커밋 prompt 권장; 다중 커밋은 evidence drop 위험 |
| HTTP/CLI/cron/MCP/event entry | `find_entrypoints` | **§2 bug 수정 후** |
| 사람에게 보여줄 Markdown 보고서 | `explore` | critic 경고는 사용자에게 함께 surface, meta-narrative strip |
| 위치를 모르는 cross-file 탐색 | `find_relevant_code` | partial-grounded edit target은 spot-check |

### 5.3 즉시 수정 권장

1. **🛑 `find_entrypoints` strategy='auto' 버그** (§2): `src/mcp/server.mjs:573` 또는 `src/explorer/schemas.mjs:391-394` 수정.
2. **`explore` meta-narrative strip**: planner monologue가 final Markdown에 누출되지 않도록 후처리 또는 prompt 가드 추가.
3. **inline citation typo 처리**: critic이 잡은 `target` 정보를 본문에 함께 surface하거나 보고서 헤더에 critic 배지 추가.

### 5.4 평가 한계

- 5개 테스트 레포 모두 Node/TS/Python — Rust/Go/JVM 단독 레포에서 동일 신뢰가 유지되는지 미검증.
- `collect_evidence`는 "그럴듯해 보이는데 잘못 귀속된" claim에 대한 견고함이 미테스트.
- `find_entrypoints`의 5개 결과는 모두 직접-호출 harness 산출물 — production MCP 경로에서의 패리티는 §2 버그 수정 후 재검증 필요.
- 동일 도구를 다른 모델(`CEREBRAS_EXPLORER_MODEL` override)로 실행했을 때의 신뢰 차이는 미평가.

---

## 부록 A. 50개 테스트 transcript 인덱스

모든 transcript는 `reports/transcripts/` 디렉토리에 `<tool>__<repo>.md` 형식으로 저장됨.

```
reports/transcripts/
├── collect_evidence__{cerebras-explorer-mcp,DeepResearch,aicc_manage,bible,studious-memory}.md
├── explain_code_path__{...}.md
├── explore__{...}.md
├── explore_repo__{...}.md
├── find_entrypoints__{...}.md   (← strategy='auto' bug 우회 완료)
├── find_relevant_code__{...}.md
├── map_change_impact__{...}.md
├── map_impact__{...}.md          (← 직접-호출 harness)
├── review_change_context__{...}.md
└── trace_symbol__{...}.md
```

각 파일에는 (1) request args, (2) directAnswer + status + evidenceQuality + searchCoverage + failure 등 응답 신호, (3) sample evidence with snippets, (4) 비용(turns/toolCalls/elapsedMs/totalTokens), (5) parent agent 관점에서 본 "Notable" 메모.

## 부록 B. sub-agent 평가자 구성

각 도구마다 1명의 sub-agent (Claude general-purpose subagent, 코드 미열람 강제). 각 sub-agent는:
- 도구 description + input schema (verbatim from MCP)
- 5개 테스트 transcript 파일 경로
- 평가 rubric (coherence/grounding/honesty/snippet plausibility/edge cases)
- 출력 형식: 테스트당 2-3 문장 + 종합 결론 + 위험 신호 2-5개

총 10명, 병렬 실행, 합산 평가 비용 ~180K tokens. 본 보고서의 §3은 각 sub-agent의 verdict + risk flag를 종합/정리한 결과.
