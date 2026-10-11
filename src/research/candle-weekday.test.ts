import { describe, expect, it } from 'vitest';
import { simulateWeekday } from './candle-weekday.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('weekday candle', () => {
  it('buys Monday from its own open to its own close', () => {
    const trades = simulateWeekday([bar('2024-06-03', 10, 12)]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-03', pattern: 'MON' })]);
  });
});
