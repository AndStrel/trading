import { describe, expect, it } from 'vitest';
import { simulateWeekRange } from './candle-week-range.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, high: number, low: number, close: number): DailyBar {
  return { day, open, high, low, close, volume: 1 };
}

describe('weekly range location', () => {
  it('buys the next week after a close in the upper third', () => {
    const trades = simulateWeekRange([
      bar('2024-06-03', 10, 12, 9, 12),
      bar('2024-06-10', 20, 22, 19, 21),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-10', pattern: 'H' })]);
  });
});
