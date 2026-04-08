# Phase 5: 개발자 경험 (DX)

## 5.1 인터랙티브 모드 — P3

**목표:** 단발성 탐색이 아닌 대화형 심층 탐색 지원

### 현재 문제

- 1회 호출 → 1회 응답의 stateless 구조
- 첫 탐색 결과가 불충분하면 parent model이 처음부터 다시 탐색해야 함
- 이전 탐색에서 발견한 파일/심볼 정보가 소실됨

### 세션 기반 탐색

```json
// 첫 번째 호출
{
  "task": "인증 시스템 아키텍처 분석",
  "budget": "quick"
}
// → 세션 ID 반환: "session_abc123"

// 후속 호출 (이전 결과 기반으로 확장)
{
  "task": "JWT 토큰 검증 로직을 더 깊이 분석",
  "session": "session_abc123",  // 이전 세션 참조
  "budget": "normal"
}
```

### 구현 방향

1. **세션 저장소**: 메모리 기반 Map, 세션별 탐색 결과 누적
2. **자동 hints 주입**: 이전 세션의 `candidatePaths`, `evidence`를 다음 호출의 hints로 자동 추가
3. **컨텍스트 유지**: 이전 세션의 핵심 발견사항을 system prompt에 요약 포함
4. **세션 만료**: 30분 TTL 또는 최대 5회 호출

### 가치
- parent model이 "더 깊이 파봐"라고 하면 이전 결과 기반으로 효율적 확장
- 점진적 탐색: quick → normal → deep으로 단계적 심화

---

## 5.2 진행 상황 리포팅 — P3

**목표:** 긴 탐색 중 parent model에게 실시간 진행 상황 전달

### MCP 진행 알림

```json
// notifications/progress (MCP 프로토콜)
{
  "jsonrpc": "2.0",
  "method": "notifications/progress",
  "params": {
    "progressToken": "explore_abc123",
    "progress": 3,
    "total": 10,
    "message": "Turn 3/10: found 5 files matching pattern, reading auth.js..."
  }
}
```

### 턴별 진행 메시지 예시

```
Turn 1/10: listing directory structure...
Turn 2/10: found 12 JS files, grepping for 'handleAuth'...
Turn 3/10: 3 matches found, reading src/auth.js (lines 15-45)...
Turn 4/10: reading src/middleware/auth.js (lines 1-80)...
Turn 5/10: synthesizing findings...
```

### 구현

```javascript
// runtime.mjs 수정
async explore(args, { onProgress }) {
  for (let turn = 0; turn < maxTurns; turn++) {
    // 도구 호출 전 진행 알림
    if (onProgress) {
      onProgress({
        progress: turn,
        total: maxTurns,
        message: this._describeTurn(turn, toolCalls)
      });
    }
    // ... 기존 로직
  }
}
```

### 가치
- parent model이 사용자에게 중간 상태를 보여줄 수 있음
- deep budget (16턴)에서 "멈춘 건 아닌지" 불안 해소

---

## 5.3 프로젝트별 설정 파일 — P3

**목표:** 레포별 맞춤 설정으로 탐색 품질 향상

### 설정 파일 위치

레포 루트의 `.cerebras-explorer.json` 또는 `.cerebras-explorer.yaml`

### 설정 스키마

```json
{
  // 기본 탐색 설정
  "defaultBudget": "normal",
  "defaultScope": ["src/**"],
  
  // 추가 제외 디렉토리 (기본 제외 + 이것)
  "extraIgnoreDirs": ["generated", "proto", "vendor"],
  
  // 프로젝트 주요 언어 (심볼 분석 우선순위)
  "languages": ["typescript", "python"],
  
  // 커스텀 심볼 패턴 (tree-sitter 미지원 언어/DSL용)
  "customSymbolPatterns": {
    "graphql": "type\\s+(\\w+)\\s*\\{",
    "proto": "message\\s+(\\w+)\\s*\\{"
  },
  
  // 프로젝트 컨텍스트 (system prompt에 주입)
  "projectContext": "이 프로젝트는 MCP 서버로, Cerebras API를 사용한 자율적 코드 탐색 도구입니다.",
  
  // 엔트리포인트 힌트
  "entryPoints": ["src/index.mjs"],
  
  // 중요 파일 (아키텍처 질문 시 우선 탐색)
  "keyFiles": [
    "src/explorer/runtime.mjs",
    "src/mcp/server.mjs"
  ]
}
```

### 로딩 우선순위

1. 함수 호출 인자 (최우선)
2. `.cerebras-explorer.json` (레포 루트)
3. 환경변수
4. 하드코딩된 기본값

### 구현

```javascript
// config.mjs 확장
export async function loadProjectConfig(repoRoot) {
  const configPath = path.join(repoRoot, '.cerebras-explorer.json');
  try {
    const raw = await fs.readFile(configPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};  // 설정 파일 없으면 기본값 사용
  }
}
```

### 가치
- 모노레포에서 `defaultScope`로 관련 패키지만 탐색
- `projectContext`로 모델에게 프로젝트 배경 제공 → 더 정확한 답변
- `keyFiles`로 아키텍처 질문 시 빠른 진입점 제공
