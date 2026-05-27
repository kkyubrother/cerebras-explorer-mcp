# Implementation Plan: transcript를 운영 디버깅 채널로 재정의

**Branch**: `018-transcript-ops-log` (작업은 `master`) | **Date**: 2026-05-27 | **Spec**: [`specs/018-transcript-ops-log/spec.md`](./spec.md)

## Summary

`src/explorer/transcript.mjs`의 기존 transcript 기능을 운영 디버깅 채널로 재정의한다. (a) `explore_repo`와 6 wrapper 도구도 transcript을 기록하도록 `ExplorerRuntime.explore()`에 recorder를 wire한다. (b) 새 envvar `CEREBRAS_EXPLORER_LOG_PATH`를 도입해 path-implies-opt-in으로 동작시키고, 기존 `CEREBRAS_EXPLORER_TRANSCRIPT*`는 hidden alias로 코드만 받는다. (c) record 직전에 응답과 동일한 redaction을 적용하고 `CEREBRAS_EXPLORER_LOG_RAW=true`로 우회 모드를 옵트인할 수 있게 한다. (d) finalize 시 stderr에 한 줄 요약을 항상 출력한다. (e) **파일명에 호출 UUID(callId)를 도입하고 모든 record에 같은 callId 필드를 넣어** "이 파일의 record가 모두 한 호출의 것"임을 검증 가능하게 만든다.

## Technical Context

**Language/Version**: Node.js 22+ ESM.

**Primary Dependencies**: 없음. `node:crypto`의 `randomUUID()`(RFC 4122 v4)를 사용해 callId 생성. zero-dep 원칙 유지.

**Storage**: 로컬 파일시스템. JSONL 파일 (호출당 1 파일).

**Testing**: `npm test` 전체. 핵심 회귀:
- `node --test tests/transcript.test.mjs` (신규 또는 확장)
- `node --test tests/runtime.mock.test.mjs` (`explore_repo`도 transcript 생성하는지)
- `node --test tests/mcp-server.test.mjs` (stderr 한 줄 요약 회귀)
- `node --test tests/integrations.test.mjs` (`CEREBRAS_EXPLORER_TRANSCRIPT*` user-facing 문서 잔재 가드)

**Target Platform**: 동일 (Node 22+ MCP stdio server).

**Project Type**: library/MCP server (단일 source root).

**Performance Goals**: transcript record 비용은 fire-and-forget. redaction 적용은 record 단위 ~O(content length) — 핫 path 우려 없음. UUID 생성은 호출당 1회.

**Constraints**:
- stdio purity: stdout는 JSON-RPC frame만, stderr는 운영 로그만.
- zero-dep 유지.
- backward-compat: 기존 envvar 사용자 0 영향 (v0.6.x 동안).
- breaking change 없음.

**Scale/Scope**:
- `src/explorer/transcript.mjs` 약 50~100라인 추가/수정 (callId 필드, opt-in 로직 확장, redaction wrapping).
- `src/explorer/runtime.mjs` `explore()` 메서드에 recorder lifecycle 6~10 라인 추가, `freeExploreV2`의 record 호출은 그대로 사용.
- `src/mcp/server.mjs` finalize 직후 stderr 한 줄 요약 helper 호출 추가 (callTool / callFreeExploreTool 양쪽).
- 테스트 신규/확장 약 200~300 라인.
- 문서 갱신: README 약 10라인, DESIGN.md 약 5라인, integrations/ 1~2 파일.

## Constitution Check

`.specify/memory/constitution.md`는 placeholder 상태(원칙 미정의). vacuous PASS — 모든 게이트 비어있음. 본 spec은 다음 자체 원칙을 따른다:

- 기능적: explore 호출 100%에서 transcript 옵트인 가능. stderr 한 줄 요약 100% 출력.
- 비기능적: stdio purity 유지, zero-dep 유지, backward-compat (FR-011/012).
- 보안: 응답 표면과 동일한 redaction 적용 (FR-020). raw 모드는 opt-in.

게이트 평가: 위반 없음.

## Project Structure

```text
specs/018-transcript-ops-log/
├── spec.md
├── plan.md           # ← 이 문서
├── tasks.md          # /speckit-tasks에서 생성
└── checklists/
    └── requirements.md
```

코드 변경:

