import { describe, expect, it } from 'vitest';
import { analyzeTmonQuoteAttempts } from './tmon-quote-quality.js';
import { parseDelayedStockQuote } from './moex-delayed-stock-quote.js';

const payload = { marketdata: { columns: ['SECID', 'BOARDID', 'TRADINGSTATUS', 'BID', 'OFFER', 'SYSTIME', 'UPDATETIME', 'BIDDEPTH', 'OFFERDEPTH'],
  data: [['TMON', 'TQBR', 'T', 100, 100.01, '2026-09-28 10:00:00', '09:59:59', 1000, 2000]] } };
const observedAtUtc = '2026-09-28T07:15:00.000Z';
const sample = parseDelayedStockQuote({ ticker: 'TMON', observedAtUtc, payload });
const line = JSON.stringify({ ticker: 'TMON', board: 'TQBR', attemptedAtUtc: observedAtUtc,
  status: 'accepted', payload, sample });

describe('TMON quote quality', () => {
  it('deduplicates unchanged source quotes and keeps window coverage', () => {
    const result = analyzeTmonQuoteAttempts([line, line]);
    expect(result.acceptedAttempts).toBe(2);
    expect(result.uniqueQuotes).toBe(1);
    expect(result.duplicates).toBe(1);
    expect(result.byDate['2026-09-28']?.openingWindowQuotes).toBe(1);
    expect(result.spreadBps.median).toBeGreaterThan(0);
    expect(result.quoteAgeAtSourceMinutes.median).toBeCloseTo(1 / 60);
  });
  it('does not count advancing system time as a fresh quote update', () => {
    const secondPayload = structuredClone(payload);
    secondPayload.marketdata.data[0]![5] = '2026-09-28 10:01:00';
    const secondSample = parseDelayedStockQuote({ ticker: 'TMON', observedAtUtc: '2026-09-28T07:16:00.000Z', payload: secondPayload });
    const secondLine = JSON.stringify({ ticker: 'TMON', board: 'TQBR', attemptedAtUtc: '2026-09-28T07:16:00.000Z',
      status: 'accepted', payload: secondPayload, sample: secondSample });
    const result = analyzeTmonQuoteAttempts([line, secondLine]);
    expect(result.acceptedAttempts).toBe(2);
    expect(result.uniqueQuotes).toBe(1);
    expect(result.duplicates).toBe(1);
  });
  it('rejects malformed accepted observations', () => {
    expect(() => analyzeTmonQuoteAttempts([line.replace('100.01', '99.99')])).toThrow();
  });
  it('reports an old quote rather than treating it as fresh', () => {
    const oldPayload = structuredClone(payload);
    oldPayload.marketdata.data[0]![6] = '09:40:00';
    const oldSample = parseDelayedStockQuote({ ticker: 'TMON', observedAtUtc, payload: oldPayload });
    const oldLine = JSON.stringify({ ticker: 'TMON', board: 'TQBR', attemptedAtUtc: observedAtUtc,
      status: 'accepted', payload: oldPayload, sample: oldSample });
    expect(analyzeTmonQuoteAttempts([oldLine]).quoteAgeAtSourceMinutes.median).toBe(20);
  });
});
