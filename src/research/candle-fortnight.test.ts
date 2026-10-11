import { describe, expect, it } from 'vitest';
import { simulateFortnight } from './candle-fortnight.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('fortnight candles', () => {
  it('buys the next fortnight after an up fortnight', () => {
    const trades = simulateFortnight([
      bar('2024-06-03', 10, 10),
      bar('2024-06-10', 11, 12),
      bar('2024-06-17', 20, 20),
      bar('2024-06-24', 21, 22),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-17', pattern: 'U' })]);
  });
});
