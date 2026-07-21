# 테스트 현황

이 문서는 현재 checkout을 검증하는 명령과 acceptance signal을 정의합니다. 고정 test 개수나 pass 개수는 기록하지 않습니다. Test 추가·삭제에 따라 숫자가 바뀌어도 기준은 동일합니다.

## 최근 확인 환경

- 확인 일시: 2026-07-21 KST
- Node.js: 22 이상
- OS/셸: Windows 11 / PowerShell 7
- 실제 API 검증: `CEREBRAS_API_KEY`가 설정된 상태

## 필수 단위·계약 테스트

```bash
npm test
```

성공 기준은 현재 checkout에서 process가 exit code 0, `0 fail`로 종료하는 것입니다. Skip은 OS와 설치된 optional binary(`git`, `rg`)에 따라 달라질 수 있습니다.

주요 회귀 범위:

- Public registry 순서와 각 tool description/dispatch
- Strict input schema와 schema-v3 parent handoff
- Required sub-goal planning, audit, revision, blocker classification
- Fixed wrapper seed exactly-once planning과 omitted revision obligation 보존
- Goal audit binding mutation rejection과 strict origin-containment refinement
- Source range reconstruction과 secret redaction
- Atomic claim semantic verification과 unsupported claim 제거
- All-exact-source deterministic comparison corroboration, hint/sibling non-exclusion, one-shot same-evidence correction and optional-failure isolation, internal observation-ID prose cleanup, natural explicit-route redirect phrasing
- Mixed-policy verifier의 known-test `missing_category` one-shot focused recheck, exact cross-phase 재사용, optional failure 격리, partial-primary 억제
- Empty-evidence claim 격리와 unknown/duplicate/malformed control fail-closed
- Bounded absence/count proof와 truncation 처리
- One-round evidence repair와 repeated-action 억제
- `complete`, `verify_targets`, `incomplete`, `failed` state reduction
- Parent target의 exact path/range deduplication, strongest-role 보존, mismatched-range role downgrade, incomplete partial-target safety
- Scope hard boundary와 git diff/show/stat filtering
- Request id `0`을 포함한 cancellation
- Fixed safety-limit observation과 affected-goal attribution
- Transcript allowlist, usage accounting, redaction
- Integration manifests, install refs, stale public name 차단
- Zero runtime/dev dependencies

변경 범위가 좁으면 해당 test file을 먼저 실행하고, commit 전에는 반드시 전체 명령을 실행합니다.

```bash
node --test tests/schemas.test.mjs tests/mcp-server.test.mjs
node --test tests/coverage.test.mjs tests/runtime.mock.test.mjs
node --test tests/repo-tools.test.mjs tests/transcript.test.mjs
npm test
```

## 실제 Cerebras API 검증

Runtime 또는 prompt의 model reasoning path를 변경했고 API key를 사용할 수 있으면 다음을 실행합니다.

```bash
CEREBRAS_API_KEY=<key> node scripts/integration-test.mjs
```

PowerShell:

```powershell
$env:CEREBRAS_API_KEY = "..."
node scripts/integration-test.mjs
```

성공 기준은 script가 모든 scenario를 PASS로 표시하고 exit code 0, `0 fail`로 끝나는 것입니다.

현재 script가 확인하는 핵심 경로:

- `explore_repo`가 실제 repository fact를 schema-v3 `complete` handoff로 반환
- Repository source로 mutable external state를 증명할 수 없을 때 `incomplete`와 최소 external verification 반환
- Cancellation이 intermediate answer를 재사용하지 않고 `failed`/`aborted`로 종료

API key 값은 console, fixture, transcript, commit에 남기지 않습니다.

## Direct runtime 검증

MCP transport 없이 runtime을 test할 때는 public runtime entry point를 사용합니다.

```js
import { ExplorerRuntime, exploreRepository } from '../src/explorer/runtime.mjs';

const result = await exploreRepository(args, { abortSignal, onProgress });

const runtime = new ExplorerRuntime({ chatClient: mockClient });
const injected = await runtime.explore(args, { abortSignal, onProgress });
```

Mock-provider test는 planner, goal auditor, exploration, synthesis, verifier, repair stage를 독립 fixture로 제어합니다. Direct 결과의 operational diagnostics는 runtime assertion에 사용할 수 있지만 parent contract assertion은 MCP projection의 schema-v3 payload를 대상으로 합니다.

## stdio MCP smoke

`src/index.mjs`를 stdio server로 기동하고 다음 왕복을 확인합니다.

