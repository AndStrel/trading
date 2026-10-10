import { describe, expect, it } from 'vitest';
import { atrAtEntry, simulateWeeklyTrendStop } from './weekly-trend-stop.js';
import { simulateWeeklyTrend, type DailyBar } from './weekly-trend.js';

function bars(count: number, crashIndex = -1): DailyBar[] {
  const result: DailyBar[] = [];
  const date = new Date('2015-01-01T12:00:00Z');
  while (result.length < count) {
    if (date.getUTCDay() >= 1 && date.getUTCDay() <= 5) {
      const index = result.length;
      const open = index === crashIndex ? 60 : 100 + index * 0.1;
      result.push({ day: date.toISOString().slice(0, 10), open, close: open,
        high: open + 1, low: open - 1, volume: 100 });
    }
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return result;
}

describe('weekly trend with fixed stop', () => {
  it('computes ATR from only completed sessions', () => {
    const input = bars(280);
    const before = atrAtEntry(input, 273);
    input[273]!.high = 1_000_000;
    expect(atrAtEntry(input, 273)).toBe(before);
  });
  it('reproduces the old no-stop trade dates and returns', () => {
    const input = bars(300);
    const old = simulateWeeklyTrend(input, 'trend');
    const control = simulateWeeklyTrendStop(input, false);
    expect(control.trades.map((trade) => [trade.entryDay, trade.exitDay, trade.netPct]))
      .toEqual(old.trades.map((trade) => [trade.entryDay, trade.exitDay, trade.netPct]));
  });
  it('fills at the worse opening after a gap through the stop', () => {
    const input = bars(290);
    const baseline = simulateWeeklyTrendStop(input, true);
    const entry = baseline.decisions.find((decision) => decision.status === 'opened')!.day;
    const entryIndex = input.findIndex((bar) => bar.day === entry);
    input[entryIndex + 1]!.open = 60;
    input[entryIndex + 1]!.close = 60;
    input[entryIndex + 1]!.low = 59;
    input[entryIndex + 1]!.high = 61;
    const result = simulateWeeklyTrendStop(input, true);
    const trade = result.trades.find((candidate) => candidate.entryDay === entry)!;
    expect(trade.reason).toBe('stop');
    expect(trade.gapThroughStop).toBe(true);
    expect(trade.exit).toBe(60);
  });
});
