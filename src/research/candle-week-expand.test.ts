import { describe, expect, it } from 'vitest';
import { simulateWeekExpand } from './candle-week-expand.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, low: number, high: number): DailyBar {
  return { day, open: 10, high, low, close: 10, volume: 1 };
}

describe('week wider than the week before', () => {
  it('buys the next week after a wider range', () => {
    const trades = simulateWeekExpand([
      bar('2024-06-03', 10, 11),
      bar('2024-06-10', 8, 14),
      bar('2024-06-17', 10, 12),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-17', pattern: 'E' })]);
  });
});
