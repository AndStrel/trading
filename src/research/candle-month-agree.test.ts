import { describe, expect, it } from 'vitest';
import { simulateMonthAgree } from './candle-month-agree.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('two monthly bodies agreeing', () => {
  it('buys the next SBMX month after both names rise', () => {
    const trades = simulateMonthAgree(
      [bar('2024-06-03', 10, 12)],
      [bar('2024-06-03', 20, 21)],
      [bar('2024-07-01', 30, 31)],
    );
    expect(trades).toEqual([expect.objectContaining({ day: '2024-07-01', pattern: 'UU' })]);
  });
});
