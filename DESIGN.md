# cerebras-explorer-mcp 설계

## 1. Mission

이 프로젝트는 parent agent의 repository discovery를 대신 수행하는 읽기 전용 MCP explorer다. Parent는 고수준 질문과 이미 아는 anchor를 전달하고, explorer는 저장소 안에서 근거를 수집·검증한 뒤 다음 행동에 필요한 최소 handoff만 반환한다.

성공의 기준은 자연스러운 설명이나 evidence 개수가 아니다. 원래 요청의 모든 유효한 필수 질문이 독립적으로 검증되어야 하며, 달성할 수 없는 요구와 끝내 입증되지 않은 요구는 명시적 gap으로 남아야 한다.

## 2. 불변 조건

- Node.js 22+ ESM, runtime/dev dependency 모두 0개
- Repository file 접근은 read-only
- Scope는 모든 file/symbol/git read 도구의 hard boundary
- Secret path deny-list와 value redaction은 항상 활성
- Public MCP registry는 고정된 여섯 도구
- Parent는 task, scope, known anchor와 선택적 언어만 제공
- Provider/context/process 보호값은 runtime-owned fixed constants
- 정상 parent payload에는 내부 planning, trust diagnostics, usage, timing, tool trace를 넣지 않음
- Completion은 required sub-goal coverage와 claim verification으로만 결정

## 3. Public MCP surface

Registry 순서는 안정적인 계약이다.

1. `find_relevant_code`
2. `trace_symbol`
3. `map_change_impact`
4. `explain_code_path`
5. `collect_evidence`
6. `explore_repo`

환경변수로 registry를 바꾸지 않는다. Parent dispatch rule도 initialization instructions에 한 번만 제공한다.

| 도구 | Positive trigger | 완료에 필요한 proof |
| --- | --- | --- |
| `find_relevant_code` | 구현/config/test/route 위치가 아직 불명확 | 각 위치의 relevance와 smallest useful set |
| `trace_symbol` | 알고 있는 function/class/type/variable의 의미와 사용처 확인 | definition/meaning과 boundary 안 usage cross-check |
| `map_change_impact` | 변경 전에 blast radius 파악 | actionable target, dependent caller/consumer, 영향받는 verification/public-contract surface, caller가 명시한 category, 남은 risk boundary |
| `explain_code_path` | request/event/job/CLI/data flow 추적 | entry, ordered handoff, terminal effect, 각 transition의 evidence |
| `collect_evidence` | 기존 claim/hypothesis 지지 또는 반박 | 직접 semantic evidence, counterevidence search, 필요 시 bounded absence proof |
| `explore_repo` | 위 분류로 명확히 좁혀지지 않는 repository investigation | 요청에서 도출된 required sub-goal별 proof policy |

Wrapper는 trusted internal task intent와 goal seed를 runtime에 전달하지만 그 값은 public input이 아니다. Convenience나 output format만 다른 도구는 추가하지 않는다.

### 3.1 Public inputs

`explore_repo`는 다음 strict object를 받는다.

```text
task: string                         required
repo_root: string                    optional
scope: string[]                      optional, immutable hard boundary
hints.symbols: string[]              optional known facts
hints.files: string[]                optional known facts
hints.regex: string[]                optional exact patterns
language: string                     optional BCP-47 response language
```

Unknown property는 거부한다. Public input으로 search policy, turn count, depth, reasoning control, internal sub-goal, repair option을 받지 않는다.

Wrapper는 같은 `repo_root`/`scope`와 도구별 query 및 `knownFiles`/`knownSymbols`/`knownText` anchor만 노출한다. Wrapper의 입력 object도 `additionalProperties: false`다.

## 4. Architecture

```text
MCP client / parent agent
  -> stdio JSON-RPC server
    -> public argument validation
    -> wrapper intent normalization
    -> ExplorerRuntime.explore
      -> audited task contract
      -> read-only repository exploration
      -> deterministic source grounding
      -> isolated semantic claim verification
      -> optional evidence repair
      -> required-goal state reduction
    -> parent-payload projection
    -> schema-v3 structuredContent + terse text parity
```

### 4.1 MCP server

`src/mcp/server.mjs`가 다음을 담당한다.

