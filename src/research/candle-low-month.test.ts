import { describe, expect, it } from 'vitest';
import { simulateLowMonth } from './candle-low-month.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number, low: number): DailyBar {
  return { day, open, high: Math.max(open, close), low, close, volume: 1 };
}

describe('sign of the session that prints the monthly low', () => {
  it('buys the next month after a down session that printed the low', () => {
    const trades = simulateLowMonth([
      bar('2024-06-03', 10, 9, 5),
      bar('2024-06-04', 10, 11, 8),
      bar('2024-07-01', 20, 21, 19),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-07-01', pattern: 'D' })]);
  });
});
