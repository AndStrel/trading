import { describe, expect, it } from 'vitest';
import { simulateWeekOfMonth } from './candle-week-of-month.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('which week of the month', () => {
  it('marks a Monday on the third as the first week', () => {
    const trades = simulateWeekOfMonth([bar('2024-06-03', 10, 11)]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-03', pattern: 'W1' })]);
  });
});
