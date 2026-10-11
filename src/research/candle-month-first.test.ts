import { describe, expect, it } from 'vitest';
import { simulateMonthFirst } from './candle-month-first.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('first session of the month', () => {
  it('buys the rest of the month after an up first session', () => {
    const trades = simulateMonthFirst([
      bar('2024-06-03', 10, 12),
      bar('2024-06-04', 20, 20),
      bar('2024-06-05', 21, 22),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-04', pattern: 'U' })]);
  });
});
