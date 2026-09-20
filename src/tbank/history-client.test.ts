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

  it('uses FIGI for the annual archive endpoint when it is available', async () => {
    const archive = new Uint8Array([80, 75, 3, 4]);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(archive, { status: 200, headers: { 'Content-Type': 'application/zip' } }),
    );
    const client = new TInvestHistoryClient('read-secret', 'https://example.test/history-data', {
      fetchImpl: fetchMock,
    });

    await expect(client.getMinuteCandleArchive({ figi: 'BBG004730N88', year: 2025 })).resolves.toEqual(
      archive,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.test/history-data?figi=BBG004730N88&year=2025',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('retries transient network failures before succeeding', async () => {
    const archive = new Uint8Array([80, 75, 3, 4]);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('fetch failed: UND_ERR_SOCKET: other side closed'))
      .mockRejectedValueOnce(new Error('fetch failed: UND_ERR_SOCKET: other side closed'))
      .mockResolvedValueOnce(new Response(archive, { status: 200 }));
    const sleepMock = vi.fn(async () => undefined);
    const client = new TInvestHistoryClient('read-secret', 'https://example.test/history-data', {
      fetchImpl: fetchMock,
      retryDelayMs: 0,
      sleep: sleepMock,
    });

    await expect(client.getMinuteCandleArchive({ instrumentId: 'uid', year: 2025 })).resolves.toEqual(archive);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleepMock).toHaveBeenCalledTimes(2);
  });

  it('retries rate limits and upstream server failures', async () => {
    const archive = new Uint8Array([80, 75, 3, 4]);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('busy', { status: 429 }))
      .mockResolvedValueOnce(new Response('temporary failure', { status: 503 }))
      .mockResolvedValueOnce(new Response(archive, { status: 200 }));
    const client = new TInvestHistoryClient('read-secret', 'https://example.test/history-data', {
      fetchImpl: fetchMock,
      retryDelayMs: 0,
      sleep: vi.fn(async () => undefined),
    });

    await expect(client.getMinuteCandleArchive({ instrumentId: 'uid', year: 2025 })).resolves.toEqual(archive);
    expect(fetchMock).toHaveBeenCalledTimes(3);
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

  it('requires exactly one archive identifier', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = new TInvestHistoryClient('read-secret', 'https://example.test/history-data', {
      fetchImpl: fetchMock,
    });

    await expect(client.getMinuteCandleArchive({ year: 2025 })).rejects.toThrow(
      'exactly one of figi or instrumentId',
    );
    await expect(
      client.getMinuteCandleArchive({ figi: 'BBG004730N88', instrumentId: 'uid', year: 2025 }),
    ).rejects.toThrow('exactly one of figi or instrumentId');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
