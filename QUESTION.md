# QUESTION.md

다른 PC에서 spec 017 구현을 이어갈 때 결정이 필요한 항목.

## 진행 상황

- `specs/017-remove-debug-and-session/spec.md`, `plan.md`, `tasks.md` 작성 완료.
- 코드 변경은 아직 시작 안 함.
- 사용자 결정 사항(2026-05-26 대화 기준):
  - `_debug` 응답에서 완전 제거.
  - 세션 기능 완전 제거 (입력·응답·SessionStore·tests/session.test.mjs 전부).
  - schemaVersion 1 → 2, breaking 단일 변경.
  - 다음 release는 minor bump(0.6.0).

## 결정이 필요한 항목

### Q1. 단일 commit vs Phase 단위 commit?

`spec.md`의 Assumptions에는 "단일 PR + 단일 commit"으로 적었지만, plan.md의 Complexity Tracking에는 Phase 단위 commit이 rollback 단위가 작아진다는 점도 적어두었다.

- **단일 commit**: PR 리뷰는 쉽지만 bisect/rollback 단위가 큼.
- **Phase 단위 8 commit**: 각 phase가 단독 빌드 가능(Phase 1 schema → Phase 2 runtime → ...)하지만 Phase 1 commit만 main에 들어가면 schema-runtime 불일치로 잠시 깨짐.

**추천**: Phase 1+2+3 한 commit (schema + runtime + server), Phase 4+5 한 commit (모듈/벤치마크 정리), Phase 6 한 commit (테스트), Phase 7 한 commit (문서), Phase 8 한 commit (버전 bump + tag) — 5개 commit. Phase 1만 들어가면 빌드는 되지만 runtime이 schema와 어긋나 테스트 깨짐. Phase 1+2+3을 묶으면 안전.

다른 PC에서 진행할 때 commit 단위를 어떻게 잡을지 결정 부탁.

### Q2. transcript 호환성 명시?

기존 `.cerebras-explorer/transcripts/*.jsonl`에 schemaVersion 1로 기록된 레코드가 있을 수 있다. 본 spec은 마이그레이션 제공 안 함. 그러나 transcript 파싱 도구가 새로 도입된다면 schemaVersion에 분기를 해야 할 수 있다.

- **Option A**: spec.md Edge Cases에 명시한 대로 그대로 둠 (분석 도구가 schemaVersion으로 분기). 추가 작업 없음.
- **Option B**: transcript writer가 schemaVersion 1 레코드를 자동으로 회전(rotate)해서 새 transcript는 schemaVersion 2만 갖도록. 구현 추가.

**추천**: Option A. 본 spec 범위 밖 작업.

### Q3. 다른 사용자에게 breaking 안내?

본인 외 사용자가 session multi-call을 production에서 쓰는지 알 길이 없다. v0.5.0이 npm publish가 아직 안 됐고 GitHub tag 기반 npx 설치만 안내된 상태이므로, breaking 사용자가 적을 가능성이 높다. 그래도 명시적 안내를 어디까지 할지:

- **Option A**: CHANGELOG의 BREAKING 항목 + README의 새 버전 릴리즈 안내문구.
- **Option B**: Option A + GitHub Releases에 release notes 별도 작성.
- **Option C**: Option B + README 상단에 "v0.6.0+은 v0.5.x와 응답 contract 호환 안 됨" 경고 박스.

**추천**: Option B. v0.5.0이 아직 단일 사용자 시점이라 Option C는 과함.

### Q4. release tag 갱신 sed 명령의 OS 호환성?

`tasks.md`의 T-096이 README의 release 절차를 따라 `sed -i`로 v0.5.0 → v0.6.0 치환을 권하지만, 본 작업이 Windows에서 진행 중이라면 `sed -i` 문법이 다르다 (GNU sed: `sed -i`, BSD sed: `sed -i ''`, PowerShell: `(Get-Content ...) -replace ... | Set-Content ...`).

- **Option A**: Git Bash에서 GNU sed 사용 (Windows에 `Git for Windows` 설치되어 있으면 가능).
- **Option B**: PowerShell의 `Get-Content | Set-Content`로 대체.
- **Option C**: Node 스크립트(`scripts/bump-version.mjs` 같은 것)로 일관 처리.

**추천**: Option B (Windows 환경 가정). 추가 스크립트 없이 PowerShell 한 줄로 처리.

### Q5. `_debug` 제거 후 stdio JSON-RPC 로그가 부족하지 않을까?

`_debug.stats`/`_debug.toolTrace`가 사라지면 운영 디버깅 시 응답만 보고는 turn 수·tool 호출 횟수를 알 수 없다. 다음 옵션 검토 필요.

- **Option A**: 그대로 두고 디버깅은 transcript JSONL로만 대응. (`CEREBRAS_EXPLORER_TRANSCRIPT=true`)
- **Option B**: stderr에 운영 메타데이터 한 줄 요약을 항상 출력 (envvar 무관). MCP stdio 채널은 안 오염, 사용자가 로그로 확인.
- **Option C**: envvar로 `_debug`를 옵트인 응답 필드로 노출 (사용자 첫 답변의 옵션 3과 유사).

**추천**: Option A. Option C는 사용자가 명시적으로 거부한 선택지. Option B는 작업이 늘어남.

## 메모

- 본 plan의 모든 파일 라인 번호는 2026-05-26 master 기준이다. 다른 PC에서 pull 후 라인이 어긋날 수 있다 — grep으로 식별자 기준 재탐색 권장.
- `SessionStore` 모듈 의존성 잔재가 의외로 깊을 수 있다. T-032/T-033을 가장 먼저 돌려서 surface를 확인하면 좋다.
- `src/explorer/critic.mjs`가 stats 10건을 본다고 grep에 잡혔는데, 본 spec은 critic이 stats의 비-세션 필드만 본다고 가정. 실제 코드에서 확인 후 가정이 맞으면 T-042는 최소 변경.
- `benchmark/transcript-metrics.mjs`의 `_debug` 의존(grep 1건)은 실제로 봤을 때 단순 fallback일 가능성이 높지만, 직접 확인이 필요.
