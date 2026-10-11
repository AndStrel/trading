import { describe, expect, it } from 'vitest';
import { gapSign, openVersusRange, simulateGapPatterns } from './candle-gap.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, high: number, low: number, close: number): DailyBar {
  return { day, open, high, low, close, volume: 1 };
}

describe('opening gaps', () => {
  const prior = bar('2024-06-03', 10, 12, 9, 11);

  it('reads the gap and the open against the prior range at the entry', () => {
    expect(gapSign(prior, bar('2024-06-04', 12, 13, 11, 12.5))).toBe('U');
    expect(gapSign(prior, bar('2024-06-04', 11, 12, 10, 11))).toBe('Z');
    expect(openVersusRange(prior, bar('2024-06-04', 13, 14, 12, 13))).toBe('A');
    expect(openVersusRange(prior, bar('2024-06-04', 8, 10, 7, 9))).toBe('B');
    expect(openVersusRange(prior, bar('2024-06-04', 10, 11, 9, 10))).toBe('I');
  });

  it('trades the same day as the observed open', () => {
    const trades = simulateGapPatterns([prior, bar('2024-06-04', 13, 14, 12, 13)], 'open-vs-range');
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-04', pattern: 'A' })]);
  });
});
