import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

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
  version?: string;
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

// ─── fetchIdescat ─────────────────────────────────────────────────────────────

export class IdescatError extends Error {
  constructor(public id: string, public apiLabel: string) {
    super(`IDESCAT API error ${id}: ${apiLabel}`);
    this.name = 'IdescatError';
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

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);

  let response: Response;
  try {
    if (candidateUrl.length > POST_URL_THRESHOLD && filterParams) {
      const postUrl = `${url}${separator}${langParam}`;
      response = await fetch(postUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: filterParams,
        signal: controller.signal,
      });
    } else {
      response = await fetch(candidateUrl, { signal: controller.signal });
    }
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error("No s'ha pogut connectar amb l'API d'IDESCAT: timeout de 30 segons superat");
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`No s'ha pogut connectar amb l'API d'IDESCAT: ${msg}`);
  }

  clearTimeout(timeoutId);

  let data: JsonStatDataset | JsonStatCollection | IdescatApiError;
  try {
    data = await response.json() as JsonStatDataset | JsonStatCollection | IdescatApiError;
  } catch {
    throw new IdescatError('00', `Resposta no vàlida de l'API (HTTP ${response.status})`);
  }

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
    href: item.href ?? (item.id ? `${url}/${item.id}` : url),
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
  const params = filters
    ? Object.entries(filters).map(([k, v]) => `${encodeURIComponent(k)}=${v}`).join('&')
    : undefined;
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
      paramParts.push(`${encodeURIComponent(k)}=${v}`);
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
          const allCodes = Array.isArray(cat.index) ? cat.index : Object.keys(cat.index);
          const codes = allCodes.slice(0, 10).join(', ');
          return `  - ${dimId}: ${codes}${allCodes.length > 10 ? ', ...' : ''}`;
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
    // Extract table segment: URL pathname is /taules/v2/{stat}/{node}/{tableId}/{geo}
    // Split by '/' → ['', 'taules', 'v2', stat, node, tableId, geo]
    try {
      const pathParts = new URL(entry.href).pathname.split('/').filter(Boolean);
      // pathParts: ['taules', 'v2', stat, node, tableId, geo]
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

// ─── flattenJsonStat ──────────────────────────────────────────────────────────

/** Normalize a sparse-object or dense-array value/status field to a dense array. */
function normalizeSparse<T>(
  field: T[] | { [index: string]: T } | undefined
): (T | null)[] {
  if (!field) return [];
  if (Array.isArray(field)) return field as (T | null)[];
  const keys = Object.keys(field).map(Number);
  if (keys.length === 0) return [];
  const maxIndex = Math.max(...keys);
  const arr: (T | null)[] = new Array(maxIndex + 1).fill(null);
  for (const [k, v] of Object.entries(field)) {
    arr[Number(k)] = v;
  }
  return arr;
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

// ─── MCP Server ───────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'idescat-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'idescat_list_catalog',
      description: "Navega el catàleg de l'IDESCAT: llista estadístiques, nodes o taules. Crida sense paràmetres per veure totes les estadístiques disponibles.",
      inputSchema: {
        type: 'object',
        properties: {
          statistics: { type: 'string', description: "Codi de l'estadística (ex: pmh). Opcional." },
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
      description: "Retorna les metadades d'una taula: dimensions, valors possibles, fonts i enllaç a les dades. Usa-la ABANS de idescat_query_data per saber quins filtres aplicar.",
      inputSchema: {
        type: 'object',
        required: ['statistics', 'node', 'table', 'geo'],
        properties: {
          statistics: { type: 'string' },
          node: { type: 'string' },
          table: { type: 'string' },
          geo: { type: 'string', description: 'Divisió territorial (cat, com, mun, prov, etc.).' },
          filters: { type: 'object', description: 'Filtres opcionals. Ex: {"SEX": "F"}', additionalProperties: { type: 'string' } },
          lang: { type: 'string', description: 'Idioma: ca (defecte), es, en.' },
        },
      },
    },
    {
      name: 'idescat_query_data',
      description: "Obté dades d'una taula com a array de files aplanades amb etiquetes. Consulta primer idescat_get_table_metadata per saber les dimensions i filtres disponibles.",
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
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(console.error);
}
