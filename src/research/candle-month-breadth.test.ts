import { describe, expect, it } from 'vitest';
import { simulateMonthBreadth } from './candle-month-breadth.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('share of rising sessions in a month', () => {
  it('buys the next month after a majority of rising sessions', () => {
    const trades = simulateMonthBreadth([
      bar('2024-06-03', 10, 11),
      bar('2024-06-04', 10, 11),
      bar('2024-06-05', 10, 11),
      bar('2024-06-06', 11, 10),
      bar('2024-07-01', 20, 22),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-07-01', pattern: 'H' })]);
  });
});
