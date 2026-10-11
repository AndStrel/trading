import { describe, expect, it } from 'vitest';
import { simulateWeekHigh } from './candle-week-high.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, high: number): DailyBar {
  return { day, open: 10, high, low: 9, close: 10, volume: 1 };
}

describe('weekday of the weekly high', () => {
  it('buys the next week after a Friday high', () => {
    const trades = simulateWeekHigh([
      bar('2024-06-03', 11),
      bar('2024-06-07', 14),
      bar('2024-06-10', 12),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-10', pattern: 'F' })]);
  });
});
