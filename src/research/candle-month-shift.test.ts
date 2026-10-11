import { describe, expect, it } from 'vitest';
import { simulateMonthShift } from './candle-month-shift.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, high: number, low: number): DailyBar {
  return { day, open: 10, high, low, close: 10, volume: 1 };
}

describe('monthly range shift', () => {
  it('buys the next month after a higher high and a higher low', () => {
    const trades = simulateMonthShift([
      bar('2024-05-02', 10, 8),
      bar('2024-06-03', 12, 9),
      bar('2024-07-01', 11, 9),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-07-01', pattern: 'HH' })]);
  });
});
