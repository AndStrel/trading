import { describe, expect, it } from 'vitest';
import { simulateThreeWeek } from './candle-three-week.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('three-week streak', () => {
  it('buys the fourth week after three up weeks', () => {
    const trades = simulateThreeWeek([
      bar('2024-05-13', 10, 11),
      bar('2024-05-20', 10, 11),
      bar('2024-05-27', 10, 11),
      bar('2024-06-03', 20, 21),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-03', pattern: 'UUU' })]);
  });
});
