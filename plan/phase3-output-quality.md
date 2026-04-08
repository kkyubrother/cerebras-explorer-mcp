# Phase 3: 출력 품질 향상 (Output Quality) ✅ 완료 (2026-04-08)

> **구현 완료.** 아래 각 섹션 끝에 실제 구현 결과를 기록함.

## 3.1 다층적 출력 포맷 — P2

**목표:** 소비자(parent model)에게 최적화된 구조화 정보 전달

### 현재 출력 스키마 확장

기존 필드 (`answer`, `summary`, `confidence`, `evidence`, `candidatePaths`, `followups`, `stats`)에 추가:

#### `codeMap` — 코드 구조 맵

```json
{
  "codeMap": {
    "entryPoints": ["src/index.mjs"],
    "keyModules": [
      {
        "path": "src/explorer/runtime.mjs",
        "role": "핵심 탐색 루프",
        "exports": ["ExplorerRuntime"],
        "linesOfCode": 302
      }
    ],
    "dependencies": [
      {
        "from": "runtime.mjs",
        "to": "cerebras-client.mjs",
        "type": "import",
        "symbols": ["CerebrasChatClient"]
      }
    ]
  }
}
```

생성 조건: 아키텍처/구조 관련 질문일 때만 포함

#### `diagram` — Mermaid 다이어그램

```json
{
  "diagram": "graph TD\n  A[index.mjs] --> B[server.mjs]\n  B --> C[runtime.mjs]\n  C --> D[cerebras-client.mjs]\n  C --> E[repo-tools.mjs]"
}
```

생성 조건: 의존성/흐름 관련 질문일 때 포함. parent model이 사용자에게 시각적으로 렌더링 가능.

#### `recentActivity` — 변경 이력 요약 (git 도구 필요)

```json
{
  "recentActivity": {
    "hotFiles": [
      "src/explorer/runtime.mjs (12 commits / 30 days)"
    ],
    "recentAuthors": ["kkyubrother"],
    "lastModified": "2026-04-07",
    "recentCommits": [
      {"hash": "459f8ab", "message": "docs: document NDJSON transport support", "date": "..."}
    ]
  }
}
```

생성 조건: git 도구를 사용한 탐색일 때 자동 포함

### ✅ 구현 결과 (3.1)

- **`codeMap`**: `buildCodeMap(observedRanges)` — 탐색 중 읽은 파일에서 자동 생성. `entryPoints`(index/main/app/server 패턴), `keyModules`(path, role, linesRead). `dependencies` 필드는 import 파싱이 필요해 현재 미포함(추후 tree-sitter 도입 시 확장).
- **`diagram`**: `buildMermaidDiagram(codeMap)` — 2–12 모듈 범위에서만 생성. breadth-first 전략 또는 strategy 미지정 시 자동 포함. entry point는 `[[이중 대괄호]]`, 나머지는 `[단일]` 노드.
- **`recentActivity`**: `buildRecentActivity(capturedGitLogs)` — `repo_git_log` 호출 결과를 캡처하여 `hotFiles`, `recentAuthors`, `lastModified`, `recentCommits` 구성. git이 없는 디렉토리에서는 `null`(필드 생략).

---

## 3.2 신뢰도(Confidence) 개선 — P2

**목표:** evidence grounding을 더 정교하게

### 현재 방식

- 읽지 않은 라인 범위의 evidence → 제거
- evidence가 제거되면 confidence → "low" 강등
- "high/medium/low" 3단계

### 개선 방향

#### 연속 신뢰도 점수
```json
{
  "confidence": 0.85,
  "confidenceLevel": "high",
  "confidenceFactors": {
    "evidenceCount": 4,
    "evidenceGrounded": 4,
    "crossVerified": true,
    "searchCoverage": 0.9,
    "explanation": "4개의 독립적 증거가 모두 grounded되었고, 2개의 다른 파일에서 교차 검증됨"
  }
}
```

#### 신뢰도 계산 규칙

| 조건 | 점수 영향 |
|------|-----------|
| evidence 전부 grounded | +0.2 |
| 다중 독립 evidence 교차 검증 | +0.15 |
| scope 전체를 탐색함 | +0.1 |
| 심볼 기반 탐색 사용 | +0.05 |
| evidence 일부 제거됨 | -0.3 |
| budget 소진으로 조기 종료 | -0.2 |
| 단일 evidence만 존재 | -0.1 |