- initialize와 stable registry 제공
- Strict public input validation
- Wrapper 입력을 공통 runtime argument로 변환
- `_meta.progressToken`이 있을 때 progress notification 전달
- MCP request id별 `AbortController` 추적과 cancellation
- Runtime 결과를 `src/explorer/parent-payload.mjs`로 projection
- Invalid input, repo mismatch, cancellation, provider/internal fault의 schema-v3 failure 변환

서버는 low-level filesystem 도구를 parent에게 노출하지 않는다.

### 4.2 ExplorerRuntime

`src/explorer/runtime.mjs`의 `ExplorerRuntime.explore(args, callOptions)`가 orchestration의 source of truth다. Convenience 함수 `exploreRepository(args, options)`는 call options와 runtime constructor options를 분리해 새 runtime을 만들고 같은 method를 호출한다.

Runtime은 다음 state를 분리한다.

- User task와 immutable effective scope
- Audited required sub-goal ledger
- Tool observations와 source reconstruction data
- Candidate atomic claims와 verifier verdict
- Goal별 gaps와 safety-limit impact
- Operational stats/transcript events
- Parent projection input

Operational state는 direct-runtime test/evaluation과 transcript에 남을 수 있지만 MCP parent payload에 그대로 전달하지 않는다.

### 4.3 Cerebras client

`src/explorer/cerebras-client.mjs`는 OpenAI-compatible chat completion 형태로 Cerebras API를 호출한다.

- 기본 model: `zai-glm-4.7`
- 기본 sampling: temperature `1.0`, top-p `0.95`
- Retry 가능한 network/408/429/5xx에 bounded retry
- Large request body gzip
- AbortSignal 전달
- Provider usage를 operational channel에 집계

API client는 첫 실제 요청에서 lazy initialization된다. Provider credential이 server startup과 tool listing을 막지 않는다.

### 4.4 RepoToolkit

`src/explorer/repo-tools.mjs`는 모델이 사용할 수 있는 내부 read-only 도구를 제공한다.

| 내부 도구 | 역할 |
| --- | --- |
| `repo_list_dir` | Scope 안 directory tree 확인 |
| `repo_find_files` | Glob-like file discovery |
| `repo_grep` | Regex text search, ripgrep fast path와 JS fallback |
| `repo_symbols` | Parser-free symbol extraction |
| `repo_references` | Definition/import/export/call/reference 분류 |
| `repo_symbol_context` | Definition과 direct callers를 묶고, bounded symbol/source 분석으로 enclosing caller 이름을 보강하는 macro read |
| `repo_read_file` | Line-bounded text read |
| `repo_git_log` | Read-only commit metadata |
| `repo_git_blame` | Scope-filtered blame |
| `repo_git_diff` | Scope-filtered file/stat diff |
| `repo_git_show` | Scope-filtered commit content |

각 tool result는 truncation, skipped/denied path, out-of-scope omission처럼 completion에 영향을 주는 boundary fact를 보존한다.

## 5. Audited task contract

### 5.1 Planning

Planner input은 원래 task, wrapper seed, effective scope, known anchor, repository project context다. Repository text와 path는 untrusted evidence data이며 system instruction을 바꿀 수 없다.

Planner는 명시된 요청 부분마다 독립 관찰 가능한 proof condition을 가진 proposed sub-goal을 만든다. Runtime이 claim type을 고정 proof policy로 변환한다.
각 fixed wrapper seed는 정확히 한 goal에만 붙인다. 같은 acceptance core를 가진 request leaf가 있으면 별도 wrapper-only goal을 만들지 않고 그 leaf에 wrapper origin을 결합한다.
Runtime은 initial plan과 isolated audit에서 active wrapper의 fixed seed origin이 모두 유지되는지 기계적으로 확인한다. Initial omission은 한 번의 bounded control correction 대상이며, 다시 누락되면 repository exploration 전에 fail-closed한다. Final corrected plan이 이번 revision에서 분해 또는 정제하도록 명시된 goal의 fixed origin만 빠뜨린 경우에는 그 obligation을 성공으로 간주하지 않고 `planning_incomplete` required gap으로 materialize한다. Preserved goal 변경, 이번 revision 대상이 아닌 origin 누락, malformed control은 계속 fault다.
`collect_evidence`는 예외 없이 supplied task 전체를 덮는 request origin과 `wrapper:collect_evidence:verdict`를 함께 가진 하나의 `claim_verification` goal로 계획한다. Direct evidence와 counterevidence search는 별도 sibling goal이 아니라 같은 verdict의 내부 proof facet이다.

