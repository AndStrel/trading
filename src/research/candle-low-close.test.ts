import { describe, expect, it } from 'vitest';
import { simulateLowClose } from './candle-low-close.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, high: number, low: number, close: number): DailyBar {
  return { day, open: close, high, low, close, volume: 1 };
}

describe('close of the session that prints the weekly low', () => {
  it('buys the next week when that session closes above its midpoint', () => {
    const trades = simulateLowClose([
      bar('2024-06-03', 12, 8, 11),
      bar('2024-06-04', 12, 9, 10),
      bar('2024-06-10', 12, 10, 11),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-10', pattern: 'U' })]);
  });
});
