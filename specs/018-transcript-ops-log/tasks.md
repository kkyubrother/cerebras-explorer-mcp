---
description: "Tasks for spec 018 — transcript을 운영 디버깅 채널로 재정의"
---

# Tasks: transcript를 운영 디버깅 채널로 재정의 (spec 018)

**Input**: Design documents from `specs/018-transcript-ops-log/`

**Prerequisites**: `spec.md`, `plan.md` (both present)

**Organization**: Tasks are grouped by user story. All 4 user stories are P1; suggested execution order is US1 → US2 → US3 → US4 (each builds on the previous foundation).

## Path Conventions

- Single project. Source under `src/`, tests under `tests/`.

---

## Phase 1: Setup (Shared baseline)

**Purpose**: Confirm working tree is on the spec-017 follow-up state and recent npm test baseline passes.

- [x] T001 Baseline checked: active implementation branch is `018-transcript-ops-log` created from `master`; pre-existing generated/spec config changes were left intact before starting C1 implementation
- [x] T002 Run `npm test` once and record the baseline (357 tests, 354 pass) — confirms spec 017 train state is intact before spec 018 modifications

---

## Phase 2: Foundational (Blocking prerequisites)

**Purpose**: Refit `src/explorer/transcript.mjs` to expose callId, support new envvars, and apply redaction. This is the shared foundation US1–US4 all depend on.

**⚠️ CRITICAL**: No user story tasks can begin until this phase is complete.

- [x] T010 Extend `src/explorer/transcript.mjs:isTranscriptEnabled()` so `CEREBRAS_EXPLORER_LOG_PATH` truthy implies enabled; fall through to existing `CEREBRAS_EXPLORER_TRANSCRIPT` truthy check. Both paths must keep returning `false` when neither envvar is set.
- [x] T011 Add a new helper `isTranscriptRawMode()` in `src/explorer/transcript.mjs` that reads `CEREBRAS_EXPLORER_LOG_RAW` and returns `true` only for the same truthy set as `isTranscriptEnabled()` (`1` / `true` / `yes`).
- [x] T012 Update `resolveTranscriptDir(repoRoot)` in `src/explorer/transcript.mjs` so the priority becomes `CEREBRAS_EXPLORER_LOG_PATH` → `CEREBRAS_EXPLORER_TRANSCRIPT_DIR` → default `<repoRoot>/.cerebras-explorer/transcripts`. Keep absolute / relative path resolution behaviour identical to the current implementation.
- [x] T013 Inside `createTranscriptRecorder` in `src/explorer/transcript.mjs`, generate `callId` via `import { randomUUID } from 'node:crypto'` (top-of-file import). Replace the existing `randomBytes(4).toString('hex')` id with this UUID and expose `callId` on the returned recorder object.
- [x] T014 Change the transcript filename construction in `createTranscriptRecorder` to `${timestamp}_${tool}_${callId}.jsonl`. Keep `timestamp` formatting identical (`new Date().toISOString().replace(/[:.]/g, '-')`).
- [x] T015 Modify the internal `record(type, data)` in `src/explorer/transcript.mjs` so every pushed buffer entry includes the per-call `callId` field (`{ t: Date.now(), type, callId, ...data }`).
- [x] T016 [P] Add a redaction wrapper in `src/explorer/transcript.mjs`: import `redactValue` from `./redact.mjs`, define a local `redactForTranscript(data)` that returns `data` when `isTranscriptRawMode()` is `true` and `redactValue(data).value` otherwise. Apply it inside `record(type, data)` before the buffer push.
- [x] T017 In `src/explorer/transcript.mjs` `finalize(stats)`, include `redacted: !isTranscriptRawMode()` and `callId` in the closing `meta` record so consumers can identify raw-mode files.
- [x] T018 [P] Run focused unit tests during foundation work: `node --test tests/transcript.test.mjs` (file may need to be created in T020 — until then, run `node --test tests/runtime.mock.test.mjs` to detect regressions in the recorder wiring).
- [x] T019 [P] Create `tests/transcript.test.mjs` skeleton with imports (`node:test`, `node:assert/strict`, `node:fs/promises`, `node:os`, transcript module) so the per-story test tasks can append cases.

