import { describe, expect, it } from 'vitest';
import { simulateWeeklyMarketRegime } from './weekly-market-regime.js';
import { simulateWeeklyRelativeStrength } from './weekly-relative-strength.js';
import type { DailyBar } from './weekly-trend.js';

function bars(count: number, slope: number): DailyBar[] {
  const result: DailyBar[] = [];
  const date = new Date('2015-01-01T12:00:00Z');
  while (result.length < count) {
    if (date.getUTCDay() >= 1 && date.getUTCDay() <= 5) {
      const price = 100 + result.length * slope;
      result.push({ day: date.toISOString().slice(0, 10), open: price, close: price,
        high: price + 1, low: price - 1, volume: 100 });
    }
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return result;
}

describe('weekly market regime', () => {
  it('ignores an index-only day and rejects a missing SBER day', () => {
    const sber = bars(300, 0.1), gazp = bars(300, 0), index = bars(300, 0.1);
    index.push({ ...index.at(-1)!, day: '2017-01-02' });
    expect(() => simulateWeeklyMarketRegime(sber, gazp, index)).not.toThrow();
    index.splice(50, 1);
    expect(() => simulateWeeklyMarketRegime(sber, gazp, index)).toThrow('calendars differ');
  });
  it('does not read the current index close to form the signal', () => {
    const sber = bars(300, 0.1), gazp = bars(300, 0), index = bars(300, 0.1);
    const baseline = simulateWeeklyMarketRegime(sber, gazp, index);
    const first = baseline.decisions.find((decision) => decision.status === 'opened')!;
    expect(first).toBeDefined();
    index.find((bar) => bar.day === first.day)!.close = 0.01;
    const after = simulateWeeklyMarketRegime(sber, gazp, index);
    expect(after.decisions.find((decision) => decision.day === first.day)?.status).toBe('opened');
  });
  it('matches relative strength when the index gate always passes', () => {
    const sber = bars(300, 0.1), gazp = bars(300, 0), index = bars(300, 0.2);
    const result = simulateWeeklyMarketRegime(sber, gazp, index);
    const control = simulateWeeklyRelativeStrength(sber, gazp);
    expect(result.trades.map((trade) => [trade.entryDay, trade.exitDay, trade.netPct]))
      .toEqual(control.trades.map((trade) => [trade.entryDay, trade.exitDay, trade.netPct]));
  });
});
