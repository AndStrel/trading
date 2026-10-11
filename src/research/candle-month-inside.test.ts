import { describe, expect, it } from 'vitest';
import { simulateMonthInside } from './candle-month-inside.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, high: number, low: number, close: number): DailyBar {
  return { day, open, high, low, close, volume: 1 };
}

describe('monthly inside bar', () => {
  it('buys the next month after a month inside the prior range', () => {
    const trades = simulateMonthInside([
      bar('2024-05-02', 7, 12, 6, 9),
      bar('2024-06-03', 9, 10, 8, 9),
      bar('2024-07-01', 20, 22, 19, 22),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-07-01', pattern: 'I' })]);
  });
});
