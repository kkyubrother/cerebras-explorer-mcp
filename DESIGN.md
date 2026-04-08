# cerebras-explorer-mcp 기획서

## 1. 배경

요구사항은 단순한 “Cerebras 연동”이 아니라 다음과 같습니다.

- 메인 모델은 Claude Code 또는 Codex 그대로 유지한다.
- Cerebras는 **서브 개념**이어야 한다.
- 사용할 모델은 기본값 `zai-glm-4.7`이지만, 필요하면 환경 변수로 바꿀 수 있다.
- 목적은 코드 생성 보조가 아니라 **탐색(explorer)** 이다.
- 상위 모델이 여러 번 `Read/Grep/Glob`를 쓰지 않고, **한 번 위임**하면 explorer가 자율적으로 파일을 찾고 읽고 결론을 내야 한다.
- 그 결과로 Claude Code / Codex 사용량을 절감해야 한다.

이 기획서는 위 요구를 만족하는 MCP 기반 external explorer를 정의한다.

---

## 2. 입력 근거

### 2.1 Claude Code 소스에서 가져온 방향

업로드된 Claude Code 소스 기준으로 다음 특징이 보인다.

1. built-in `Explore` agent는 **빠른 read-only 탐색기** 역할이다.
   - 파일 수정이 금지된다.
   - glob / grep / read 중심으로 탐색한다.
   - 최종 보고를 직접 메시지로 돌려준다.
   - 빠른 탐색을 위해 `CLAUDE.md`를 생략한다.

2. custom agent는 frontmatter로 제어할 수 있다.
   - `mcpServers`
   - `disallowedTools`
   - `model`
   - 기타 prompt / 도구 범위

3. skill은 `context: fork` + `agent:` 구조를 통해 분리된 하위 컨텍스트를 사용할 수 있다.

이것은 “탐색 전용 sub-agent”라는 개념이 Claude Code의 철학과 잘 맞는다는 뜻이다.

### 2.2 기존 `cerebras-code-mcp` 저장소에서 가져온 방향

업로드된 `cerebras-code-mcp`는 다음 형태다.

- MCP 서버 하나
- 고수준 도구 하나(`write`)
- 내부적으로 Cerebras chat completion 호출

가져올 점:

- **MCP tool 하나로 상위 모델의 복잡한 워크플로를 감춘다**는 점
- Cerebras 호출을 서버 내부 구현으로 숨긴다는 점

버릴 점:

- 쓰기 중심 설계
- `zai-glm-4.6` 기본값
- 코드 생성/수정 도구 중심 UX

결론적으로 이번 설계는 기존 `write` MCP를 `explore_repo`로 치환한 읽기 전용 구조다.

---

## 3. 핵심 목표

### 목표

- 상위 모델은 **한 번만 위임**한다.
- 자율 탐색 루프는 **MCP 서버 내부에서** 끝난다.
- 상위 모델 토큰을 아끼기 위해, low-level 파일 검색 도구는 부모에게 넘기지 않는다.
- 반환은 항상 구조화된 JSON이다.

### 비목표

- 코드 수정
- 테스트 실행
- 셸 명령 자동 실행
- 런타임 중 다중 모델 자동 라우팅
- fallback provider

---

## 4. 왜 low-level MCP 도구를 직접 노출하지 않는가

잘못된 설계는 이런 형태다.

```text
Parent model
  -> repo_list_dir
  -> repo_grep
  -> repo_read_file
  -> repo_read_file
  -> repo_grep
  -> ...
```

이 구조에서는 탐색 orchestration을 부모 모델이 맡게 된다. 그러면 결국 Claude/Codex가 계속 탐색 토큰을 소비하게 되고, “Cerebras를 explorer로 써서 메인 사용량을 줄인다”는 목표가 약해진다.

따라서 바른 설계는 이 형태다.

