# Gemini CLI 연결

[Gemini CLI](https://github.com/google-gemini/gemini-cli)에서 `cerebras-explorer-mcp`를 사용하는 설정 예시입니다.

## 설정 파일 위치

- 전역: `~/.gemini/settings.json`
- 프로젝트별: `<project>/.gemini/settings.json`

## 설정 추가

[`settings.json.example`](./settings.json.example)의 `mcpServers` 항목을 본인 설정 파일에 병합합니다.

```json
{
  "mcpServers": {
    "cerebras-explorer": {
      "command": "npx",
      "args": ["-y", "github:kkyubrother/cerebras-explorer-mcp#v0.1.0"],
      "env": {
        "CEREBRAS_API_KEY": "$CEREBRAS_API_KEY"
      },
      "trust": false,
      "includeTools": [
        "explore_repo",
        "find_relevant_code",
        "trace_symbol",
        "map_change_impact"
      ],
      "timeout": 60000
    }
  }
}
```

Gemini CLI는 MCP 서버 프로세스에 전달되는 환경변수 중 `*KEY*`, `*SECRET*`, `*TOKEN*`, `*PASSWORD*`, `*AUTH*`, `*CREDENTIAL*` 패턴을 기본 차단합니다. `CEREBRAS_API_KEY`는 이 규칙에 걸리므로 셸에 export만 해서는 부족하고, 서버 설정의 `env` 블록에 명시해야 합니다.

서버 alias는 `cerebras-explorer`처럼 하이픈을 쓰는 이름을 권장합니다. 일부 흐름에서 underscore가 도구 네임스페이스와 섞여 읽히기 쉬우므로 `cerebras_explorer`는 피하세요.

`includeTools`는 Gemini CLI 쪽 allowlist입니다. 특정 도구를 추가로 막는 `excludeTools`를 함께 쓰면 `excludeTools`가 우선합니다.

## CLI 등록

```bash
gemini mcp add -e CEREBRAS_API_KEY="$CEREBRAS_API_KEY" \
  cerebras-explorer npx -- \
  -y github:kkyubrother/cerebras-explorer-mcp#v0.1.0
```

## 검증

```bash
gemini mcp list
```

목록에 `cerebras-explorer`가 보이고, Gemini 세션에서 `explore_repo` 같은 도구가 노출되면 연결된 것입니다.
