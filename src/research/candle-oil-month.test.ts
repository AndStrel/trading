import { describe, expect, it } from 'vitest';
import { simulateOilMonth } from './candle-oil-month.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('oil month', () => {
  it('buys the next ROSN month after an up LKOH month', () => {
    const trades = simulateOilMonth(
      [bar('2024-06-03', 10, 12)],
      [bar('2024-07-01', 20, 22)],
    );
    expect(trades).toEqual([expect.objectContaining({ day: '2024-07-01', pattern: 'U' })]);
  });
});
