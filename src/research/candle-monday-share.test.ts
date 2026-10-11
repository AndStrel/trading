import { describe, expect, it } from 'vitest';
import { simulateMondayShare } from './candle-monday-share.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, low: number, high: number): DailyBar {
  return { day, open: 10, high, low, close: 10, volume: 1 };
}

describe('Monday share of the weekly range', () => {
  it('buys the next week after Monday holds more than half the range', () => {
    const trades = simulateMondayShare([
      bar('2024-06-03', 8, 14),
      bar('2024-06-04', 9, 12),
      bar('2024-06-10', 10, 11),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-10', pattern: 'H' })]);
  });
});
