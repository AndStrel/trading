import { describe, expect, it } from 'vitest';
import {
  controlBlocksSpecificity,
  flowGateReasons,
  secondThursday,
  simulateStructuralFlows,
  thirdThursday,
  type FlowTrade,
} from './structural-flow.js';
import type { DailyBar } from './weekly-trend.js';

function bars(days: string[], price: (day: string) => number): DailyBar[] {
  return days.map((day) => {
    const priceValue = price(day);
    return { day, open: priceValue, high: priceValue, low: priceValue, close: priceValue, volume: 1 };
  });
}

function weekdays(from: string, thru: string): string[] {
  const days: string[] = [];
  const cursor = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${thru}T12:00:00Z`);
  while (cursor <= end) {
    const day = cursor.getUTCDay();
    if (day >= 1 && day <= 5) days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

describe('structural flow calendars', () => {
  it('anchors the third Thursday and the non-quarter second Thursday', () => {
    expect(thirdThursday(2024, 3)).toBe('2024-03-21');
    expect(new Date(`${thirdThursday(2024, 6)}T12:00:00Z`).getUTCDay()).toBe(4);
    expect(secondThursday(2024, 2)).toBe('2024-02-08');
    expect(Number(secondThursday(2024, 3).slice(8, 10))).toBeGreaterThan(7);
  });

  it('enters two sessions before expiration and exits on the next session', () => {
    const days = weekdays('2024-03-01', '2024-03-29');
    const result = simulateStructuralFlows(bars(days, () => 100), bars(days, () => 50));
    const trade = result.expiration.find((item) => item.anchorDay === '2024-03-21');
    expect(trade?.status).toBe('trade');
    expect(trade?.entryDay).toBe('2024-03-19');
    expect(trade?.exitDay).toBe('2024-03-22');
    expect(trade?.sbmxNetPct).toBeLessThan(0);
  });

  it('does not move a missing expiration Thursday onto a neighbor', () => {
    const days = weekdays('2024-03-01', '2024-03-29').filter((day) => day !== '2024-03-21');
    const result = simulateStructuralFlows(bars(days, () => 100), bars(days, () => 50));
    expect(result.expiration.find((item) => item.anchorDay === '2024-03-21')?.status).toBe('unresolved');
  });

  it('drops sessions after the frozen 2025 sample', () => {
    const days = weekdays('2026-03-01', '2026-03-31');
    const result = simulateStructuralFlows(bars(days, () => 100), bars(days, () => 50));
    expect(result.expiration.every((item) => item.year <= 2025 || item.status === 'unresolved')).toBe(true);
    expect(result.expiration.some((item) => item.entryDay?.startsWith('2026'))).toBe(false);
  });

  it('keeps the month-start exit three sessions later', () => {
    const days = weekdays('2024-03-01', '2024-03-29');
    const result = simulateStructuralFlows(bars(days, () => 100), bars(days, () => 50));
    const march = result.turnOfMonth.find((item) => item.anchorDay === '2024-03-01');
    expect(march).toMatchObject({ status: 'trade', entryDay: '2024-03-01', exitDay: '2024-03-06' });
  });
});

describe('structural flow gates', () => {
  it('rejects a sample that cannot drop the best three trades', () => {
    const trades: FlowTrade[] = [1, 2, 3].map((index) => ({
      kind: 'expiration',
      anchorDay: `2024-03-0${index}`,
      year: 2024,
      status: 'trade',
      sbmxNetPct: 1,
      sbmxStressPct: 1,
      sbmmNetPct: 0,
      excessPct: 1,
    }));
    expect(flowGateReasons(trades, 14)).toContain('too-few-trades');
  });

  it('lets a failing control leave expiration specific', () => {
    expect(controlBlocksSpecificity(['failed-combined-mean', 'failed-discovery-mean', 'failed-validation-mean'])).toBe(false);
    expect(controlBlocksSpecificity([])).toBe(true);
    expect(controlBlocksSpecificity(['too-few-trades'])).toBe(true);
  });
});
