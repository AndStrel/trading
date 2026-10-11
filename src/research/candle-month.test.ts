import { describe, expect, it } from 'vitest';
import { monthPasses, simulateMonthLeadership } from './candle-month.js';
import type { DailyBar } from './weekly-trend.js';

function day(dayName: string, open: number, close: number): DailyBar {
  return { day: dayName, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('monthly leadership', () => {
  it('buys the prior-month leader at the next month open', () => {
    const books = {
      SBER: [day('2023-11-30', 10, 10), day('2023-12-29', 10, 12), day('2024-01-03', 20, 20), day('2024-02-01', 22, 22)],
      GAZP: [day('2023-11-30', 10, 10), day('2023-12-29', 10, 11), day('2024-01-03', 10, 10), day('2024-02-01', 10, 10)],
      SBMX: [day('2023-11-30', 10, 10), day('2023-12-29', 10, 10), day('2024-01-03', 10, 10), day('2024-02-01', 10, 10)],
    };
    const trades = simulateMonthLeadership(books, 'leader');
    expect(trades).toEqual([expect.objectContaining({ month: '2024-01', ticker: 'SBER' })]);
  });

  it('does not pass a year with fewer than eight trades', () => {
    expect(monthPasses([{ month: '2024-01', ticker: 'SBER', netPct: 1, stressPct: 1 }])).toBe(false);
  });
});
