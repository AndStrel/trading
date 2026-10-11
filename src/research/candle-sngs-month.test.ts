import { describe, expect, it } from 'vitest';
import { simulateSngsMonth } from './candle-sngs-month.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('Surgutneftegas month leading Gazprom', () => {
  it('buys the next Gazprom month after an up Surgutneftegas month', () => {
    const trades = simulateSngsMonth(
      [bar('2024-06-03', 10, 12)],
      [bar('2024-07-01', 20, 21)],
    );
    expect(trades).toEqual([expect.objectContaining({ day: '2024-07-01', pattern: 'U' })]);
  });
});
