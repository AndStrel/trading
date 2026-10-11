import { describe, expect, it } from 'vitest';
import { simulateMonthOpen } from './candle-month-open.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('first five sessions of the month', () => {
  it('buys the rest of the month after an up opening stretch', () => {
    const trades = simulateMonthOpen([
      bar('2024-06-03', 10, 10),
      bar('2024-06-04', 10, 10),
      bar('2024-06-05', 10, 10),
      bar('2024-06-06', 10, 10),
      bar('2024-06-07', 10, 12),
      bar('2024-06-10', 20, 20),
      bar('2024-06-11', 21, 21),
      bar('2024-06-12', 22, 22),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-10', pattern: 'U' })]);
  });
});
