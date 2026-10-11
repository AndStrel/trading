import { describe, expect, it } from 'vitest';
import { simulateYearOpen } from './candle-year-open.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('week close against the year open', () => {
  it('buys the next week after a close above the first open of that year', () => {
    const trades = simulateYearOpen([
      bar('2024-01-03', 10, 10),
      bar('2024-06-03', 11, 12),
      bar('2024-06-10', 12, 13),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-10', pattern: 'A' })]);
  });
});