**Checkpoint**: `transcript.mjs` exports the new behaviour. Tests for foundational pieces can be added now or co-located in the per-story test tasks below. No external caller has been re-wired yet, so callers that already use `createTranscriptRecorder` (only `freeExploreV2`) continue to work with the new filename/callId/redaction.

---

## Phase 3: User Story 1 — explore() 호출도 transcript에 기록 (Priority: P1) 🎯 MVP

**Goal**: `LOG_PATH` 또는 `TRANSCRIPT*` 옵트인 상태에서 `explore_repo` 및 6개 wrapper 도구도 호출별 JSONL 파일을 생성한다.

**Independent Test**: 임의 `LOG_PATH` 설정 → `explore_repo` 단일 호출 → 해당 디렉토리에 `{ISO8601}_explore_repo_{UUID}.jsonl` 파일 존재 + 첫 line의 `type:"meta"` + `callId` 필드 일치.

### Implementation for User Story 1

- [x] T030 [US1] In `src/explorer/runtime.mjs` `ExplorerRuntime.explore()`, import `createTranscriptRecorder` and instantiate it right after `_initExploreContext(...)` resolves (mirroring the pattern in `freeExploreV2`). Tool name should be `'explore_repo'`; `task` should be `args.task`.
- [x] T031 [US1] Inside the explore turn loop in `src/explorer/runtime.mjs` `ExplorerRuntime.explore()`, call `transcript.record('assistant', ...)` for each assistant completion message and `transcript.record('tool', ...)` for each tool call result, matching the existing `freeExploreV2` pattern. Do not duplicate raw file content into the record payload — keep the existing summarised tool result shape.
- [x] T032 [US1] In the same `explore()` method add a try/finally that calls `await transcript.finalize(stats)` exactly once at the end (success, error, and abort paths). Confirm the abort path (`stats.stoppedByAbort`) still finalizes via the `finally` block.
- [x] T033 [P] [US1] Append a unit test to `tests/transcript.test.mjs` covering: with `CEREBRAS_EXPLORER_LOG_PATH` set to a temp dir, an `ExplorerRuntime.explore()` call with a stub chat client produces exactly one transcript file under the temp dir whose filename matches `^[0-9-T]+Z_explore_repo_[0-9a-f-]{36}\.jsonl$`.
- [x] T034 [P] [US1] Append a unit test to `tests/transcript.test.mjs` covering: every record in the produced transcript file has the same `callId`, equal to the value embedded in the filename.
- [x] T035 [P] [US1] Append a unit test to `tests/runtime.mock.test.mjs` (existing harness) that exercises one of the wrapper tools (e.g. `trace_symbol`) end-to-end and asserts a transcript file is created when `LOG_PATH` is set — confirms wrapper coverage through `explore_repo` delegation.
- [x] T036 [US1] Run `npm test`; verify all newly added tests pass and no spec-017 regressions. Adjust assertions if they conflict with existing fixtures.

**Checkpoint**: explore_repo + 6 wrappers all emit transcripts. freeExploreV2 continues to emit transcripts unchanged (filename now uses callId, contents now redacted by default — handled in foundation phase).

---

## Phase 4: User Story 2 — stderr 한 줄 요약 (Priority: P1)

**Goal**: 옵트인 없이도 호출이 끝날 때 stderr에 `[cerebras-explorer] tool=... turns=... toolCalls=... stoppedByBudget=... elapsed=...s` 한 줄이 항상 출력된다.

**Independent Test**: 임의 explore_repo 호출을 stderr 캡처 + stdout 캡처 → stderr 마지막 줄에 접두어 `[cerebras-explorer]` + stdout JSON-RPC 라인이 오염되지 않음.

### Implementation for User Story 2

