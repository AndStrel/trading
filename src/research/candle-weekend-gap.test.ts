import { describe, expect, it } from 'vitest';
import { gapGroupPasses, simulateWeekendGaps } from './candle-weekend-gap.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('weekend gap', () => {
  it('buys Monday after a gap above the prior week close and sells the week close', () => {
    const trades = simulateWeekendGaps([
      bar('2024-05-31', 10, 10),
      bar('2024-06-03', 12, 12),
      bar('2024-06-04', 12, 13),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-03', pattern: 'U' })]);
  });

  it('rejects a positive mean that is only the best trade', () => {
    const trades = Array.from({ length: 20 }, (_, index) => ({
      day: `2024-01-${String(index + 1).padStart(2, '0')}`,
      pattern: 'U',
      netPct: index === 0 ? 30 : -0.2,
      stressPct: index === 0 ? 29 : -0.3,
    }));
    expect(gapGroupPasses(trades, true)).toBe(false);
  });
});
