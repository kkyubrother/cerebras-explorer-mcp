# 테스트 현황

## 최근 확인 환경

- 확인 일시: 2026-05-21 03:01 KST
- Node.js: v24.14.1
- npm: 11.11.0
- OS/셸: Linux 6.17.0-23-generic / bash
- 통합 테스트: `CEREBRAS_API_KEY`가 설정된 상태에서 실행

## 단위 테스트

```bash
npm test
```

성공 기준: 현재 checkout에서 `npm test`가 `0 fail`로 종료되어야 합니다.

- 현재 skip 1건은 Windows 전용 경로 재사용 테스트가 Linux 환경에서 제외된 결과입니다.
- `git` 또는 `rg`가 없는 환경, 또는 Windows에서는 skip 수가 달라질 수 있습니다.
- 이 문서의 숫자는 마지막 관측값입니다. 실제 기준은 항상 위 `npm test` 실행 결과입니다.

## 통합 테스트 (실제 Cerebras API)

```bash
CEREBRAS_API_KEY=<key> node scripts/integration-test.mjs
```

### 최근 실행 결과 (2026-05-21, `zai-glm-4.7`)

| 테스트 | 결과 |
|--------|------|
| explore_repo (quick) | 통과 |
| explore_repo (normal) | 통과 |
| freeExplore (quick) | 통과 |
| freeExploreV2 (normal) | 통과 |
| tool validation | 통과 |

전체 기준: 스크립트가 보고하는 모든 케이스가 통과하고 `0 fail`로 종료합니다.

### 검증된 기능

- `explore_repo` quick/normal 경로 모두 정상 동작
- `explore`, `explore_v2` Markdown 보고서 생성 정상 동작
- compact JSON finalization과 repair 경로 정상 동작
- confidence, evidence quality, target/evidence 기반 compact contract 정상 동작
- 결과 포맷: formatExploreResult로 스캔 가능한 텍스트 생성
- tool result budgeting: V2에서 truncation 카운트 정상 기록
- V2 통계 필드: `llmCompactions`, `toolResultsTruncated`, `outputRecoveries` 모두 정상 노출
- 한국어 출력: language 파라미터 정상 동작
- ERROR RECOVERY 프롬프트: 모델이 에러 시 전략 전환 관찰됨

## 수동 stdio smoke 확인

`src/index.mjs`를 stdio MCP 서버로 직접 기동한 뒤 다음 왕복을 확인했습니다.

- `initialize` 응답 정상
- `tools/list` 응답에서 공개 도구 목록이 누락 없이 반환되는 것을 확인
- `tools/call -> explore_repo` 정상 응답 (`confidence=high`, `sessionId` 반환)

### 자동 회귀 가드로 커버된 항목

다음 항목은 단위 테스트에서 트리거 시나리오를 직접 가드하므로 미검증 표에서 제외합니다.

| 항목 | 가드 위치 |
|------|-----------|
| **LLM 대화 요약** (V2 `llmCompactions`) | `tests/runtime.mock.test.mjs` (대형 context로 compaction 강제) |
| **Max Output Recovery** (V2 `outputRecoveries`) | `tests/runtime.mock.test.mjs` (`finishReason='length'` 후 continuation 검증) |
| **API retry** (429/500/ECONNRESET/AbortError/timeout) | `tests/http-client.test.mjs` |
| **gzip 압축** (페이로드 32 KiB 이상) | `tests/cerebras-client.test.mjs` (`content-encoding: gzip` 헤더 + Buffer body 검증) |
| **캐시 mtime 감지** (`repo_read_file` 캐시 무효화) | `tests/repo-tools.test.mjs` (`fs.utimes`로 mtime 변경 후 새 내용 반환 검증) |
| **Transcript JSONL trigger** (`CEREBRAS_EXPLORER_TRANSCRIPT=true` → `transcriptPath` 반환) | `tests/free-explore.test.mjs` |

### 미검증 항목 (추가 테스트 필요)

남은 항목은 모두 외부 parent agent (Claude Code, Codex 등)의 행동 관찰이 필요해 단위 테스트로 자동화하기 어렵습니다. 각 항목별 관찰 절차는 아래 "수동 관찰 절차"를 참고하세요.

| 항목 | 트리거 조건 | 테스트 방법 |
|------|-----------|-----------|
| **도구 자발적 사용** | Claude Code에서 명시적 지시 없이 도구 선택 | MCP 연결 후 실제 사용 관찰 |
| **부모 모델 재탐색 방지** | 부모 모델이 결과 신뢰하고 동일 파일 재Read 안 함 | Claude Code에서 explore 결과 후 행동 관찰 |
| **AbortController** | 탐색 중 MCP cancelled 알림 수신 | 탐색 중 Ctrl+C 또는 MCP 취소 |
| **동시 도구 호출** (실제 API) | Claude Code에서 explore + explore_repo 동시 호출 | MCP 연결 후 병렬 호출 후 두 응답 모두 수신 확인 |

