# 테스트 현황

## 최근 확인 환경

- 단위 테스트 실행 일시: 2026-05-11
- Node.js: v24.14.0
- npm: 11.0.0
- OS/셸: Windows / PowerShell
- 통합 테스트: 아래 2026-04-16 기록은 `CEREBRAS_API_KEY`가 설정된 상태에서 실행

## 단위 테스트

```bash
npm test
```

현재 환경에서는 `259 tests`, `258 pass`, `1 skip`, `0 fail`.

- 현재 skip 1건은 Windows 전용 경로 정규화/세션 재사용 테스트입니다.
- `git` 또는 `rg`가 없는 환경, 또는 Windows에서는 추가 skip이 생길 수 있습니다.

## 통합 테스트 (실제 Cerebras API)

```bash
CEREBRAS_API_KEY=<key> node scripts/integration-test.mjs
```

### 최근 실행 결과 (2026-04-16, `zai-glm-4.7`)

| 테스트 | 소요 시간 | 턴 | 도구 호출 | 결과 |
|--------|----------|-----|----------|------|
| explore_repo (quick) | ~5.3초 | 4 | 3 | `confidence=high`, `evidence=4`, `filesRead=2` |
| explore_repo (normal) | ~17.2초 | 14 | 16 | `freeExploreV2` 호출 흐름 정확 추적, `filesRead=9` |
| freeExplore (quick) | ~8.8초 | 10 | 17 | provider 시스템 Markdown 리포트, `filesRead=10` |
| freeExploreV2 (normal) | ~13.1초 | 7 | 19 | 한국어 아키텍처 보고서 15,774자, `toolResultsTruncated=6` |
| tool validation | 별도 계측 없음 | 3 | 2 | `src/index.mjs` 진입점 분석 완료 |

### 검증된 기능

- `explore_repo` quick/normal 경로 모두 정상 동작
- `explore`, `explore_v2` Markdown 보고서 생성 정상 동작
- confidence 계산과 `trustSummary` 출력 정상 동작
- trustSummary: 모든 결과에 자연어 검증 문구 포함
- 결과 포맷: formatExploreResult로 스캔 가능한 텍스트 생성
- tool result budgeting: V2에서 truncation 카운트 정상 기록 (`toolResultsTruncated=6`)
- V2 통계 필드: `llmCompactions`, `toolResultsTruncated`, `outputRecoveries` 모두 정상 노출
- 한국어 출력: language 파라미터 정상 동작
- ERROR RECOVERY 프롬프트: 모델이 에러 시 전략 전환 관찰됨

## 수동 stdio smoke 확인

`src/index.mjs`를 stdio MCP 서버로 직접 기동한 뒤 다음 왕복을 확인했습니다.

- `initialize` 응답 정상
- `tools/list`에서 기본 공개 도구 8개 확인
- `tools/call -> explore_repo` 정상 응답 (`confidence=high`, `sessionId` 반환)

### 미검증 항목 (추가 테스트 필요)

| 항목 | 트리거 조건 | 테스트 방법 |
|------|-----------|-----------|
| **도구 자발적 사용** | Claude Code에서 명시적 지시 없이 도구 선택 | MCP 연결 후 실제 사용 관찰 |
| **부모 모델 재탐색 방지** | 부모 모델이 결과 신뢰하고 동일 파일 재Read 안 함 | Claude Code에서 explore 결과 후 행동 관찰 |
| **LLM 대화 요약** (V2) | context가 70% 임계값 초과 (llmCompactions>0) | deep budget (60턴) 테스트 |
| **Max Output Recovery** (V2) | 보고서가 출력 토큰 한도 초과 (outputRecoveries>0) | 매우 상세한 보고서 요청 |
| **AbortController** | 탐색 중 MCP cancelled 알림 수신 | 탐색 중 Ctrl+C 또는 MCP 취소 |
| **gzip 압축** | 페이로드 32KB 초과 | deep budget에서 자동 트리거 |
| **API retry (네트워크 에러)** | ECONNRESET, ETIMEDOUT 등 발생 | 네트워크 불안정 환경 또는 mock |
| **캐시 mtime 감지** | 탐색 중 파일이 수정됨 | 탐색 도중 파일 수정 후 재읽기 확인 |
| **Transcript 기록** | CEREBRAS_EXPLORER_TRANSCRIPT=true 설정 | 환경변수 설정 후 JSONL 파일 생성 확인 |
| **동시 도구 호출** (실제 API) | Claude Code에서 explore + explore_repo 동시 호출 | MCP 연결 후 병렬 호출 후 두 응답 모두 수신 확인 |

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
