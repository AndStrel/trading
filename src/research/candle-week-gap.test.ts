import { describe, expect, it } from 'vitest';
import { simulateWeekGap } from './candle-week-gap.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, high: number, low: number, close: number): DailyBar {
  return { day, open, high, low, close, volume: 1 };
}

describe('Monday open beyond the prior week', () => {
  it('buys that Monday after an open above the prior high and sells the week close', () => {
    const trades = simulateWeekGap([
      bar('2024-05-27', 9, 10, 8, 9),
      bar('2024-06-03', 12, 13, 11, 12),
      bar('2024-06-07', 12, 14, 12, 13),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-03', pattern: 'A' })]);
  });
});
