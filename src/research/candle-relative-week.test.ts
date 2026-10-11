import { describe, expect, it } from 'vitest';
import { simulateRelativeWeek } from './candle-relative-week.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('week ahead of the index', () => {
  it('buys the next week after the name outruns IMOEX', () => {
    const trades = simulateRelativeWeek(
      [bar('2024-06-03', 100, 101)],
      [bar('2024-06-03', 10, 12), bar('2024-06-10', 12, 13)],
    );
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-10', pattern: 'A' })]);
  });
});