```text
src/explorer/transcript.mjs            # callId 도입, opt-in 정책 확장, redaction wrapping
src/explorer/runtime.mjs               # explore() 메서드에 recorder lifecycle 추가
src/explorer/redact.mjs                # (필요 시) transcript용 redact wrapper export
src/mcp/server.mjs                     # callTool/callFreeExploreTool에 stderr 한 줄 요약 helper 호출
src/explorer/config.mjs                # (선택) CEREBRAS_EXPLORER_LOG_PATH / LOG_RAW 정규화 헬퍼
tests/transcript.test.mjs              # 신규 또는 확장 (callId, opt-in, redaction)
tests/runtime.mock.test.mjs            # explore_repo가 transcript 생성하는지 회귀 가드
tests/mcp-server.test.mjs              # stderr 한 줄 요약 회귀 가드
tests/integrations.test.mjs            # CEREBRAS_EXPLORER_TRANSCRIPT* user-facing 안내 grep 가드
README.md                              # 새 envvar 안내, TRANSCRIPT* 사용자 안내 제거
DESIGN.md                              # transcript 정체성 재정의 단락 추가
CHANGELOG.md                           # v0.7.0(예정) BREAKING 예고 항목
integrations/                          # (필요 시) CEREBRAS_EXPLORER_TRANSCRIPT* 언급 정리
```

**Structure Decision**: 기존 단일 source root 구조 유지. 신규 파일 없이 기존 `transcript.mjs`를 확장하고 wire를 늘리는 방식.

## 파일명 포맷 및 callId 정책 (사용자 의견 반영)

사용자 추가 의견: "동일한 호출 연속이 맞는지 알 수 있는 UUID같은 요소를 넣으면 좋겠음."

결정:

- **파일명**: `{ISO8601-with-dashes}_{tool}_{callId}.jsonl`
  - 예: `2026-05-27T14-30-22-123Z_explore_repo_5f3a8b2c-1d4e-4a9f-9c0a-7b6e2f8d1a3b.jsonl`
  - 기존 `4-byte-hex`(8 hex chars) → `callId`(36-char UUIDv4)로 강화. 충돌 확률 사실상 0.
- **callId 값**: Node `node:crypto`의 `randomUUID()` 사용. RFC 4122 v4. zero-dep 원칙 유지.
- **record 단위 callId**: 모든 record(meta/system/user/assistant/tool)에 `callId` 필드를 추가한다. 같은 호출의 record는 동일한 `callId`를 갖는다.
- **활용**:
  - `jq 'select(.callId == "<uuid>")' file.jsonl`로 파일 내 record가 모두 한 호출의 것임을 검증.
  - 여러 파일을 디렉토리에서 merge할 때 callId로 grouping 가능.
  - 파일이 어떤 이유로 손상돼 record가 섞여도 callId로 분리 가능.
- **backward-compat**:
  - 기존 transcript에는 `callId` 필드가 없다. 새 record에만 추가되며 분석 도구는 누락 시 fallback(파일명에서 추출)을 사용한다.
  - 기존 `4-byte-hex` 파일명은 이미 disk에 존재할 수 있지만 새 호출은 UUID 형식만 생성한다.

## Commit 단위 (확정)

spec 017과 같은 train 방식. 단, 본 spec은 추가 변경이 작아 3 commits로 충분.

| Commit | 범위 | 메시지 prefix |
|---|---|---|
| C1 | transcript.mjs callId 도입 + LOG_PATH/LOG_RAW envvar + redaction wrapping. tests 확장. | `feat(spec-018): add callId, LOG_PATH opt-in, and redaction to transcript` |
| C2 | runtime.mjs explore()에 recorder wire + server.mjs stderr 한 줄 요약. tests 확장. | `feat(spec-018): record transcripts for explore_repo and emit stderr summary` |
| C3 | README/DESIGN/CHANGELOG/integrations 문서 갱신. | `docs(spec-018): document LOG_PATH and stderr ops summary` |

C1과 C2 끝에 `npm test`로 0 failures 확인. C3는 코드 영향 없으므로 검증 생략 가능.

## Implementation Outline

### Phase 1 — transcript.mjs 확장 (C1)

(1) **opt-in 로직 확장** (`src/explorer/transcript.mjs`):
- `isTranscriptEnabled()`를 확장: `CEREBRAS_EXPLORER_LOG_PATH`가 truthy하면 true; 아니면 기존 `CEREBRAS_EXPLORER_TRANSCRIPT` 검사.
- `resolveTranscriptDir(repoRoot)`: 우선순위 — `LOG_PATH` → `TRANSCRIPT_DIR` → 기본(`<repoRoot>/.cerebras-explorer/transcripts`).
- 추가 helper: `isTranscriptRawMode()` — `CEREBRAS_EXPLORER_LOG_RAW` truthy 검사.

(2) **callId 도입**:
- `createTranscriptRecorder({ repoRoot, tool, task, logger })`에서 `crypto.randomUUID()`로 `callId` 생성.
- 파일명: `${timestamp}_${tool}_${callId}.jsonl`.
- `record(type, data)` 내부에서 모든 record buffer push 시 `callId` 필드 자동 부여:
  ```javascript
  buffer.push({ t: Date.now(), type, callId, ...data });
  ```
- recorder 반환값에 `callId` 노출 (호출자가 stderr 요약에 포함하기 위함).

