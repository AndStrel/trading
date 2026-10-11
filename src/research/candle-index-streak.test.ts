import { describe, expect, it } from 'vitest';
import { simulateIndexStreak } from './candle-index-streak.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('two index months of the same sign', () => {
  it('buys the next share month after two up index months', () => {
    const trades = simulateIndexStreak(
      [bar('2024-05-02', 10, 11), bar('2024-06-03', 11, 12)],
      [bar('2024-07-01', 20, 21)],
    );
    expect(trades).toEqual([expect.objectContaining({ day: '2024-07-01', pattern: 'UU' })]);
  });
});
