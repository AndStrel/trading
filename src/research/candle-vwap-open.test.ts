import { describe, expect, it } from 'vitest';
import { simulateVwapOpen } from './candle-vwap-open.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, price: number): DailyBar {
  return { day, open: price, high: price, low: price, close: price, volume: 1 };
}

describe('week open against the prior week VWAP', () => {
  it('buys the week that opens above the prior VWAP', () => {
    const trades = simulateVwapOpen([
      bar('2024-06-03', 10),
      bar('2024-06-10', 12),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-10', pattern: 'A' })]);
  });
});
