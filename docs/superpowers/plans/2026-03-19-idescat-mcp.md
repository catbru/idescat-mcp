# IDESCAT MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a stdio MCP server in TypeScript that exposes 5 tools for navigating and querying the IDESCAT Tables API v2, returning flattened row-based data with resolved labels.

**Architecture:** Single `src/index.ts` file with four logical blocks: types/constants, `fetchIdescat` helper, `flattenJsonStat` helper, and MCP tool handlers + server. Helper functions and tool handlers are exported for unit testing. The server entry point only starts when run directly.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk` (stdio), `tsx` (no build step), `vitest` (tests), Node.js 18+ native `fetch`.

---

## File map

| File | Purpose |
|------|---------|
| `package.json` | Project manifest, scripts, deps |
| `tsconfig.json` | TypeScript config |
| `vitest.config.ts` | Vitest config (ESM) |
| `src/index.ts` | All server logic: types, helpers, tool handlers, server |
| `tests/flattenJsonStat.test.ts` | Unit tests for JSON-stat flattening |
| `tests/fetchIdescat.test.ts` | Unit tests for fetch wrapper |
| `tests/tools.test.ts` | Unit tests for tool handler functions |
| `README.md` | Usage & Claude Desktop integration |

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "idescat-mcp",
  "version": "1.0.0",
  "type": "module",
  "description": "MCP server for the IDESCAT Tables API v2",
  "main": "src/index.ts",
  "scripts": {
    "start": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0"
  },
  "devDependencies": {
    "tsx": "^4.0.0",
    "typescript": "^5.0.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
});
```

- [ ] **Step 4: Install dependencies**

```bash
npm install
```

Expected: `node_modules/` created, `package-lock.json` generated, no errors.

- [ ] **Step 5: Create `src/` and `tests/` directories, then commit**

```bash
mkdir -p src tests
git add package.json tsconfig.json vitest.config.ts
git commit -m "chore: project scaffold with deps and config"
```

---

## Task 2: Types, constants, and `flattenJsonStat` (TDD)

**Files:**
- Create: `tests/flattenJsonStat.test.ts`
- Create: `src/index.ts` (initial — types, constants, `flattenJsonStat` only)

- [ ] **Step 1: Write failing tests for `flattenJsonStat`**

Create `tests/flattenJsonStat.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { flattenJsonStat } from '../src/index.js';

// Minimal valid JSON-stat dataset fixture
const basicDataset = {
  version: '2.0',
  class: 'dataset' as const,
  id: ['SEX', 'YEAR'],
  size: [2, 2],
  dimension: {
    SEX: {
      label: 'Sexe',
      category: {
        index: { 'T': 0, 'H': 1 },
        label: { 'T': 'Total', 'H': 'Homes' },
      },
    },
    YEAR: {
      label: 'Any',
      category: {
        index: { '2022': 0, '2023': 1 },
        label: { '2022': '2022', '2023': '2023' },
      },
    },
  },
  value: [100, 200, 50, 80],
};

describe('flattenJsonStat', () => {
  it('returns one row per Cartesian combination', () => {
    const rows = flattenJsonStat(basicDataset);
    expect(rows).toHaveLength(4);
  });

  it('resolves dimension codes to labels', () => {
    const rows = flattenJsonStat(basicDataset);
    expect(rows[0]).toMatchObject({ SEX: 'Total', YEAR: '2022', value: 100 });
    expect(rows[1]).toMatchObject({ SEX: 'Total', YEAR: '2023', value: 200 });
    expect(rows[2]).toMatchObject({ SEX: 'Homes', YEAR: '2022', value: 50 });
    expect(rows[3]).toMatchObject({ SEX: 'Homes', YEAR: '2023', value: 80 });
  });

  it('handles null values', () => {
    const ds = { ...basicDataset, value: [null, 200, 50, 80] };
    const rows = flattenJsonStat(ds as any);
    expect(rows[0].value).toBeNull();
  });

  it('handles sparse object value format', () => {
    const ds = { ...basicDataset, value: { '1': 200, '2': 50, '3': 80 } };
    const rows = flattenJsonStat(ds as any);
    expect(rows[0].value).toBeNull(); // index 0 missing → null
    expect(rows[1].value).toBe(200);
  });

  it('falls back to raw code when label is absent', () => {
    const ds = {
      ...basicDataset,
      dimension: {
        ...basicDataset.dimension,
        SEX: {
          label: 'Sexe',
          category: {
            index: { 'T': 0, 'H': 1 },
            // no label map
          },
        },
      },
    };
    const rows = flattenJsonStat(ds as any);
    expect(rows[0].SEX).toBe('T'); // raw code fallback
  });

  it('includes status when present', () => {
    const ds = { ...basicDataset, status: { '1': 'p' } };
    const rows = flattenJsonStat(ds as any);
    expect(rows[0].status).toBeUndefined();
    expect(rows[1].status).toBe('p');
  });

  it('handles array-form category.index', () => {
    const ds = {
      ...basicDataset,
      dimension: {
        ...basicDataset.dimension,
        SEX: {
          label: 'Sexe',
          category: {
            index: ['T', 'H'], // array form
            label: { 'T': 'Total', 'H': 'Homes' },
          },
        },
      },
    };
    const rows = flattenJsonStat(ds as any);
    expect(rows[0].SEX).toBe('Total');
    expect(rows[2].SEX).toBe('Homes');
  });
});
```