### 수동 관찰 절차

각 미검증 항목을 실측할 때 따를 단계와 기대 신호. 한 번 실측한 결과는 이 문서에 기록하지 않습니다 (점-시간 증거이고 다음 변경에서 곧 stale 됨). 회귀가 의심될 때마다 다시 따라 합니다.

**1. 도구 자발적 사용**
1. README의 `Claude Code 연결 예시` 절차로 MCP 서버를 등록한다 (`claude mcp add -s user cerebras-explorer ...`).
2. Claude Code 세션에서 도구 이름을 언급하지 않은 자연어 질문을 던진다: 예) "이 저장소의 인증 흐름을 설명해줘".
3. **기대**: parent 모델이 `explore_repo` 또는 `explore` 중 하나를 자동 호출하고, 자체 `Grep`/`Read` 반복으로 답을 만들지 않는다.
4. **fail 신호**: parent가 explorer 도구를 한 번도 호출하지 않거나, 도구 호출 직전/직후에 동일 파일을 native `Read`로 다시 읽는다.

**2. 부모 모델 재탐색 방지**
1. 1번 절차로 explorer 응답을 받은 직후 같은 세션에서 후속 질문: 예) "그러면 `requireAuth`가 어디에 붙는지 정확한 라인 알려줘".
2. **기대**: parent가 explorer 응답의 `targets[]` / `evidence[]` / `citations[]` 정보를 그대로 사용하고, 동일 파일을 다시 `Read`하거나 `Grep`하지 않는다.
3. **fail 신호**: parent가 `result.targets[].path`를 무시하고 native `Read`로 같은 파일을 다시 열어 라인 검색한다 — explorer 응답의 신뢰 계약이 깨진 신호.

**3. AbortController (MCP cancelled)**
1. deep 호출이 예상되는 무거운 질문을 던진다: 예) "전체 라우팅 구조를 모든 미들웨어 포함해서 깊게 분석해줘".
2. 탐색 도중 (turn 5–15 즈음, `_meta.progressToken` 진행률을 보면서) MCP cancellation을 트리거한다 (Claude Code: `Esc`, 또는 다른 클라이언트의 동등 명령).
3. **기대**: 서버가 진행 중인 chat completion fetch를 abort하고, 응답에 `stoppedByAbort=true` 또는 `buildCancelledReport()` 본문을 반환한다.
4. **fail 신호**: cancellation 후에도 서버가 끝까지 돌아 정상 결과를 반환하거나, 프로세스가 좀비처럼 남는다.

**4. 동시 도구 호출**
1. parent agent에 두 개 이상 도구 호출을 동시에 시키는 메시지를 보낸다: 예) "`explore`로 인증 구조 설명하면서 동시에 `explore_repo`로 라우터 변경 영향도 분석해줘".
2. **기대**: 두 호출이 모두 응답을 반환하고, 한쪽이 다른 쪽을 차단(serialize)하지 않는다. 두 응답의 `sessionId`는 서로 다르며 각자 grounded evidence를 가진다.
3. **fail 신호**: 한쪽 호출이 다른 쪽 완료까지 대기하거나, 두 응답의 `sessionId`가 충돌해서 reuse 동작이 어긋난다.

## Cerebras API 에러 코드 참조

https://inference-docs.cerebras.ai/api-reference/error-codes

| 코드 | 유형 | retry 여부 |
|------|------|-----------|
| 400 | BadRequestError | X |
| 401 | AuthenticationError | X |
| 402 | PaymentRequired | X |
| 403 | PermissionDeniedError | X |
| 404 | NotFoundError | X |
| 408 | Request Timeout | O (자동 retry) |
| 422 | UnprocessableEntityError | X |
| 429 | RateLimitError | O (exponential backoff + Retry-After) |
| 500 | InternalServerError | O |
| 502 | Bad Gateway | O |
| 503 | ServiceUnavailable | O |
| 504 | Gateway Timeout | O |
| N/A | APIConnectionError (네트워크) | O (ECONNRESET, ETIMEDOUT 등) |

기본 timeout: 60초 (환경변수 `CEREBRAS_EXPLORER_HTTP_TIMEOUT_MS`로 변경 가능).
기본 retry: 최대 2회, exponential backoff (500ms base, 25% jitter, 최대 32초).
