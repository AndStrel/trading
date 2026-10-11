import { describe, expect, it } from 'vitest';
import { simulateIndexMonth } from './candle-index-month.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('index month', () => {
  it('buys the next month of the stock after an up index month', () => {
    const trades = simulateIndexMonth(
      [bar('2024-06-03', 10, 12)],
      [bar('2024-07-01', 20, 22)],
    );
    expect(trades).toEqual([expect.objectContaining({ day: '2024-07-01', pattern: 'U' })]);
  });
});
