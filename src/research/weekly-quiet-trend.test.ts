import { describe, expect, it } from 'vitest';
import { median, simulateWeeklyQuietTrend } from './weekly-quiet-trend.js';
import type { DailyBar } from './weekly-trend.js';

function bars(count: number, start = '2015-01-01'): DailyBar[] {
  const result: DailyBar[] = [];
  const date = new Date(`${start}T12:00:00Z`);
  while (result.length < count) {
    if (date.getUTCDay() >= 1 && date.getUTCDay() <= 5) {
      const price = 100 + result.length * 0.1;
      result.push({ day: date.toISOString().slice(0, 10), open: price, high: price + 1,
        low: price - 1, close: price, volume: 100 });
    }
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return result;
}

describe('weekly quiet trend', () => {
  it('uses a true numeric median', () => {
    expect(median([10, 1, 3, 2])).toBe(2.5);
    expect(median([10, 1, 3])).toBe(3);
  });
  it('does not use the current candle for signal', () => {
    const input = bars(285);
    const baseline = simulateWeeklyQuietTrend(input, 'quiet-trend');
    const candidate = input.map((bar) => ({ ...bar }));
    const decision = baseline.decisions.find((item) => item.status === 'opened');
    expect(decision).toBeDefined();
    const altered = candidate.find((bar) => bar.day === decision!.day)!;
    altered.high = 1_000_000;
    altered.low = 0.01;
    const after = simulateWeeklyQuietTrend(candidate, 'quiet-trend');
    expect(after.decisions.find((item) => item.day === decision!.day)?.status).toBe('opened');
  });
  it('charges both sides and exits after five later sessions', () => {
    const result = simulateWeeklyQuietTrend(bars(285), 'always-long');
    const trade = result.trades[0]!;
    expect(trade.netPct).toBeLessThan((trade.exit / trade.entry - 1) * 100);
    const input = bars(285);
    expect(input.findIndex((bar) => bar.day === trade.exitDay) -
      input.findIndex((bar) => bar.day === trade.entryDay)).toBe(5);
  });
});
