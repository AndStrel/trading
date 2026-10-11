import { describe, expect, it } from 'vitest';
import { simulateStepHold } from './candle-step-hold.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, close: number): DailyBar {
  return { day, open: close, high: close, low: close, close, volume: 1 };
}

describe('close above the prior close, held five sessions', () => {
  it('buys the next session and sells the fifth close', () => {
    const trades = simulateStepHold([
      bar('2024-05-01', 10),
      bar('2024-05-02', 12),
      bar('2024-05-03', 12),
      bar('2024-05-06', 12),
      bar('2024-05-07', 12),
      bar('2024-05-08', 12),
      bar('2024-05-10', 13),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-05-03', pattern: 'U' })]);
  });
});
