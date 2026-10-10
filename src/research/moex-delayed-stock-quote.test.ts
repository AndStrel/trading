import { describe, expect, it } from 'vitest';
import { parseDelayedStockQuote } from './moex-delayed-stock-quote.js';

const columns = ['SECID', 'BOARDID', 'BID', 'BIDDEPTH', 'OFFER', 'OFFERDEPTH', 'TRADINGSTATUS', 'UPDATETIME', 'SYSTIME'];
const row = ['TMON', 'TQBR', 150, 100, 150.03, 120, 'T', '10:00:00', '2026-09-28 10:15:00'];
const input = { ticker: 'TMON' as const, observedAtUtc: '2026-09-28T07:15:05.000Z' };

describe('public delayed stock quote parser', () => {
  it('accepts a normal-trading positive best bid/ask with explicit delay provenance', () => {
    const quote = parseDelayedStockQuote({ ...input, payload: { marketdata: { columns, data: [row] } } });
    expect(quote?.bid).toBe(150);
    expect(quote?.ask).toBe(150.03);
    expect(quote?.bidDepth).toBe(100);
    expect(quote?.source).toBe('MOEX_ISS_DELAYED');
    expect(quote?.spreadBps).toBeGreaterThan(1);
  });

  it('rejects closed sessions, crossed books, wrong ticker and missing quotes', () => {
    for (const changed of [
      ['TMON', 'TQBR', 150, 100, 150.03, 120, 'N', '10:00:00', '2026-09-28 10:15:00'],
      ['TMON', 'TQBR', 150.03, 100, 150, 120, 'T', '10:00:00', '2026-09-28 10:15:00'],
      ['TGLD', 'TQBR', 150, 100, 150.03, 120, 'T', '10:00:00', '2026-09-28 10:15:00'],
      ['TMON', 'TQBR', null, 100, 150.03, 120, 'T', '10:00:00', '2026-09-28 10:15:00'],
    ]) expect(parseDelayedStockQuote({ ...input, payload: { marketdata: { columns, data: [changed] } } })).toBeNull();
  });
});
