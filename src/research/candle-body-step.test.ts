import { describe, expect, it } from 'vitest';
import { simulateBodyStep } from './candle-body-step.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('week body against the prior week body', () => {
  it('buys the next week after a larger body', () => {
    const trades = simulateBodyStep([
      bar('2024-06-03', 10, 11),
      bar('2024-06-10', 10, 13),
      bar('2024-06-17', 10, 11),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-17', pattern: 'H' })]);
  });
});
