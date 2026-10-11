import { describe, expect, it } from 'vitest';
import { simulateMonthLow } from './candle-month-low.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, low: number): DailyBar {
  return { day, open: 10, high: 11, low, close: 10, volume: 1 };
}

describe('when the month prints its low', () => {
  it('buys the next month after a low in the first half', () => {
    const trades = simulateMonthLow([
      bar('2024-06-03', 5),
      bar('2024-06-04', 9),
      bar('2024-06-05', 9),
      bar('2024-06-06', 9),
      bar('2024-07-01', 9),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-07-01', pattern: 'E' })]);
  });
});
