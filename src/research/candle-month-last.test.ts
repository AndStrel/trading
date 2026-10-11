import { describe, expect, it } from 'vitest';
import { simulateMonthLast } from './candle-month-last.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('last session of the month', () => {
  it('buys the next month after an up last session', () => {
    const trades = simulateMonthLast([
      bar('2024-06-03', 8, 8),
      bar('2024-06-05', 10, 12),
      bar('2024-07-01', 20, 22),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-07-01', pattern: 'U' })]);
  });
});
