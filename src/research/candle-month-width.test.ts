import { describe, expect, it } from 'vitest';
import { simulateMonthWidth } from './candle-month-width.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, high: number, low: number, close: number): DailyBar {
  return { day, open, high, low, close, volume: 1 };
}

describe('monthly range width', () => {
  it('buys the next month after a narrow month', () => {
    const wide = (month: string) => bar(`${month}-01`, 10, 20, 10, 10);
    const trades = simulateMonthWidth([
      wide('2023-12'),
      wide('2024-01'),
      wide('2024-02'),
      wide('2024-03'),
      wide('2024-04'),
      wide('2024-05'),
      bar('2024-06-03', 10, 11, 10, 10),
      bar('2024-07-01', 20, 22, 19, 22),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-07-01', pattern: 'N' })]);
  });
});
