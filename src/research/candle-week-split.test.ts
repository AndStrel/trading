import { describe, expect, it } from 'vitest';
import { simulateWeekSplit } from './candle-week-split.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('two weekly bodies of opposite sign', () => {
  it('buys the next SBMX week after SBER rises and GAZP falls', () => {
    const trades = simulateWeekSplit(
      [bar('2024-06-03', 10, 12)],
      [bar('2024-06-03', 12, 10)],
      [bar('2024-06-10', 20, 21)],
    );
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-10', pattern: 'UD' })]);
  });
});
