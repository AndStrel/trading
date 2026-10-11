import { describe, expect, it } from 'vitest';
import { simulateHighSign } from './candle-high-sign.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number, high: number): DailyBar {
  return { day, open, high, low: Math.min(open, close), close, volume: 1 };
}

describe('sign of the session that prints the weekly high', () => {
  it('buys the next week after an up session that printed the high', () => {
    const trades = simulateHighSign([
      bar('2024-06-03', 10, 9, 11),
      bar('2024-06-04', 10, 12, 15),
      bar('2024-06-10', 20, 21, 22),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-10', pattern: 'U' })]);
  });
});
