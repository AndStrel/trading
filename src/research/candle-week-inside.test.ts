import { describe, expect, it } from 'vitest';
import { simulateWeekInside } from './candle-week-inside.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, high: number, low: number, close: number): DailyBar {
  return { day, open, high, low, close, volume: 1 };
}

describe('weekly inside bar', () => {
  it('buys the next week after a week inside the prior range', () => {
    const trades = simulateWeekInside([
      bar('2024-05-20', 7, 12, 6, 9),
      bar('2024-05-27', 9, 10, 8, 9),
      bar('2024-06-03', 20, 22, 19, 21),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-03', pattern: 'I' })]);
  });
});
