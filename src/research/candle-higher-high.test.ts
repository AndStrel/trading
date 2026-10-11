import { describe, expect, it } from 'vitest';
import { simulateHigherHigh } from './candle-higher-high.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, high: number): DailyBar {
  return { day, open: 10, high, low: 9, close: 10, volume: 1 };
}

describe('count of higher daily highs in a week', () => {
  it('buys the next week after three higher highs', () => {
    const trades = simulateHigherHigh([
      bar('2024-05-31', 10),
      bar('2024-06-03', 11),
      bar('2024-06-04', 12),
      bar('2024-06-05', 13),
      bar('2024-06-10', 13),
    ]);
    expect(trades.find((trade) => trade.day === '2024-06-10')).toEqual(expect.objectContaining({ pattern: 'H' }));
  });
});