- [x] T040 [US2] In `src/mcp/server.mjs`, add a helper `formatOpsSummary({ tool, stats, transcriptPath, raw })` that returns a single-line string in the format `[cerebras-explorer] tool=${tool} turns=${stats.turns ?? 0} toolCalls=${stats.toolCalls ?? 0} stoppedByBudget=${Boolean(stats.stoppedByBudget)} elapsed=${Math.round((stats.elapsedMs ?? 0) / 1000)}s${transcriptPath ? ` log=${transcriptPath}` : ''}${raw ? ' raw=true' : ''}`. Place it next to `formatExploreResult` so the two helpers sit together.
- [x] T041 [US2] In `src/mcp/server.mjs` `callTool(...)`, capture `result.stats`, `transcriptPath` (read from `result.transcriptPath` for free-form / `result.stats?.transcriptPath` for explore — needs surfacing from runtime in T042), and `isTranscriptRawMode()` (import from `transcript.mjs`). Write `formatOpsSummary(...) + '\n'` to `process.stderr` after the agent-facing result is built. Wrap in try/catch so any stderr failure cannot break the MCP response.
- [x] T042 [US2] Surface `transcriptPath` on the explore() return value. In `src/explorer/runtime.mjs` `ExplorerRuntime.explore()` return shape, attach `transcriptPath: transcript.filePath` similarly to how `freeExploreV2` already exposes it under `result.transcriptPath`. This is the data hookup `callTool` reads in T041.
- [x] T043 [US2] Repeat the stderr summary emission in `src/mcp/server.mjs` `callFreeExploreTool(...)` using `result.transcriptPath` directly (already exposed by freeExploreV2). Same try/catch guard.
- [x] T044 [US2] Move the stderr summary emission into `finally` blocks of both `callTool` and `callFreeExploreTool` so the line is also written when explore throws. Use the partial `stats` from the thrown error if available; otherwise emit `turns=0 toolCalls=0 stoppedByBudget=false elapsed=0s` plus the recovery `failure` reason added at end of line.
- [x] T045 [P] [US2] Add a unit test to `tests/mcp-server.test.mjs` that runs an `explore_repo` MCP call with a mock chat client, captures `process.stderr.write` (using a stub or `process.stderr` patch), and asserts a single line matching `/^\[cerebras-explorer\] tool=explore_repo turns=\d+ toolCalls=\d+ stoppedByBudget=(true|false) elapsed=\d+s$/`.
- [x] T046 [P] [US2] Add a follow-up assertion in the same test (or a sibling test) that the captured stdout JSON-RPC frame does not contain the `[cerebras-explorer]` prefix, confirming stdio purity.
- [x] T047 [P] [US2] Add a unit test to `tests/mcp-server.test.mjs` that sets `CEREBRAS_EXPLORER_LOG_PATH` to a temp dir before the call and asserts the stderr line ends with ` log=<path>` (path matches the generated transcript file).
- [x] T048 [US2] Run `npm test`; verify US1 + US2 tests pass together.

**Checkpoint**: stderr 한 줄 요약이 모든 explore 호출 끝에 출력되고 `LOG_PATH` 설정 시 파일 경로까지 노출.

---

## Phase 5: User Story 3 — envvar surface 정리 (Priority: P1)

**Goal**: `CEREBRAS_EXPLORER_LOG_PATH`가 유일한 사용자-안내 envvar가 되고, 기존 `CEREBRAS_EXPLORER_TRANSCRIPT*`는 hidden alias로만 작동.

**Independent Test**: README/DESIGN/integrations 문서에서 `CEREBRAS_EXPLORER_TRANSCRIPT` grep → CHANGELOG의 deprecation 안내 1곳을 제외하고 0 매치.

### Implementation for User Story 3

- [x] T050 [P] [US3] Add a unit test to `tests/transcript.test.mjs` covering envvar precedence: with both `CEREBRAS_EXPLORER_LOG_PATH=/a` and `CEREBRAS_EXPLORER_TRANSCRIPT_DIR=/b` set, the resolver returns `/a`.
- [x] T051 [P] [US3] Add a unit test to `tests/transcript.test.mjs` covering backward-compat: with only `CEREBRAS_EXPLORER_TRANSCRIPT=true` and `CEREBRAS_EXPLORER_TRANSCRIPT_DIR=/b` set, transcript enables and uses `/b`.
- [x] T052 [P] [US3] Add a unit test to `tests/transcript.test.mjs` covering the new path-implies-opt-in: setting `CEREBRAS_EXPLORER_LOG_PATH` alone enables transcript without `CEREBRAS_EXPLORER_TRANSCRIPT=true`.
- [x] T053 [P] [US3] Add a unit test to `tests/transcript.test.mjs` covering off state: neither envvar set → `isTranscriptEnabled()` returns `false` and the no-op recorder is returned.
- [x] T054 [P] [US3] Add a guard to `tests/integrations.test.mjs` (or a new test file `tests/docs-envvar-surface.test.mjs`) that greps `README.md`, `DESIGN.md`, and `integrations/**/*.md*` for `CEREBRAS_EXPLORER_TRANSCRIPT` and asserts the only match is inside `CHANGELOG.md`'s deprecation announcement (use whichever scoping helpers existing tests already use).
- [x] T055 [US3] Run `npm test`; ensure no regression from US1/US2 surfaces while US3 guards land.

