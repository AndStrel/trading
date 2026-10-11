import { describe, expect, it } from 'vitest';
import { simulateWeekBody } from './candle-week-body.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, high: number, low: number, close: number): DailyBar {
  return { day, open, high, low, close, volume: 1 };
}

describe('weekly body share', () => {
  it('buys the next week after a body that fills at least two thirds of the range', () => {
    const trades = simulateWeekBody([
      bar('2024-06-03', 10, 12, 9, 12),
      bar('2024-06-10', 20, 21, 19, 21),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-10', pattern: 'F' })]);
  });
});
