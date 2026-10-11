import { describe, expect, it } from 'vitest';
import { simulatePriorBreak } from './candle-prior-break.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, high: number, low: number, close: number): DailyBar {
  return { day, open, high, low, close, volume: 1 };
}

describe('close beyond the prior day extreme', () => {
  it('buys the next session after a close above the prior high and sells the fifth close', () => {
    const trades = simulatePriorBreak([
      bar('2024-05-01', 9, 10, 8, 9),
      bar('2024-05-02', 9, 12, 9, 11),
      bar('2024-05-03', 10, 11, 10, 11),
      bar('2024-05-06', 11, 11, 10, 10),
      bar('2024-05-07', 10, 11, 10, 11),
      bar('2024-05-08', 11, 12, 11, 12),
      bar('2024-05-10', 12, 13, 12, 13),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-05-03', pattern: 'A' })]);
  });
});
