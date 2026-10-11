import { describe, expect, it } from 'vitest';
import { simulateMondayPatterns } from './candle-monday.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('Monday sign', () => {
  it('buys the rest of the week after a rising Monday', () => {
    const trades = simulateMondayPatterns([
      bar('2024-06-03', 10, 12),
      bar('2024-06-04', 20, 21),
      bar('2024-06-05', 21, 23),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-03', pattern: 'U' })]);
    expect(trades[0]?.netPct).toBeGreaterThan(0);
  });

  it('skips a week that has no session after Monday', () => {
    expect(simulateMondayPatterns([bar('2024-06-03', 10, 12)])).toHaveLength(0);
  });
});
