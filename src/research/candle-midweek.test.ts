import { describe, expect, it } from 'vitest';
import { simulateMidweek } from './candle-midweek.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('Wednesday close against Monday open', () => {
  it('buys Thursday after Wednesday finishes above Monday open', () => {
    const trades = simulateMidweek([
      bar('2024-06-03', 10, 10),
      bar('2024-06-04', 10, 10),
      bar('2024-06-05', 10, 12),
      bar('2024-06-06', 12, 12),
      bar('2024-06-07', 12, 12),
      bar('2024-06-10', 12, 12),
      bar('2024-06-11', 12, 12),
      bar('2024-06-12', 12, 13),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-06', pattern: 'U' })]);
  });
});
