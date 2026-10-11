import { describe, expect, it } from 'vitest';
import { simulateRangeStreak } from './candle-range-streak.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, low: number, high: number): DailyBar {
  return { day, open: 10, high, low, close: 10, volume: 1 };
}

describe('three weeks of a widening range', () => {
  it('buys the fourth week after three wider ranges', () => {
    const trades = simulateRangeStreak([
      bar('2024-05-13', 10, 11),
      bar('2024-05-20', 10, 12),
      bar('2024-05-27', 10, 13),
      bar('2024-06-03', 10, 11),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-03', pattern: 'EEE' })]);
  });
});
