import { describe, expect, it } from 'vitest';
import { simulateIndexTwo } from './candle-index-two.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('two index weeks of the same sign', () => {
  it('buys the share week after two up index weeks', () => {
    const trades = simulateIndexTwo(
      [bar('2024-06-03', 10, 12), bar('2024-06-10', 12, 13)],
      [bar('2024-06-17', 20, 21)],
    );
    expect(trades.find((trade) => trade.day === '2024-06-17')).toEqual(expect.objectContaining({ pattern: 'UU' }));
  });
});
