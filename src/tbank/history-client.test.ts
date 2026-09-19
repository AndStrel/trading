import { describe, expect, it, vi } from 'vitest';

import { TInvestHistoryClient, type CurlGetArchive } from './history-client.js';

describe('TInvestHistoryClient', () => {
  it('requires a read-only token before downloading an archive', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = new TInvestHistoryClient(undefined, 'https://example.test/history-data', {
      fetchImpl: fetchMock,
    });

    await expect(client.getMinuteCandleArchive({ instrumentId: 'uid', year: 2025 })).rejects.toThrow(
      'T_INVEST_TOKEN is not configured',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('downloads an annual archive with an authorized HTTPS request', async () => {
    const archive = new Uint8Array([80, 75, 3, 4]);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(archive, { status: 200, headers: { 'Content-Type': 'application/zip' } }),
    );
    const client = new TInvestHistoryClient('read-secret', 'https://example.test/history-data', {
      fetchImpl: fetchMock,
    });

    await expect(client.getMinuteCandleArchive({ instrumentId: 'instrument uid', year: 2025 })).resolves.toEqual(
      archive,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.test/history-data?instrument_id=instrument+uid&year=2025',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer read-secret' }),
      }),
    );
  });

  it('uses system curl only when configured', async () => {
    const curlGetArchive = vi.fn<CurlGetArchive>().mockResolvedValue({
      status: 200,
      statusText: 'HTTP 200',
      body: new Uint8Array([80, 75, 3, 4]),
    });
    const fetchMock = vi.fn<typeof fetch>();
    const client = new TInvestHistoryClient('read-secret', 'https://example.test/history-data', {
      transport: 'system-curl',
      fetchImpl: fetchMock,
      curlGetArchive,
    });

    await expect(client.getMinuteCandleArchive({ instrumentId: 'uid', year: 2025 })).resolves.toEqual(
      new Uint8Array([80, 75, 3, 4]),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(curlGetArchive).toHaveBeenCalledWith({
      url: 'https://example.test/history-data?instrument_id=uid&year=2025',
      token: 'read-secret',
    });
  });

  it('does not leak the token when the API returns an error', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ code: '30000', message: 'Bad request' }), { status: 400 }),
    );
    const client = new TInvestHistoryClient('read-secret', 'https://example.test/history-data', {
      fetchImpl: fetchMock,
    });

    await expect(client.getMinuteCandleArchive({ instrumentId: 'uid', year: 2025 })).rejects.toThrow(
      'T-Invest history API 400: 30000: Bad request',
    );
    await client.getMinuteCandleArchive({ instrumentId: 'uid', year: 2025 }).catch((error: unknown) => {
      expect(String(error)).not.toContain('read-secret');
    });
  });

  it('rejects impossible years before contacting the API', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = new TInvestHistoryClient('read-secret', 'https://example.test/history-data', {
      fetchImpl: fetchMock,
    });

    await expect(client.getMinuteCandleArchive({ instrumentId: 'uid', year: 1999 })).rejects.toThrow(
      'History archive year',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