```text
Parent model
  -> explore_repo(...)
    -> explorer runtime
      -> model-driven tool loop
      -> structured result
```

즉, `explore_repo`는 단순한 편의 함수가 아니라 **독립 실행형 explorer 서브시스템의 단일 진입점**이다.

---

## 5. 아키텍처

```text
Claude Code / Codex
  -> MCP: explore_repo
    -> ExplorerRuntime
      -> RepoToolkit
         - repo_list_dir
         - repo_find_files
         - repo_grep
         - repo_read_file
      -> CerebrasChatClient
         - model: configurable via env (default zai-glm-4.7)
      -> final grounded JSON
```

### 5.1 컴포넌트 역할

#### `RepoToolkit`

저장소를 읽기 전용으로 탐색한다.

- 디렉터리 목록
- 파일 glob 검색
- 정규식 grep
- 특정 파일 라인 범위 읽기

#### `CerebrasChatClient`

Cerebras chat completion API에 직접 연결한다.

- 모델 기본값: `zai-glm-4.7`
- override: `CEREBRAS_EXPLORER_MODEL` 또는 `CEREBRAS_MODEL`
- tool calling 지원
- structured final JSON 유도

#### `ExplorerRuntime`

실제 autonomous loop를 담당한다.

- system/user prompt 구성
- budget 설정
- tool loop 실행
- evidence grounding
- 최종 결과 정규화

#### `MCP Server`

상위 모델에게는 `explore_repo` 하나만 노출한다.

---

## 6. 독립성 정의

여기서 “main과 독립적인 explorer”는 다음 의미다.

1. 부모는 내부 탐색 단계를 모르고, 안 알아도 된다.
2. explorer는 자신의 도구 루프를 스스로 결정한다.
3. 부모는 결과만 받고 필요한 경우 일부 evidence만 재검증한다.
4. explorer 컨텍스트는 부모 대화와 분리된다.

즉, 이 explorer는 Claude Code 내장 Explore와 비슷한 역할을 하지만, **외부 MCP 뒤에서 선택된 Cerebras 모델로 돌아간다**는 점이 다르다.

---

## 7. 모델 정책

- 기본 모델: `zai-glm-4.7`
- override: `CEREBRAS_EXPLORER_MODEL` 또는 `CEREBRAS_MODEL`
- 외부 fallback provider는 허용하지 않는다.

이 프로젝트는 Cerebras provider 안에서만 동작한다. 모델 이름은 바꿀 수 있지만, 부모 모델이 아닌 explorer 내부 모델만 교체한다.

---

## 8. 내부 도구 설계

### 8.1 `repo_list_dir`

저장소 구조 감잡기용.

### 8.2 `repo_find_files`

파일명/패턴 기반 후보 압축용.

### 8.3 `repo_grep`

심볼, 라우트, 설정 키, 문자열 흔적 찾기용.

### 8.4 `repo_read_file`

필요한 라인 범위만 읽기용.

이 4개면 explorer MVP에는 충분하다.

---

## 9. 반환 스키마

```json
{
  "answer": "string",
  "summary": "string",
  "confidence": "low|medium|high",
  "evidence": [
    {
      "path": "relative/path",
      "startLine": 1,
      "endLine": 10,
      "why": "why it matters"
    }
  ],
  "candidatePaths": ["relative/path"],
  "followups": ["optional next checks"],
  "stats": {
    "model": "${CEREBRAS_EXPLORER_MODEL:-zai-glm-4.7}",
    "budget": "quick|normal|deep",
    "turns": 0,
    "toolCalls": 0
  }
}
```

반환을 자연어가 아니라 JSON으로 고정한 이유:

- Claude Code / Codex가 후처리하기 쉽다.
- UI / 로그 / 캐싱이 쉬워진다.
- evidence 재검증이 쉬워진다.

---

## 10. evidence grounding 정책

탐색형 agent의 가장 큰 문제는 “읽지 않은 파일을 안 읽은 척 결론에 넣는 것”이다.

