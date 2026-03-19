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
