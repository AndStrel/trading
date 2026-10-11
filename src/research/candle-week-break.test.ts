import { describe, expect, it } from 'vitest';
import { simulateWeekBreak } from './candle-week-break.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, high: number, low: number, close: number): DailyBar {
  return { day, open: close, high, low, close, volume: 1 };
}

describe('eight-week break', () => {
  it('buys the next week after a close above the prior eight-week high', () => {
    const trades = simulateWeekBreak([
      bar('2024-04-08', 10, 8, 9),
      bar('2024-04-15', 10, 8, 9),
      bar('2024-04-22', 10, 8, 9),
      bar('2024-04-29', 10, 8, 9),
      bar('2024-05-06', 10, 8, 9),
      bar('2024-05-13', 10, 8, 9),
      bar('2024-05-20', 10, 8, 9),
      bar('2024-05-27', 10, 8, 9),
      bar('2024-06-03', 13, 11, 12),
      bar('2024-06-10', 22, 19, 21),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-10', pattern: 'A' })]);
  });
});
