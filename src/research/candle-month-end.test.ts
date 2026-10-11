import { describe, expect, it } from 'vitest';
import { simulateMonthEnd } from './candle-month-end.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('last five sessions of the month', () => {
  it('buys the next month after an up month-end', () => {
    const trades = simulateMonthEnd([
      bar('2024-06-03', 10, 10),
      bar('2024-06-04', 10, 10),
      bar('2024-06-05', 10, 10),
      bar('2024-06-06', 10, 10),
      bar('2024-06-07', 10, 12),
      bar('2024-07-01', 20, 22),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-07-01', pattern: 'U' })]);
  });
});
