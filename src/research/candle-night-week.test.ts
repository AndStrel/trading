import { describe, expect, it } from 'vitest';
import { simulateNightWeek } from './candle-night-week.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('week made by the overnight gap', () => {
  it('buys the next week after a larger overnight product', () => {
    const trades = simulateNightWeek([
      bar('2024-05-31', 9, 9),
      bar('2024-06-03', 10, 11),
      bar('2024-06-10', 11, 12),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-10', pattern: 'N' })]);
  });
});
