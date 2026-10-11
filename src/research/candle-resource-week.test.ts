import { describe, expect, it } from 'vitest';
import { simulateWeekLead } from './candle-week-lead.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('weekly laggard of the resource names', () => {
  it('buys the unique loser for the next week', () => {
    const book = (prior: number, signal: number, entry: number, exit: number) => [
      bar('2024-05-27', prior, prior),
      bar('2024-06-03', signal, signal),
      bar('2024-06-10', entry, entry),
      bar('2024-06-17', exit, exit),
    ];
    const trades = simulateWeekLead({
      LKOH: book(12, 10, 100, 110),
      ROSN: book(18, 20, 50, 50),
      PLZL: book(29, 30, 40, 40),
    }, 'laggard');
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-10', ticker: 'LKOH' })]);
  });
});
