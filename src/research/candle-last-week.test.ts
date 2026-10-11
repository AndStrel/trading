import { describe, expect, it } from 'vitest';
import { simulateLastWeek } from './candle-last-week.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('the last week inside a month', () => {
  it('buys the next month after an up last week', () => {
    const trades = simulateLastWeek([
      bar('2024-06-03', 10, 9),
      bar('2024-06-24', 10, 12),
      bar('2024-07-01', 20, 21),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-07-01', pattern: 'U' })]);
  });
});
