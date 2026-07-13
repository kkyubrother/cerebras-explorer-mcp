# AGENTS.md

이 파일은 본 repository에서 작업하는 coding agent가 따라야 할 행동 규칙을 선언한다. Project mission과 architecture는 `README.md`/`DESIGN.md`가 source of truth다. 이 파일은 구현과 문서의 drift를 막는 gate만 다룬다.

## 프로젝트 불변 조건

- **Zero runtime dependencies.** `package.json`의 `dependencies`와 `devDependencies`는 모두 비어 있어야 한다.
- **Read-only repository access.** Explorer에 file write/delete 또는 shell execution 경로를 추가하지 말 것.
- **Secret deny-list + redaction always on.** Path policy는 `src/explorer/security.mjs`, value redaction은 `src/explorer/redact.mjs`를 따른다. Snippet 안의 `process.env.X`/`import.meta.env.X`/`Deno.env.get("X")` 식별자는 public code interface이므로 기본 보존하고, secret value와 secret path를 마스킹한다.
- **Public registry는 아래 순서로 고정.** `find_relevant_code`, `trace_symbol`, `map_change_impact`, `explain_code_path`, `collect_evidence`, `explore_repo`. Alias나 output-format 전용 tool을 추가하지 말 것.
- **Parent가 runtime policy를 선택하지 않는다.** Public input은 task/query, immutable scope, known file/symbol/text anchor, 선택적 language만 허용한다. Turn count, depth, reasoning control, internal sub-goal/repair 설정을 노출하지 말 것.
- **Fixed safety limits.** Provider/context/process/repository 보호 한계는 runtime-owned constants다. Project config, public input, operator env로 덮어쓰는 경로를 추가하지 말 것. Internal observation name은 `turn_limit`, `context_limit`, `generation_output_limit`, `walk_limit`, `tool_result_limit`만 사용한다.
- **Scope는 모든 tool의 hard boundary.** `repo_list_dir`/`repo_read_file`/`repo_grep`/symbol tools뿐 아니라 `repo_git_diff`/`repo_git_show`/stat path도 scope 밖 file을 제외한다. Omission count는 internal observation과 transcript에만 남긴다.
- **Schema-v3 parent handoff.** `schemaVersion`, `state`와 state에 필요한 `directAnswer`, `targets`, `evidence`, `gaps`, `followUp`, `failure`만 parent에게 전달한다. Internal goals, audit/verifier diagnostics, counters, usage, timing, transcript path, tool trace를 normal payload에 복사하지 말 것.
- **State reduction is fail-closed.** 모든 유효한 required sub-goal이 verified되기 전에는 `complete`/`verify_targets`가 될 수 없다. Planner invention은 버리되, 사용자가 요구한 infeasible/unresolved goal은 `incomplete` gap으로 보존한다.
- **Progress handoff.** Long path/impact call에는 `_meta.progressToken`을 전달한다. 다른 agent에 결과를 요약할 때 `state`와 해당 state의 conditional fields를 누락하거나 확장하지 말 것.
- `EXPLORER_PROVIDER` / `EXPLORER_FAILOVER` 경로는 internal implementation이며 public documentation의 1급 설정으로 다루지 말 것.

## Public tool 선택 규칙

Initialization, integration skill, parent instruction에서 다음 순서를 한 번만 사용한다.

```text
Need locations -> find_relevant_code
Know the symbol -> trace_symbol
Plan a change -> map_change_impact
Need an execution/data path -> explain_code_path
Need to verify one claim -> collect_evidence
Anything else -> explore_repo
```

개별 tool description에는 해당 tool의 positive trigger와 한 boundary만 둔다. Sibling 비교 목록을 각 description에 반복하지 말 것.

## 문서-코드 동기화 매트릭스

좌측을 변경하면 같은 change set에서 우측을 함께 갱신한다. `tests/integrations.test.mjs`가 일부를 snapshot/negative guard로 강제한다.