- [ ] **Step 2: Run tests — verify they all fail**

```bash
npm test -- tests/flattenJsonStat.test.ts
```

Expected: `Cannot find module '../src/index.js'` or similar failure.

- [ ] **Step 3: Create `src/index.ts` with types, constants, and `flattenJsonStat`**

```typescript
import { fileURLToPath } from 'node:url';

// ─── Constants ────────────────────────────────────────────────────────────────

export const BASE_URL = 'https://api.idescat.cat/taules/v2';
export const DEFAULT_LANG = 'ca';
const POST_URL_THRESHOLD = 2000;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface JsonStatCategory {
  index: { [code: string]: number } | string[];
  label?: { [code: string]: string };
}

export interface JsonStatDimension {
  label: string;
  category: JsonStatCategory;
  role?: string;
  extension?: {
    break?: Array<{ time: string; id: string; label: string }>;
    status?: { [code: string]: string };
  };
}

export interface JsonStatDataset {
  version: string;
  class: 'dataset' | 'error';
  id: string[];
  size: number[];
  dimension: { [key: string]: JsonStatDimension };
  value: (number | null)[] | { [index: string]: number | null };
  status?: (string | null)[] | { [index: string]: string | null };
  extension?: {
    status?: { label: { [symbol: string]: string } };
    source?: string[];
  };
  link?: {
    describes?: Array<{ class: string; href: string; label: string }>;
    describedby?: Array<{ class: string; href: string; label: string }>;
    related?: Array<{
      class: string;
      href: string;
      label: string;
      extension?: { group?: boolean };
    }>;
    monitor?: Array<{ type: string; href: string }>;
  };
}

export interface JsonStatCollectionItem {
  class?: string;
  href?: string;
  label: string;
  id?: string;
}

export interface JsonStatCollection {
  version: string;
  class: 'collection' | 'error';
  link: {
    item: JsonStatCollectionItem[];
  };
}

export interface IdescatApiError {
  version: string;
  class: 'error';
  status: string;
  id: string;
  label: string;
}

export interface FlatRow {
  [dimName: string]: string | number | null | undefined;
  value: number | null;
  status?: string;
}

export interface CatalogItem {
  id: string;
  label: string;
  href?: string;
}

export interface TerritorialOption {
  id: string;
  label: string;
  href: string;
}

export interface DimensionMeta {
  id: string;
  label: string;
  categories: Array<{ id: string; label: string }>;
  breaks?: Array<{ time: string; id: string; label: string }>;
}

export interface TableMetadata {
  dimensions: DimensionMeta[];
  statusLegend?: { [symbol: string]: string };
  source?: string[];
  describes?: { href: string; label: string };
}

export interface HistoricalRelations {
  other_geos: Array<{ href: string; label: string }>;
  historical: Array<{ href: string; label: string }>;
  grouped: Array<{ href: string; label: string }>;
}

// ─── flattenJsonStat ──────────────────────────────────────────────────────────

/** Normalize a sparse-object or dense-array value/status field to a dense array. */
function normalizeSparse<T>(
  field: T[] | { [index: string]: T } | undefined
): (T | null)[] {
  if (!field) return [];
  if (Array.isArray(field)) return field as (T | null)[];
  const arr: (T | null)[] = [];
  for (const [k, v] of Object.entries(field)) {
    arr[Number(k)] = v;
  }
  return arr;
}

/** Resolve category position → code, handling both array and object index forms. */
function resolveCode(
  index: { [code: string]: number } | string[],
  pos: number
): string {
  if (Array.isArray(index)) return index[pos];
  // Object form: {code: position} — build inverted map once per call
  // (caller caches at dimension level if performance matters)
  for (const [code, p] of Object.entries(index)) {
    if (p === pos) return code;
  }
  return String(pos);
}

/**
 * Convert a JSON-stat dataset to a flat array of row objects with resolved labels.
 * Each row: { [dimName]: labelString, value: number|null, status?: string }
 */
export function flattenJsonStat(dataset: JsonStatDataset): FlatRow[] {
  const dims = dataset.id;
  const sizes = dataset.size;
  const values = normalizeSparse(dataset.value);
  const statuses = normalizeSparse(dataset.status);

  // Build inverted index maps once per dimension for O(1) lookup
  const invertedIndexes: Map<string, Map<number, string>> = new Map();
  for (const dim of dims) {
    const cat = dataset.dimension[dim].category;
    const map = new Map<number, string>();
    if (Array.isArray(cat.index)) {
      cat.index.forEach((code, pos) => map.set(pos, code));
    } else {
      for (const [code, pos] of Object.entries(cat.index)) {
        map.set(pos, code);
      }
    }
    invertedIndexes.set(dim, map);
  }

  const rows: FlatRow[] = [];
  const total = sizes.reduce((a, b) => a * b, 1);

  for (let i = 0; i < total; i++) {
    // Compute per-dimension category index from flat position
    let remaining = i;
    const row: FlatRow = { value: values[i] ?? null };

    for (let d = dims.length - 1; d >= 0; d--) {
      const dim = dims[d];
      const pos = remaining % sizes[d];
      remaining = Math.floor(remaining / sizes[d]);

      const code = invertedIndexes.get(dim)!.get(pos) ?? String(pos);
      const label = dataset.dimension[dim].category.label?.[code];
      row[dim] = label !== undefined ? label : code;
    }

    const st = statuses[i];
    if (st != null) row.status = st;

    rows.push(row);
  }

  return rows;
}
```

