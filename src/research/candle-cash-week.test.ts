import { describe, expect, it } from 'vitest';
import { simulateCashWeek } from './candle-cash-week.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('money-market week leading the shares', () => {
  it('buys the next share week after an up money-market week', () => {
    const trades = simulateCashWeek(
      [bar('2024-06-03', 10, 11)],
      [bar('2024-06-10', 20, 21)],
    );
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-10', pattern: 'U' })]);
  });
});
