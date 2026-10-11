import { describe, expect, it } from 'vitest';
import { simulateWeekAverage } from './candle-week-average.js';
import type { DailyBar } from './weekly-trend.js';

function monday(offsetWeeks: number): string {
  const date = new Date('2023-08-21T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + offsetWeeks * 7);
  return date.toISOString().slice(0, 10);
}

function bar(day: string, close: number): DailyBar {
  return { day, open: close, high: close, low: close, close, volume: 1 };
}

describe('week close against the prior twenty-week average', () => {
  it('buys the next week after a close above that average', () => {
    const bars = Array.from({ length: 22 }, (_, index) => bar(monday(index), index === 20 ? 12 : 10));
    const trades = simulateWeekAverage(bars);
    expect(trades).toEqual([expect.objectContaining({ day: monday(21), pattern: 'U' })]);
  });
});