#### 부분 일치 허용

현재: 읽은 범위와 정확히 겹치지 않으면 evidence 제거

개선: 1-2줄 차이는 경고 표시 후 유지
```json
{
  "evidence": [
    {
      "path": "src/auth.js",
      "startLine": 15,
      "endLine": 20,
      "why": "handleAuth 함수 정의",
      "groundingStatus": "partial",
      "groundingNote": "읽은 범위: 14-22, 1줄 오프셋"
    }
  ]
}
```

### ✅ 구현 결과 (3.2)

- **연속 신뢰도 점수**: `computeConfidenceScore(groundedEvidence, totalBefore, stats)` → `{score, level, factors}`. Base=0.5, 규칙에 따라 ±조정, [0,1] 클램핑.
- **`confidenceScore`** (숫자), **`confidenceLevel`** (low/medium/high), **`confidenceFactors`** (`evidenceCount`, `evidenceDropped`, `crossVerified`, `symbolSearchUsed`, `stoppedByBudget`, `adjustments` 배열) 모두 반환값에 포함.
- **모델 보고값 하향 조정**: 계산된 `confidenceLevel`이 모델 보고값보다 낮으면 `confidence` 필드를 하향 조정.
- **부분 일치 허용**: `EVIDENCE_LINE_TOLERANCE = 2`. `checkEvidenceGrounding()` — exact/partial/없음 3단계. partial은 `groundingStatus: "partial"` 플래그 후 유지, exact는 `groundingStatus: "exact"`. 범위 밖은 제거.

계산 규칙 (계획 대비 구현):
| 조건 | 계획 | 실제 |
|------|------|------|
| evidence 전부 grounded | +0.2 | ✅ +0.20 |
| 다중 파일 교차 검증 | +0.15 | ✅ +0.15 |
| scope 전체 탐색 | +0.1 | 미구현 (측정 어려움) |
| 심볼 기반 탐색 (grep) | +0.05 | ✅ +0.05 |
| evidence 일부 제거 | -0.3 | ✅ -0.30 |
| budget 소진 | -0.2 | ✅ -0.20 |
| 단일 evidence | -0.1 | ✅ -0.10 |

---

## 3.3 후속 탐색 제안 지능화 — P2

**목표:** `followups`를 단순 텍스트에서 실행 가능한 호출로 변환

### 현재
```json
{
  "followups": [
    "인증 미들웨어의 에러 핸들링 패턴을 더 분석해보세요"
  ]
}
```

### 개선
```json
{
  "followups": [
    {
      "description": "인증 미들웨어의 에러 핸들링 패턴 분석",
      "priority": "recommended",
      "suggestedCall": {
        "task": "Analyze error handling patterns in auth middleware",
        "scope": ["src/middleware/auth*"],
        "budget": "normal",
        "hints": {
          "symbols": ["handleAuthError", "AuthMiddleware"],
          "strategy": "pattern-scan"
        }
      }
    },
    {
      "description": "JWT 토큰 검증 로직의 보안 검토",
      "priority": "optional",
      "suggestedCall": {
        "task": "Review JWT token verification for security issues",
        "scope": ["src/auth/**", "src/middleware/**"],
        "budget": "deep",
        "hints": {
          "symbols": ["verifyToken", "validateJWT"],
          "regex": ["jwt\\.verify", "token.*expir"]
        }
      }
    }
  ]
}
```

### 가치
- parent model이 사용자에게 "더 조사할까요?" 제안 시 바로 실행 가능
- 탐색 연속성 보장: 이전 탐색 결과를 기반으로 다음 탐색 최적화

### ✅ 구현 결과 (3.3)

- **`EXPLORE_RESULT_JSON_SCHEMA.followups`**: `string[]` → 구조화된 객체 배열로 변경. 각 항목: `{description, priority: "recommended"|"optional", suggestedCall: {task, scope, budget, hints: {symbols, strategy}}}`.
- **Legacy 호환**: `normalizeFollowupItem()` — string 타입 followup은 자동으로 `{description, priority: "optional", suggestedCall: null}` 형태로 정규화.
- **프롬프트 업데이트**: system prompt의 Final JSON shape에 followups 구조화 포맷 가이드 추가. `buildFinalizePrompt()`에 structured followup 예시 포함.
- **`suggestedCall.hints.strategy`**: 6개 전략 중 하나를 명시하도록 모델에 가이드.
