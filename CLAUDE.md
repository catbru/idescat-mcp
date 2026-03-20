# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # Install dependencies
npm start            # Run the MCP server (tsx src/index.ts)
npm test             # Run tests once (vitest run)
npm run test:watch   # Run tests in watch mode
```

Run a single test file:
```bash
npx vitest run tests/tools.test.ts
```

There is no build step for development — `tsx` runs TypeScript directly. The `outDir: dist` in tsconfig is unused at runtime.

## Architecture

The entire server lives in a single file: `src/index.ts`. It exports all tool handlers and types so tests can import them directly without starting the server.

**Entry point guard** — the MCP stdio server only starts when the file is run directly (not imported by tests):
```ts
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(console.error);
}
```

**Data flow** for a typical query:
1. MCP client calls a tool → `CallToolRequestSchema` handler dispatches to the matching `handle*` function
2. `handle*` builds a URL under `BASE_URL = https://api.idescat.cat/taules/v2`
3. `fetchIdescat()` adds `lang=` param, auto-switches to POST when URL > 2000 chars (filter-heavy queries), and enforces a 30 s timeout
4. The API returns JSON-stat 2.0 (`class: 'dataset'` or `class: 'collection'`); errors come as `class: 'error'` in the body even on 2xx
5. `flattenJsonStat()` converts a JSON-stat dataset into a flat array of row objects with resolved labels

**URL pattern** for all 5 tools:
```
/{statistics}/{node}/{table}/{geo}          → metadata / territorial options / historical
/{statistics}/{node}/{table}/{geo}/data     → query data
/{statistics} or /{statistics}/{node}       → catalog listing
```

**Error 05 handling** — when `handleQueryData` gets IDESCAT error `05` (>20,000 rows), it makes a follow-up metadata call to list available dimensions and returns a Catalan-language hint string instead of throwing.

## Testing

Tests use Vitest with `vi.stubGlobal('fetch', ...)` to mock the global `fetch`. Each test file restores mocks via `afterEach(() => vi.unstubAllGlobals())`. Tests import handlers directly from `../src/index.js` (note the `.js` extension required by NodeNext module resolution).

## Language

Tool descriptions, error messages, and user-facing strings are in Catalan (`ca`). The default language for API calls is `ca`; `es` and `en` are also supported via the `lang` parameter.
