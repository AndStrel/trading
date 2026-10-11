import { describe, expect, it } from 'vitest';
import { simulateStreakHold } from './candle-streak-hold.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('three-session streak held for five sessions', () => {
  it('buys the session after three down bodies and sells the fifth close', () => {
    const trades = simulateStreakHold([
      bar('2024-05-01', 10, 9),
      bar('2024-05-02', 9, 8),
      bar('2024-05-03', 8, 7),
      bar('2024-05-06', 7, 8),
      bar('2024-05-07', 8, 8),
      bar('2024-05-08', 8, 9),
      bar('2024-05-09', 9, 10),
      bar('2024-05-10', 10, 11),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-05-06', pattern: 'DDD' })]);
  });
});
