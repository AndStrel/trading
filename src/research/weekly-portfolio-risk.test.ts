import { describe, expect, it } from 'vitest';
import { auditWeeklyPortfolio } from './weekly-portfolio-risk.js';
import type { DailyBar } from './weekly-trend.js';

const days = ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05',
  '2024-01-08', '2024-01-09', '2024-01-10'];
function bars(): DailyBar[] {
  return days.map((day, index) => ({ day, open: index >= 5 ? 110 : 100,
    close: index >= 5 ? 110 : 100, high: index >= 5 ? 111 : 101,
    low: index >= 5 ? 109 : 99, volume: 100 }));
}

describe('weekly portfolio risk audit', () => {
  it('reconstructs cash, marks open positions and separates trade wins from active-week wins', () => {
    const principal = 200_000, shares = principal / (100 * 1.0005 * 1.003);
    const proceeds = shares * 110 * 0.9995 * 0.997;
    const result = auditWeeklyPortfolio(bars(), [
      { entryDay: '2024-01-02', exitDay: '2024-01-09', entry: 100, principal, proceeds },
    ], [], 800_000 + proceeds);
    expect(result.endingCash).toBeCloseTo(800_000 + proceeds);
    expect(result.activeWeeks).toBe(2);
    expect(result.positiveActiveWeeks).toBe(1);
    expect(result.maxDrawdownPct).toBeLessThan(0);
    expect(result.daily.find((day) => day.day === '2024-01-02')?.openPositions).toBe(1);
  });
  it('refuses a journal that spends unavailable cash', () => {
    const principal = 1_100_000;
    expect(() => auditWeeklyPortfolio(bars(), [], [
      { entryDay: '2024-01-02', entry: 100, principal, shares: principal / 100 },
    ], -100_000)).toThrow('spent more than available');
  });
  it('requires exact ledger reconciliation', () => {
    expect(() => auditWeeklyPortfolio(bars(), [], [], 999_000)).toThrow('does not match source ledger');
  });
});