| Claim type | Proof policy |
| --- | --- |
| positive fact | direct source |
| bounded absence | complete boundary/search certificate |
| deterministic count | bounded complete enumeration |
| symbol definition | exact definition range |
| symbol usage | bounded usage cross-check |
| ordered flow | entry와 every handoff 및 terminal effect |
| change impact | requested impact categories |
| comparison | distinct policy paths |
| claim verification | support or refute plus counterevidence |

### 5.2 Goal audit

Goal auditor는 repository content나 exploratory prose를 보지 않는다. 원래 request, scope, fixed capability manifest, wrapper seed, proposed goals만 보고 다음을 결정한다.

- Ready goal
- Duplicate merge
- Decomposition 필요
- Request에서 추적되지 않는 invention 거부
- Scope, read-only capability, external state, missing input, contradiction, unobservable proof condition에 의한 blocker

Request coverage가 빠졌거나 goal이 너무 넓으면 planner revision을 한 번만 허용한다. Revision 뒤에도 남은 명시적 요구는 `planning_incomplete` required goal로 materialize한다. Planner invention은 로그에만 남기고 completion을 막지 않는다.

Late audit가 기존 ledger goal과 acceptance core가 다른 proposal을 두 번 연속 `merge_duplicate`로 반환하면 runtime은 그 merge만 버리고 원래 proposal을 `needs_decomposition`으로 환원한다. Late audit에는 planner revision이 남아 있지 않으므로 해당 사용자 요구는 `planning_incomplete` required gap으로 보존된다. 이 복구는 target, claim type, origin containment, constraint subset, missing-request-part 검사가 모두 유효한 경우에만 적용한다. 더 강한 constraint, widened origin, 잘못된 target, malformed control은 계속 audit fault다.

Auditor가 ready로 확정한 goal은 immutable acceptance core의 runtime-owned `auditBinding`으로 봉인한다. 이 binding은 의미 판정이나 서명이 아니라 audit 이후 `id`, 질문, confirmed origin, claim/proof policy, proof condition, constraints, verdict가 바뀌는 것을 막는 내부 checksum이다. Exploration state와 claim reference는 binding 밖에 있으며, transition과 TaskContract 검증 때 다시 확인한다. 같은 claim type의 confirmed origin signature가 형제 signature를 일방향으로 엄격히 포함하면 기존 한 번의 revision에서 각각 하나의 구분 가능한 descendant goal로 정제한다. 동일 origin이나 단순 overlap은 정상적인 shared request facet일 수 있으므로 그 자체로 revision을 만들지 않는다.

### 5.3 Evidence collection

Explorer model은 audited ready goal을 대상으로 RepoToolkit을 호출한다. Runtime은 관측을 goal에 연결하고 다음을 기록한다.

`find_relevant_code`의 unanchored mode와 exact symbol anchor mode는 immutable scope의 grep 한 번에서 role별 최소 후보를 고른 뒤 최대 두 bounded read batch로 종료한다. Structured-output 위치 요청은 formatter/schema뿐 아니라 production caller/adapter를 포함하는 implementation 후보를 최대 세 개 보존한다. `trace_symbol`은 definition macro, runtime-escaped literal full-scope usage grep, bounded source read 순서를 고정하며 symbol range가 실제 call line을 포함할 때만 enclosing caller 이름을 전달한다.

