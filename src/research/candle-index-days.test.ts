import { describe, expect, it } from 'vitest';
import { simulateIndexDays } from './candle-index-days.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('share of sessions agreeing with the index', () => {
  it('buys the next week after most sessions match IMOEX', () => {
    const trades = simulateIndexDays(
      [bar('2024-06-03', 100, 101), bar('2024-06-04', 101, 102)],
      [bar('2024-06-03', 10, 11), bar('2024-06-04', 11, 12), bar('2024-06-10', 12, 13)],
    );
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-10', pattern: 'H' })]);
  });
});
