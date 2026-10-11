import { describe, expect, it } from 'vitest';
import { simulatePrefSpread } from './candle-pref-spread.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('preferred week against the common week', () => {
  it('buys the next common week after the preferred share outruns it', () => {
    const trades = simulatePrefSpread(
      [bar('2024-06-03', 10, 12)],
      [bar('2024-06-03', 10, 11), bar('2024-06-10', 11, 12)],
    );
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-10', pattern: 'P' })]);
  });
});