`map_change_impact`의 unanchored wrapper mode는 exact grep에서 역할별 후보와 match line을 골라 bounded read batch로 전환한다. Wrapper가 자동 생성하는 category leaf는 verification/public-contract surface를 묶되 흔한 category를 각각 필수 목표로 만들지 않으며, caller가 change에 구체적으로 명시한 category만 필수로 보존한다. Structured-output change는 wrapper 이름 대신 schema assignment, registry field, formatter/response-builder declaration or call을 찾는 고정 predicate를 먼저 implementation role에 적용해 schema/runtime/server 후보를 읽는다. 이어 같은 immutable scope에서 public `outputSchema`, quoted `"schemaVersion"`, 또는 exact `schema-v3 structuredContent` contract phrase를 찾는 저잡음 고정 predicate를 test/documentation/config/fixture role에 한 번만 적용한다. 이 internal role filter는 public repository argument가 아니며 result cap 전에 적용되고 absence/count completeness에는 사용할 수 없으므로, scope가 생략되어 `**`가 되더라도 documentation match가 implementation 후보를 밀어내지 않는다. 각 단계는 runtime-fixed argument를 사용하며, model이 두 번째 search 또는 category read를 도구 없이 건너뛰면 같은 단계만 한 번 재촉하고 다시 거부하면 gap으로 종료한다. Runtime-selected category source가 있는데 claim이 일부 source를 인용하지 않거나 통째로 생략되면 claim synthesis만 한 번 교정하고, 다시 누락되면 해당 goal을 gap으로 격리한다. 다른 impact query의 recovery와 repair는 기존처럼 한 repository action으로 제한한다.

`collect_evidence`의 내부 `evidence_verification` mode는 claim의 bounded literal term을 안전한 compound predicate로 만든 direct lookup부터 시작하고 implementation scope에서 최대 두 번만 시도한다. 첫 predicate가 0건이면 component label이 아닌 mechanism/field/function term으로 한 번만 교정하고, 가장 강한 관찰 implementation path 하나의 allowlisted source read로 전환한다. Model은 exact source가 전체 premise를 의미상 직접 반박할 때만 추가 search 없이 synthesis로 넘어갈 수 있고, 그 밖의 affirmation은 plausible counterexample/exception/alternative의 complete full-boundary search를 요구한다. Runtime은 영어·한국어 부정어만으로 이 분기를 결정하지 않으며 verifier가 잘못된 선택을 fail-closed로 막는다. 동일 claim에 대한 broad synonym search를 더 반복하지 않는다. 이 단일 verdict goal의 claim synthesis는 전체 premise를 덮는 aggregate claim을 0개 또는 1개만 허용한다. 첫 fan-out은 한 번 교정하고 두 번째 fan-out은 해당 goal을 unresolved gap으로 격리한다.

Generic `explore_repo`가 정확히 하나의 `commit <40-hex SHA>`를 받으면 recent log를 탐색하지 않고 그 ref의 scope-filtered `repo_git_show`를 한 번 수행한다. 성공 시 대표 implementation과 companion 경로를 최대 두 개의 allowlisted current-source read batch로 확인하고 종료한다. Show 실패나 무관측 상태에서는 같은 ref를 반복하지 않고, 남은 repair도 runtime-enforced allowlisted read 한 번으로 제한해 gap을 보존한다. Scope 안에 diff hunk가 없으면 commit metadata만으로 scoped change claim을 완료하지 않는다.

- 실제 읽은 path/range/content
- Search boundary와 query
- Git observation
- Truncation과 walk completion
- Denied secret path
- Scope 밖에서 제외된 file 수
- Exact safety-limit impact

Absence나 count는 단순 0 match로 끝나지 않는다. Search boundary가 완전하고 관련 enumeration이 잘리지 않았다는 certificate가 필요하다.

### 5.4 Deterministic grounding

Runtime은 model이 낸 path와 line range를 repository에서 다시 읽고 snippet을 재구축한다. 다음 evidence는 drop한다.

- 읽지 않은 file/range
- Invalid or reversed line range
- Scope 밖 path
- Secret-denied path
- 현재 source와 맞지 않는 snippet
- 관측되지 않은 git claim

Source range 검증과 semantic support는 별개다. 정확한 line을 인용해도 claim이 그 line보다 과장되면 다음 단계에서 거부된다.

### 5.5 Isolated semantic verifier

Verifier는 원래 request, audited sub-goals, candidate atomic claims, rebuilt evidence, bounded search certificate만 받는다. Exploratory prose나 model self-confidence는 받지 않는다.

`map_change_impact:requested_categories`는 아직 적용하지 않은 변경을 전제로 한 영향 예측이다. 따라서 현재 test/documentation/configuration/fixture가 해당 계약을 검증하거나 문서화한다는 exact evidence는 review/update surface를 support할 수 있으며, 제안된 field의 현재 존재나 before/after 또는 control-flow transition을 요구하지 않는다. Caller가 all/every/exhaustive category를 요구한 경우의 전체 category coverage와 이미 구현되었다는 주장, uncited path, concrete modification에 대한 검증은 계속 엄격하게 유지한다.

