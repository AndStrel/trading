import { describe, expect, it } from 'vitest';
import { simulateGapSize } from './candle-gap-size.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, high: number, low: number, close: number): DailyBar {
  return { day, open, high, low, close, volume: 1 };
}

describe('weekend gap against Friday range', () => {
  it('buys Monday after a gap larger than half of Friday range', () => {
    const trades = simulateGapSize([
      bar('2024-05-31', 10, 12, 8, 10),
      bar('2024-06-03', 13, 14, 12, 13),
      bar('2024-06-07', 13, 15, 13, 14),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-03', pattern: 'A' })]);
  });
});
