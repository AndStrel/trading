import { describe, expect, it } from 'vitest';
import { simulateThreeBreak } from './candle-three-break.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, high: number, low: number, close: number): DailyBar {
  return { day, open: close, high, low, close, volume: 1 };
}

describe('three closes beyond the prior extreme', () => {
  it('buys five sessions after three closes above the prior high', () => {
    const trades = simulateThreeBreak([
      bar('2024-06-03', 10, 8, 9),
      bar('2024-06-04', 12, 9, 11),
      bar('2024-06-05', 14, 11, 13),
      bar('2024-06-06', 16, 13, 15),
      bar('2024-06-07', 16, 14, 15),
      bar('2024-06-10', 16, 14, 15),
      bar('2024-06-11', 16, 14, 15),
      bar('2024-06-12', 16, 14, 15),
      bar('2024-06-13', 16, 14, 15),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-07', pattern: 'A' })]);
  });
});
