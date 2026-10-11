import { describe, expect, it } from 'vitest';
import { simulateMonthWeeks } from './candle-month-weeks.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('up and down weeks inside a month', () => {
  it('buys the next month after more up weeks', () => {
    const trades = simulateMonthWeeks([
      bar('2024-06-03', 10, 12),
      bar('2024-06-10', 12, 13),
      bar('2024-07-01', 20, 21),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-07-01', pattern: 'H' })]);
  });
});