| 변경 | 함께 갱신할 것 |
| --- | --- |
| `src/explorer/schemas.mjs` public schema | `README.md`, `DESIGN.md`, `examples/expected-response.json`, schema/integration tests |
| `src/explorer/runtime.mjs` parent-visible string/state | `examples/expected-response.json`, runtime/MCP tests |
| `src/mcp/server.mjs` public registry/description/dispatch | `README.md`, `DESIGN.md`, `TESTING.md`, 모든 `integrations/*` readme/example, adoption fixtures |
| Retry/follow-up vocabulary | Runtime schema, MCP projection, integrations, negative stale-name guards |
| Fixed safety-limit name/value | `README.md`, `DESIGN.md`, `TESTING.md`, transcript/benchmark tests |
| `package.json` version | `CHANGELOG.md`, README install snippet, 모든 integration install ref |
| Public `CEREBRAS_EXPLORER_*` env | `README.md`, `DESIGN.md`, integration docs/tests |
| Secret path/value policy | `README.md`, `DESIGN.md`, security/redaction tests |
| Benchmark schema | `benchmarks/adoption.json`과 evaluator tests |

`src/` 변경 후 어느 문서를 갱신할지 불확실하면 먼저 `npm test`를 실행해 drift guard를 확인한다.

## Plan closure

`docs/superpowers/plans/<plan>.md`의 모든 task가 commit으로 landed되면 다음 중 하나를 수행한다.

1. 모든 checkbox를 `[x]`로 바꾸고 `git mv`로 `docs/superpowers/plans/completed/`에 이동
2. `plan/README.md` 정책에 따라 `git rm`

완료된 plan을 unchecked 상태로 남기지 말 것.

## 테스트 규칙

- **모든 commit 전 `npm test`가 `0 fail`.**
- `src/explorer/runtime.mjs` 또는 prompt reasoning path를 바꿨고 `CEREBRAS_API_KEY`를 사용할 수 있으면 `node scripts/integration-test.mjs`도 실행한다.
- Public field/tool/env를 추가·변경하면 `tests/integrations.test.mjs`에 대응 assertion과 stale-name guard를 둔다.
- Parent contract 변경은 MCP `structuredContent`와 text parity를 함께 test한다.
- Direct runtime caller test는 `exploreRepository` 또는 `ExplorerRuntime.explore`를 사용한다.
- Commit 직전 `git diff --check`를 실행한다.

## CHANGELOG 규칙

- `CHANGELOG.md` 최상단 version heading은 `package.json` version과 일치해야 한다.
- Released heading: `## v<X.Y.Z> - <YYYY-MM-DD>`
- 아직 출하 전 heading: `## v<X.Y.Z> - Unreleased`
- Declared package version을 release한 뒤에도 해당 heading을 `Unreleased`로 두지 말 것.

## 하지 말 것

- Parent agent에 raw filesystem tools(Read/Glob/Grep)를 이 MCP의 public surface로 노출하지 말 것.
- Schema-v3 외의 top-level field를 새 public contract처럼 문서화하거나 반환하지 말 것.
- Evidence count, self-rating, safety-limit hit만으로 completion을 선언하지 말 것.
- Rejected planner goal을 parent gap으로 노출하거나 completion blocker로 남기지 말 것.
- User-required blocker를 planner mistake처럼 버리지 말 것.
- Scope를 넓히는 follow-up이나 이미 시도한 equivalent action을 반복하지 말 것.
- Empty optional object/array, successful internal check list, tool trace를 parent payload에 넣지 말 것.
- `dependencies` / `devDependencies`를 추가하지 말 것. 필요하면 owner와 별도 합의한다.
- 자신의 변경과 무관한 adjacent refactor, formatting, dead-code cleanup을 하지 말 것.

## 다중 agent 협업

이 repository는 여러 coding session이 병렬로 작업할 수 있다.

- 다른 agent가 만든 변경을 따라잡을 때 memory보다 current source와 tests를 먼저 확인한다.
- Shared worktree의 unrelated modification을 되돌리거나 덮어쓰지 않는다.
- Sub-agent는 독립적이고 bounded한 workstream에만 사용한다.
- Sub-agent 결과를 parent에게 넘길 때 file scope, 검증 명령, 남은 risk를 명시한다.
- 본 파일을 다른 agent가 자동으로 읽었다고 가정하지 말고 필요한 invariant를 delegation prompt에 포함한다.

## Quick reference

- Mission / quickstart: `README.md`
- Architecture: `DESIGN.md`
- Test acceptance: `TESTING.md`
- Release history: `CHANGELOG.md`
- Current feature plan: `specs/028-trustworthy-explorer/plan.md`
- Current feature tasks: `specs/028-trustworthy-explorer/tasks.md`
- Legacy plan policy: `plan/README.md`
- Local pre-commit hook: `bash scripts/install-hooks.sh`

<!-- SPECKIT START -->
For feature 028 trust and parent-handoff work, read
`specs/028-trustworthy-explorer/plan.md` before implementation.
<!-- SPECKIT END -->
