import { describe, expect, it } from 'vitest';
import { simulateTwoMonth } from './candle-two-month.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, close: number): DailyBar {
  return { day, open: close, high: close, low: close, close, volume: 1 };
}

describe('two months in a row', () => {
  it('buys the third month after two rising months', () => {
    const trades = simulateTwoMonth([
      bar('2023-10-02', 10),
      bar('2023-11-01', 12),
      bar('2023-12-01', 14),
      bar('2024-01-03', 20),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-01-01', pattern: 'UU' })]);
  });
});
