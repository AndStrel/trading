import { describe, expect, it } from 'vitest';
import { parseGoldPricePage } from './research-gold-spot-2026-source.js';

describe('gold spot price source', () => {
  it('accepts price candles with null exchange volume but rejects invalid prices', () => {
    const columns = ['open', 'close', 'high', 'low', 'value', 'volume', 'begin'];
    expect(parseGoldPricePage({ candles: { columns, data: [[100, 101, 102, 99, null, null, '2026-09-25 10:00:00']] } }, '2026-09-25')).toHaveLength(1);
    expect(() => parseGoldPricePage({ candles: { columns, data: [[100, 101, 98, 99, null, null, '2026-09-25 10:00:00']] } }, '2026-09-25')).toThrow();
  });
});
