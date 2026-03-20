import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  handleListCatalog,
  handleGetTerritorialOptions,
  handleGetTableMetadata,
  handleQueryData,
  handleCheckHistoricalRelations,
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

  it('on error 03, makes catalog follow-up and returns helpful message with table list', async () => {
    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: false, status: 400,
          json: () => Promise.resolve({ class: 'error', status: '400', id: '03', label: 'Identificador de taula incorrecte.' }),
        });
      }
      // Second call: catalog listing for node
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve(collectionFixture),
      });
    }));

    const result = await handleGetTableMetadata({ statistics: 'pmh', node: '1', table: '1', geo: 'com' });
    expect(typeof result).toBe('string');
    expect(result as string).toContain('Identificador de taula incorrecte');
    expect(result as string).toContain('"1"');
    expect(result as string).toContain('idescat_list_catalog');
    expect(result as string).toContain('pmh');
  });
});

// ─── handleQueryData ──────────────────────────────────────────────────────────

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

  it('on error 03, makes catalog follow-up and returns helpful message with table list', async () => {
    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: false, status: 400,
          json: () => Promise.resolve({ class: 'error', status: '400', id: '03', label: 'Identificador de taula incorrecte.' }),
        });
      }
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve(collectionFixture),
      });
    }));

    const result = await handleQueryData({ statistics: 'pmh', node: '1', table: '1', geo: 'com' });
    expect(typeof result).toBe('string');
    expect(result as string).toContain('Identificador de taula incorrecte');
    expect(result as string).toContain('idescat_list_catalog');
    expect(result as string).toContain('pmh');
  });
});

// ─── handleCheckHistoricalRelations ──────────────────────────────────────────

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
