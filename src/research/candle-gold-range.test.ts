import { describe, expect, it } from 'vitest';
import { simulateGoldRange } from './candle-gold-range.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, high: number, low: number): DailyBar {
  return { day, open: 10, high, low, close: 10, volume: 1 };
}

describe('gold month range leading the shares', () => {
  it('buys the next share month after a wider gold month', () => {
    const trades = simulateGoldRange(
      [bar('2024-04-01', 11, 10), bar('2024-05-02', 14, 9)],
      [bar('2024-06-03', 12, 10)],
    );
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-01', pattern: 'E' })]);
  });
});
