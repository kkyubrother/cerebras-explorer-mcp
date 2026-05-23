# Cerebras Explorer MCP Current Tool Trust Evaluation

작성일: 2026-05-24 KST  
대상 코드: 현재 working tree (`package.json` v0.4.1, `src/mcp/server.mjs`에 `find_entrypoints` hints fix가 적용된 상태)  
평가 범위: 공개 MCP 도구 10개 x 5개 레포지토리 = 50회 라이브 호출  
원자료: `reports/tool-eval-current-2026-05-23T21-54-32-804Z/`

## 1. 프로젝트 목적 이해

이 프로젝트는 Claude Code/Codex 같은 parent agent가 `Read/Grep/Glob` 반복 탐색에 컨텍스트를 쓰지 않도록, Cerebras 모델이 MCP 서버 내부에서 read-only autonomous repo exploration을 수행하고 grounded evidence를 압축해 돌려주는 도구다.

핵심 설계는 다음과 같다.

- parent agent에는 low-level repo tools를 노출하지 않고, `explore_repo`, 8개 wrapper, `explore`만 공개한다.
- 내부 `ExplorerRuntime`이 `RepoToolkit`의 read-only 도구(`repo_list_dir`, `repo_grep`, `repo_read_file`, `repo_symbols`, git tools 등)를 모델 루프에 제공한다.
- 응답은 `directAnswer`, `status`, `targets`, `evidence`, `evidenceQuality`, `searchCoverage`, `failure`, `session/sessionId` 중심의 compact contract로 parent-agent handoff에 맞춘다.
- secret deny-list, redaction, scope hard boundary, symlink 거부, git diff/show scope filtering이 보안/경계의 핵심이다.
- `explore`는 사람이 읽는 Markdown report이며, structured citation/target metadata와 report critic을 함께 제공한다.

코드 확인 범위:

- `src/mcp/server.mjs`, `src/mcp/jsonrpc-stdio.mjs`, `src/index.mjs`
- `src/explorer/*.mjs`, `src/explorer/providers/*.mjs`, `src/explorer/utils/http-client.mjs`
- `src/benchmark/*.mjs`, `scripts/*.mjs`, examples
- 테스트 inventory 및 핵심 테스트: MCP server/runtime/repo-tools/security/provider/schema/session/free-explore/integration drift guards
- 현재 dirty diff: `find_entrypoints`의 invalid `hints.strategy='auto'` 제거와 regression test 추가가 이미 working tree에 있음

## 2. 실행 방법

테스트 레포:

- `/home/kyubr/IdeaProjects/cerebras-explorer-mcp`
- `/home/kyubr/IdeaProjects/DeepResearch`
- `/home/kyubr/IdeaProjects/aicc_manage`
- `/home/kyubr/IdeaProjects/bible`
- `/home/kyubr/IdeaProjects/studious-memory`

각 도구는 각 레포에서 1회씩 호출했다. 총 50건 모두 실제 MCP request handler를 통해 실행했다. 결과 packet은 도구별로 만든 뒤, 코드 비공개 조건의 sub-agent 10명에게 각각 한 도구씩 평가시켰다. sub-agent 지시사항은 "소스 코드나 다른 파일을 보지 말고 packet의 description, input schema, request, response summary만 보고 parent-agent 입장에서 쓸 만한지 판단"이었다.

라이브 호출 결과:

- 50/50 호출 성공
- MCP-level error: 0
- `failure`: 0
- `find_entrypoints`: 현재 코드에서는 schema 오류 재현 없음

## 3. 정량 요약

| Tool | Cases | Verification | Evidence exact/partial/dropped | Budget/truncation | Sub-agent verdict |
|---|---:|---|---:|---|---|
| `explore_repo` | 5 | 5 targeted_read_needed | 39 / 0 / 1 | 0 / 0 | 조건부 사용 |
| `find_relevant_code` | 5 | 5 verified | 35 / 5 / 0 | 0 / 0 | 사용 |
| `trace_symbol` | 5 | 5 verified | 20 / 2 / 0 | 0 / 0 | 사용, usage count 재검증 |
| `map_change_impact` | 5 | 5 targeted_read_needed | 38 / 1 / 1 | 0 / 0 | 사용, impact 초안 |
| `map_impact` | 5 | 5 targeted_read_needed | 31 / 9 / 0 | 0 / 0 | 사용, count claim 재검증 |
| `explain_code_path` | 5 | 5 verified | 36 / 2 / 0 | 0 / 0 | 사용 |
| `collect_evidence` | 5 | 5 verified | 30 / 0 / 0 | 0 / 0 | 사용, 좁은 claim 검증용 |
| `review_change_context` | 5 | 5 verified | 31 / 5 / 4 | 0 / 0 | 사용, 리뷰 범위 압축용 |
| `find_entrypoints` | 5 | 5 verified | 39 / 1 / 0 | 0 / 0 | 사용, 후보 탐색용 |
| `explore` | 5 | report mode | n/a | 0 / 36 tool-result truncations | 조건부 사용 |