(3) **redaction wrapping**:
- `record(type, data)` 직전 redaction 통과. 정책:
  - 기본: `redactValue(data).value`로 통과 (response와 동일한 secret deny-list + 패턴 마스킹).
  - `isTranscriptRawMode()` true일 때만 raw 그대로 통과.
- finalize meta record에 `redacted: <boolean>` 필드 추가.

(4) **단위 테스트** (`tests/transcript.test.mjs` 신규 or 확장):
- T1: `LOG_PATH=...`만 설정 → `isTranscriptEnabled()` true, 파일이 그 경로에 생성.
- T2: `TRANSCRIPT=true`만 설정 → 기존 동작 그대로.
- T3: 둘 다 설정 → LOG_PATH가 우선.
- T4: 둘 다 미설정 → no-op recorder.
- T5: 파일명에 callId(UUID format) 포함.
- T6: 파일 내 모든 record에 동일한 callId 필드.
- T7: 합성 secret 포함 fixture → 기본 모드에서 마스킹 확인.
- T8: `LOG_RAW=true` 설정 → raw 보존 확인.
- T9: finalize meta에 `redacted` 필드 존재.

### Phase 2 — runtime + server wire (C2)

(5) **runtime.mjs `explore()` 메서드에 recorder lifecycle 추가**:
- 현재 `freeExploreV2`에는 있는 패턴을 동일하게 적용:
  ```javascript
  const transcript = createTranscriptRecorder({
    repoRoot, tool: 'explore_repo', task: args.task, logger: this.logger,
  });
  ```
- 각 turn 끝에 assistant/tool 메시지를 `transcript.record(...)` 호출.
- 호출 끝에 `transcript.finalize(stats)` 호출.
- 6 wrapper는 `explore()`에 위임하므로 자동 적용 (wrapper별 별도 작업 불필요).

(6) **finalize meta record 필드 확정**:
- 기본: `tool`, `task`(슬라이스 200자), `repoRoot`, `startedAt`, `pid`, `finishedAt`, `stats` (현행 유지).
- 추가 (spec 018): `redacted`(boolean), `callId`(UUID), `aborted`(boolean, abort 시).
- `stats`에 spec 017에서 추가된 `evidenceSufficiency`도 자연 포함됨 (별도 작업 불필요).

(7) **stderr 한 줄 요약 helper** (`src/mcp/server.mjs`):
- `formatOpsSummary(result, { transcriptPath, raw })` 헬퍼 추가.
- 형식: `[cerebras-explorer] tool=${name} turns=${n} toolCalls=${n} stoppedByBudget=${bool} elapsed=${n}s`
  - `transcriptPath` 있으면 `log=${path}` 추가.
  - `raw === true`이면 `raw=true` 추가.
- `callTool`과 `callFreeExploreTool`의 `finally` 블록 또는 정상 반환 직전에 `process.stderr.write(line + '\n')` 호출.
- 정상/abort/error 어느 경로로 끝나도 한 번 출력 보장.

(8) **단위 테스트 확장**:
- `tests/runtime.mock.test.mjs`: `LOG_PATH=tmp` 설정 + explore_repo 호출 → 파일이 생성됨을 확인. callId 필드 확인.
- `tests/mcp-server.test.mjs`: stderr capture → 한 줄 요약이 출력됨 + stdout JSON-RPC frame 오염 없음.
- `tests/mcp-server.test.mjs`: `LOG_PATH` 설정 시 라인 끝에 `log=` 토큰 포함.
- `tests/mcp-server.test.mjs`: `LOG_RAW=true` 시 라인 끝에 `raw=true` 토큰 포함.

### Phase 3 — 문서 갱신 (C3)

(9) **README.md**:
- `CEREBRAS_EXPLORER_TRANSCRIPT*` 사용자 안내 단락(약 498-500행)을 `CEREBRAS_EXPLORER_LOG_PATH` / `CEREBRAS_EXPLORER_LOG_RAW`로 교체.
- "디버깅 / 관측" envvar 그룹에 새 envvar 두 개 소개.
- `_debug` 제거 단락에서 "transcript JSONL 또는 후속 spec의 local ops log" 표현을 "transcript JSONL (LOG_PATH로 opt-in) + stderr 한 줄 요약"으로 명확화.

(10) **DESIGN.md**:
- §11.7 또는 별도 단락에 "transcript = 운영 디버깅 채널 (spec 018)" 정의 추가.
- callId 정책과 record 구조 한 줄 명시.

(11) **CHANGELOG.md**:
- v0.7.0 (TBD) 항목 추가: "BREAKING (planned): `CEREBRAS_EXPLORER_TRANSCRIPT` / `CEREBRAS_EXPLORER_TRANSCRIPT_DIR` envvar 제거 예정. `CEREBRAS_EXPLORER_LOG_PATH`로 마이그레이션."
- v0.6.1 (현재 진행) 항목 추가: transcript ops log 재정의, `CEREBRAS_EXPLORER_LOG_PATH` / `CEREBRAS_EXPLORER_LOG_RAW` 신규 + stderr 한 줄 요약 항상 출력.

