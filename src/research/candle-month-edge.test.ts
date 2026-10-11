import { describe, expect, it } from 'vitest';
import { simulateMonthEdge } from './candle-month-edge.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, high: number, low: number, close: number): DailyBar {
  return { day, open, high, low, close, volume: 1 };
}

describe('month close beyond the prior month range', () => {
  it('buys the next month after a close above the prior high', () => {
    const trades = simulateMonthEdge([
      bar('2023-11-01', 9, 10, 8, 9),
      bar('2023-12-01', 10, 12, 10, 11),
      bar('2024-01-02', 11, 13, 11, 12),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-01-01', pattern: 'A' })]);
  });
});
