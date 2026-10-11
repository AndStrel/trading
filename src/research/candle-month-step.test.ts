import { describe, expect, it } from 'vitest';
import { simulateMonthStep } from './candle-month-step.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('month open against the prior close', () => {
  it('buys a month that opens above the prior close', () => {
    const trades = simulateMonthStep([
      bar('2024-06-03', 8, 10),
      bar('2024-07-01', 12, 14),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-07-01', pattern: 'U' })]);
  });
});
