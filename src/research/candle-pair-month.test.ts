import { describe, expect, it } from 'vitest';
import { simulatePairMonth } from './candle-pair-month.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, close: number): DailyBar {
  return { day, open: close, high: close, low: close, close, volume: 1 };
}

describe('SBER and SBERP monthly laggard', () => {
  it('buys the unique loser for the next month', () => {
    const trades = simulatePairMonth({
      SBER: [bar('2023-11-01', 12), bar('2023-12-01', 10), bar('2024-01-03', 20)],
      SBERP: [bar('2023-11-01', 10), bar('2023-12-01', 11), bar('2024-01-03', 30)],
    }, 'laggard');
    expect(trades).toEqual([expect.objectContaining({ day: '2024-01-01', ticker: 'SBER' })]);
  });
});
