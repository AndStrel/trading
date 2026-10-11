import { describe, expect, it } from 'vitest';
import { simulateWeekPatterns, weekMonday } from './candle-week.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('weekly candle patterns', () => {
  it('anchors the week on Monday', () => {
    expect(weekMonday('2024-06-05')).toBe('2024-06-03');
  });

  it('buys the next week after a rising weekly body', () => {
    const trades = simulateWeekPatterns([
      bar('2024-06-03', 10, 11),
      bar('2024-06-04', 11, 12),
      bar('2024-06-10', 20, 22),
      bar('2024-06-11', 22, 21),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-10', pattern: 'U' })]);
    expect(trades[0]?.netPct).toBeLessThan((21 / 20 - 1) * 100);
  });
});
