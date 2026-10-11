import { describe, expect, it } from 'vitest';
import { simulateGoldLead } from './candle-gold-lead.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('gold fund leading the miner', () => {
  it('buys the next miner week after an up gold-fund week', () => {
    const trades = simulateGoldLead(
      [bar('2024-06-03', 10, 12)],
      [bar('2024-06-10', 20, 21)],
    );
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-10', pattern: 'U' })]);
  });
});
