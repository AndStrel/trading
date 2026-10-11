import { describe, expect, it } from 'vitest';
import { simulateMonthWick } from './candle-month-wick.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, high: number, low: number, close: number): DailyBar {
  return { day, open, high, low, close, volume: 1 };
}

describe('monthly wick', () => {
  it('buys the next month after a longer lower wick', () => {
    const trades = simulateMonthWick([
      bar('2024-06-03', 10, 11, 5, 10),
      bar('2024-07-01', 20, 22, 19, 22),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-07-01', pattern: 'L' })]);
  });
});
