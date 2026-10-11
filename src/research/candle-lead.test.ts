import { describe, expect, it } from 'vitest';
import { simulateLead } from './candle-lead.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('daily leadership', () => {
  it('holds the next five sessions after the stronger stock day', () => {
    const days = ['2024-06-03', '2024-06-04', '2024-06-05', '2024-06-06', '2024-06-07', '2024-06-10', '2024-06-11'];
    const sber = days.map((day, index) => bar(day, 10, index === 0 ? 12 : 10));
    const gazp = days.map((day) => bar(day, 10, 10));
    const sbmx = days.map((day, index) => bar(day, 100 + index, 100 + index));
    const trades = simulateLead(sber, gazp, sbmx);
    expect(trades[0]).toMatchObject({ day: '2024-06-04', pattern: 'S' });
    expect(trades).toHaveLength(1);
  });
});
