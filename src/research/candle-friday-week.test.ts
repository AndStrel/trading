import { describe, expect, it } from 'vitest';
import { simulateFridayWeek } from './candle-friday-week.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('Friday body and the next week', () => {
  it('buys the next week after an up Friday', () => {
    const trades = simulateFridayWeek([
      bar('2024-06-07', 10, 12),
      bar('2024-06-10', 20, 21),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-10', pattern: 'U' })]);
  });
});
