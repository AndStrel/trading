import { describe, expect, it } from 'vitest';
import { simulateLkohWeek } from './candle-lkoh-week.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('Lukoil week leading Rosneft', () => {
  it('buys the next Rosneft week after an up Lukoil week', () => {
    const trades = simulateLkohWeek(
      [bar('2024-06-03', 10, 12)],
      [bar('2024-06-10', 20, 21)],
    );
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-10', pattern: 'U' })]);
  });
});
