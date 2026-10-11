import { describe, expect, it } from 'vitest';
import { simulateMonthAbove } from './candle-month-above.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('closes above the month open', () => {
  it('buys the next month after most sessions close above the month open', () => {
    const trades = simulateMonthAbove([
      bar('2024-06-03', 10, 11),
      bar('2024-06-04', 9, 12),
      bar('2024-06-05', 13, 9),
      bar('2024-07-01', 20, 21),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-07-01', pattern: 'H' })]);
  });
});
