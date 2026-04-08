# Explorer Mode — Claude Code Explorer 스타일 탐색 기능

Last updated: 2026-04-08

## 배경

Claude Code의 `Explore` 에이전트는 자연어 프롬프트를 받아 코드베이스를 자율적으로 탐색하고 종합된 자연어 리포트를 반환한다. 현재 cerebras-explorer의 `explore_repo`도 유사한 구조이지만, Claude Code Explorer가 보여주는 몇 가지 패턴은 아직 지원하지 않는다.

### Claude Code Explorer 핵심 특성 (실제 로그 분석)

1. **풍부한 자연어 프롬프트**: "Read all plan documents", "Check whether all implementation work is properly reflected" 등 구체적이고 상세한 지시를 그대로 수행
2. **Thoroughness 레벨**: `quick` / `medium` / `very thorough` 로 탐색 깊이 제어
3. **자유로운 도구 조합**: Read, Bash, Glob, Grep을 상황에 맞게 유연하게 조합
4. **병렬 도구 실행**: 독립적인 도구 호출을 동시에 실행 (예: 7개 파일을 한 번에 Read)
5. **에러 복구**: EISDIR 에러 → ls로 fallback 등 graceful degradation
6. **자연어 리포트**: JSON 스키마가 아닌 서술형 분석 결과 반환
7. **전략 미지정**: 사전 정의된 전략 없이 프롬프트 내용에 따라 자유롭게 탐색

### 현재 cerebras-explorer와의 갭

| 항목 | Claude Code Explorer | cerebras-explorer 현재 |
|------|---------------------|----------------------|
| 탐색 깊이 제어 | thoroughness (quick/medium/very thorough) | budget (quick/normal/deep) — 유사하나 의미 다름 |
| 탐색 전략 | 자유 (프롬프트 기반) | 6개 사전 정의 전략 (자동 감지) |
| 도구 실행 | 병렬 가능 | 순차 실행 |
| 출력 형식 | 자연어 리포트 | 구조화된 JSON |
| 에러 처리 | fallback 패턴 | 단순 에러 반환 |
| 프롬프트 유연성 | 완전 자유형 | 전략 기반 구조화 |

## 제안: Explorer Mode

기존 `explore_repo`의 구조화된 탐색과 별도로, **자유형 탐색 모드**를 추가한다.

### 핵심 설계 원칙

1. `explore_repo`와 공존 — 기존 기능을 변경하지 않음
2. 자연어 입출력 — JSON 스키마 강제 없이 서술형 응답 허용
3. Thoroughness 기반 예산 — 탐색 깊이를 직관적으로 제어
4. 병렬 도구 실행 — 독립적 도구 호출을 동시에 처리

---

## 1. 새 MCP 도구: `explore`

### 1.1 입력 스키마

```json
{
  "type": "object",
  "properties": {
    "prompt": {
      "type": "string",
      "description": "자유형 탐색 지시. 예: 'Read all test files and report coverage gaps'"
    },
    "thoroughness": {
      "type": "string",
      "enum": ["quick", "medium", "thorough"],
      "description": "탐색 깊이. quick: 기본 검색 (3턴), medium: 보통 탐색 (6턴), thorough: 종합 분석 (12턴)",
      "default": "medium"
    },
    "scope": {
      "type": "array",
      "items": { "type": "string" },
      "description": "탐색 범위 제한 (경로 패턴)"
    },
    "repo_root": {
      "type": "string",
      "description": "저장소 루트 경로"
    },
    "session": {
      "type": "string",
      "description": "이전 탐색의 세션 ID (컨텍스트 연속)"
    }
  },
  "required": ["prompt"]
}
```

### 1.2 출력 형식

구조화된 JSON 대신 **자연어 리포트**를 주 출력으로 사용한다.

```json
{
  "report": "string — 자연어 탐색 결과 리포트 (마크다운 허용)",
  "filesExamined": ["string — 탐색한 파일 경로 목록"],
  "toolsUsed": 15,
  "elapsedMs": 12340,
  "sessionId": "string",
  "stats": { /* 기존 stats 객체 */ }
}
```

**기존 `explore_repo`와의 차이**:
- `answer` / `summary` / `confidence` / `evidence` / `followups` → 없음
- `report` 하나에 자유형 서술
- 구조화된 confidence scoring 없음 (리포트 내에서 자체 판단 서술)

### 1.3 Thoroughness → 예산 매핑

