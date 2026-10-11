import { describe, expect, it } from 'vitest';
import { simulateMonthHigh } from './candle-month-high.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, high: number): DailyBar {
  return { day, open: 10, high, low: 9, close: 10, volume: 1 };
}

describe('when the month prints its high', () => {
  it('buys the next month after a high in the first half', () => {
    const trades = simulateMonthHigh([
      bar('2024-06-03', 20),
      bar('2024-06-04', 11),
      bar('2024-06-05', 11),
      bar('2024-06-06', 11),
      bar('2024-07-01', 12),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-07-01', pattern: 'E' })]);
  });
});
