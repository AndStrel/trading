import { describe, expect, it } from 'vitest';
import { simulateWeeklyTrend, type DailyBar } from './weekly-trend.js';

function weekdays(count: number): DailyBar[] {
  const rows: DailyBar[] = [], date = new Date('2020-01-01T12:00:00Z');
  while (rows.length < count) {
    const day = date.getUTCDay();
    if (day >= 1 && day <= 5) {
      const price = 100 + rows.length * 0.1;
      rows.push({ day: date.toISOString().slice(0, 10), open: price, high: price, low: price, close: price, volume: 100 });
    }
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return rows;
}

describe('weekly trend simulation', () => {
  it('opens after a full 252-session history and exits 20 sessions later without leverage', () => {
    const bars = weekdays(290);
    const result = simulateWeeklyTrend(bars, 'trend');
    expect(result.trades.length).toBeGreaterThan(0);
    expect(result.trades[0]?.entryDay).toBe(bars[253]?.day);
    expect(result.trades[0]?.exitDay).toBe(bars[273]?.day);
    expect(result.trades[0]?.netPct).toBeLessThan(result.trades[0]!.grossPct);
    expect(result.maxConcurrent).toBeLessThanOrEqual(5);
    expect(result.endingCash).toBeGreaterThanOrEqual(0);
  });

  it('does not enter when the previous 252-session price trend is down', () => {
    const bars = weekdays(280).map((bar, index) => {
      const price = 200 - index * 0.1;
      return { ...bar, open: price, high: price, low: price, close: price };
    });
    const result = simulateWeeklyTrend(bars, 'trend');
    expect(result.trades).toHaveLength(0);
    expect(result.decisions.some((d) => d.status === 'no-signal')).toBe(true);
  });
});
