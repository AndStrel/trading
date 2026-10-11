import { describe, expect, it } from 'vitest';
import { simulateVolumeSign } from './candle-volume-sign.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number, volume: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume };
}

describe('sign of the weekly volume peak', () => {
  it('buys the next week after an up session that printed the peak volume', () => {
    const trades = simulateVolumeSign([
      bar('2024-06-03', 10, 9, 1),
      bar('2024-06-04', 10, 12, 9),
      bar('2024-06-10', 20, 21, 1),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-10', pattern: 'U' })]);
  });
});