Evidence id는 opaque exact token이다. 예를 들어 `E5`와 `E5:search`는 서로 다른 ref이며 verifier가 suffix를 추론할 수 없다. 다른 claim의 ref를 반환하면 한 번만 교정을 요청하고, 이 교정은 supported verdict의 `affirmed|refuted` resolution 의무와 non-supported verdict의 resolution 금지를 다시 명시한다. Schema-valid 응답이 같은 경계를 다시 넘으면 해당 claim만 `insufficient`로 격리한다. Unknown/duplicate/missing claim, malformed control, 또는 구조 오류는 계속 verifier fault로 처리하므로 이 격리는 claim을 support로 승격하지 않는다.

Claim synthesis가 두 번 모두 알려진 sub-goal에 `evidenceRefs:[]`인 구조적으로 유효한 claim을 반환하면 그 claim만 버리고 해당 goal을 unresolved로 둔다. Unknown sub-goal, duplicate claim id, malformed claim, invalid non-empty evidence ref는 이 복구 대상이 아니다. Post-repair verifier packet은 해당 claim에 실제로 추가된 fresh evidence id만 별도로 표시하며, fresh id를 하나도 인용하지 않은 supported verdict는 기존 reduction에서 support가 되지 않는다.

각 claim은 `supported`, `insufficient`, `contradicted` 중 하나가 된다. Accepted claim만 direct answer와 evidence에 사용한다. Unsupported claim을 자연스러운 문장으로 완화해 성공처럼 반환하지 않는다.

두 개 이상의 current source path를 묶는 comparison claim은 해당 claim과 bounded semantic batch의 observation으로 focused corroboration을 한 번 더 수행한다. Claim이 인용하지 않은 current source도 audited sub-goal boundary 안의 독립적인 route/predicate 변형을 보이는지 검토한다. Focused verifier에는 sibling goal의 관련 없는 observation을 omission으로 취급하지 말라고 지시한다. Supporting evidence는 결과와 무관하게 claim이 직접 인용한 ref의 subset으로 강제하며, 두 verifier가 primary verifier가 지지한 모든 source path와 전체 관계에 동의할 때만 support를 유지한다. 하나의 route/predicate라도 누락되거나 잘못 연결되면 기존 repair 또는 gap 경로로 fail-closed 한다. 이 내부 확인은 parent schema에 진단 필드를 추가하지 않는다.

`support_or_refute` claim을 direct source/git counterexample 없이 zero-match search certificate만으로 refute하려면 focused corroboration을 한 번 더 수행한다. Filename glob은 bounded filename absence만, grep은 해당 regex/text의 bounded absence만 증명한다. Exact textual/path premise는 정확한 boundary의 complete search로 닫을 수 있지만 behavior, registration, function existence, mechanism premise는 가능한 repository 표현을 모두 포괄하는 search predicate가 필요하다. 두 verifier가 같은 complete certificate의 전체 search ref와 `refuted` resolution에 동의해야만 내부 corroboration artifact가 생기며, 이 artifact가 없으면 proof gate는 fail-closed 한다. Direct source/git counterexample은 이 추가 pass 없이 기존 gate를 통과한다. Artifact와 verifier diagnostics는 parent payload에 노출하지 않는다.

`collect_evidence`가 claim을 affirm하려면 exact direct source/git evidence와 claim boundary 안의 plausible counterexample, exception, alternative를 찾는 complete zero-match search가 모두 필요하다. Runtime은 non-empty `pattern` 또는 `symbol`을 가진 complete `repo_grep`/`repo_find_files`/`repo_symbol_context` observation만 이 counter-search로 인정한다. `repo_git_diff`처럼 zero-result일 수 있지만 disconfirming predicate를 표현하지 않는 operation, 같은 symbol을 다시 찾는 confirming lookup, unrelated/narrower search는 counterevidence가 아니다. Source-oriented initial exploration은 direct lookup, source read, counter-search, counterexample read proof 단계에 맞게 available repository tool surface를 좁히며, repair도 한 repository action만 허용한다. Git/history claim은 source 전용 단계 축소를 적용하지 않는다. Primary verifier와 runtime-owned deterministic sampling(`temperature=0`, `top_p=1`)의 focused affirmation verifier가 같은 complete certificate의 모든 search ref 및 `affirmed` resolution에 독립적으로 동의해야 한다. 이 verifier 전용 설정은 parent input이나 일반 exploration sampling surface가 아니다. Search certificate와 agreement는 내부 proof에만 남고 parent handoff에는 verdict를 직접 뒷받침하는 최소 source/git evidence만 투영한다. Parent presentation에는 verified `affirmed`/`refuted` resolution을 응답 언어의 짧은 verdict prefix로 명시하되 claim 사실은 다시 작성하지 않는다. Verifier가 `reasonCode=uncovered_request`를 다른 result와 결합하면 schema validation에서 거부하며, structured uncovered facet을 보고하면 원래 verdict가 supported, contradicted, insufficient 중 무엇이든 runtime은 `insufficient/uncovered_request`로 낮추고 같은 canonical goal의 repair/terminal gap으로 보존한다. Sibling goal이나 late goal audit은 만들지 않는다.

