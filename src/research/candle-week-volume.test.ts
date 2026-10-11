import { describe, expect, it } from 'vitest';
import { simulateWeekVolume } from './candle-week-volume.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, volume: number): DailyBar {
  return { day, open: 10, high: 11, low: 9, close: 10, volume };
}

describe('weekly volume versus its median', () => {
  it('buys the next week after a high-volume week', () => {
    const trades = simulateWeekVolume([
      bar('2024-04-08', 1),
      bar('2024-04-15', 1),
      bar('2024-04-22', 1),
      bar('2024-04-29', 1),
      bar('2024-05-06', 1),
      bar('2024-05-13', 1),
      bar('2024-05-20', 1),
      bar('2024-05-27', 1),
      bar('2024-06-03', 5),
      bar('2024-06-10', 1),
    ]);
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-10', pattern: 'H' })]);
  });
});
