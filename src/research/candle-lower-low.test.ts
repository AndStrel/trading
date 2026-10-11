import { describe, expect, it } from 'vitest';
import { simulateLowerLow } from './candle-lower-low.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, low: number): DailyBar {
  return { day, open: 20, high: 21, low, close: 20, volume: 1 };
}

describe('count of lower lows in a week', () => {
  it('buys the next week after three lower lows', () => {
    const trades = simulateLowerLow([
      bar('2024-05-31', 12),
      bar('2024-06-03', 11),
      bar('2024-06-04', 10),
      bar('2024-06-05', 9),
      bar('2024-06-10', 8),
    ]);
    expect(trades.find((trade) => trade.day === '2024-06-10')).toEqual(expect.objectContaining({ pattern: 'H' }));
  });
});
