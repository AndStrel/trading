import { describe, expect, it } from 'vitest';
import { simulateWeekShift } from './candle-week-shift.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, high: number, low: number): DailyBar {
  return { day, open: 10, high, low, close: 10, volume: 1 };
}

describe('weekly range shift', () => {
  it('buys the next week after a higher high and a higher low', () => {
    const trades = simulateWeekShift([
      bar('2024-05-27', 10, 8),
      bar('2024-06-03', 12, 9),
      bar('2024-06-10', 11, 9),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-10', pattern: 'HH' })]);
  });
});