1. `initialize`가 protocol/server info와 concise dispatch rule을 반환
2. `tools/list`가 `find_relevant_code`, `trace_symbol`, `map_change_impact`, `explain_code_path`, `collect_evidence`, `explore_repo` 순서로 반환
3. `tools/call` 결과의 `structuredContent.schemaVersion`이 `3`
4. `content[0].text`가 structured result를 확장하거나 모순하지 않음
5. `_meta.progressToken`이 있는 long call에서 progress notification 수신
6. `notifications/cancelled`가 해당 request만 중단

Unknown tool이나 unknown input field는 provider call 전에 거부되어야 합니다.

## Parent-agent 관찰

다음은 실제 Claude Code/Codex 행동을 관찰해야 하는 adoption scenario입니다. 한 번의 관찰 결과는 빠르게 stale해지므로 이 문서에 고정 pass 숫자를 기록하지 않습니다.

Parent-observation JSONL은 실제 completed/failed command event만 repository 행동으로 분류합니다. Codex CLI가 내는 정확히 알려진 skill-description shortening 안내는 비행동 diagnostic으로 건너뛰되, 다른 unknown item/error type과 분류할 수 없는 command는 계속 fail-closed 합니다.

### 1. 자발적 tool selection

Parent에게 tool 이름 없이 repository 질문을 줍니다.

```text
이 저장소에서 인증 middleware가 등록되는 위치를 찾아 설명해줘.
```

기대:

- 위치 discovery에는 `find_relevant_code`
- known symbol 후속 질문에는 `trace_symbol`
- 어느 specialized intent에도 명확히 속하지 않으면 `explore_repo`
- 동일 질문을 native Glob/Grep/Read로 먼저 반복하지 않음

### 2. Parent 재탐색 억제

`state=complete` 응답 뒤 같은 fact를 다시 묻습니다.

기대:

- Parent가 `directAnswer`와 `evidence`를 사용
- Named `targets`가 있으면 그 범위만 읽는다. `verify_targets`는 모든 goal이 닫힌 편집 계획이고, `incomplete.targets`는 gap과 함께 제공된 검증된 부분 범위다.
- `complete`인데 같은 file을 습관적으로 다시 search/read하지 않음

### 3. Incomplete honesty

Repository 밖 mutable state나 일부러 scope 밖 evidence가 필요한 질문을 줍니다.

기대:

- 검증된 partial fact만 answer에 포함
- 해결되지 않은 원래 request slice가 `gaps`에 남고 model-authored goal/audit 문구는 노출되지 않음
- Scope를 자동으로 넓히지 않음
- External fact가 필요하면 최소 `external_verification`만 제시
- 결과를 개선할 행동이 없으면 `followUp`을 생략

### 4. Cancellation

진행 중인 exploration을 client에서 취소합니다.

기대:

- Active provider request가 abort됨
- 해당 MCP request만 종료됨
- Intermediate assistant prose가 `directAnswer`로 나오지 않음
- Parent는 `state=failed`, `failure.reason=aborted`를 받음

### 5. Concurrent calls

서로 다른 두 repository question을 병렬 호출합니다.

기대:

- 두 request의 progress, cancellation, transcript callId가 섞이지 않음
- 한 call이 다른 call을 serialize하지 않음
- 각 결과가 자기 scope와 evidence만 포함

## Trust fixture 원칙

Known-answer fixture는 explorer output과 분리된 oracle을 가집니다.
Live oracle은 source anchor뿐 아니라 필요한 경우 allowed claim의 독립 semantic marker group과 path-to-predicate association도 검사합니다. Association은 일반 절에서 하나의 명시적 subject와 가까운 predicate group을 결합하고 `respectively`/`각각` 절에서는 두 목록의 순서를 결합합니다. 명시적 부정·무관 표현은 거부합니다. 따라서 올바른 파일과 단어를 모두 포함하더라도 `ADMIN_USERS` membership, row existence, `is_admin` boolean predicate를 route 사이에서 바꿔 쓰거나 무관한 단어 묶음으로 채운 claim은 통과하지 않습니다.

- Expected required questions
- Allowed/forbidden claims
- Required evidence anchors
- Scope와 negative boundary
- Expected public state
- Fixture content hash 또는 repository revision

반복 실행은 model의 자연어 일치가 아니라 다음을 평가합니다.

- False-complete 여부
- Unsupported cited claim 여부
- Wrong/infeasible goal classification
- Request-part coverage
- Citation/source reconstruction accuracy
- Parent payload byte size
- Parent native re-search 행동

Token usage와 latency는 운영 비교용으로 기록하지만 trust acceptance를 대신하지 않습니다.

## Safety-limit scenario

