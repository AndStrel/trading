import { describe, expect, it } from 'vitest';
import { ownMonthPasses, simulateOwnMonth } from './candle-own-month.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('own-month sign', () => {
  const bars = [
    bar('2023-11-30', 10, 10),
    bar('2023-12-29', 10, 12),
    bar('2024-01-03', 20, 21),
    bar('2024-02-01', 22, 22),
  ];

  it('buys the next month after a rising month only in the continuation group', () => {
    expect(simulateOwnMonth(bars, 'continue')).toEqual([expect.objectContaining({ month: '2024-01' })]);
    expect(simulateOwnMonth(bars, 'reverse')).toHaveLength(0);
  });

  it('rejects a sample shorter than four trades', () => {
    expect(ownMonthPasses([{ month: '2024-01', netPct: 1, stressPct: 1 }])).toBe(false);
  });
});
