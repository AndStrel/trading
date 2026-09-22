import { describe, expect, it } from 'vitest';

import { MoexIssHistoryClient } from './iss-history-client.js';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('MoexIssHistoryClient', () => {
  it('paginates TQBR minute candles and converts Moscow time to UTC', async () => {
    const starts: string[] = [];
    const fetchImpl = async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (!url.pathname.endsWith('/candles.json')) {
        return jsonResponse({ securities: { columns: ['SECID', 'LOTSIZE', 'MINSTEP'], data: [['SBER', 10, 0.01]] } });
      }
      const start = url.searchParams.get('start') ?? '';
      starts.push(start);
      return start === '0'
        ? jsonResponse({
            candles: {
              columns: ['open', 'close', 'high', 'low', 'volume', 'begin'],
              data: [
                [250, 251, 252, 249, 1000, '2025-01-03 10:00:00'],
                [251, 252, 253, 250, 1100, '2025-01-03 10:01:00'],
              ],
            },
          })
        : jsonResponse({ candles: { columns: ['open', 'close', 'high', 'low', 'volume', 'begin'], data: [] } });
    };
    const client = new MoexIssHistoryClient('https://iss.example/iss', {
      fetchImpl: fetchImpl as typeof fetch,
      retryDelayMs: 0,
      pageDelayMs: 0,
    });

    const result = await client.getMinuteHistory('sber', 2025);

    expect(starts).toEqual(['0', '2']);
    expect(result).toMatchObject({
      ticker: 'SBER',
      instrumentId: 'MOEX:TQBR:SBER',
      lotSize: 10,
      priceStep: 0.01,
      rawRowCount: 2,
      invalidRowCount: 0,
      duplicateRowCount: 0,
    });
    expect(result.archiveSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.candles.map((candle) => candle.time)).toEqual([
      '2025-01-03T07:00:00.000Z',
      '2025-01-03T07:01:00.000Z',
    ]);
  });

  it('counts invalid and duplicate rows without storing broken candles', async () => {
    let candlePage = 0;
    const fetchImpl = async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (!url.pathname.endsWith('/candles.json')) {
        return jsonResponse({ securities: { columns: ['SECID', 'LOTSIZE', 'MINSTEP'], data: [['GAZP', 10, 0.01]] } });
      }
      candlePage += 1;
      return candlePage === 1
        ? jsonResponse({
            candles: {
              columns: ['open', 'close', 'high', 'low', 'volume', 'begin'],
              data: [
                [100, 101, 102, 99, 25, '2025-02-03 10:00:00'],
                [100, 101, 98, 99, 25, '2025-02-03 10:01:00'],
                [100, 101, 102, 99, 30, '2025-02-03 10:00:00'],
              ],
            },
          })
        : jsonResponse({ candles: { columns: ['open', 'close', 'high', 'low', 'volume', 'begin'], data: [] } });
    };
    const client = new MoexIssHistoryClient('https://iss.example/iss', {
      fetchImpl: fetchImpl as typeof fetch,
      retryDelayMs: 0,
      pageDelayMs: 0,
    });

    const result = await client.getMinuteHistory('GAZP', 2025);

    expect(result.rawRowCount).toBe(3);
    expect(result.invalidRowCount).toBe(1);
    expect(result.duplicateRowCount).toBe(1);
    expect(result.candles).toHaveLength(1);
    expect(result.candles[0]?.volume).toBe(30);
  });

  it('retries transient HTTP failures with a bounded attempt count', async () => {
    let requests = 0;
    const fetchImpl = async () => {
      requests += 1;
      return requests === 1
        ? jsonResponse({ message: 'busy' }, 503)
        : jsonResponse({ securities: { columns: ['SECID', 'LOTSIZE', 'MINSTEP'], data: [['SBER', 10, 0.01]] } });
    };
    const client = new MoexIssHistoryClient('https://iss.example/iss', {
      fetchImpl: fetchImpl as typeof fetch,
      retryAttempts: 2,
      retryDelayMs: 0,
    });

    await expect(client.getInstrument('SBER')).resolves.toMatchObject({ ticker: 'SBER' });
    expect(requests).toBe(2);
  });
});
