import { describe, expect, it } from 'vitest';
import { simulateWickPatterns, wickSide } from './candle-wick.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, high: number, low: number, close: number): DailyBar {
  return { day, open, high, low, close, volume: 1 };
}

describe('candle wicks', () => {
  it('names the longer wick', () => {
    expect(wickSide(bar('2024-06-03', 10, 11, 8, 10.5))).toBe('L');
    expect(wickSide(bar('2024-06-03', 10, 14, 9.5, 10.5))).toBe('U');
    expect(wickSide(bar('2024-06-03', 10, 12, 8, 10))).toBe('E');
  });

  it('trades the day after the wick', () => {
    const trades = simulateWickPatterns([
      bar('2024-06-03', 10, 11, 8, 10.5),
      bar('2024-06-04', 20, 21, 19, 21),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-04', pattern: 'L' })]);
  });
});
