import { describe, expect, it } from 'vitest';
import { simulateWeekAgree } from './candle-week-agree.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('weekly agreement', () => {
  it('buys SBMX next week when SBER and GAZP both rose', () => {
    const trades = simulateWeekAgree(
      [bar('2024-06-03', 10, 12)],
      [bar('2024-06-03', 10, 11)],
      [bar('2024-06-10', 20, 21)],
    );
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-10', pattern: 'UU' })]);
  });
});
