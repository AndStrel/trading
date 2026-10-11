import { describe, expect, it } from 'vitest';
import { simulateWeekMonth } from './candle-week-month.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('week close against the month open', () => {
  it('buys the next week after a close above the month open', () => {
    const trades = simulateWeekMonth([
      bar('2024-06-03', 10, 12),
      bar('2024-06-10', 20, 21),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-10', pattern: 'A' })]);
  });
});
