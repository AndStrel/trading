import { describe, expect, it } from 'vitest';
import { simulateHalfCount } from './candle-half-count.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, close: number): DailyBar {
  return { day, open: 10, high: 12, low: 8, close, volume: 1 };
}

describe('upper-half closes inside a week', () => {
  it('buys the next week when more sessions close above their midpoint', () => {
    const trades = simulateHalfCount([
      bar('2024-06-03', 11),
      bar('2024-06-04', 11),
      bar('2024-06-05', 9),
      bar('2024-06-10', 10),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-10', pattern: 'H' })]);
  });
});
