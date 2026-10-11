import { describe, expect, it } from 'vitest';
import { crossGroupPasses, simulateCrossMonth } from './candle-cross-month.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('cross-month lead', () => {
  it('buys the equity month after a rising signal month', () => {
    const signal = [bar('2023-11-30', 10, 10), bar('2023-12-29', 10, 12), bar('2024-01-03', 12, 12), bar('2024-02-01', 12, 12)];
    const target = [bar('2023-11-30', 10, 10), bar('2023-12-29', 10, 10), bar('2024-01-03', 20, 20), bar('2024-02-01', 22, 22)];
    const trades = simulateCrossMonth(signal, target, 'tgld');
    expect(trades).toEqual([expect.objectContaining({ month: '2024-01', pattern: 'tgld-up' })]);
  });

  it('rejects a mean that disappears without the best trade', () => {
    const trades = Array.from({ length: 8 }, (_, index) => ({ month: `2024-0${index + 1}`, pattern: 'tgld-up', netPct: index === 0 ? 20 : -0.1, stressPct: 0.1 }));
    expect(crossGroupPasses(trades)).toBe(false);
  });
});
