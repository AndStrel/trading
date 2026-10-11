import { describe, expect, it } from 'vitest';
import { simulateVolumeDay } from './candle-volume-day.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, volume: number): DailyBar {
  return { day, open: 10, high: 11, low: 9, close: 10, volume };
}

describe('weekday of the weekly volume peak', () => {
  it('buys the next week after a midweek volume peak', () => {
    const trades = simulateVolumeDay([
      bar('2024-06-03', 1),
      bar('2024-06-04', 9),
      bar('2024-06-10', 1),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-10', pattern: 'O' })]);
  });
});