Runtime 내부 관측 이름은 다음으로 고정됩니다.

```text
turn_limit
context_limit
generation_output_limit
walk_limit
tool_result_limit
```

Runtime 한계값은 `maxTurns=30`, `maxSearchResults=80`, `maxReadLines=320`,
`maxDirectoryEntries=300`, `maxWalkFiles=6000`, `maxCompletionTokens=16384`,
`finalizeMaxCompletionTokens=16384`, `maxContextTokens=110000`으로 고정됩니다.

Test는 한계 도달만으로 성공이나 실패가 되지 않는지 확인해야 합니다. 실제로 evidence 수집이 끊긴 required goal만 `safety_limit_reached` gap이 되고, 영향을 받지 않은 goal은 기존 verdict를 유지합니다. Invalid planner/auditor/verifier/final control response가 bounded recovery 뒤에도 남으면 coverage gap이 아니라 해당 fault로 처리합니다. 단, schema-valid verifier가 다른 claim의 opaque evidence id를 반복 인용한 경우와 알려진 sub-goal의 구조적으로 유효한 empty-evidence claim에는 claim-local 격리를 적용합니다. Unknown/duplicate/missing claim, invalid non-empty evidence ref, malformed control은 계속 `verifier_error`여야 합니다. `find_relevant_code`의 두 fixed leaf를 request-origin 부재만으로 분해하는 audit은 한 번 교정하며, 반복되면 planner revision이나 exploration 없이 fail-closed해야 합니다. Map risk-boundary test는 broad search ref와 confined/unaffected 문구가 verifier packet에서 빠지고, verifier-supported non-risk sibling의 exact current source path와 unverified caveat만 남는지 검증해야 합니다. Structured-output category verifier가 claim이 직접 명명한 selected source를 누락하면 한 번 교정하고 반복 시 해당 claim을 gap으로 격리해야 합니다. Exact unaffected, unchanged, no-modification, not-impacted request는 fixed risk leaf와 별도 absence goal로 유지하고, 같은 결합이 반복되면 audit 전에 fail-closed해야 합니다. Trace definition의 exact `repo_symbol_context` source가 이미 있는데 initial verifier가 과잉 일반화 또는 semantic mismatch를 보고하면 같은 source의 deterministic narrowing/verifier를 정확히 한 번만 실행하고, 그 retry 뒤 proof gate가 낮추더라도 repository read 없이 terminal gap으로 남겨야 합니다. Collect-evidence test는 helper definition만으로 entry-point wiring을 완료하지 않고 initial direct search가 드러낸 unread same-file invocation cluster의 runtime-fixed range를 한 번 더 읽으며, direct refutation은 deterministic focused verifier가 helper behavior와 invocation/call path를 모두 승인해야 합니다. Parent cover에는 search telemetry가 아닌 필요한 비중첩 direct range가 모두 남아야 합니다. Final corrected planner가 빠뜨릴 수 있는 것은 이번 분해/정제 대상의 fixed wrapper origin뿐이며, 이 경우에도 completion이 아니라 `planning_incomplete` gap이어야 합니다.

## Transcript 검증

```powershell
$env:CEREBRAS_EXPLORER_LOG_PATH = ".\.explorer-logs"
node scripts/integration-test.mjs
```

확인 항목:

- 각 file/record의 `callId` 일치
- Planning, goal-audit, claim, verdict, repair, safety-limit, usage, final event 존재
- Secret value/path redaction
- Raw mode에서도 planning/trust record allowlist와 redaction 유지
- Parent payload에 transcript path, stats, usage, timing이 섞이지 않음
- Failed/cancelled provider call도 실제 발행된 usage가 있으면 집계

## HTTP recovery

`tests/http-client.test.mjs`는 retry 가능한 timeout, connection reset, 408, 429, 5xx와 retry하지 않는 authentication/input 오류를 가드합니다. 짧은 `Retry-After`는 따르되 parent call의 bounded wait를 넘는 값은 transcript에 남기고 즉시 실패하므로 하루 단위 한도에서 같은 요청을 반복하지 않습니다. 기본 timeout은 `CEREBRAS_EXPLORER_HTTP_TIMEOUT_MS`로 조정할 수 있습니다.

Cerebras API reference: <https://inference-docs.cerebras.ai/api-reference/error-codes>

## Commit gate

1. 변경에 대응하는 targeted test 실행
2. `npm test` → `0 fail`
3. Runtime/prompt reasoning path 변경이며 key 사용 가능 → 실제 API script 통과
4. `git diff --check`
5. Public schema/tool/env 변경 시 README, DESIGN, examples, integrations snapshot 동기화 확인
