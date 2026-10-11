import { describe, expect, it } from 'vitest';
import { simulateUpVolume } from './candle-up-volume.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number, volume: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume };
}

describe('up-day volume against down-day volume', () => {
  it('buys the next week after heavier volume on up sessions', () => {
    const trades = simulateUpVolume([
      bar('2024-06-03', 10, 12, 2),
      bar('2024-06-04', 12, 11, 1),
      bar('2024-06-10', 11, 12, 1),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-10', pattern: 'H' })]);
  });
});
