import { describe, expect, it } from 'vitest';
import { simulateWeeklySberpTrendPullback } from './weekly-sberp-trend-pullback.js';
import type { DailyBar } from './weekly-trend.js';

function data(): DailyBar[] {
  const rows: DailyBar[] = [];
  const start = Date.parse('2024-01-01T12:00:00Z');
  for (let week = 0; week < 55; week++) {
    for (let day = 0; day < 5; day++) {
      const date = new Date(start + (week * 7 + day) * 86_400_000).toISOString().slice(0, 10);
      const price = week === 39 ? 100 : week === 40 ? 98 : 90;
      rows.push({ day: date, open: price, high: price, low: price, close: price, volume: 100 });
    }
  }
  return rows;
}

describe('weekly SBERP trend pullback', () => {
  it('enters after a completed weak week above its past-only 200-close mean', () => {
    const result = simulateWeeklySberpTrendPullback(data());
    const entry = result.decisions.find((decision) => decision.day === '2024-10-14');
    expect(entry).toMatchObject({ status: 'opened', priorClose: 98 });
    expect(entry?.priorWeekReturnPct).toBeCloseTo(-2);
    expect(entry?.sma200).toBeLessThan(98);
    expect(result.trades.find((trade) => trade.entryDay === '2024-10-14')?.exitDay).toBe('2024-11-11');
  });

  it('does not use a changed future price to decide the current entry', () => {
    const original = data();
    const revised = original.map((bar) => bar.day > '2024-10-14' ? { ...bar, open: 200,
      high: 200, low: 200, close: 200 } : bar);
    const first = simulateWeeklySberpTrendPullback(original).decisions.find((x) => x.day === '2024-10-14');
    const second = simulateWeeklySberpTrendPullback(revised).decisions.find((x) => x.day === '2024-10-14');
    expect(second).toEqual(first);
  });
});
