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

> Note: the `doc/` directory contains developer reference material only. It is not loaded or read at runtime by the server.

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

**Calls:** `GET https://api.idescat.cat/taules/v2[/{statistics}[/{node}]]`

**Parameters:**
- `statistics` (optional string) — statistic identifier (e.g. `pmh`)
- `node` (optional string) — node identifier (e.g. `1180`)
- `lang` (optional, default `"ca"`) — `ca`, `es`, or `en`

**Behaviour:** Calls the appropriate level based on which parameters are provided:
- Neither → lists all statistics
- `statistics` only → lists nodes for that statistic
- Both → lists tables for that node

**Returns:** Array of `{id, label, href?}` extracted from the JSON-stat collection. `href` may be absent for some entries at the statistics listing level if the API does not include it; in that case it is omitted from the returned object rather than constructed.

---

### 2. `idescat_get_territorial_options`
**Purpose:** List available territorial divisions for a specific table.

**Calls:** `GET https://api.idescat.cat/taules/v2/{statistics}/{node}/{table}`

**Parameters:**
- `statistics` (required)
- `node` (required)
- `table` (required)
- `lang` (optional, default `"ca"`)

**Returns:** Array of `{id, label, href}` where `href` is the metadata URL for that table+geo combination (directly usable as input to `idescat_get_table_metadata`). Example: `[{id: "cat", label: "Catalunya", href: "https://api.idescat.cat/taules/v2/.../cat"}, ...]`.

---

### 3. `idescat_get_table_metadata`
**Purpose:** Inspect dimensions and valid filter values before querying data. This is the key tool for precision querying.

**Calls:** `GET https://api.idescat.cat/taules/v2/{statistics}/{node}/{table}/{geo}`

**Parameters:**
- `statistics`, `node`, `table`, `geo` (all required)
- `lang` (optional, default `"ca"`)
- `filters` (optional object, same shape as `idescat_query_data`) — e.g. `{"SEX": "F"}` to pre-filter dimensions shown in the metadata

**Returns:**
- Dimensions with all valid category ids and labels
- Dataset-level extensions: `status` symbols legend (e.g. `{"p": "Dades provisionals"}`), `source`
- Dimension-level extensions: geographical breaks (`extension.break`)
- `describes`: object `{href, label}` — extracted verbatim from the API response's `link.describes[0]` field; `href` is the URL to request the actual data (it is the data endpoint, not the metadata endpoint)

---

### 4. `idescat_query_data`
**Purpose:** Retrieve data as a flattened row-based array with resolved labels.

**Calls:** `GET https://api.idescat.cat/taules/v2/{statistics}/{node}/{table}/{geo}/data` (or POST if URL > 2,000 chars)

**Parameters:**
- `statistics`, `node`, `table`, `geo` (all required)
- `filters` (optional object) — e.g. `{"SEX": "F", "COM": "01,TOTAL"}`. Should not include a time dimension key when `last` is also provided (the API will return error 06 in that case, which will be surfaced as-is).
- `last` (optional number) — uses `_LAST_=N` for most recent N periods. The mutual exclusion with a time dimension in `filters` is enforced by the API (error 06); the tool does not attempt to detect this at request-construction time.
- `lang` (optional, default `"ca"`)

**Returns:** Array of row objects, e.g.:
```json
[
  {"SEX": "Dones", "YEAR": "2023", "COM": "Alt Camp", "value": 12345, "status": "p"},
  ...
]
```
The `status` field (when present) is a single character code, e.g. `"p"` = provisional data. Status codes and their descriptions are available from `idescat_get_table_metadata`.

**Error 05 handling:** If the API returns data limit exceeded (>20,000 cells), the tool makes a follow-up call to the metadata endpoint (`/{statistics}/{node}/{table}/{geo}`) to retrieve the available dimensions, then returns an explanatory message listing each dimension name with its available category ids so the caller knows what filters to apply.

**Auto POST:** The full URL is constructed (including `lang` parameter) before the length check. If the fully constructed URL exceeds 2,000 characters, the request is made via POST: filters encoded as `application/x-www-form-urlencoded` in the body, with `Content-Type: application/x-www-form-urlencoded` header. The `lang` parameter stays in the query string of the POST URL.

---

### 5. `idescat_check_historical_relations`
**Purpose:** Discover related tables — historical versions and same-data in other territorial granularities.

**Calls:** `GET https://api.idescat.cat/taules/v2/{statistics}/{node}/{table}/{geo}` (same as metadata endpoint, no filters)

**Parameters:**
- `statistics`, `node`, `table`, `geo` (all required)
- `lang` (optional, default `"ca"`)

**Classification algorithm:** The `link.related` array contains mixed entries distinguished only by parsing the `href` path segments:
1. Extract the table segment from each related entry's `href` (5th path segment: `.../v2/{stat}/{node}/{table}/{geo}`)
2. If the entry has `extension.group === true` (i.e. `link.related[i].extension.group`) → classify as `grouped`
3. Else if the extracted table segment matches the current `table` parameter → classify as `other_geos` (same data, different territorial granularity)
4. Else (different table segment, no group flag) → classify as `historical` (older version of the same series)

**Returns:** Object with three categorised arrays:
- `other_geos` — `{href, label}` entries: same table at different territorial divisions
- `historical` — `{href, label}` entries: older versions of the same table (same node, different table id)
- `grouped` — `{href, label}` entries: thematically related tables (`extension.group: true`)

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
2. **Normalize `dataset.value`:** if it is a plain object (sparse format, keyed by string index), convert it to a dense array first: `const arr = []; Object.keys(value).forEach(k => arr[+k] = value[k]);`
3. **Normalize `dataset.status`:** same sparse→dense treatment as `value` if it is an object.
4. Generate the full Cartesian product of category indices (one index per dimension, in the order of `dataset.id`)
5. For each combination:
   - For each dimension, look up the category code for the current index via `dataset.dimension[dim].category.index` (may be an object `{code: position}` or array — handle both), then resolve to label via `dataset.dimension[dim].category.label?.[code]`. If `label` is absent or has no entry for this code, fall back to the raw category code string.
   - Read the value from the normalized array at position `i` (may be `null`)
   - Read `dataset.status[i]` if present; it is a single character code string (e.g. `"p"`)
6. Return array of plain objects: `{[dimName: string]: string, value: number | null, status?: string}`

## `fetchIdescat` error detection

`fetchIdescat` must detect errors via **both** mechanisms:
1. **HTTP status check:** if the response status is not 2xx, parse the JSON body and throw with the `id` and `label` fields.
2. **JSON body check:** if HTTP status is 2xx but the parsed body has `class: "error"`, treat it as an error and throw accordingly. This handles edge cases where the API returns a 200 with an error body.

The `lang` parameter is always included as a query string parameter on both GET and POST requests.

For POST requests (URL > 2,000 chars): set `Content-Type: application/x-www-form-urlencoded` and encode the dimension filters as a URL-encoded string in the body. The `lang` parameter remains in the query string of the POST URL, not in the body.

If an unsupported `lang` value is passed by the caller, it is passed through to the API as-is; the API's error response is surfaced to the caller.

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
