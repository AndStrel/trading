import { describe, expect, it } from 'vitest';
import { simulateCloseSteps } from './candle-close-steps.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, close: number): DailyBar {
  return { day, open: 10, high: Math.max(10, close), low: Math.min(10, close), close, volume: 1 };
}

describe('close-to-close steps inside a month', () => {
  it('buys the next month after more rising closes', () => {
    const trades = simulateCloseSteps([
      bar('2024-06-03', 10),
      bar('2024-06-04', 11),
      bar('2024-06-05', 12),
      bar('2024-07-01', 13),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-07-01', pattern: 'H' })]);
  });
});
