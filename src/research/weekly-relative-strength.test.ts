import { describe, expect, it } from 'vitest';
import { simulateWeeklyRelativeStrength } from './weekly-relative-strength.js';
import { simulateWeeklyTrend, type DailyBar } from './weekly-trend.js';

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

describe('weekly SBER relative strength', () => {
  it('rejects a misaligned reference calendar', () => {
    const sber = bars(300, 0.1), gazp = bars(300, 0);
    gazp[50]!.day = '2015-01-01';
    expect(() => simulateWeeklyRelativeStrength(sber, gazp)).toThrow('calendars differ');
  });
  it('uses only previous closes for the signal', () => {
    const sber = bars(300, 0.1), gazp = bars(300, 0);
    const baseline = simulateWeeklyRelativeStrength(sber, gazp);
    const first = baseline.decisions.find((decision) => decision.status === 'opened')!;
    expect(first).toBeDefined();
    gazp.find((bar) => bar.day === first.day)!.close = 1_000_000;
    const after = simulateWeeklyRelativeStrength(sber, gazp);
    expect(after.decisions.find((decision) => decision.day === first.day)?.status).toBe('opened');
  });
  it('matches the old trend model when the relative filter always passes', () => {
    const sber = bars(300, 0.1), gazp = bars(300, 0);
    const result = simulateWeeklyRelativeStrength(sber, gazp);
    const control = simulateWeeklyTrend(sber, 'trend');
    expect(result.trades.map((trade) => [trade.entryDay, trade.exitDay, trade.netPct]))
      .toEqual(control.trades.map((trade) => [trade.entryDay, trade.exitDay, trade.netPct]));
  });
});
