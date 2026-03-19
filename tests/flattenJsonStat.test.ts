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
