import { describe, expect, it } from 'vitest';
import { simulateWeekEnds } from './candle-week-ends.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('Monday and Friday of the prior week', () => {
  it('buys the next week after a down Monday and an up Friday', () => {
    const trades = simulateWeekEnds([
      bar('2024-06-03', 12, 10),
      bar('2024-06-07', 10, 12),
      bar('2024-06-10', 20, 21),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-10', pattern: 'DU' })]);
  });
});
