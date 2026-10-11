import { describe, expect, it } from 'vitest';
import { simulateLongGap } from './candle-long-gap.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('session after a gap longer than a weekend', () => {
  it('buys the first session after an up day and a five-day pause', () => {
    const trades = simulateLongGap([
      bar('2024-05-03', 10, 12),
      bar('2024-05-08', 12, 12),
      bar('2024-05-10', 12, 12),
      bar('2024-05-13', 12, 12),
      bar('2024-05-14', 12, 12),
      bar('2024-05-15', 12, 13),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-05-08', pattern: 'U' })]);
  });
});
