import { describe, expect, it } from 'vitest';
import { dividendUpperBound } from './dividend-upper-bound.js';

describe('dividend upper bound', () => {
  it('credits a full gross dividend to each intersecting position, not to distant positions', () => {
    const trades = [
      { entryDay: '2024-07-01', exitDay: '2024-07-15', entry: 300, netPct: -5 },
      { entryDay: '2024-08-01', exitDay: '2024-08-20', entry: 300, netPct: -5 },
    ];
    const result = dividendUpperBound(trades, { recordDay: '2024-07-11', amount: 33.3 }, 14);
    expect(result.credited).toBe(1);
    expect(result.winners).toBe(1);
    expect(result.meanNetPct).toBeCloseTo((-5 + 100 * 33.3 / (300 * 1.0005 * 1.003) - 5) / 2);
  });
  it('does not infer entitlement from a trade starting after the sensitivity window', () => {
    const result = dividendUpperBound([
      { entryDay: '2020-10-20', exitDay: '2020-11-20', entry: 200, netPct: -2 },
    ], { recordDay: '2020-10-05', amount: 18.7 }, 14);
    expect(result.credited).toBe(0);
    expect(result.meanNetPct).toBe(-2);
  });
});
