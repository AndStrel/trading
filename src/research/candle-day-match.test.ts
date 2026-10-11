import { describe, expect, it } from 'vitest';
import { simulateDayMatch } from './candle-day-match.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('daily agreement of Sber and Gazprom', () => {
  it('buys the next SBMX week after more agreeing days', () => {
    const trades = simulateDayMatch(
      [bar('2024-06-03', 10, 12), bar('2024-06-04', 10, 12)],
      [bar('2024-06-03', 10, 12), bar('2024-06-04', 10, 11)],
      [bar('2024-06-10', 20, 21)],
    );
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-10', pattern: 'H' })]);
  });
});
