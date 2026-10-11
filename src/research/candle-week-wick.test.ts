import { describe, expect, it } from 'vitest';
import { simulateWeekWick } from './candle-week-wick.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, high: number, low: number, close: number): DailyBar {
  return { day, open, high, low, close, volume: 1 };
}

describe('weekly wick', () => {
  it('buys the next week after a longer lower wick', () => {
    const trades = simulateWeekWick([
      bar('2024-06-03', 10, 11, 6, 10),
      bar('2024-06-10', 10, 12, 9, 11),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-10', pattern: 'L' })]);
  });
});
