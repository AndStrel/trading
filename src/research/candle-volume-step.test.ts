import { describe, expect, it } from 'vitest';
import { simulateVolumeStep } from './candle-volume-step.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, volume: number): DailyBar {
  return { day, open: 10, high: 11, low: 9, close: 10, volume };
}

describe('week volume against the prior week', () => {
  it('buys the next week after a heavier week', () => {
    const trades = simulateVolumeStep([
      bar('2024-06-03', 1),
      bar('2024-06-10', 2),
      bar('2024-06-17', 1),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-17', pattern: 'H' })]);
  });
});
