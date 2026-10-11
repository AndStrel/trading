import { describe, expect, it } from 'vitest';
import { simulateMonthVolume } from './candle-month-volume.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, volume: number, close = 10): DailyBar {
  return { day, open: close, high: close, low: close, close, volume };
}

describe('month-to-month volume', () => {
  it('buys the next month after volume rises', () => {
    const trades = simulateMonthVolume([
      bar('2023-11-01', 1),
      bar('2023-12-01', 5),
      bar('2024-01-03', 1, 12),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-01-01', pattern: 'H' })]);
  });
});