| thoroughness | maxTurns | maxReadLines | maxSearchResults | 용도 |
|-------------|----------|-------------|-----------------|------|
| quick | 3 | 200 | 30 | 빠른 검색, 단일 파일 확인 |
| medium | 6 | 300 | 50 | 보통 탐색, 여러 파일 분석 |
| thorough | 12 | 500 | 80 | 종합 분석, 전체 구조 파악 |

---

## 2. Explorer System Prompt

기존 `buildExplorerSystemPrompt`와 별도의 프롬프트를 사용한다.

### 2.1 `buildExploreSystemPrompt()`

```
You are Cerebras Explorer, an autonomous READ-ONLY codebase exploration agent.

You receive a free-form exploration prompt and must investigate the repository
to answer it thoroughly.

## Approach

1. Read the prompt carefully and plan your investigation
2. Use available tools to gather information
3. When you have enough evidence, write a comprehensive report
4. Stop as soon as you can answer — don't over-explore

## Tool Usage Guidelines

- Use repo_find_files and repo_grep to discover relevant files BEFORE reading
- Use repo_read_file with minimal line ranges — read only what you need
- Use repo_list_dir to understand directory structure
- Use repo_git_log / repo_git_blame / repo_git_diff for history questions
- Use repo_symbols / repo_references for code structure questions

When multiple files need to be examined and the lookups are independent,
request them in a single turn (parallel tool calls).

## Error Handling

- If a file doesn't exist, try alternative paths or search for it
- If a directory read fails, use repo_list_dir instead
- If grep returns too many results, narrow with scope or more specific patterns

## Output

When you have gathered enough information, respond with a natural-language
report. Use markdown formatting for readability. Include:
- Direct answer to the prompt
- Key findings with file paths and line numbers where relevant
- Confidence assessment in your own words
- Suggestions for further investigation if the answer is incomplete

MUST remain read-only. Never suggest writing files or running mutating commands.
MUST answer in the same natural language as the prompt.

Repository root: {repoRoot}
Budget: {thoroughness} ({maxTurns} turns max)
```

### 2.2 `buildExploreUserPrompt()`

기존의 전략/힌트 블록 없이 프롬프트를 그대로 전달한다.

```
Exploration prompt:
{prompt}

Scope: {scope or 'entire repository'}

Investigate and report your findings. Stop when you have enough evidence.
```

### 2.3 Finalize Prompt

```
Produce your final exploration report now.
Do not call any tools.
Summarize everything you've found in a clear, readable report.
```

---

## 3. ExplorerRuntime 확장

### 3.1 `exploreMode` 옵션

`ExplorerRuntime.explore()` 메서드에 mode 파라미터를 추가하거나, 별도 메서드 `ExplorerRuntime.freeExplore()`를 추가한다.

**권장: 별도 메서드** — 기존 explore()와 분기가 많아질 수 있으므로 분리한다.

```javascript
class ExplorerRuntime {
  // 기존
  async explore(args, opts) { /* ... */ }

  // 신규
  async freeExplore(args, opts) {
    // 1. thoroughness → budgetConfig 매핑
    // 2. buildExploreSystemPrompt() 사용
    // 3. buildExploreUserPrompt() 사용
    // 4. 동일한 tool loop 실행
    // 5. JSON 스키마 강제 없이 자연어 응답 추출
    // 6. report + metadata 반환
  }
}
```

### 3.2 병렬 도구 실행

현재 도구 실행 루프:
```javascript
// 현재 (순차)
for (const toolCall of completion.message.toolCalls) {
  toolResult = await repoToolkit.callTool(toolName, toolArgs);
  // ...
}
```

개선:
```javascript
// 제안 (병렬)
const toolResults = await Promise.all(
  completion.message.toolCalls.map(async (toolCall) => {
    try {
      const result = await repoToolkit.callTool(toolCall.function.name, toolArgs);
      return { id: toolCall.id, result };
    } catch (error) {
      return { id: toolCall.id, result: { error: true, message: error.message } };
    }
  })
);
```

**참고**: 이 병렬 실행 개선은 `explore_repo`에도 적용 가능하다. Explorer mode 전용이 아님.

### 3.3 자연어 응답 추출

기존 `explore()`는 `extractFirstJsonObject()`로 JSON을 추출한다. `freeExplore()`는 마지막 assistant 메시지의 content를 그대로 report로 사용한다.

```javascript
// freeExplore에서
if (completion.message.toolCalls.length === 0) {
  return {
    report: completion.message.content,
    filesExamined: [...observedRanges.keys()],
    toolsUsed: stats.toolCalls,
    elapsedMs: stats.elapsedMs,
    sessionId,
    stats,
  };
}
```

