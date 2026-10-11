import { describe, expect, it } from 'vitest';
import { simulateWeekFlip } from './candle-week-flip.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('two-week flip into the next week', () => {
  it('buys the week after an up week and a down week', () => {
    const trades = simulateWeekFlip([
      bar('2024-06-03', 10, 12),
      bar('2024-06-10', 12, 10),
      bar('2024-06-17', 10, 11),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-17', pattern: 'UD' })]);
  });
});
