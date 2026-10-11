import { describe, expect, it } from 'vitest';
import { simulateMonthBreak } from './candle-month-break.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, high: number, low: number, close: number): DailyBar {
  return { day, open: 10, high, low, close, volume: 1 };
}

describe('week close beyond the prior month range', () => {
  it('buys the next week after a close above the prior month high', () => {
    const trades = simulateMonthBreak([
      bar('2024-05-27', 12, 9, 11),
      bar('2024-06-03', 14, 10, 13),
      bar('2024-06-10', 12, 10, 11),
    ]);
    expect(trades.find((trade) => trade.day === '2024-06-10')).toEqual(expect.objectContaining({ pattern: 'A' }));
  });
});
