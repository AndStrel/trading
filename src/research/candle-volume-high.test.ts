import { describe, expect, it } from 'vitest';
import { simulateVolumeHigh } from './candle-volume-high.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, high: number, volume: number): DailyBar {
  return { day, open: 10, high, low: 9, close: 10, volume };
}

describe('weekly volume peak and weekly high on one session', () => {
  it('buys the next week when they fall on different sessions', () => {
    const trades = simulateVolumeHigh([
      bar('2024-06-03', 15, 1),
      bar('2024-06-04', 11, 9),
      bar('2024-06-10', 12, 1),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-10', pattern: 'X' })]);
  });
});
