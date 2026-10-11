import { describe, expect, it } from 'vitest';
import { simulateInsideCount } from './candle-inside-count.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, high: number, low: number): DailyBar {
  return { day, open: 10, high, low, close: 10, volume: 1 };
}

describe('count of inside sessions in a week', () => {
  it('buys the next week after two inside sessions', () => {
    const trades = simulateInsideCount([
      bar('2024-06-03', 14, 6),
      bar('2024-06-04', 12, 8),
      bar('2024-06-05', 11, 9),
      bar('2024-06-10', 12, 8),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-10', pattern: 'H' })]);
  });
});