- [ ] **Step 4: Run tests — verify they all pass**

```bash
npm test -- tests/flattenJsonStat.test.ts
```

Expected: `7 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts tests/flattenJsonStat.test.ts
git commit -m "feat: add types, constants, and flattenJsonStat with tests"
```

---

## Task 3: `fetchIdescat` helper (TDD)

**Files:**
- Create: `tests/fetchIdescat.test.ts`
- Modify: `src/index.ts` — add `fetchIdescat`

- [ ] **Step 1: Write failing tests for `fetchIdescat`**

Create `tests/fetchIdescat.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchIdescat } from '../src/index.js';

function mockFetch(body: unknown, status = 200) {
  return vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchIdescat', () => {
  it('returns parsed JSON on 200 success', async () => {
    mockFetch({ class: 'collection', version: '2.0', link: { item: [] } });
    const result = await fetchIdescat('https://api.idescat.cat/taules/v2');
    expect(result).toMatchObject({ class: 'collection' });
  });

  it('appends lang=ca by default', async () => {
    const fetchMock = mockFetch({ class: 'collection', link: { item: [] } });
    await fetchIdescat('https://api.idescat.cat/taules/v2');
    const calledUrl = (fetchMock as any).mock.calls[0][0] as string;
    expect(calledUrl).toContain('lang=ca');
  });

  it('appends custom lang when provided', async () => {
    const fetchMock = mockFetch({ class: 'collection', link: { item: [] } });
    await fetchIdescat('https://api.idescat.cat/taules/v2', undefined, 'en');
    const calledUrl = (fetchMock as any).mock.calls[0][0] as string;
    expect(calledUrl).toContain('lang=en');
  });

  it('throws on non-2xx HTTP status with API error id and label', async () => {
    mockFetch({ class: 'error', status: '400', id: '01', label: 'Incorrect statistic.' }, 400);
    await expect(fetchIdescat('https://api.idescat.cat/taules/v2/bad'))
      .rejects.toThrow('01');
  });

  it('throws on 2xx with class:error body', async () => {
    mockFetch({ class: 'error', status: '416', id: '05', label: 'Data limit exceeded.' }, 200);
    await expect(fetchIdescat('https://api.idescat.cat/taules/v2/pmh/1/2/com/data'))
      .rejects.toThrow('05');
  });

  it('uses POST when URL + params exceed 2000 chars', async () => {
    const fetchMock = mockFetch({ class: 'dataset', id: [], size: [], dimension: {}, value: [] });
    const longFilter = 'COM=' + Array.from({ length: 200 }, (_, i) => String(i).padStart(3, '0')).join(',');
    await fetchIdescat('https://api.idescat.cat/taules/v2/pmh/1/2/com/data', { params: longFilter });
    const [calledUrl, options] = (fetchMock as any).mock.calls[0] as [string, RequestInit];
    expect(options.method).toBe('POST');
    expect(options.headers).toMatchObject({ 'Content-Type': 'application/x-www-form-urlencoded' });
    expect(options.body).toContain('COM=');
    expect(calledUrl).toContain('lang=ca');
    expect(calledUrl).not.toContain('COM=');
  });

  it('throws on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network failure')));
    await expect(fetchIdescat('https://api.idescat.cat/taules/v2'))
      .rejects.toThrow("No s'ha pogut connectar amb l'API d'IDESCAT: Network failure");
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test -- tests/fetchIdescat.test.ts
```

Expected: `fetchIdescat is not a function` or similar.

- [ ] **Step 3: Add `fetchIdescat` to `src/index.ts`**

Add after the `flattenJsonStat` function:

