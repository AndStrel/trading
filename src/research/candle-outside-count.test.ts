import { describe, expect, it } from 'vitest';
import { simulateOutsideCount } from './candle-outside-count.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, high: number, low: number): DailyBar {
  return { day, open: 10, high, low, close: 10, volume: 1 };
}

describe('an outside session inside a week', () => {
  it('buys the next week after a session that breaks both sides', () => {
    const trades = simulateOutsideCount([
      bar('2024-06-03', 11, 9),
      bar('2024-06-04', 12, 8),
      bar('2024-06-10', 11, 9),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-10', pattern: 'O' })]);
  });
});
