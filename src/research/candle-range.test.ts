import { describe, expect, it } from 'vitest';
import { rangeZone, simulateRangePatterns } from './candle-range.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, high: number, low: number, close: number): DailyBar {
  return { day, open, high, low, close, volume: 1 };
}

describe('range location patterns', () => {
  it('splits a completed day into the upper, middle, and lower third', () => {
    expect(rangeZone(bar('2024-06-03', 10, 12, 9, 12))).toBe('H');
    expect(rangeZone(bar('2024-06-03', 10, 12, 9, 10.5))).toBe('M');
    expect(rangeZone(bar('2024-06-03', 10, 12, 9, 9.5))).toBe('L');
  });

  it('trades the next day from the prior close location', () => {
    const trades = simulateRangePatterns([
      bar('2024-06-03', 10, 12, 9, 12),
      bar('2024-06-04', 20, 21, 19, 20),
    ], 'one-day');
    expect(trades).toHaveLength(1);
    expect(trades[0]?.pattern).toBe('H');
    expect(trades[0]?.day).toBe('2024-06-04');
  });
});
