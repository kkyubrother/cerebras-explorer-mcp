# 테스트 현황

## 단위 테스트

```bash
npm test
```

184개 테스트, 183 pass, 1 skip (symlink — 플랫폼 의존).

## 통합 테스트 (실제 Cerebras API)

```bash
CEREBRAS_API_KEY=<key> node scripts/integration-test.mjs
```

### 결과 (2026-04-13, zai-glm-4.7)

| 테스트 | 소요 시간 | 턴 | 도구 호출 | 결과 |
|--------|----------|-----|----------|------|
| explore_repo (quick) | ~7초 | 5 | 7 | confidence=high (0.86), trustSummary 정상 |
| explore_repo (normal) | ~14초 | 7 | 12 | V2 흐름 정확 추적, filesRead=7 |
| freeExplore (quick) | ~4초 | 3 | 6 | 프로바이더 시스템 Markdown 리포트 |
| freeExploreV2 (normal) | ~17초 | 7 | 21 | 한국어 아키텍처 보고서 11,299자, toolResultsTruncated=8 |
| tool validation | ~5초 | 3 | 3 | index.mjs 정확 분석 |

### 검증된 기능

- confidence 보정: base score 상향으로 high (0.86) 정상 달성
- trustSummary: 모든 결과에 자연어 검증 문구 포함
- 결과 포맷: formatExploreResult로 스캔 가능한 텍스트 생성
- tool result budgeting: V2에서 8건 truncation 정상 동작
- 병렬 도구 실행: freeExploreV2에서 턴당 평균 3회 병렬 호출
- 한국어 출력: language 파라미터 정상 동작
- ERROR RECOVERY 프롬프트: 모델이 에러 시 전략 전환 관찰됨

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
