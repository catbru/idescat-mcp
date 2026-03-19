# idescat-mcp

MCP server for the [IDESCAT Tables API v2](https://api.idescat.cat/taules/v2) — the Statistical Institute of Catalonia.

## Tools

| Tool | Purpose |
|------|---------|
| `idescat_list_catalog` | Navigate catalogue: statistics → nodes → tables |
| `idescat_get_territorial_options` | List available geo divisions for a table |
| `idescat_get_table_metadata` | Inspect dimensions and valid filter values |
| `idescat_query_data` | Fetch data as flattened rows with resolved labels |
| `idescat_check_historical_relations` | Discover historical and related tables |

## Typical workflow

1. `idescat_list_catalog` — find the statistics and node
2. `idescat_get_territorial_options` — pick a geo division
3. `idescat_get_table_metadata` — understand dimensions and valid filter values
4. `idescat_query_data` — fetch filtered data

## Installation

```bash
npm install
```

## Claude Desktop integration

Add to `~/.config/claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "idescat": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/idescat-mcp/src/index.ts"]
    }
  }
}
```

## Requirements

- Node.js 18+