Verifier가 새로운 request part를 제안하면 원래 request에 추적 가능한지 다시 audit한다. Verifier invention도 required goal로 바로 승격하지 않는다.

### 5.6 One-round repair

Ready goal의 좁고 실행 가능한 evidence gap만 한 번의 repair 대상이다. Blocked goal, known-infeasible goal, 같은 action을 반복해야 하는 gap은 repair하지 않는다.

Repair 뒤에도 required goal이 닫히지 않으면 `incomplete`다. 반복 loop를 만들지 않는다.

## 6. State reduction

Public `state`는 내부 required-goal ledger에서 결정한다.

| State | Reduction rule |
| --- | --- |
| `complete` | 모든 required goal이 supported이고 parent source read가 필요 없음 |
| `verify_targets` | 모든 required goal이 supported이며 edit intent 때문에 named range read가 필요 |
| `incomplete` | 하나 이상의 required goal이 blocked 또는 unresolved |
| `failed` | Trustworthy normal result를 만들 수 없는 input/execution/provider/tool/verifier/internal fault |

Safety limit, confidence-like self-rating, evidence count만으로 state를 정하지 않는다. Cancellation은 intermediate assistant content를 answer로 재사용하지 않는다. Fault가 있으면 stale partial answer와 success evidence를 내보내지 않는다.

## 7. Parent handoff schema v3

Top-level public object는 strict하고 다음 필드만 허용한다.

| Field | 조건 |
| --- | --- |
| `schemaVersion` | 항상 `3` |
| `directAnswer` | `complete`, `verify_targets`, `failed`에서 필수; supported partial fact가 있는 `incomplete`에서만 선택 |
| `state` | 항상 필요 |
| `targets` | Parent가 source location을 읽거나 수정해야 할 때만 |
| `evidence` | 성공 state와 supported partial answer에 필요 |
| `gaps` | `incomplete`에서 필수 |
| `followUp` | `incomplete`에서 결과를 실제 개선할 수 있는 한 action만 |
| `failure` | `failed`에서만 |

`incomplete.gaps[].question`과 `followUp` requirement는 required goal의 확인된 `request:<start>-<end>` slice에서 runtime이 재구성한다. Wrapper-only 또는 plan-level gap은 원래 task로 돌아간다. Model-authored goal/audit 문구와 `auditBinding`은 parent payload에 포함하지 않는다.

### 7.1 Targets

Target은 `path`, `role`, `reason`을 갖고 optional line bounds와 evidence cross-reference를 가질 수 있다. Directory listing에 나타났다는 이유만으로 target이 되지 않는다. 같은 path/range는 하나로 합치고 `edit`, `test`, `config`, `read` 순서에서 가장 강한 role과 합쳐진 evidence refs만 남긴다.

### 7.2 Evidence

Evidence는 discriminated union이다.

- `source`: exact path/range와 supported claim, 필요할 때만 short snippet
- `git`: observed SHA와 supported claim, optional path/range
- `absence`: complete boundary, 실제 searches, boundary-qualified claim

Evidence list는 claim-cover-minimized한다. Comparison, ordered transition, independent cross-check에 필요하지 않은 중복 item은 parent에게 보내지 않는다.

### 7.3 Gaps and follow-up

Gap은 해결되지 않은 원래 질문과 이유만 담는다. 성공한 goal, internal id, audit verdict, transition history는 담지 않는다.