(12) **integrations/**:
- `CEREBRAS_EXPLORER_TRANSCRIPT` grep 후 사용자 안내 부분만 새 envvar로 교체. integrations 예시 파일 자체에는 envvar 노출이 적어 영향 작음.

(13) **integrations.test.mjs 가드**:
- README/DESIGN/integrations 문서에서 `CEREBRAS_EXPLORER_TRANSCRIPT[_A-Z]*` 매치가 CHANGELOG의 deprecation 안내 1곳 외에는 0이 되도록 grep 단위 테스트 추가.

## Complexity Tracking

- **redaction 적용 비용**: `redactValue`는 모든 string에 패턴 매칭. transcript record가 모든 LLM 메시지 + tool args/result를 redact하면 burst 비용이 있을 수 있음. 그러나 transcript는 옵트인이고, 운영 디버깅 채널이 보안 일관성보다 작은 가치라면 분석 시 비활성화하면 됨. 운영 영향은 측정 후 결정. plan은 일관성을 우선.
- **callId record overhead**: 각 record에 36-char UUID 필드 추가 → JSONL line당 ~50 bytes 증가. transcript 파일 크기 1~5% 증가 추정. 무시 가능.
- **stderr 한 줄 요약과 logger 출력 중복**: 기존 `index.mjs`의 `installStdioGuard`가 console.log를 stderr로 redirect. 새 한 줄 요약은 `process.stderr.write`를 직접 호출하므로 중복 위험은 없지만, 동시 호출 시 라인 간 interleaving은 가능. fire-and-forget이라 순서 보장 안 함. 운영 디버깅 용도라 허용.
- **abort/error 경로에서 finalize 보장**: `callTool`의 `finally` 블록에서 transcript.finalize + stderr 요약 모두 호출. 단, runtime이 finalize 도중 throw하면 stderr 요약은 생략될 수 있음. try/catch wrapping으로 두 출력의 독립성 보장.
- **explore_repo의 transcript = freeExploreV2와 동일 패턴**: lifecycle은 기존 freeExploreV2 코드 그대로 복사. 위치는 `_initExploreContext` 직후 + 각 turn 끝 + 마지막 finalize.
- **6 wrapper 자동 적용**: 모두 `explore_repo`에 위임하므로 `explore()`에 recorder 추가만으로 자동 적용. wrapper별 별도 작업 불필요.
- **rollback 단위**: C1/C2 commit 분리로 transcript 자체 변경과 runtime/server 변경을 독립적으로 revert 가능. C3는 코드 미영향이라 revert 부담 최소.

## Out of Scope

- benchmark/transcript-metrics 영향 보강 — 별도 follow-up이 필요할 수 있음(spec 017 fallback 제거의 부수효과). 본 spec은 다루지 않음.
- 기존 `4-byte-hex` 형식 파일의 자동 마이그레이션 — read-only 기록물이라 마이그레이션 제공 안 함. 분석 도구가 두 형식을 모두 인식.
- `CEREBRAS_EXPLORER_LOG_PATH` 외의 추가 envvar(예: rotation, max size) — 운영 정책은 자연 회전(호출별 파일)으로 충분.
- transcript JSONL을 stdout으로 echo하는 옵션 — stdio purity 위반 위험으로 도입 안 함.
- 응답에 `_debug` 재노출 — spec 017 결정과 모순되므로 도입 안 함. 운영 디버깅은 transcript + stderr 요약으로만.
- transcript schema versioning — 현재 single schema, 변경 시 별도 spec에서 다룸.
- prompt improvement 용도 도구 — transcript을 prompt 개선에도 쓸 수 있지만 본 spec은 운영 디버깅 목적에만 집중.

## Phase 0 / 1 Outputs

본 spec은 NEEDS CLARIFICATION이 0개이고 외부 contract 도입이 없는 internal feature이므로, 별도 `research.md`/`data-model.md`/`quickstart.md`/`contracts/` 파일은 생성하지 않는다 (spec 014/015/016/017 plan 패턴과 동일). 다음 정보는 본 plan 안에 통합되어 있다:

- Research 결과 → "파일명 포맷 및 callId 정책" 절 (사용자 의견 + Node `randomUUID()` 결정 + 호환성)
- Data model → spec.md의 "Key Entities" + 본 plan의 "Phase 1 (6) finalize meta record 필드 확정"
- Quickstart → README 갱신 (Phase 3 (9)) 시점에 함께 작성

추후 외부 도구 contract가 필요해지면 별도 follow-up plan으로 추가.