---

## 4. MCP 서버 등록

### 4.1 server.mjs 에 도구 추가

```javascript
// 기존 5개 도구에 추가
{
  name: 'explore',
  description: 'Free-form codebase exploration. Give a natural-language prompt and get a detailed report. ' +
    'Use thoroughness to control depth: quick for basic lookups, medium for moderate exploration, ' +
    'thorough for comprehensive analysis across multiple locations.',
  inputSchema: EXPLORE_INPUT_SCHEMA,
}
```

### 4.2 핸들러

```javascript
case 'explore': {
  const result = await freeExploreRepository(args, { onProgress, sessionStore });
  return {
    content: [{ type: 'text', text: result.report }],
    // 메타데이터는 structuredContent로
    structuredContent: {
      filesExamined: result.filesExamined,
      toolsUsed: result.toolsUsed,
      elapsedMs: result.elapsedMs,
      sessionId: result.sessionId,
    },
  };
}
```

---

## 5. 구현 순서

### Phase A: Core (P1)

1. **explore 입력 스키마** 정의 (`schemas.mjs`)
2. **Explorer mode 프롬프트** 작성 (`prompt.mjs`에 `buildExploreSystemPrompt`, `buildExploreUserPrompt`, `buildExploreFinalize` 추가)
3. **`ExplorerRuntime.freeExplore()`** 메서드 구현 (`runtime.mjs`)
4. **`freeExploreRepository()`** 편의 함수 export
5. **MCP 서버에 `explore` 도구 등록** (`server.mjs`)
6. **기본 테스트** 추가

### Phase B: Enhancement (P2)

7. **병렬 도구 실행** — `freeExplore()`와 `explore()` 모두에 적용
8. **에러 복구 패턴** — 도구 실패 시 fallback 힌트를 다음 턴에 주입
9. **세션 연속성** — 기존 SessionStore 재사용
10. **progress reporting** — 기존 onProgress 콜백 재사용

### Phase C: Polish (P3)

11. **thoroughness 자동 감지** — 프롬프트 복잡도에 따라 기본 thoroughness 조정
12. **출력 포맷 옵션** — `format: 'markdown' | 'plain'` 파라미터 추가
13. **벤치마크** — 기존 benchmark suite에 explore 모드 시나리오 추가

---

## 6. explore_repo와의 관계

| 항목 | explore_repo | explore |
|------|-------------|---------|
| 목적 | 구조화된 탐색 + JSON 결과 | 자유형 탐색 + 자연어 리포트 |
| 전략 | 6개 사전 정의 | 없음 (자유) |
| 출력 | JSON (answer, evidence, followups) | 자연어 report |
| confidence | 자동 계산 (score + level) | 리포트 내 서술 |
| followups | 구조화된 suggestedCall | 리포트 내 서술 |
| 사용 시나리오 | 프로그래밍 방식 연동, 자동화 | 사람이 읽는 분석 리포트 |

두 도구는 공존한다. `explore`는 `explore_repo`를 대체하지 않으며, 사용자의 필요에 따라 선택할 수 있다.

---

## 7. 제약 조건

- zero dependencies 원칙 유지
- read-only 원칙 유지
- Node 18.17+ 유지
- 기존 `explore_repo` 입출력 스키마 변경 없음
- 동일한 RepoToolkit 도구 세트 사용 (새로운 도구 추가 없음)

---

## 8. 예상 사용 예시

### Claude Code에서 cerebras-explorer의 explore 도구 호출

```
// Parent model (Claude) → cerebras-explorer MCP
{
  "tool": "explore",
  "arguments": {
    "prompt": "Read all plan documents in the plan/ directory and report their completion status, any inconsistencies, and recommendations for improvement.",
    "thoroughness": "thorough",
    "scope": ["plan/"]
  }
}
```

### 반환값

```
{
  "content": [{
    "type": "text",
    "text": "## Plan Documents Analysis\n\n### Files Examined\n1. plan/README.md (10 lines)\n2. plan/roadmap.md (76 lines)\n...\n\n### Findings\n...\n\n### Recommendations\n..."
  }],
  "structuredContent": {
    "filesExamined": ["plan/README.md", "plan/roadmap.md", ...],
    "toolsUsed": 12,
    "elapsedMs": 8500,
    "sessionId": "abc123"
  }
}
```

### 간단한 탐색

```
{
  "tool": "explore",
  "arguments": {
    "prompt": "What testing framework does this project use?",
    "thoroughness": "quick"
  }
}
```