Follow-up은 다음 중 하나다.

- 여섯 public tools 중 하나를 같은 hard boundary 안에서 호출
- 한 missing input이나 contradiction을 해소하는 user question
- Repository 밖 mutable fact를 얻기 위한 최소 external verification

이미 시도한 equivalent action, scope를 몰래 넓히는 action, known-infeasible goal의 무의미한 retry는 생략한다.

### 7.4 Failure

Public reason은 다음으로 고정한다.

```text
invalid_arguments
repo_mismatch
aborted
provider_error
tool_failure
verifier_error
access_denied
internal_error
```

Retry가 있으면 public six-tool action schema를 그대로 검증한다. Retry가 결과를 개선할 근거가 없으면 넣지 않는다. `directAnswer`만 human-readable failure message이며 `failure` object가 같은 문장을 반복하지 않는다.

### 7.5 Omission policy

다음은 정상 parent handoff에서 제외한다.

- Internal sub-goal plan, rejected goal, audit explanation
- Claim/verifier reason-code history
- Search/read counters와 candidate file list
- Successful check list와 detailed trust diagnostics
- Provider/model, tokens, latency, transcript path
- Tool trace와 empty optional object/array

MCP text response는 structured result를 확장하지 않는다. `complete`는 보통 direct answer만, `incomplete`는 primary gap과 optional follow-up, `failed`는 reason과 optional retry만 간결하게 표시한다.

## 8. Fixed safety limits

Runtime config는 `getRuntimeConfig()`가 반환하는 frozen object다.

| Constraint | Value |
| --- | ---: |
| `maxTurns` | 30 |
| `maxSearchResults` | 80 |
| `maxReadLines` | 320 |
| `maxDirectoryEntries` | 300 |
| `maxWalkFiles` | 6000 |
| `maxCompletionTokens` | 16384 |
| `finalizeMaxCompletionTokens` | 3000 |
| `maxContextTokens` | 110000 |
| `temperature` | 1.0 |
| `topP` | 0.95 |

Project config, public args, operator env가 이 값을 덮어쓰지 못한다. Runtime safety observation name은 `turn_limit`, `context_limit`, `generation_output_limit`, `walk_limit`, `tool_result_limit`으로 제한한다.

Limit observation은 `{ name, stage, affectedSubgoalIds, truncated }` 형태다. Affected goal의 evidence collection이 실제로 끊겼을 때만 gap에 영향을 준다. Operational-only event는 affected id가 비어 있을 수 있다. Limit 자체를 completion이나 confidence input으로 사용하지 않는다.

## 9. Scope, path, ignore, secret policy

### 9.1 Scope hard boundary

- Call-level `scope`와 project `defaultScope`를 결합해 effective scope를 만든다.
- 내부 tool이 추가 scope를 받더라도 effective boundary를 좁힐 수만 있다.
- Directory traversal은 boundary와 무관한 subtree를 queue에 넣지 않는다.
- Git diff/show/stat은 scope 밖 file을 제거하고 omission count만 내부 observation에 남긴다.
- Parent follow-up도 원래 boundary를 넓히지 않는다.

### 9.2 Path safety

모든 path는 repository root relative path로 정규화한다. Absolute path, `..` traversal, symlink escape를 거부하고 실제 target을 `realpath`로 재확인한다. Text size와 binary 여부도 read 전에 확인한다.

### 9.3 Ignore order

Traversal은 다음을 함께 적용한다.

1. Built-in ignored directory와 binary suffix
2. Root `.gitignore`
3. Nested `.gitignore`
4. `.cerebras-explorer.json`의 `extraIgnoreDirs`와 `extraIgnorePatterns`
5. Effective scope
6. Secret path deny-list

Secret deny가 일반 ignore보다 강하다. Secret file은 discovery, grep, symbol, read, evidence reconstruction 어느 경로에서도 content를 내보내지 않는다.

### 9.4 Redaction

Response, default transcript, stderr-safe summaries는 같은 value/path redaction policy를 적용한다. Environment variable identifier는 code interface이므로 기본 보존하고 opt-in flag에서만 감춘다. Planning/trust transcript record는 raw mode에서도 redaction을 강제한다.

## 10. Symbol engine

Zero-dependency 제약 때문에 `src/explorer/symbols.mjs`는 regex/syntax-lite extractor를 사용한다.

