# HANDOFF — production-readiness 감사 + deny-list 대소문자 수정/되돌림 (v0.8.7 → v0.8.8)

**작성**: 2026-06-14 세션 (대화형 — 사용자 동석)
**상태**: **종결 (2026-06-14)** — v0.8.8 릴리스 완료(tag + GitHub release, CI success). master clean, 462/462.
**이전 핸드오프**: spec 026(trace_symbol cross-check, 종결 2026-06-12)는 git 이력에 보존 — `git log -- HANDOFF.md` 또는 `git show 076d323:HANDOFF.md`.

이 문서는 이번 세션의 (a) production-readiness 감사 결과, (b) 거기서 파생된 deny-list 수정과 *되돌림*의 판단·근거, (c) 감사가 식별했지만 의도적으로 보류/드롭한 항목을 기록합니다.

---

## 1. 무엇을 했나 (요약)

| 단계 | 커밋/산출 | 결과 |
|---|---|---|
| Production-readiness 감사 | (워크플로우, 무커밋) | 8차원 × 14 agents, 갭 적대 검증. **배포 모델 기준 production-grade** (7/8 ready, 1 minor-gaps) |
| deny-list 대소문자 수정 | `ac3ae17` | `security.mjs` deny-list에 regex `i` 플래그 — `.ENV`/`Secret.PEM` 케이스 변형 우회 차단 (TDD red→green) |
| v0.8.7 릴리스 | `0ad9207` | 16개 버전 ref 동기화 + CHANGELOG + tag + GitHub release |
| **되돌림** | `580ff9d` | `git revert ac3ae17` — deny-list를 다시 **case-sensitive**로 (코드+테스트 복원) |
| v0.8.8 릴리스 | `2223f91` | 16개 ref v0.8.8 동기화 + CHANGELOG(revert 사유) + tag + GitHub release |

**커밋 그래프**: `ac3ae17 fix → 0ad9207 (v0.8.7) → 580ff9d revert → 2223f91 (v0.8.8)`.
**최종 상태**: 최신 태그 **v0.8.8 = case-sensitive deny-list**(v0.8.6과 동일 동작). v0.8.7은 이력에 보존(forward-only, 삭제 안 함).

---

## 2. Production-readiness 감사 결과

**방법**: ultracode 워크플로우 — 8개 차원 각각 Explore agent가 실제 코드를 읽어 구조화 평가, medium+/배포관련 갭은 두 번째 agent가 "반박하라" 지시로 적대 검증(가짜 갭 배제).

**총평: 이 배포 모델(상위 AI가 spawn하는 로컬 read-only stdio 서브프로세스) 기준 production-grade.** "production을 막는다"고 플래그된 갭이 검증에서 전부 무너졌고, Content-Length 버퍼 갭은 사실무근으로 반박됨.

| 차원 | 판정 |
|---|---|
| 장애 처리/복원력 | ✅ ready (AbortController 타임아웃, 지수 백오프+Retry-After, failover, 3-turn 서킷브레이커, JSON 복구) |
| 보안/데이터 노출 | ✅ ready (path traversal 다층 차단, 117패턴 deny-list, redact, API키 비로깅) |
| 자원/비용 안전 | ✅ ready (30-iter 캡, 512KB/256KB 한도, 70% compaction) |
| MCP 프로토콜/IO | ✅ ready (Content-Length+NDJSON, stdout 순수성, 프레임 resync) |
| 테스트 품질 | ✅ ready (복구/서킷/심링크탈출/시크릿필터 실측, 실서버 E2E) |
| 관측성/운영 | ✅ ready (구조화 에러 + MCP 실패계약 + stderr 스냅샷 + JSONL transcript) |
| 릴리스/CI | ⚠️ minor-gaps (단일 Node22/단일 OS — 블로커 아님) |
| 핵심 가치(근거성) | ✅ ready (citation 결정적 재검증, critic 환각 강등, 벤치 독립 재검증) |

추가 신호: 소스 ~10.7K LOC에 TODO/FIXME/HACK **0개**, 런타임 의존성 0개.

---

## 3. 자율/협의 판단과 근거

### 판단 1 — deny-list 수정을 confined하게 (security.mjs만)

- **상황**: `globToRegExp`가 `security.mjs`(deny-list 전용)와 `repo-tools.mjs`(scope/`findFiles`/ignore 매칭) **두 벌** 존재.
- **결정**: `i` 플래그를 `security.mjs:40`에만 추가. `repo-tools.mjs`의 것은 case-sensitive 유지.
- **근거**: repo-tools 쪽을 case-insensitive로 바꾸면 case-sensitive FS(Linux)에서 정상 검색/스코프 의미가 달라짐(`Foo.js`가 `foo.js` 패턴에 매치). 보안 패치에 행위 변경을 섞지 않음. 격리 확인 + 과차단 방지 negative 테스트(`SecretsManager.ts` 등) 통과.