## 4. 전체 결론

parent agent 입장에서 이 MCP는 사용할 만하다. 단, 대부분의 도구는 "최종 판단"보다 "읽을 대상과 검증할 범위 압축"에 더 적합하다.

가장 좋은 신호는 실패와 탐색 범위가 구조화되어 나온다는 점이다. `failure`, `searchCoverage`, `scopeLimited`, `stoppedByBudget`, `toolResultsTruncated`, `evidenceQuality`가 있어 blind trust를 피할 수 있다.

가장 큰 공통 약점은 상태 신호가 낙관적인 경우다. 여러 도구에서 `confidence=high`, `complete=true`가 partial/dropped evidence, `targeted_read_needed`, empty `evidenceRefs`, broad count claim과 동시에 나타났다. parent agent는 `confidence`보다 `verification`, `nextAction`, `partialCount`, `droppedCount`, `uncertainties`, `searchCoverage.warnings`를 우선 읽어야 한다.

## 5. 도구별 평가

### `explore_repo`

판정: 조건부 사용.

좋은 점:

- 넓은 탐색에서 `targets`, `evidence`, `searchCoverage`, `sessionId`가 잘 나온다.
- 모든 케이스가 `failure:null`, `stoppedByBudget:false`, `toolResultsTruncated:0`이었다.
- 편집 후보 지도와 다음 읽기 대상 생성에 유용하다.

위험:

- 5/5가 `verification=targeted_read_needed`인데 `complete=true`, `confidence=high`다. 탐색 완료와 검증 완료를 혼동하기 쉽다.
- `targets[].evidenceRefs`가 빈 항목이 반복된다.
- `critic`이 top-level에 없고, `evidenceRefs` ID 형식이 `E1`, `"1"`, `path:line` 등으로 섞인다.
- `bible`, `DeepResearch`에서 directAnswer가 evidence보다 넓은 API/migration/orchestration claim을 한다.

parent-agent 사용법: first-pass architecture/impact 탐색에는 좋다. 하지만 `nextAction.target`과 evidence-backed targets를 직접 읽기 전에는 편집하지 않는다.

### `find_relevant_code`

판정: 사용.

좋은 점:

- 위치 파악용으로 가장 자연스럽다. 각 케이스가 파일, 라인, role, reason을 제공한다.
- 4/5는 exact evidence만으로 깨끗했다.

위험:

- 첫 케이스는 `exactCount=3`, `partialCount=5`인데 `high/verified/complete`였고, summary 문구가 "3/8 grounded"와 "All evidence grounded"를 동시에 암시했다.
- 일부 target/evidence 연결이 약하다.

parent-agent 사용법: broad query 뒤 반환 target만 읽는 locator로 사용. partial evidence가 있으면 후보로만 취급한다.

### `trace_symbol`

판정: 사용.

좋은 점:

- known symbol의 정의와 대표 사용처를 빠르게 좁힌다.
- `authMiddleware`, `scoped_tool`처럼 정의 + 주변 authz/registration 맥락을 잘 연결했다.

위험:

- usage count claim이 evidence보다 앞선다. 예: `createMcpRequestHandler`의 "22 uses"는 packet 기준 근거가 부족했다.
- `partialCount > 0`인데도 `verified/complete`가 유지된다.
- `useStore` 케이스는 discovered paths는 많고 filesRead는 적어 영향 범위 판단에는 부족하다.

parent-agent 사용법: 정의/핵심 구현 위치 파악에는 사용. "all callsites", "complete usage"는 후속 `find_relevant_code`나 grep/read로 재검증한다.

### `map_change_impact`

판정: 사용, impact 초안.