**Checkpoint**: envvar surface가 정리되었음을 grep + 단위 테스트로 보증.

---

## Phase 6: User Story 4 — redaction 보안 일관성 (Priority: P1)

**Goal**: 기본 모드에서 transcript에 secret이 누설되지 않고, `CEREBRAS_EXPLORER_LOG_RAW=true` 옵트인 시에만 raw 보존.

**Independent Test**: 합성 secret 패턴이 들어간 fixture를 explorer가 읽도록 만든 뒤, 기본 모드 transcript에서 그 패턴이 `[REDACTED:*]`로 치환됐는지 grep으로 단독 검증.

### Implementation for User Story 4

- [x] T060 [P] [US4] Add a unit test to `tests/transcript.test.mjs` that constructs a fixture containing a synthetic API-key pattern, runs an explore() call through `LOG_PATH`, then reads the resulting JSONL and asserts every line that mentioned the key now contains `[REDACTED:` and never the raw key value.
- [x] T061 [P] [US4] Add a unit test to `tests/transcript.test.mjs` for deny-list paths: with a fixture containing a `.env` file, run an explore that tries to read it, then assert the transcript records do not contain the env file's raw contents.
- [x] T062 [P] [US4] Add a unit test to `tests/transcript.test.mjs` for `LOG_RAW`: with `CEREBRAS_EXPLORER_LOG_RAW=true` + the same synthetic API-key fixture, assert the raw key is preserved in the transcript (verifies the opt-in escape hatch).
- [x] T063 [P] [US4] Add a unit test to `tests/transcript.test.mjs` confirming the closing `meta` record contains `redacted: false` when `LOG_RAW=true` and `redacted: true` otherwise.
- [x] T064 [P] [US4] Extend `tests/mcp-server.test.mjs` stderr capture (from T047) with a case where `LOG_RAW=true` is set; assert the stderr line ends with ` raw=true` (after the `log=...` token if present).
- [x] T065 [US4] Run `npm test`; full suite must pass with all four user stories' tests in place.

**Checkpoint**: 보안 경계가 응답 표면과 동일하게 transcript에도 적용되고 raw 모드는 명시적 opt-in에 한정됨.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Document the new behaviour and announce the alias deprecation.

- [x] T070 Update `README.md`: replace the `CEREBRAS_EXPLORER_TRANSCRIPT` / `CEREBRAS_EXPLORER_TRANSCRIPT_DIR` envvar block (~498-500 라인) with `CEREBRAS_EXPLORER_LOG_PATH` and `CEREBRAS_EXPLORER_LOG_RAW`. Add a one-line note that the previous envvar names are accepted as hidden aliases until v0.7 and point readers to the CHANGELOG entry.
- [x] T071 Update `README.md` "주요 특징" 항목에 stderr 한 줄 요약 동작을 한 줄로 명시 (예: "운영 디버깅 출력: finalize 시 stderr 한 줄 요약 항상 출력 + `CEREBRAS_EXPLORER_LOG_PATH`로 transcript JSONL 옵트인").
- [x] T072 [P] Update `DESIGN.md` §11.7 (또는 §5 인접 단락): transcript을 "운영 디버깅 채널 (spec 018)"로 재정의하고 callId 정책 + record 구조 한 줄 명시. spec 017 단락의 "후속 spec의 local ops log"라는 placeholder 문장을 본 spec 018로 명시적으로 가리키도록 갱신.
- [x] T073 [P] Update `CHANGELOG.md` with a new v0.6.1 (or appropriate next patch) entry: feature additions (`CEREBRAS_EXPLORER_LOG_PATH`, `CEREBRAS_EXPLORER_LOG_RAW`, callId, stderr 한 줄 요약, transcript 적용 범위 확장). Add a separate "v0.7.0 (planned)" BREAKING line announcing the `CEREBRAS_EXPLORER_TRANSCRIPT*` removal so the deprecation grep test in T054 has a single sanctioned match.
- [x] T074 [P] Scan `integrations/` for `CEREBRAS_EXPLORER_TRANSCRIPT` mentions; for each user-facing prose file replace with `CEREBRAS_EXPLORER_LOG_PATH` (or remove the mention if the file only documents minimal envvars). Do not touch `.gitignore` or `package.json` style files.
- [x] T075 Verify `tests/integrations.test.mjs` `CEREBRAS_EXPLORER_TRANSCRIPT` grep guard (T054) is now satisfied — only `CHANGELOG.md` matches.
- [x] T076 Run final `npm test`; full suite 0 failures.
- [x] T077 Update `specs/018-transcript-ops-log/checklists/requirements.md` to mark spec 018 implementation complete (manual checklist tick after T076 succeeds).
- [x] T078 Optional manual smoke test: run `CEREBRAS_API_KEY=<key> CEREBRAS_EXPLORER_LOG_PATH=/tmp/ops node scripts/integration-test.mjs` to confirm transcripts land under `/tmp/ops` and stderr lines appear. Skip if no API key available locally.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)** has no dependencies.
- **Foundational (Phase 2)** depends on Setup. Blocks all user stories because every story relies on the new transcript.mjs behaviour.
- **User Stories (Phases 3-6)** all depend on Foundational. Suggested order: US1 → US2 → US3 → US4. US2 has a soft dependency on US1 (the runtime needs to expose `transcriptPath` first — T042). US3 and US4 can run in parallel with each other once Foundational is done.
- **Polish (Phase 7)** depends on every user story phase being complete. T075 specifically requires US3's grep guard test to exist.

