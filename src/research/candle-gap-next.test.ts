import { describe, expect, it } from 'vitest';
import { simulateGapNext } from './candle-gap-next.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('the week after an opening gap', () => {
  it('buys the following week after an up gap', () => {
    const trades = simulateGapNext([
      bar('2024-05-27', 9, 10),
      bar('2024-06-03', 12, 11),
      bar('2024-06-10', 20, 21),
    ]);
    expect(trades.find((trade) => trade.day === '2024-06-10')).toEqual(expect.objectContaining({ pattern: 'U' }));
  });
});
