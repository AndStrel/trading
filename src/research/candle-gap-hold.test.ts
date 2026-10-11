import { describe, expect, it } from 'vitest';
import { simulateGapHold } from './candle-gap-hold.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, high: number, low: number, close: number): DailyBar {
  return { day, open, high, low, close, volume: 1 };
}

describe('open beyond the prior day range', () => {
  it('buys that open and sells the fifth close', () => {
    const trades = simulateGapHold([
      bar('2024-05-01', 9, 10, 8, 9),
      bar('2024-05-02', 12, 13, 11, 12),
      bar('2024-05-03', 12, 12, 11, 12),
      bar('2024-05-06', 12, 12, 11, 12),
      bar('2024-05-07', 12, 12, 11, 12),
      bar('2024-05-08', 12, 13, 12, 13),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-05-02', pattern: 'A' })]);
  });
});
