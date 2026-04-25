# Claude Desktop 연결

[Claude Desktop](https://claude.ai/download) (macOS / Windows) 앱에서 `cerebras-explorer-mcp`를 사용하는 방법입니다. CLI 버전인 Claude Code와 다른 클라이언트입니다.

## 설정 파일 위치

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: 공식 Claude Desktop 빌드는 현재 없습니다. Linux에서는 [Claude Code CLI](../claude/) 또는 다른 MCP 클라이언트를 사용하세요.

설정 파일을 직접 편집하거나 Claude Desktop의 **Settings → Developer → "Edit Config"** 버튼으로도 열 수 있습니다.

## 설정 추가

[`claude_desktop_config.json.example`](./claude_desktop_config.json.example) 내용을 그대로 저장하거나, 기존 `mcpServers` 객체에 `cerebras-explorer` 항목을 병합합니다. 그리고 `your-cerebras-api-key-here` 자리에 실제 API 키를 채워 넣습니다.

```json
{
  "mcpServers": {
    "cerebras-explorer": {
      "command": "npx",
      "args": ["-y", "github:kkyubrother/cerebras-explorer-mcp"],
      "env": {
        "CEREBRAS_API_KEY": "your-cerebras-api-key-here"
      }
    }
  }
}
```

> Claude Desktop은 `${CEREBRAS_API_KEY}` 같은 셸 변수 보간을 항상 지원하지는 않으므로, **`env` 안에 API 키를 평문으로 적는 형태가 가장 확실**합니다. 키를 평문으로 두기 싫다면 OS 키체인 + 시작 스크립트 우회를 고려하세요.

## 버전 핀

```json
"args": ["-y", "github:kkyubrother/cerebras-explorer-mcp#v0.1.0"]
```

## 검증

설정 파일을 저장한 뒤 Claude Desktop을 **완전히 종료(메뉴바에서 Quit)** 하고 다시 실행합니다. 입력창 우하단의 MCP 슬라이더 아이콘을 클릭해 `cerebras-explorer` 도구들이 보이는지 확인하세요.

문제 발생 시 로그 위치:
- macOS: `~/Library/Logs/Claude/mcp.log`, `mcp-server-cerebras-explorer.log`
- Windows: `%APPDATA%\Claude\logs\mcp*.log`

공식 quickstart: <https://modelcontextprotocol.io/quickstart/user>
