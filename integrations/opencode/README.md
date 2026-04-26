# OpenCode 연결

[OpenCode](https://opencode.ai)에서 `cerebras-explorer-mcp`를 사용하는 방법입니다.

## 설정 파일 위치

- 프로젝트별: `<project>/opencode.json` (또는 `opencode.jsonc`)
- 전역: 사용자별 `opencode.json` 위치는 OpenCode 문서를 참고하세요.

## 설정 추가

[`opencode.json.example`](./opencode.json.example) 의 `mcp` 항목을 본인 `opencode.json` 의 `mcp` 객체에 병합합니다. 다른 MCP 서버가 이미 등록되어 있다면 같은 키 아래에 항목만 추가하면 됩니다.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "cerebras-explorer": {
      "type": "local",
      "command": ["npx", "-y", "github:kkyubrother/cerebras-explorer-mcp#v0.1.0"],
      "enabled": true,
      "environment": {
        "CEREBRAS_API_KEY": "${CEREBRAS_API_KEY}"
      }
    }
  }
}
```

## 버전 핀

기본 브랜치 대신 tag/branch/commit으로 고정하려면 `command` 마지막 인자를 다음 중 하나로 교체합니다.

```json
"command": ["npx", "-y", "github:kkyubrother/cerebras-explorer-mcp#v0.1.0"]
"command": ["npx", "-y", "github:kkyubrother/cerebras-explorer-mcp#main"]
"command": ["npx", "-y", "github:kkyubrother/cerebras-explorer-mcp#<commit-sha>"]
```

## 검증

OpenCode를 재시작한 뒤 MCP 패널 또는 툴 목록에서 `cerebras-explorer` 도구가 노출되는지 확인합니다. 정상 부팅되면 stderr에 `[cerebras-explorer-mcp] stdio MCP server started` 라인이 한 번 출력됩니다.

자세한 OpenCode 측 설정 스키마는 공식 문서를 참고하세요: <https://opencode.ai/docs/mcp-servers/>