- JS/TS, Python, Go, Rust, Java의 common definition 형태 지원
- Signature, language, container, qualified name 보존
- Reference relation으로 definition/import/export/call/member_call/constructor/type_reference/reference 분류
- `repo_symbol_context`는 direct caller 수준으로 제한

이 분류는 빠른 target mapping용이다. Complete type resolution, dynamic dispatch, JSX/decorator 의미, reflection을 주장하지 않는다. Semantic claim은 exact source read와 verifier gate를 통과해야 한다.

## 11. Observability

`CEREBRAS_EXPLORER_LOG_PATH`가 있으면 호출별 JSONL transcript를 쓴다. 모든 record는 같은 `callId`를 사용한다.

주요 record:

- `plan_proposed`, `goal_audit`, `plan_revised`, `goal_rejected`
- `subgoal_state`, `claim`, `verdict`
- `tool`, `assistant`, `repair`, `safety_limit`
- `usage`, `final`, terminal `meta`

Default transcript는 raw source/result 대신 compact summary와 allowlisted trust fields만 기록한다. `CEREBRAS_EXPLORER_LOG_RAW=true`도 planning/trust record의 secret redaction과 field allowlist를 해제하지 않는다.

Stdout은 MCP JSON-RPC frame 전용이다. Concise lifecycle summary는 stderr에 남긴다. Parent answer routing은 operational record가 아니라 schema-v3 handoff만 사용한다.

Execution provenance는 transcript와 benchmark envelope에 server/package version, git SHA, registry hash, public tool names를 남긴다. Parent payload에는 넣지 않는다.

## 12. Direct runtime API

Library caller는 다음 두 entry point만 사용한다.

```js
import { ExplorerRuntime, exploreRepository } from './src/explorer/runtime.mjs';

const oneShot = await exploreRepository(args, {
  abortSignal,
  onProgress,
});

const runtime = new ExplorerRuntime({ chatClient, logger });
const injected = await runtime.explore(args, {
  abortSignal,
  onProgress,
});
```

`exploreRepository`는 일반 one-shot call, `ExplorerRuntime`은 test double이나 shared runtime dependency injection에 적합하다. Direct 결과의 diagnostics는 evaluation용이다. Parent-facing 최소 projection은 MCP server 책임이다.

## 13. Integration model

Claude Code, Codex, OpenCode, Cursor, Continue, Claude Desktop, Gemini 설정은 같은 six-tool registry를 사용한다. Client-specific file은 server command, timeout, API key 전달, tool allowlist만 다르게 표현한다.

권장 parent instruction은 짧게 유지한다.

```text
Need locations -> find_relevant_code
Know the symbol -> trace_symbol
Plan a change -> map_change_impact
Need an execution/data path -> explain_code_path
Need to verify one claim -> collect_evidence
Anything else -> explore_repo
```

Parent는 결과를 받으면 `state` 하나로 routing하고, `verify_targets`가 아니면 같은 source를 습관적으로 다시 읽지 않는다. Conflict가 있으면 숨기지 말고 새 evidence나 gap으로 취급한다.

## 14. Test and synchronization gates

- Commit 전 `npm test`가 `0 fail`
- Runtime/prompt reasoning path 변경 시 API key가 있으면 `node scripts/integration-test.mjs`
- Public registry 변경은 server, retry vocabulary, docs, integrations, examples, benchmark manifests, stale-name guards를 같은 change set에서 갱신
- Schema 변경은 README, DESIGN, expected response fixture를 함께 갱신
- Version 변경은 package, changelog, README install ref, 모든 integration install ref를 함께 갱신
- Dependency arrays는 계속 비어 있어야 함

## 15. Non-goals

- Repository write-back agent
- Shell execution tool
- Secret file inspection
- Live deployment/cloud/process state verification
- LSP/tree-sitter dependency
- Public low-level filesystem tools
- Unbounded planning or repair loops
- Parent-facing telemetry dump

## 16. 한 줄 결론

> Parent가 repository 탐색의 세부 과정을 떠안지 않도록 외부 model과 read-only toolkit을 MCP 뒤에 숨기되, 완료 여부는 audited request coverage와 independently verified claims로만 결정하고 parent에게는 schema-v3의 최소 행동 정보만 전달한다.
