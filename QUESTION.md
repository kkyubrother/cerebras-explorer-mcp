# QUESTION.md

다른 PC에서 spec 017 구현을 이어갈 때 결정 사항.

## 진행 상황

- `specs/017-remove-debug-and-session/spec.md`, `plan.md`, `tasks.md` 작성 완료.
- 코드 변경은 아직 시작 안 함.
- 사용자 결정 사항 (확정):
  - `_debug` 응답에서 완전 제거.
  - 세션 기능 완전 제거 (입력·응답·SessionStore·tests/session.test.mjs 전부).
  - schemaVersion 1 → 2, breaking 단일 변경.
  - 다음 release는 minor bump(0.6.0).

## 확정된 결정

### A1. Commit 단위 → **Phase 단위 5 commit**

`plan.md`의 8 Phase를 다음 5개 commit으로 묶는다. 각 commit은 빌드/테스트가 통과하는 상태로 끊는다.

| Commit | 범위 | 메시지 prefix |
|---|---|---|
| C1 | Phase 1+2+3 (schemas + runtime + mcp server) | `refactor(spec-017): drop _debug, session, and sessionId from response/input contracts` |
| C2 | Phase 4+5 (session.mjs 삭제, benchmark/critic 정리) | `refactor(spec-017): remove SessionStore module and benchmark fallbacks` |
| C3 | Phase 6 (테스트 갱신) | `test(spec-017): align tests with schemaVersion 2 contract` |
| C4 | Phase 7 (README/DESIGN/CHANGELOG/integrations 문서) | `docs(spec-017): document breaking change and remove session/_debug references` |
| C5 | Phase 8 (version bump + tag + push) | `chore: release v0.6.0` |

근거: C1을 한 덩어리로 가는 이유는 schema와 runtime/server가 어긋나면 모든 테스트가 깨지기 때문. C2부터는 surface가 정합 상태라 단독으로 끊어도 된다.

### A2. Transcript schemaVersion 1/2 호환 → **그대로 두고 분기**

마이그레이션 제공 안 함. 분석 도구가 schemaVersion으로 분기. `spec.md` Edge Cases에 이미 명시되어 있음. 추가 작업 없음.

### A3. Breaking 안내 → **CHANGELOG + GitHub Releases**

- `CHANGELOG.md` 새 release 라인에 BREAKING 항목 명시 (T-081).
- GitHub Releases에 release notes 작성 — `git log v0.5.0..v0.6.0 --oneline` 기반.
- README 상단 경고 박스는 추가하지 않음 (v0.5.0이 단일 사용자 시점이라 과함).

### A4. Release tag sed → **Bash 기준 (GNU sed)**

Windows 환경이라도 Git Bash에서 GNU sed로 일관 처리. `tasks.md` T-096의 sed 명령을 그대로 사용:

```bash
grep -rl "github:kkyubrother/cerebras-explorer-mcp#v0.5.0" README.md integrations/ \
  | xargs sed -i "s|cerebras-explorer-mcp#v0.5.0|cerebras-explorer-mcp#v0.6.0|g"
```

PowerShell 대안은 채택 안 함. 다른 PC가 Linux/macOS여도 동일하게 동작.

### A5. `_debug` 제거 후 운영 디버깅 → **별도 로컬 로그 메커니즘 필요 (후속 spec)**

사용자 결정: "_debug는 어차피 parent agent가 사람에게 보여주지 않으니 응답에 박혀 있어도 운영 디버깅 용도로는 못 쓴다. 운영 디버깅이 필요하면 로컬에 로그를 남기는 별도 메커니즘이 맞다."

본 spec 017 범위에서는 `_debug`를 단순 제거만 한다. **별도 로컬 로그 메커니즘은 spec 018로 분리**한다.

후속 spec 018 (가칭 "explorer local operational log")에서 다룰 후보:

- stderr에 turn 수·tool 호출 횟수·budget 상태를 한 줄 요약으로 출력 (envvar 무관 또는 `CEREBRAS_EXPLORER_OPS_LOG`로 토글).
- 또는 `.cerebras-explorer/ops/*.log` 로테이션 파일로 기록.
- transcript JSONL과의 역할 분리: transcript는 LLM 대화 trace, ops log는 호출 단위 메타 요약.
- MCP stdio 채널은 절대 오염하지 않음 (stdout은 JSON-RPC 전용 보장).

본 spec 017은 이 후속 spec을 차단하지 않으며, 후속 spec에서 `_debug` 복원이 아닌 신규 로그 채널 도입을 전제로 한다.

## 메모

- 본 plan의 모든 파일 라인 번호는 master 기준이다. 다른 PC에서 pull 후 라인이 어긋날 수 있다 — grep으로 식별자 기준 재탐색 권장.
- `SessionStore` 모듈 의존성 잔재가 의외로 깊을 수 있다. T-032/T-033(grep 검증)을 Phase 4 마지막에 돌려 surface를 확인.
- `src/explorer/critic.mjs`가 stats 10건을 본다고 grep에 잡혔는데, 본 spec은 critic이 stats의 비-세션 필드만 본다고 가정. 실제 코드에서 확인 후 가정이 맞으면 T-042는 최소 변경.
- `benchmark/transcript-metrics.mjs`의 `_debug` 의존(grep 1건)은 단순 fallback일 가능성 높지만 직접 확인 필요.
- 본 spec 작업 완료 직후 spec 018(로컬 운영 로그) 초안을 같은 방식으로 작성하는 것이 자연스러운 흐름이다.
