# IDESCAT MCP Server — Design Spec
Date: 2026-03-19

## Overview

A Model Context Protocol (MCP) server in TypeScript that connects Claude with the IDESCAT Tables API v2. The server exposes 5 tools that allow Claude to navigate the IDESCAT data catalogue hierarchically, inspect metadata before querying, and retrieve statistical data as flattened row-based records with human-readable labels.

## Architecture

### Transport
stdio — integrates with Claude Desktop via `~/.config/claude/claude_desktop_config.json`.

### File structure
```
idescat-mcp/
├── src/
│   └── index.ts          # Single file: all server logic
├── doc/
│   └── idescat.cat-api-docs-tables-v2.md
├── package.json
├── tsconfig.json
└── README.md
```

### Internal structure of `src/index.ts`
Four logical blocks in a single file:
1. **Constants & types** — base URL (`https://api.idescat.cat/taules/v2`), known error codes, TypeScript interfaces for JSON-stat dataset and collection
2. **`fetchIdescat(url, params?)`** — fetch wrapper with error handling and auto GET/POST (POST when query string would exceed 2,000 characters)
3. **`flattenJsonStat(dataset)`** — JSON-stat → row-based array converter
4. **MCP tool definitions + stdio server** — 5 tools registered with `@modelcontextprotocol/sdk`

### Dependencies
- `@modelcontextprotocol/sdk` — MCP server
- `tsx` — run TypeScript directly without a `dist/` build step
- Node.js 18+ native `fetch` — zero HTTP library dependencies

## API URL pattern
```
https://api.idescat.cat/taules/v2/{statistics}/{node}/{table}/{geo}[/data][?{filters}]
```

Navigation levels:
- No path → list of statistics (collections)
- `/{statistics}` → list of nodes
- `/{statistics}/{node}` → list of tables
- `/{statistics}/{node}/{table}` → territorial divisions available
- `/{statistics}/{node}/{table}/{geo}` → metadata (JSON-stat dataset, no values)
- `/{statistics}/{node}/{table}/{geo}/data` → data (JSON-stat dataset with values)

## Tools

### 1. `idescat_list_catalog`
**Purpose:** Hierarchical catalogue navigation (statistics → nodes → tables).

**Parameters:**
- `statistics` (optional string) — statistic identifier (e.g. `pmh`)
- `node` (optional string) — node identifier (e.g. `1180`)
- `lang` (optional, default `"ca"`) — `ca`, `es`, or `en`

**Behaviour:** Calls the appropriate level based on which parameters are provided:
- Neither → lists all statistics
- `statistics` only → lists nodes for that statistic
- Both → lists tables for that node

**Returns:** Array of `{id, label, href}` extracted from the JSON-stat collection.

---

### 2. `idescat_get_territorial_options`
**Purpose:** List available territorial divisions for a specific table.

**Parameters:**
- `statistics` (required)
- `node` (required)
- `table` (required)
- `lang` (optional, default `"ca"`)

**Returns:** Array of `{id, label}` (e.g. `[{id: "cat", label: "Catalunya"}, {id: "com", label: "Comarques i Aran"}, ...]`).

---

### 3. `idescat_get_table_metadata`
**Purpose:** Inspect dimensions and valid filter values before querying data. This is the key tool for precision querying.

**Parameters:**
- `statistics`, `node`, `table`, `geo` (all required)
- `lang` (optional, default `"ca"`)
- Any dimension filters (optional) — same syntax as `idescat_query_data`

**Returns:**
- Dimensions with all valid category ids and labels
- Dataset-level extensions: `status` symbols legend, `source`
- Dimension-level extensions: geographical breaks (`extension.break`)
- `describes` link: the URL to request actual data

---

### 4. `idescat_query_data`
**Purpose:** Retrieve data as a flattened row-based array with resolved labels.

**Parameters:**
- `statistics`, `node`, `table`, `geo` (all required)
- `filters` (optional object) — e.g. `{"SEX": "F", "COM": "01,TOTAL"}`
- `last` (optional number) — uses `_LAST_` parameter for most recent N periods
- `lang` (optional, default `"ca"`)

**Returns:** Array of row objects, e.g.:
```json
[
  {"SEX": "Dones", "YEAR": "2023", "COM": "Alt Camp", "value": 12345, "status": "p"},
  ...
]
```

**Error 05 handling:** If the API returns data limit exceeded (>20,000 cells), the tool returns an explanatory message listing the available dimensions and suggesting which to filter.

**Auto POST:** If the constructed URL would exceed 2,000 characters, the request is made via POST with filters in the body.

---

### 5. `idescat_check_historical_relations`
**Purpose:** Discover related tables — historical versions and same-data in other territorial granularities.

**Parameters:**
- `statistics`, `node`, `table`, `geo` (all required)
- `lang` (optional, default `"ca"`)

**Returns:** Object with three categorised arrays extracted from `link.related`:
- `other_geos` — same table at different territorial divisions
- `historical` — older versions of the same table (same node, different table id)
- `grouped` — thematically related tables (`extension.group: true`)

## Data flow

Typical agent workflow:
```
idescat_list_catalog
  → idescat_get_territorial_options
    → idescat_get_table_metadata     ← understand dimensions & valid values
      → idescat_query_data           ← filtered, precise data request
```

## `flattenJsonStat` algorithm

1. Read `dataset.id` (ordered dimension names) and `dataset.size` (category counts per dimension)
2. Generate the full Cartesian product of category indices
3. For each combination:
   - Resolve each dimension code to its label via `dataset.dimension[dim].category.label[code]`
   - Read `dataset.value[i]` (may be `null`)
   - Read `dataset.status[i]` if present
4. Return array of plain objects: `{[dimName: string]: string, value: number | null, status?: string}`

## Error handling

| API code | HTTP | MCP tool response |
|----------|------|-------------------|
| 01 | 400 | "Identificador d'estadística incorrecte: {value}" |
| 02 | 400 | "Identificador de node incorrecte: {value}" |
| 03 | 400 | "Identificador de taula incorrecte: {value}" |
| 04 | 400 | "Divisió territorial incorrecta: {value}" |
| 05 | 416 | "Límit de 20.000 dades superat. Filtra per: {list of available dimensions and their values}" |
| 06 | 400 | "Valor de _LAST_ incorrecte. Ha de ser un enter positiu." |
| 00 | 500 | "Error intern de l'API d'IDESCAT" |
| network | — | "No s'ha pogut connectar amb l'API d'IDESCAT: {message}" |

## Language
All requests default to `lang=ca`. Any tool accepts an optional `lang` parameter (`ca`, `es`, `en`).
