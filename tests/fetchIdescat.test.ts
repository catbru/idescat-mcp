import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchIdescat } from '../src/index.js';

function mockFetch(body: unknown, status = 200) {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
  vi.stubGlobal('fetch', fn);
  return fn;
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
    const longFilter = 'COM=' + Array.from({ length: 500 }, (_, i) => String(i).padStart(3, '0')).join(',');
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
