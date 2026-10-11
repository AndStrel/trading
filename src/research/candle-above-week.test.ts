import { describe, expect, it } from 'vitest';
import { simulateAboveWeek } from './candle-above-week.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, close: number): DailyBar {
  return { day, open: close, high: close, low: close, close, volume: 1 };
}

describe('sessions closing above the prior week close', () => {
  it('buys the next week when more sessions close above that mark', () => {
    const trades = simulateAboveWeek([
      bar('2024-05-27', 10),
      bar('2024-06-03', 11),
      bar('2024-06-04', 12),
      bar('2024-06-10', 13),
    ]);
    expect(trades.find((trade) => trade.day === '2024-06-10')).toEqual(expect.objectContaining({ pattern: 'H' }));
  });
});