```typescript
// ─── fetchIdescat ─────────────────────────────────────────────────────────────

export class IdescatError extends Error {
  constructor(public id: string, public apiLabel: string) {
    super(`IDESCAT API error ${id}: ${apiLabel}`);
  }
}

/**
 * Fetch a URL from the IDESCAT API.
 * - Appends lang query param (default: 'ca')
 * - Auto-switches to POST when full URL > 2000 chars
 * - Detects errors from HTTP status AND JSON body class
 * @param url     Base URL (no query string for filters)
 * @param options Optional filter params string (URL-encoded, e.g. "SEX=F&COM=01")
 * @param lang    Language (default: 'ca')
 */
export async function fetchIdescat(
  url: string,
  options?: { params?: string },
  lang: string = DEFAULT_LANG
): Promise<JsonStatDataset | JsonStatCollection> {
  const langParam = `lang=${encodeURIComponent(lang)}`;
  const filterParams = options?.params ?? '';

  // Build the candidate GET URL to measure length
  const separator = url.includes('?') ? '&' : '?';
  const candidateUrl = filterParams
    ? `${url}${separator}${filterParams}&${langParam}`
    : `${url}${separator}${langParam}`;

  let response: Response;
  try {
    if (candidateUrl.length > POST_URL_THRESHOLD && filterParams) {
      // Use POST: lang in query string, filters in body
      const postUrl = `${url}${separator}${langParam}`;
      response = await fetch(postUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: filterParams,
      });
    } else {
      response = await fetch(candidateUrl);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`No s'ha pogut connectar amb l'API d'IDESCAT: ${msg}`);
  }

  const data = await response.json() as JsonStatDataset | JsonStatCollection | IdescatApiError;

  // Check JSON body class first (covers 2xx-with-error-body edge case)
  if ((data as IdescatApiError).class === 'error') {
    const e = data as IdescatApiError;
    throw new IdescatError(e.id, e.label);
  }

  if (!response.ok) {
    // Non-2xx without a recognized error body
    throw new IdescatError('00', `HTTP ${response.status}`);
  }

  return data as JsonStatDataset | JsonStatCollection;
}
```

- [ ] **Step 4: Run tests — verify they all pass**

```bash
npm test -- tests/fetchIdescat.test.ts
```

Expected: `8 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts tests/fetchIdescat.test.ts
git commit -m "feat: add fetchIdescat with GET/POST auto-switch and error handling"
```

---

## Task 4: Tool handlers — catalog, territorial options, metadata (TDD)

**Files:**
- Create: `tests/tools.test.ts`
- Modify: `src/index.ts` — add handler functions

- [ ] **Step 1: Write failing tests for the first three tool handlers**

Create `tests/tools.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  handleListCatalog,
  handleGetTerritorialOptions,
  handleGetTableMetadata,
} from '../src/index.js';

afterEach(() => vi.unstubAllGlobals());

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const collectionFixture = {
  version: '2.0',
  class: 'collection',
  link: {
    item: [
      { class: 'dataset', href: 'https://api.idescat.cat/taules/v2/pmh', label: 'Padró municipal', id: 'pmh' },
      { class: 'dataset', href: 'https://api.idescat.cat/taules/v2/censp', label: 'Cens de població', id: 'censp' },
    ],
  },
};

const metadataFixture = {
  version: '2.0',
  class: 'dataset',
  id: ['SEX', 'YEAR'],
  size: [2, 2],
  dimension: {
    SEX: {
      label: 'Sexe',
      category: { index: { T: 0, H: 1 }, label: { T: 'Total', H: 'Homes' } },
    },
    YEAR: {
      label: 'Any',
      category: { index: { '2022': 0, '2023': 1 }, label: { '2022': '2022', '2023': '2023' } },
      role: 'time',
    },
  },
  value: [],
  extension: {
    status: { label: { p: 'Dades provisionals' } },
    source: ['Idescat, a partir del INE.'],
  },
  link: {
    describes: [{ class: 'dataset', href: 'https://api.idescat.cat/taules/v2/pmh/1/2/com/data', label: 'Pop. per sexe. Comarques' }],
    related: [
      { class: 'dataset', href: 'https://api.idescat.cat/taules/v2/pmh/1/2/prov', label: 'Pop. Provinces' },
      { class: 'dataset', href: 'https://api.idescat.cat/taules/v2/pmh/1/99/com', label: 'Pop. 2001-2010 (hist.)' },
      { class: 'dataset', href: 'https://api.idescat.cat/taules/v2/pmh/1/2/mun', label: 'Pop. Municipis', extension: { group: true } },
    ],
  },
};

function mockFetch(body: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true, status: 200,
    json: () => Promise.resolve(body),
  }));
}

// ─── handleListCatalog ────────────────────────────────────────────────────────

describe('handleListCatalog', () => {
  it('calls base URL when no arguments', async () => {
    const fetchMock = mockFetch(collectionFixture) as any;
    await handleListCatalog({});
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain('/taules/v2?');
  });

  it('calls statistics URL when statistics provided', async () => {
    mockFetch(collectionFixture);
    await handleListCatalog({ statistics: 'pmh' });
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain('/taules/v2/pmh?');
  });

  it('calls node URL when both statistics and node provided', async () => {
    mockFetch(collectionFixture);
    await handleListCatalog({ statistics: 'pmh', node: '1180' });
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain('/taules/v2/pmh/1180?');
  });

  it('returns array of {id, label, href?}', async () => {
    mockFetch(collectionFixture);
    const result = await handleListCatalog({});
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: 'pmh', label: 'Padró municipal', href: expect.any(String) });
  });
});

// ─── handleGetTerritorialOptions ──────────────────────────────────────────────

