import { describe, expect, it } from 'vitest';
import { simulateWeekLow } from './candle-week-low.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, low: number): DailyBar {
  return { day, open: 10, high: 12, low, close: 11, volume: 1 };
}

describe('weekday of the weekly low', () => {
  it('buys the next week after a Monday low', () => {
    const trades = simulateWeekLow([
      bar('2024-06-03', 8),
      bar('2024-06-04', 9),
      bar('2024-06-10', 10),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-10', pattern: 'M' })]);
  });
});
