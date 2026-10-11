import { describe, expect, it } from 'vitest';
import { simulateLkohMonth } from './candle-lkoh-month.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('Lukoil month leading the shares', () => {
  it('buys the next share month after an up Lukoil month', () => {
    const trades = simulateLkohMonth(
      [bar('2024-06-03', 10, 12)],
      [bar('2024-07-01', 20, 21)],
    );
    expect(trades).toEqual([expect.objectContaining({ day: '2024-07-01', pattern: 'U' })]);
  });
});