좋은 점:

- 변경 설명만 있을 때 `nextAction.target`, likely read/edit/test/config targets를 잘 만든다.
- scope/budget/truncation 신호가 안정적으로 제공됐다.

위험:

- 5/5가 `targeted_read_needed + complete=true` 조합이다.
- `confidence=high`가 partial/dropped evidence와 같이 나온다.
- "will not break", "no tests found", "all clients" 같은 broad/negative claim은 evidence보다 강하다.

parent-agent 사용법: 편집 전 첫 지도. `nextAction.target`부터 읽고, 숫자/부재/호환성 주장은 별도 확인한다.

### `map_impact`

판정: 사용, anchor 기반 리팩터링 준비에 유용.

좋은 점:

- 이미 파일/심볼 anchor가 있을 때 dependency/test/config 후보를 압축한다.
- 모든 케이스가 provider failure 없이 끝났고, budget/truncation도 없었다.

위험:

- high-fanout anchor에서 count claim이 강하다. `bible`은 filesRead=1, partial evidence 7개인데 "31 direct importers"를 말한다.
- "complete dependency chain", "no tests/config/importers" 같은 문구는 재검증 필요.
- scope 밖 문서 reference를 directAnswer에 포함한 케이스가 있었다.

parent-agent 사용법: rename/remove/refactor 전 후보 목록 생성용. `targeted_read_needed`이면 완료가 아니라 직접 읽기 대기 상태로 해석한다.

### `explain_code_path`

판정: 사용.

좋은 점:

- code path tracing 결과가 읽을 파일 순서로 전환된다.
- 5개 모두 `failure:null`, 대부분 exact evidence, `stoppedByBudget:false`.
- `scopeLimited`, read/grep/symbol count로 한계를 볼 수 있다.

위험:

- `confidence=high/complete=true`가 partial evidence와 같이 나오는 케이스가 있다.
- 일부 target의 `evidenceRefs`가 비어 있다.
- snippet truncation 때문에 directAnswer의 모든 hop을 packet만으로 확인하기 어렵다.

parent-agent 사용법: route/event/auth flow 후보 압축에 사용. 보안/데이터 변경 경로는 핵심 target을 직접 읽고 결론낸다.

### `collect_evidence`

판정: 사용. 좁은 claim 검증에는 가장 직접적이다.

좋은 점:

- 5/5 exact evidence만 유지됐다.
- 일부 케이스는 claim을 그대로 긍정하지 않고 "부분적으로 맞지만 경로가 틀림"처럼 교정한다.
- `budget` 제거, FastAPI factory, Telegram auth server validation 등 좁은 claim은 실용적인 증거를 제공했다.

위험:

- "all/every" claim에는 overclaim 위험이 있다. 모든 tool annotation을 직접 보여주지 않고 "all 10"을 결론낸 케이스가 있었다.
- snippet이 잘려 핵심 등록/검증 라인이 packet에서 안 보이는 케이스가 있다.
- `PARTIALLY CORRECT`인데도 `verified/complete`인 케이스가 있었다.

parent-agent 사용법: PR comment나 사용자 답변 전 fact check에 사용. 단, "all", "never", "removed", "security guarantee"는 추가 확인한다.

### `review_change_context`

판정: 사용, 리뷰 범위 압축용.

좋은 점:

- 변경 요약, 검토 대상 파일, line target을 빠르게 만든다.
- git evidence, file evidence, uncertainties가 같이 나온다.

위험:

- `git_diff_hunk`/`git_commit` evidence는 exact여도 snippet이 비어 있을 수 있다.
- DeepResearch는 dropped evidence 4개와 미검토 불확실성이 있는데 `high/complete`였다.
- "All changes are defensive", "wire format preserved", "cookie auth eliminated" 같은 넓은 리뷰 결론은 추가 확인이 필요하다.
- `since/until`이 optional이라 재현 가능한 review 기준은 caller가 명시해야 한다.

parent-agent 사용법: 변경 리뷰 준비와 우선순위 설정에 사용. 최종 review finding은 returned target을 직접 확인한 뒤 작성한다.

### `find_entrypoints`

판정: 사용, 후보 탐색용.

좋은 점:

- 현재 코드에서 `hints.strategy='auto'` schema failure는 재현되지 않았다.
- `entryKind`와 `scope`로 HTTP/event/MCP 등 탐색 범위를 좁히기 좋다.
- regex 기반 caveat를 응답이 대체로 명시했다.

