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
    mockFetch(collectionFixture);
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