이를 줄이기 위해 구현은 다음 규칙을 갖는다.

- `repo_read_file`로 실제 읽은 line range를 기록한다.
- `repo_grep`로 실제 일치한 line을 기록한다.
- 최종 evidence는 **기록된 line range와 겹치는 항목만 유지**한다.
- 누락된 evidence가 있으면 confidence를 낮춘다.

이 정책 덕분에 “탐색은 했다고 하는데 근거가 빈약한” 출력을 줄일 수 있다.

---

## 11. 경계 강화 정책

초기 `scope`는 advisory가 아니라 **hard boundary**로 취급한다.

- `repo_find_files`와 `repo_grep`의 추가 `scope`는 초기 범위를 **더 좁히기만** 할 수 있다.
- `repo_list_dir`는 현재 scope 밖 디렉터리를 나열하지 않는다.
- 디렉터리 순회는 scope와 무관한 하위 트리를 큐에 넣지 않는다.
- symlink 항목은 순회 결과에서 숨기고, 직접 읽으려 해도 거부한다.
- 실제 경로는 `realpath`로 확인해 repo root 밖 탈출을 막는다.

즉, scope 확장과 symlink 탈출을 모두 막아서, explorer가 부모가 준 저장소 경계를 넘지 못하게 한다.

---

## 11. budget 정책

### `quick`

- 빠른 1차 탐색
- 얕은 검색
- 토큰 절감 우선

### `normal`

- 대부분의 기본 동작

### `deep`

- 더 많은 반복 탐색 허용
- 넓은 후보군 탐색 가능

이 budget은 상위 모델이 질문 중요도에 따라 조절할 수 있다.

---

## 12. Claude Code 통합 방식

Claude Code에서는 두 층으로 붙인다.

### A. MCP 서버 등록

Claude는 `explore_repo`를 하나의 외부 고수준 도구로 본다.

### B. 얇은 sub-agent / skill

- custom agent: 외부 explorer를 우선 사용하도록 지시
- skill: 탐색형 과제에서 그 agent를 부르도록 유도

핵심은 Claude의 native `Read/Grep/Glob`를 먼저 쓰지 않고, **외부 explorer를 먼저 호출**하게 만드는 것이다.

---

## 13. Codex 통합 방식

Codex도 동일하다.

- MCP 서버 등록
- read-only custom agent 정의
- skill 또는 AGENTS.md 규칙으로 explorer 우선 위임

즉, 공용 핵심은 MCP 서버이고, 각 도구별 glue는 얇다.

---

## 14. 구현 범위

### 포함

- MCP stdio 서버 (Content-Length 방식 + NDJSON 방식 자동 감지)
- `explore_repo`
- 내부 repo toolkit
- Cerebras API 클라이언트
- autonomous tool loop
- 기본 테스트
- Claude/Codex integration 예시

### 제외

- 공식 MCP SDK 의존성
- tree-sitter/LSP 통합
- 병렬 repo 샤딩 탐색
- git diff awareness
- write-back agent

---

## 15. 추후 확장

### Phase 2

- `trace_symbol`
- `map_impact`
- `find_entrypoints`
- nested `.gitignore` / `.ignore` 지원
- ripgrep 연동

### Phase 3

- tree-sitter 기반 구조 인덱스
- import graph / call graph
- cache layer
- repo fingerprint 기반 warm-start

---

## 16. 한 줄 결론

이 설계의 핵심은 다음 문장으로 요약된다.

> **Claude/Codex의 subagent 기능을 직접 메인으로 쓰는 것이 아니라, `zai-glm-4.7` 기반의 외부 autonomous explorer를 MCP 뒤에 숨기고, 메인 모델은 그 explorer에게 한 번만 위임하게 만든다.**

이것이 “main과 독립적인 explorer 기능을 갖춘 MCP sub-agent” 요구에 가장 가깝다.
