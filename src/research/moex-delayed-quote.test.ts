import { describe, expect, it } from 'vitest';
import { parseDelayedMoexQuote } from './moex-delayed-quote.js';

const input = {
  instrumentId: 'SiZ6',
  observedAt: '2026-09-26T15:38:00.000Z',
  payload: {
    marketdata: {
      columns: ['SYSTIME', 'OFFER', 'UPDATETIME', 'SECID', 'TRADEDATE', 'BID'],
      data: [['2026-09-26 18:38:00', 85538, '18:22:47', 'SiZ6', '2026-09-26', 85534]],
    },
  },
};

describe('delayed MOEX quote', () => {
  it('maps fields by column name and labels the source as delayed', () => {
    expect(parseDelayedMoexQuote(input)).toMatchObject({
      source: 'moex-iss-delayed', bid: 85534, ask: 85538, exchangeUpdateTime: '18:22:47',
    });
  });

  it('rejects missing and crossed quotes', () => {
    expect(parseDelayedMoexQuote({ ...input, payload: { marketdata: { columns: [], data: [] } } })).toBeNull();
    expect(parseDelayedMoexQuote({ ...input, payload: {
      marketdata: { columns: ['SECID', 'BID', 'OFFER', 'TRADEDATE', 'UPDATETIME', 'SYSTIME'],
        data: [['SiZ6', 85538, 85534, '2026-09-26', '18:22:47', '2026-09-26 18:38:00']] },
    } })).toBeNull();
  });
});
