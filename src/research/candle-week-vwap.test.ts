import { describe, expect, it } from 'vitest';
import { simulateWeekVwap } from './candle-week-vwap.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, high: number, low: number, close: number): DailyBar {
  return { day, open, high, low, close, volume: 1 };
}

describe('weekly volume price', () => {
  it('buys the next week after a close above the week volume price', () => {
    const trades = simulateWeekVwap([
      bar('2024-06-03', 10, 12, 9, 12),
      bar('2024-06-10', 20, 21, 19, 21),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-10', pattern: 'U' })]);
  });
});
