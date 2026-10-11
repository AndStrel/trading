import { describe, expect, it } from 'vitest';
import { simulateVolumeHalf } from './candle-volume-half.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, volume: number): DailyBar {
  return { day, open: 10, high: 11, low: 9, close: 10, volume };
}

describe('when the month prints its volume peak', () => {
  it('buys the next month after a peak in the first half', () => {
    const trades = simulateVolumeHalf([
      bar('2024-06-03', 9),
      bar('2024-06-04', 1),
      bar('2024-06-05', 1),
      bar('2024-06-06', 1),
      bar('2024-07-01', 1),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-07-01', pattern: 'E' })]);
  });
});
