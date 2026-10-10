import { describe, expect, it } from 'vitest';
import { parseQuoteSample } from './quote-capture.js';

const payload = {
  time: '2026-09-25T10:00:01.000Z',
  isConsistent: true,
  bids: [{ price: { units: '100', nano: 0 }, quantity: '4' }],
  asks: [{ price: { units: '100', nano: 100000000 }, quantity: '3' }],
};

describe('quote capture', () => {
  it('keeps only a fresh, crossed-free, consistent two-sided book', () => {
    const sample = parseQuoteSample({ instrumentId: 'public-id', observedAt: '2026-09-25T10:00:02.000Z', payload });
    expect(sample).toMatchObject({ bid: 100, ask: 100.1, bidQuantity: 4, askQuantity: 3 });
    expect(sample?.spreadPct).toBeGreaterThan(0);
  });

  it('rejects stale, inconsistent, empty, and crossed books', () => {
    const base = { instrumentId: 'public-id', observedAt: '2026-09-25T10:00:20.000Z' };
    expect(parseQuoteSample({ ...base, payload })).toBeNull();
    expect(parseQuoteSample({ ...base, payload: { ...payload, isConsistent: false } })).toBeNull();
    expect(parseQuoteSample({ ...base, payload: { ...payload, bids: [] } })).toBeNull();
    expect(parseQuoteSample({ ...base, payload: { ...payload, asks: payload.bids } })).toBeNull();
  });
});
