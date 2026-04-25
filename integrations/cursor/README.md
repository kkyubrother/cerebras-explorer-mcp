# Cursor 연결

[Cursor IDE](https://cursor.com)에서 `cerebras-explorer-mcp`를 사용하는 방법입니다.

## 설정 파일 위치

- 전역: `~/.cursor/mcp.json` (모든 프로젝트에서 공유)
- 프로젝트별: `<project>/.cursor/mcp.json` (해당 프로젝트에서만)

두 위치 모두 동일한 JSON 스키마를 사용합니다. 둘 다 존재하면 보통 프로젝트별 설정이 우선합니다.

## 설정 추가

[`mcp.json.example`](./mcp.json.example) 의 내용을 위 위치 중 하나에 저장하거나, 기존 `mcpServers` 객체에 항목만 병합합니다.

```json
{
  "mcpServers": {
    "cerebras-explorer": {
      "command": "npx",
      "args": ["-y", "github:kkyubrother/cerebras-explorer-mcp"],
      "env": {
        "CEREBRAS_API_KEY": "${CEREBRAS_API_KEY}"
      }
    }
  }
}
```

## 버전 핀

```json
"args": ["-y", "github:kkyubrother/cerebras-explorer-mcp#v0.1.0"]
```

## 검증

Cursor의 **Settings → MCP** 화면에서 `cerebras-explorer` 항목이 활성(녹색) 상태로 표시되고 도구 목록(`explore_repo`, `explore`, `explain_symbol` 등)이 노출되는지 확인합니다. 항목이 빨간색이면 환경 변수(`CEREBRAS_API_KEY`)나 `npx` 경로 문제일 가능성이 높습니다.

최신 Cursor MCP 설정 형식은 공식 문서를 확인하세요: <https://cursor.com/docs>
