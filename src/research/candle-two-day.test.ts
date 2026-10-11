import { describe, expect, it } from 'vitest';
import { simulateTwoDay } from './candle-two-day.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('two opposite sessions held for five', () => {
  it('buys the session after a down day and an up day', () => {
    const trades = simulateTwoDay([
      bar('2024-05-01', 10, 9),
      bar('2024-05-02', 9, 11),
      bar('2024-05-03', 11, 11),
      bar('2024-05-06', 11, 11),
      bar('2024-05-07', 11, 11),
      bar('2024-05-08', 11, 11),
      bar('2024-05-10', 11, 12),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-05-03', pattern: 'DU' })]);
  });
});
