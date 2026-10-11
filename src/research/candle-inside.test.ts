import { describe, expect, it } from 'vitest';
import { barRelation, simulateInsidePatterns } from './candle-inside.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, high: number, low: number, close: number): DailyBar {
  return { day, open, high, low, close, volume: 1 };
}

describe('inside and outside bars', () => {
  it('classifies a narrower day as inside and a wider day as outside', () => {
    const wide = bar('2024-06-03', 10, 12, 8, 11);
    expect(barRelation(wide, bar('2024-06-04', 10, 11, 9, 10.5))).toBe('I');
    expect(barRelation(wide, bar('2024-06-04', 10, 13, 7, 12))).toBe('O');
    expect(barRelation(wide, bar('2024-06-04', 10, 13, 9, 12))).toBe('N');
  });

  it('trades the day after the completed relation', () => {
    const trades = simulateInsidePatterns([
      bar('2024-06-03', 10, 12, 8, 11),
      bar('2024-06-04', 10, 11, 9, 10.5),
      bar('2024-06-05', 20, 21, 19, 20),
    ], 'bar-body');
    expect(trades.map((trade) => trade.pattern)).toEqual(['IU']);
    expect(trades[0]?.day).toBe('2024-06-05');
  });
});
