import { describe, expect, it } from 'vitest';
import { simulateMonthBody } from './candle-month-body.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, high: number, low: number, close: number): DailyBar {
  return { day, open, high, low, close, volume: 1 };
}

describe('monthly body share', () => {
  it('buys the next month after a body that fills at least two thirds of the range', () => {
    const trades = simulateMonthBody([
      bar('2024-06-03', 10, 12, 9, 12),
      bar('2024-07-01', 20, 22, 19, 22),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-07-01', pattern: 'F' })]);
  });
});