### User Story Dependencies

- **US1 (P1)**: depends on Phase 2.
- **US2 (P1)**: depends on Phase 2 and on T042 from US1 (transcriptPath exposure). Can otherwise run in parallel with US3/US4 test additions.
- **US3 (P1)**: depends on Phase 2; tests only — can land alongside US1/US2.
- **US4 (P1)**: depends on Phase 2; tests only — can land alongside US1/US2.

### Parallel Opportunities

- All [P]-marked foundational tasks (T016, T018, T019) can be split across reviewers.
- Within US1, the test-only tasks (T033, T034, T035) can be authored in parallel after the runtime change in T030-T032 lands.
- US3 and US4 are almost entirely test additions and can be written in parallel by different reviewers after Phase 2.
- Polish tasks T072, T073, T074 are independent files and can run in parallel.

---

## Parallel Example: After Phase 2 completion

```bash
# Three reviewers can pick up these in parallel:
Reviewer A: T030-T036 (US1 runtime wire + tests)
Reviewer B: T050-T055 (US3 envvar surface tests + docs grep guard)
Reviewer C: T060-T065 (US4 redaction tests)

# US2 (T040-T048) follows once T042 lands so transcriptPath is available.
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1: Setup (T001-T002).
2. Phase 2: Foundational (T010-T019).
3. Phase 3: US1 (T030-T036).
4. Validate: explore_repo creates transcript with callId-based filename; existing freeExploreV2 still works.
5. Commit as C1 (foundation) + C2 (US1 runtime wire). Stop and demo. This is the smallest deployable increment that restores operational debugging for explore_repo.

### Incremental Delivery

1. C1 (Foundation): Phases 1-2.
2. C2 (Wire-up): Phases 3-4 (US1 + US2). Now every explore call emits a transcript + stderr summary.
3. C3 (Tests + docs): Phases 5-7 (US3 + US4 tests + Polish). Documents the new surface and proves backward compatibility.

This map matches the three commit groups already declared in plan.md.

### Parallel Team Strategy

After Phase 2 completes, two reviewers can split work — one finishes US1 + US2, another writes US3 + US4 tests in parallel. Polish phase is single-threaded but each polish task touches a different file.

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks.
- [Story] label maps each story task to spec.md's user stories (US1-US4).
- spec 018 has 4 P1 user stories — no P2/P3 phases.
- Tests are co-located with their owning story phase. Spec 018 did not request a separate TDD-style test-first workflow, but the FR section explicitly requires regression guards, so each story phase includes test tasks.
- Commit after each story phase completes (C1 = T001-T019, C2 = T030-T048, C3 = T050-T078) to align with plan.md commit train.
- Avoid touching unrelated transcript record schema in this spec — schema versioning is explicitly out of scope.
