import { describe, expect, it } from 'vitest';
import { simulateFirstWeek } from './candle-first-week.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('the first week of a month', () => {
  it('buys the rest of the month after an up first week', () => {
    const trades = simulateFirstWeek([
      bar('2024-06-03', 10, 12),
      bar('2024-06-10', 20, 21),
      bar('2024-06-11', 21, 22),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-10', pattern: 'U' })]);
  });
});
