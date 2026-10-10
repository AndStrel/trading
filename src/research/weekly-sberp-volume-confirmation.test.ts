import { describe, expect, it } from 'vitest';
import { simulateWeeklySberpVolumeConfirmation } from './weekly-sberp-volume-confirmation.js';
import type { DailyBar } from './weekly-trend.js';

function data(): DailyBar[] {
  const rows: DailyBar[] = [];
  const start = Date.parse('2024-01-01T12:00:00Z');
  for (let week = 0; week < 27; week++) {
    for (let day = 0; day < 5; day++) {
      const date = new Date(start + (week * 7 + day) * 86_400_000).toISOString().slice(0, 10);
      const price = week === 20 && day === 4 ? 101 : 100;
      rows.push({ day: date, open: 100, high: Math.max(100, price), low: 100,
        close: price, volume: week === 20 ? 200 : 100 });
    }
  }
  return rows;
}

describe('weekly SBERP volume confirmation', () => {
  it('excludes the signal week from its 20-week volume median and waits for completion', () => {
    const result = simulateWeeklySberpVolumeConfirmation(data());
    const entry = result.decisions.find((decision) => decision.day === '2024-05-27');
    expect(entry).toMatchObject({ status: 'opened', priorVolume: 1000,
      baselineVolume: 500, positivePriorWeek: true });
    expect(result.trades.find((trade) => trade.entryDay === '2024-05-27')?.exitDay).toBe('2024-06-24');
  });

  it('does not change an entry when later prices and volumes change', () => {
    const original = data();
    const changed = original.map((bar) => bar.day > '2024-05-27' ?
      { ...bar, open: 200, high: 200, low: 200, close: 200, volume: 9999 } : bar);
    const first = simulateWeeklySberpVolumeConfirmation(original).decisions.find((x) =>
      x.day === '2024-05-27');
    const second = simulateWeeklySberpVolumeConfirmation(changed).decisions.find((x) =>
      x.day === '2024-05-27');
    expect(second).toEqual(first);
  });
});