### 판단 2 — 되돌리기 (case-insensitive → case-sensitive)

- **상황**: v0.8.7 릴리스 후 사용자가 case-sensitive로 되돌리기를 요청.
- **결정**: 되돌림 + v0.8.8 릴리스.
- **근거(검증됨)**: 주 배포 환경이 case-sensitive FS(Linux). 거기선 case-sensitive 매칭이 **더 정밀** — `Secrets/` 디렉터리, `Deck.KEY` Keynote, `Credentials.JSON` 같은 정상 파일을 false-positive로 스킵하지 않음. v0.8.7이 닫은 변형 우회는 case-insensitive FS(macOS/Windows)에서만 의미 있었고 이는 배포 범위 밖. 좁은 보호를 정밀도·동작 안정성과 맞바꿈.

### 판단 3 — 릴리스 방식: forward-only (v0.8.7 삭제 대신 v0.8.8)

- **결정**: v0.8.7 태그/릴리스를 **삭제하지 않고** master에서 되돌린 뒤 v0.8.8로 릴리스. (사용자 선택)
- **근거**: 비파괴적. 누가 이미 `#v0.8.7`을 받았어도 안 깨짐. 커밋 그래프가 의도(수정→되돌림)를 정직하게 기록.

---

## 4. 감사가 식별한 항목 — 보류/드롭 결정 (블로커 아님)

전부 "더 단단하게"이지 "준비도 미달"이 아니며, **사용자 검토 후 드롭/보류**됨. 후속 TODO로 박지 말 것:

1. **CI 매트릭스** — 단일 `ubuntu × Node22`. **드롭 결정.** 근거: 주 환경이 Linux+Node22. macOS는 GH Actions `macos-latest`(퍼블릭 repo 무료)로 *기술적으론 가능*하나 실익 낮음(POSIX 동일, 심링크 테스트는 macOS에선 안 skip되어 그냥 통과, 유일 차이인 case-insensitive FS를 현 테스트가 안 건드림). Windows 심링크 skip은 정당(`fs.symlink` 권한 필요 + Git for Windows `core.symlinks=false` 기본). git/ripgrep skip은 가용성 가드일 뿐 로컬/CI에서 돈다.
2. **Action SHA 핀** — `checkout@v4`/`setup-node@v4` 부유 태그. 공급망 강화 후보(선택, minor).
3. **벨트-앤-서스펜더(선택)** — 시작 시 API키 fail-fast 검증, `.cerebras-explorer.json` 파싱오류 표면화(현재 silent default), Content-Length 상한 가드. 검증단에서 "있으면 좋지만 현재 위험 아님"으로 판정.

### 의도된 절제 (체크리스트 반사로 손대지 말 것)

- **커버리지툴/lint/TypeScript 없음** — zero-dep 미니멀리즘. 462 테스트가 경험적 커버리지 제공.
- **regex-lite 심볼 인덱싱**(tree-sitter 아님) — 문서화된 의도적 한계, zero-dep 유지용.
- **텔레메트리/알림 서버 없음, 수동 릴리스** — 로컬 subprocess + 솔로 + tag 배포에 맞는 선택.

---

## 5. 후임자 주의

- **deny-list는 v0.8.8 기준 의도적으로 case-sensitive.** 향후 `security.mjs`와 `repo-tools.mjs`의 두 `globToRegExp`를 "중복 제거"로 합치면 동작이 바뀐다 — security 쪽 case-sensitive 의도가 깨지지 않도록 주의(이번 세션 ac3ae17→580ff9d 왕복의 원인).
- **감사는 코드 기반(static).** 라이브 provider 상대 타임아웃/429/대형 repo 카오스 테스트는 미실행 — 마지막 1% 확신이 필요하면 관측하 스모크 테스트가 유일하게 남는 검증.

---

## 6. 검증 재현

```bash
npm test                                    # 462 pass / 0 fail / 0 skip (git+ripgrep 있는 환경)
node ./scripts/integration-test.mjs         # 실 API (CEREBRAS_API_KEY 필요)
git log --oneline -4                         # ac3ae17 → 0ad9207 → 580ff9d → 2223f91
git describe --tags --exact-match HEAD       # v0.8.8
sed -n '40p' src/explorer/security.mjs       # case-sensitive 확인 (i 플래그 없음)
```
