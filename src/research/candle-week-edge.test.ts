import { describe, expect, it } from 'vitest';
import { simulateWeekEdge } from './candle-week-edge.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, high: number, low: number, close: number): DailyBar {
  return { day, open: 10, high, low, close, volume: 1 };
}

describe('week close beyond the prior week range', () => {
  it('buys the next week after a close above the prior high', () => {
    const trades = simulateWeekEdge([
      bar('2024-05-27', 12, 9, 11),
      bar('2024-06-03', 14, 9, 13),
      bar('2024-06-10', 12, 9, 11),
    ]);
    expect(trades.find((trade) => trade.day === '2024-06-10')).toEqual(expect.objectContaining({ pattern: 'A' }));
  });
});
