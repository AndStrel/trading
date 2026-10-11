import { describe, expect, it } from 'vitest';
import { simulateMonthExpand } from './candle-month-expand.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, high: number, low: number): DailyBar {
  return { day, open: 10, high, low, close: 10, volume: 1 };
}

describe('month range against the prior month', () => {
  it('buys the next month after a wider month', () => {
    const trades = simulateMonthExpand([
      bar('2024-04-01', 11, 10),
      bar('2024-05-02', 14, 9),
      bar('2024-06-03', 12, 10),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-01', pattern: 'E' })]);
  });
});
