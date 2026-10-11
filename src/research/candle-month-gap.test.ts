import { describe, expect, it } from 'vitest';
import { simulateMonthGap } from './candle-month-gap.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, high: number, low: number, close: number): DailyBar {
  return { day, open, high, low, close, volume: 1 };
}

describe('monthly open against the prior range', () => {
  it('buys a month that opens above the prior high', () => {
    const trades = simulateMonthGap([
      bar('2024-06-03', 10, 12, 9, 11),
      bar('2024-07-01', 13, 14, 12, 14),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-07-01', pattern: 'A' })]);
  });
});
