import { describe, expect, it } from 'vitest';
import { simulateWidth } from './candle-width.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number, high: number, low: number): DailyBar {
  return { day, open, high, low, close, volume: 1 };
}

describe('range width', () => {
  it('marks a wide day against the prior twenty ranges', () => {
    const bars = Array.from({ length: 28 }, (_, index) => {
      const day = `2024-01-${String(index + 1).padStart(2, '0')}`;
      return bar(day, 10, 10, index === 21 ? 20 : 11, index === 21 ? 9 : 10);
    });
    const trades = simulateWidth(bars);
    expect(trades.at(-1)?.pattern).toBe('H');
  });
});
