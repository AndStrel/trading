import { describe, expect, it } from 'vitest';
import { simulateLowSign } from './candle-low-sign.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number, low: number): DailyBar {
  return { day, open, high: Math.max(open, close), low, close, volume: 1 };
}

describe('sign of the session that prints the weekly low', () => {
  it('buys the next week after an up session that printed the low', () => {
    const trades = simulateLowSign([
      bar('2024-06-03', 10, 9, 8),
      bar('2024-06-04', 10, 12, 7),
      bar('2024-06-10', 20, 21, 19),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-10', pattern: 'U' })]);
  });
});