describe('handleGetTerritorialOptions', () => {
  it('calls the correct territorial options URL', async () => {
    mockFetch(collectionFixture);
    await handleGetTerritorialOptions({ statistics: 'pmh', node: '1180', table: '8078' });
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain('/taules/v2/pmh/1180/8078?');
  });

  it('returns array of {id, label, href}', async () => {
    mockFetch(collectionFixture);
    const result = await handleGetTerritorialOptions({ statistics: 'pmh', node: '1180', table: '8078' });
    expect(result[0]).toMatchObject({ id: 'pmh', label: expect.any(String), href: expect.any(String) });
  });
});

// ─── handleGetTableMetadata ───────────────────────────────────────────────────

describe('handleGetTableMetadata', () => {
  it('returns dimensions with categories', async () => {
    mockFetch(metadataFixture);
    const result = await handleGetTableMetadata({ statistics: 'pmh', node: '1', table: '2', geo: 'com' });
    expect(result.dimensions).toHaveLength(2);
    expect(result.dimensions[0]).toMatchObject({
      id: 'SEX',
      label: 'Sexe',
      categories: [{ id: 'T', label: 'Total' }, { id: 'H', label: 'Homes' }],
    });
  });

  it('extracts statusLegend from extension', async () => {
    mockFetch(metadataFixture);
    const result = await handleGetTableMetadata({ statistics: 'pmh', node: '1', table: '2', geo: 'com' });
    expect(result.statusLegend).toEqual({ p: 'Dades provisionals' });
  });

  it('extracts source from extension', async () => {
    mockFetch(metadataFixture);
    const result = await handleGetTableMetadata({ statistics: 'pmh', node: '1', table: '2', geo: 'com' });
    expect(result.source).toEqual(['Idescat, a partir del INE.']);
  });

  it('extracts describes link', async () => {
    mockFetch(metadataFixture);
    const result = await handleGetTableMetadata({ statistics: 'pmh', node: '1', table: '2', geo: 'com' });
    expect(result.describes).toMatchObject({ href: expect.stringContaining('/data'), label: expect.any(String) });
  });

  it('passes filters as query params', async () => {
    mockFetch(metadataFixture);
    await handleGetTableMetadata({ statistics: 'pmh', node: '1', table: '2', geo: 'com', filters: { SEX: 'H' } });
    const calledUrl = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(calledUrl).toContain('SEX=H');
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test -- tests/tools.test.ts
```

Expected: `handleListCatalog is not a function` or similar.

- [ ] **Step 3: Add the three handler functions to `src/index.ts`**

Add after `fetchIdescat`:

```typescript
// ─── Helper: parse collection items ──────────────────────────────────────────

function parseCollectionItems(collection: JsonStatCollection): CatalogItem[] {
  return collection.link.item.map((item) => {
    const entry: CatalogItem = {
      id: item.id ?? item.href?.split('/').pop() ?? item.label,
      label: item.label,
    };
    if (item.href) entry.href = item.href;
    return entry;
  });
}

// ─── Tool handlers ────────────────────────────────────────────────────────────

export async function handleListCatalog(args: {
  statistics?: string;
  node?: string;
  lang?: string;
}): Promise<CatalogItem[]> {
  const { statistics, node, lang = DEFAULT_LANG } = args;
  let url = BASE_URL;
  if (statistics) url += `/${statistics}`;
  if (statistics && node) url += `/${node}`;
  const data = await fetchIdescat(url, undefined, lang) as JsonStatCollection;
  return parseCollectionItems(data);
}

export async function handleGetTerritorialOptions(args: {
  statistics: string;
  node: string;
  table: string;
  lang?: string;
}): Promise<TerritorialOption[]> {
  const { statistics, node, table, lang = DEFAULT_LANG } = args;
  const url = `${BASE_URL}/${statistics}/${node}/${table}`;
  const data = await fetchIdescat(url, undefined, lang) as JsonStatCollection;
  return data.link.item.map((item) => ({
    id: item.id ?? item.href?.split('/').pop() ?? item.label,
    label: item.label,
    href: item.href ?? `${url}/${item.id}`,
  }));
}

export async function handleGetTableMetadata(args: {
  statistics: string;
  node: string;
  table: string;
  geo: string;
  filters?: Record<string, string>;
  lang?: string;
}): Promise<TableMetadata> {
  const { statistics, node, table, geo, filters, lang = DEFAULT_LANG } = args;
  const url = `${BASE_URL}/${statistics}/${node}/${table}/${geo}`;
  const params = filters ? new URLSearchParams(filters).toString() : undefined;
  const data = await fetchIdescat(url, params ? { params } : undefined, lang) as JsonStatDataset;

  const dimensions: DimensionMeta[] = data.id.map((dimId) => {
    const dim = data.dimension[dimId];
    const cat = dim.category;
    // Build ordered categories from index
    const indexMap = Array.isArray(cat.index)
      ? Object.fromEntries(cat.index.map((code, pos) => [pos, code]))
      : Object.fromEntries(Object.entries(cat.index).map(([code, pos]) => [pos, code]));

    const count = Array.isArray(cat.index) ? cat.index.length : Object.keys(cat.index).length;
    const categories = Array.from({ length: count }, (_, pos) => {
      const code = indexMap[pos] ?? String(pos);
      return { id: code, label: cat.label?.[code] ?? code };
    });

    const entry: DimensionMeta = { id: dimId, label: dim.label, categories };
    if (dim.extension?.break) entry.breaks = dim.extension.break;
    return entry;
  });

  const result: TableMetadata = { dimensions };
  if (data.extension?.status?.label) result.statusLegend = data.extension.status.label;
  if (data.extension?.source) result.source = data.extension.source;
  if (data.link?.describes?.[0]) {
    result.describes = {
      href: data.link.describes[0].href,
      label: data.link.describes[0].label,
    };
  }
  return result;
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm test -- tests/tools.test.ts
```

Expected: all tests for the three handlers pass.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts tests/tools.test.ts
git commit -m "feat: add handleListCatalog, handleGetTerritorialOptions, handleGetTableMetadata"
```

---

## Task 5: Tool handler — `idescat_query_data` (TDD)

**Files:**
- Modify: `tests/tools.test.ts` — add query_data tests
- Modify: `src/index.ts` — add `handleQueryData`

- [ ] **Step 1: Add failing tests for `handleQueryData` to `tests/tools.test.ts`**

Append to `tests/tools.test.ts`:

```typescript
import { handleQueryData } from '../src/index.js';

// Add this import at the top of the file (merge with existing import line):
// import { handleListCatalog, handleGetTerritorialOptions, handleGetTableMetadata, handleQueryData } from '../src/index.js';

const dataFixture = {
  version: '2.0',
  class: 'dataset',
  id: ['SEX', 'YEAR'],
  size: [2, 2],
  dimension: {
    SEX: { label: 'Sexe', category: { index: { T: 0, H: 1 }, label: { T: 'Total', H: 'Homes' } } },
    YEAR: { label: 'Any', category: { index: { '2022': 0, '2023': 1 }, label: { '2022': '2022', '2023': '2023' } }, role: 'time' },
  },
  value: [100, 200, 50, 80],
};

describe('handleQueryData', () => {
  it('calls the data endpoint', async () => {
    mockFetch(dataFixture);
    await handleQueryData({ statistics: 'pmh', node: '1', table: '2', geo: 'com' });
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain('/data');
  });

  it('returns flattened rows with labels', async () => {
    mockFetch(dataFixture);
    const rows = await handleQueryData({ statistics: 'pmh', node: '1', table: '2', geo: 'com' });
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ SEX: 'Total', YEAR: '2022', value: 100 });
  });

  it('appends filters to URL', async () => {
    mockFetch(dataFixture);
    await handleQueryData({ statistics: 'pmh', node: '1', table: '2', geo: 'com', filters: { SEX: 'H' } });
    const calledUrl = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(calledUrl).toContain('SEX=H');
  });

  it('appends _LAST_ when last is provided', async () => {
    mockFetch(dataFixture);
    await handleQueryData({ statistics: 'pmh', node: '1', table: '2', geo: 'com', last: 2 });
    const calledUrl = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(calledUrl).toContain('_LAST_=2');
  });

  it('on error 05, makes metadata follow-up and returns helpful message', async () => {
    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // First call: data endpoint → error 05
        return Promise.resolve({
          ok: false, status: 416,
          json: () => Promise.resolve({ class: 'error', status: '416', id: '05', label: 'Data limit exceeded.' }),
        });
      }
      // Second call: metadata endpoint
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve(metadataFixture),
      });
    }));

    const result = await handleQueryData({ statistics: 'pmh', node: '1', table: '2', geo: 'com' });
    expect(typeof result).toBe('string');
    expect(result as string).toContain('20.000');
    expect(result as string).toContain('SEX');
    expect(result as string).toContain('YEAR');
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test -- tests/tools.test.ts
```

Expected: `handleQueryData is not a function`.

- [ ] **Step 3: Add `handleQueryData` to `src/index.ts`**

```typescript
export async function handleQueryData(args: {
  statistics: string;
  node: string;
  table: string;
  geo: string;
  filters?: Record<string, string>;
  last?: number;
  lang?: string;
}): Promise<FlatRow[] | string> {
  const { statistics, node, table, geo, filters, last, lang = DEFAULT_LANG } = args;
  const url = `${BASE_URL}/${statistics}/${node}/${table}/${geo}/data`;

  // Build filter params string
  const paramParts: string[] = [];
  if (filters) {
    for (const [k, v] of Object.entries(filters)) {
      paramParts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
    }
  }
  if (last !== undefined) paramParts.push(`_LAST_=${last}`);
  const params = paramParts.length > 0 ? paramParts.join('&') : undefined;

  let data: JsonStatDataset;
  try {
    data = await fetchIdescat(url, params ? { params } : undefined, lang) as JsonStatDataset;
  } catch (err) {
    if (err instanceof IdescatError && err.id === '05') {
      // Follow-up metadata call to list available dimensions
      const metaUrl = `${BASE_URL}/${statistics}/${node}/${table}/${geo}`;
      let hint = '';
      try {
        const meta = await fetchIdescat(metaUrl, undefined, lang) as JsonStatDataset;
        const dimHints = meta.id.map((dimId) => {
          const cat = meta.dimension[dimId].category;
          const codes = Array.isArray(cat.index)
            ? cat.index.slice(0, 10).join(', ')
            : Object.keys(cat.index).slice(0, 10).join(', ');
          return `  - ${dimId}: ${codes}${Object.keys(cat.index).length > 10 ? ', ...' : ''}`;
        });
        hint = `\n\nDimensions disponibles per filtrar:\n${dimHints.join('\n')}`;
      } catch {
        hint = '';
      }
      return `Límit de 20.000 dades superat. Afegeix filtres per reduir la consulta.${hint}`;
    }
    throw err;
  }

  return flattenJsonStat(data);
}
```

- [ ] **Step 4: Run all tests — verify they pass**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts tests/tools.test.ts
git commit -m "feat: add handleQueryData with error-05 follow-up and _LAST_ support"
```

---

## Task 6: Tool handler — `idescat_check_historical_relations` (TDD)

**Files:**
- Modify: `tests/tools.test.ts` — add historical relations tests
- Modify: `src/index.ts` — add `handleCheckHistoricalRelations`

- [ ] **Step 1: Add failing tests to `tests/tools.test.ts`**

Update the import line at the top to include `handleCheckHistoricalRelations`, then append:

```typescript
import { handleCheckHistoricalRelations } from '../src/index.js';

describe('handleCheckHistoricalRelations', () => {
  it('classifies other_geos correctly (same table segment)', async () => {
    mockFetch(metadataFixture); // related has pmh/1/2/prov (table=2 = current)
    const result = await handleCheckHistoricalRelations({ statistics: 'pmh', node: '1', table: '2', geo: 'com' });
    expect(result.other_geos).toHaveLength(1);
    expect(result.other_geos[0].label).toBe('Pop. Provinces');
  });

  it('classifies historical correctly (different table segment, no group)', async () => {
    mockFetch(metadataFixture); // related has pmh/1/99/com (table=99 ≠ 2)
    const result = await handleCheckHistoricalRelations({ statistics: 'pmh', node: '1', table: '2', geo: 'com' });
    expect(result.historical).toHaveLength(1);
    expect(result.historical[0].label).toContain('hist');
  });

  it('classifies grouped correctly (extension.group === true)', async () => {
    mockFetch(metadataFixture); // related has pmh/1/2/mun with extension.group=true
    const result = await handleCheckHistoricalRelations({ statistics: 'pmh', node: '1', table: '2', geo: 'com' });
    expect(result.grouped).toHaveLength(1);
    expect(result.grouped[0].label).toContain('Municipis');
  });

  it('returns empty arrays when no related links', async () => {
    const noRelated = { ...metadataFixture, link: { describes: metadataFixture.link.describes } };
    mockFetch(noRelated);
    const result = await handleCheckHistoricalRelations({ statistics: 'pmh', node: '1', table: '2', geo: 'com' });
    expect(result).toEqual({ other_geos: [], historical: [], grouped: [] });
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test -- tests/tools.test.ts
```

Expected: `handleCheckHistoricalRelations is not a function`.

- [ ] **Step 3: Add `handleCheckHistoricalRelations` to `src/index.ts`**

```typescript
export async function handleCheckHistoricalRelations(args: {
  statistics: string;
  node: string;
  table: string;
  geo: string;
  lang?: string;
}): Promise<HistoricalRelations> {
  const { statistics, node, table, geo, lang = DEFAULT_LANG } = args;
  const url = `${BASE_URL}/${statistics}/${node}/${table}/${geo}`;
  const data = await fetchIdescat(url, undefined, lang) as JsonStatDataset;

  const related = data.link?.related ?? [];
  const result: HistoricalRelations = { other_geos: [], historical: [], grouped: [] };

  for (const entry of related) {
    const item = { href: entry.href, label: entry.label };
    if (entry.extension?.group) {
      result.grouped.push(item);
      continue;
    }
    // Extract table segment: URL path is .../v2/{stat}/{node}/{tableId}/{geo}
    // Split by '/' and take the 7th segment (0-indexed: v2=3, stat=4, node=5, table=6, geo=7)
    try {
      const pathParts = new URL(entry.href).pathname.split('/').filter(Boolean);
      // pathname parts: ['taules', 'v2', stat, node, tableId, geo]
      const entryTableId = pathParts[4]; // index 4 = table segment
      if (entryTableId === table) {
        result.other_geos.push(item);
      } else {
        result.historical.push(item);
      }
    } catch {
      result.historical.push(item);
    }
  }

  return result;
}
```

- [ ] **Step 4: Run all tests — verify they pass**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts tests/tools.test.ts
git commit -m "feat: add handleCheckHistoricalRelations with URL-based classification"
```

---

## Task 7: MCP server wiring + entry point

**Files:**
- Modify: `src/index.ts` — add Server setup, tool definitions, entry point

- [ ] **Step 1: Add MCP server wiring at the bottom of `src/index.ts`**

```typescript
// ─── MCP Server ───────────────────────────────────────────────────────────────

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const server = new Server(
  { name: 'idescat-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'idescat_list_catalog',
      description: 'Navega el catàleg de l\'IDESCAT: llista estadístiques, nodes o taules. Crida sense paràmetres per veure totes les estadístiques disponibles.',
      inputSchema: {
        type: 'object',
        properties: {
          statistics: { type: 'string', description: 'Codi de l\'estadística (ex: pmh). Opcional.' },
          node: { type: 'string', description: 'Codi del node (requereix statistics). Opcional.' },
          lang: { type: 'string', description: 'Idioma: ca (defecte), es, en.' },
        },
      },
    },
    {
      name: 'idescat_get_territorial_options',
      description: 'Retorna les divisions territorials disponibles per a una taula específica (cat, com, mun, prov, etc.).',
      inputSchema: {
        type: 'object',
        required: ['statistics', 'node', 'table'],
        properties: {
          statistics: { type: 'string' },
          node: { type: 'string' },
          table: { type: 'string' },
          lang: { type: 'string', description: 'Idioma: ca (defecte), es, en.' },
        },
      },
    },
    {
      name: 'idescat_get_table_metadata',
      description: 'Retorna les metadades d\'una taula: dimensions, valors possibles, fonts i enllaç a les dades. Usa-la ABANS de idescat_query_data per saber quins filtres aplicar.',
      inputSchema: {
        type: 'object',
        required: ['statistics', 'node', 'table', 'geo'],
        properties: {
          statistics: { type: 'string' },
          node: { type: 'string' },
          table: { type: 'string' },
          geo: { type: 'string', description: 'Divisió territorial (cat, com, mun, prov, etc.).' },
          filters: { type: 'object', description: 'Filtres opcionals per reduir les dimensions mostrades. Ex: {"SEX": "F"}', additionalProperties: { type: 'string' } },
          lang: { type: 'string', description: 'Idioma: ca (defecte), es, en.' },
        },
      },
    },
    {
      name: 'idescat_query_data',
      description: 'Obté dades d\'una taula com a array de files aplanades amb etiquetes. Consulta primer idescat_get_table_metadata per saber les dimensions i filtres disponibles.',
      inputSchema: {
        type: 'object',
        required: ['statistics', 'node', 'table', 'geo'],
        properties: {
          statistics: { type: 'string' },
          node: { type: 'string' },
          table: { type: 'string' },
          geo: { type: 'string' },
          filters: { type: 'object', description: 'Filtres per dimensió. Ex: {"SEX": "F", "COM": "01,TOTAL"}', additionalProperties: { type: 'string' } },
          last: { type: 'number', description: 'Retorna els darrers N períodes disponibles (_LAST_). No combinar amb filtre de temps.' },
          lang: { type: 'string', description: 'Idioma: ca (defecte), es, en.' },
        },
      },
    },
    {
      name: 'idescat_check_historical_relations',
      description: 'Descobreix taules relacionades: versions anteriors de la mateixa sèrie i les mateixes dades en altres divisions territorials.',
      inputSchema: {
        type: 'object',
        required: ['statistics', 'node', 'table', 'geo'],
        properties: {
          statistics: { type: 'string' },
          node: { type: 'string' },
          table: { type: 'string' },
          geo: { type: 'string' },
          lang: { type: 'string', description: 'Idioma: ca (defecte), es, en.' },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = (args ?? {}) as Record<string, unknown>;

  try {
    let result: unknown;

    if (name === 'idescat_list_catalog') {
      result = await handleListCatalog(a as Parameters<typeof handleListCatalog>[0]);
    } else if (name === 'idescat_get_territorial_options') {
      result = await handleGetTerritorialOptions(a as Parameters<typeof handleGetTerritorialOptions>[0]);
    } else if (name === 'idescat_get_table_metadata') {
      result = await handleGetTableMetadata(a as Parameters<typeof handleGetTableMetadata>[0]);
    } else if (name === 'idescat_query_data') {
      result = await handleQueryData(a as Parameters<typeof handleQueryData>[0]);
    } else if (name === 'idescat_check_historical_relations') {
      result = await handleCheckHistoricalRelations(a as Parameters<typeof handleCheckHistoricalRelations>[0]);
    } else {
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }

    const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    return { content: [{ type: 'text', text }] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text', text: msg }], isError: true };
  }
});

export async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Only start server when run directly (not imported by tests)
import { fileURLToPath } from 'node:url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(console.error);
}
```

> Note: the `import { fileURLToPath }` at the top of the file (already added in Task 2) covers this. Move the imports to the top of the file if needed.

- [ ] **Step 2: Consolidate all imports at the top of `src/index.ts`**

Ensure the file starts with:

```typescript
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
```

- [ ] **Step 3: Run all tests — verify nothing is broken**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Smoke test the server manually**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | tsx src/index.ts
```

Expected: JSON response listing all 5 tools.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire MCP server with all 5 tools and stdio transport"
```

---

## Task 8: README and Claude Desktop config

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create `README.md`**

```markdown
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
```

- [ ] **Step 2: Run final test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Final commit**

```bash
git add README.md
git commit -m "docs: add README with Claude Desktop integration instructions"
```