위험:

- count claim mismatch가 있다. DeepResearch는 "13 routes"라고 하면서 나열이 14개처럼 보이고, aicc_manage는 event handler와 emit을 섞어 "58 event handler"라고 표현했다.
- 수십 개 entrypoint를 말하면서 evidence는 대표 8개 수준이라 `verified/high/complete`가 강하다.
- 결과가 정규화된 entrypoint array가 아니라 prose 중심이다.

parent-agent 사용법: 어디부터 읽을지 잡는 첫 스코프 도구. entrypoint 개수/완전성은 직접 확인한다.

### `explore`

판정: 조건부 사용.

좋은 점:

- architecture/onboarding/report mode에는 유용하다.
- `citations`, `targets`, `filesRead`, `toolsUsed`, `critic`, `searchCoverage`가 있다.

위험:

- 5/5 `critic.status=caution`.
- 총 36개 tool result truncation이 있었다.
- `status.verification`, `status.complete`, `evidenceQuality`, `failure`, `session/sessionId` 같은 structured handoff 필드가 없다.
- reportPreview에 "Now I have sufficient evidence..." 같은 내부 진행 문구가 섞였다.
- citation raw 문자열 깨짐과 "Seven tools" vs 8개 나열 같은 작은 불일치가 있었다.

parent-agent 사용법: 사용자-facing 설명 초안과 온보딩용. 코드 변경/보안 판단에는 `explore_repo` 또는 wrapper로 좁혀 재검증한다.

## 6. 공통 개선 권고

1. `complete=true`와 `verification=targeted_read_needed`의 의미를 더 명확히 해야 한다. parent agent가 "완료"로 오해하기 쉽다.
2. partial/dropped evidence가 있으면 `confidence=high`와 `evidenceQuality.summary` 문구를 더 보수적으로 조정해야 한다.
3. structured tools에도 top-level `critic` 또는 `critic.warnings`를 노출하는 편이 handoff 규칙과 맞다.
4. `targets[].evidenceRefs`를 항상 존재하는 evidence id와 연결하고, id 형식을 `E1` 계열로 정규화해야 한다.
5. `discoveredPathsCount`만 노출하는 packet은 상한/실제 수 구분이 불분명하다. 실제 `discoveredPaths`의 상한/omitted count를 명시하면 좋다.
6. count/absence claim을 별도 warning으로 낮추는 deterministic check가 필요하다. 예: "all", "no", "only", "N routes/importers/callers"가 evidence count보다 강한 경우.
7. `explore` report mode는 internal planning sentence 제거와 citation raw 정규화가 필요하다.

## 7. Parent Agent Decision Rule

사용한다:

- `collect_evidence`: 좁은 claim 검증
- `find_relevant_code`: 관련 파일/라인 후보 압축
- `trace_symbol`: known symbol 정의/대표 사용처
- `explain_code_path`: route/event/auth/request flow 후보 압축
- `map_change_impact` / `map_impact`: 편집 전 impact map 초안
- `review_change_context`: 리뷰 범위와 위험 후보 압축
- `find_entrypoints`: entrypoint 후보 발견
- `explore_repo`: 구조화된 첫 탐색/자동화 handoff
- `explore`: 사람용 넓은 Markdown 설명

바로 믿지 않는다:

- `confidence=high` 단독 신호
- count claim (`N routes`, `N callers`, `N importers`)
- absence claim (`no tests`, `no config`, `not used`)
- `complete=true`가 `targeted_read_needed`와 같이 나온 결과
- partial/dropped evidence가 있는데 summary가 "All evidence grounded"처럼 보이는 결과
- empty `evidenceRefs`, truncated snippets, `critic.status=caution`

## 8. 산출물

- 라이브 호출 aggregate: `reports/tool-eval-current-2026-05-23T21-54-32-804Z/summary.json`
- 도구별 sub-agent packet: `reports/tool-eval-current-2026-05-23T21-54-32-804Z/subagent-packets/*.md`
- 케이스별 raw JSON/Markdown: `reports/tool-eval-current-2026-05-23T21-54-32-804Z/cases/*.{json,md}`
- 본 보고서: `reports/tool-trust-evaluation-current-2026-05-24.md`
