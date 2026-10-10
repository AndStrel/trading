import { describe, expect, it } from 'vitest';
import {
  alignWeekdayBars,
  sbgbSbmmBreakevenRatio,
  simulateSbgbSbmmRelativeLag,
} from './sbgb-sbmm-relative-lag.js';
import type { DailyBar } from './weekly-trend.js';

function series(start: string, days: number, priceAt: (i: number) => number): DailyBar[] {
  const rows: DailyBar[] = [];
  const t0 = Date.parse(`${start}T12:00:00Z`);
  let added = 0;
  for (let offset = 0; added < days; offset++) {
    const day = new Date(t0 + offset * 86_400_000).toISOString().slice(0, 10);
    const n = new Date(`${day}T12:00:00Z`).getUTCDay();
    if (n < 1 || n > 5) continue;
    const price = priceAt(added);
    rows.push({ day, open: price, high: price, low: price, close: price, volume: 1 });
    added += 1;
  }
  return rows;
}

describe('SBGB vs SBMM relative lag', () => {
  it('requires SBGB to lag SBMM by more than round-trip costs', () => {
    expect(sbgbSbmmBreakevenRatio).toBeGreaterThan(1.007);
    const sbmm = series('2024-10-01', 80, () => 100);
    const lagged = series('2024-10-01', 80, (i) => 100 * 0.995 ** i);
    const matched = series('2024-10-01', 80, () => 100);
    const opened = simulateSbgbSbmmRelativeLag(lagged, sbmm, '2025-01-01', '2025-03-31', 'relative-lag');
    const quiet = simulateSbgbSbmmRelativeLag(matched, sbmm, '2025-01-01', '2025-03-31', 'relative-lag');
    expect(opened.decisions.some((decision) => decision.status === 'opened')).toBe(true);
    expect(quiet.decisions.some((decision) => decision.status === 'no-signal')).toBe(true);
  });

  it('opens relative momentum only when the traded series leads by more than round-trip costs', () => {
    const sbmm = series('2024-10-01', 80, () => 100);
    const leader = series('2024-10-01', 80, (i) => 100 * 1.01 ** i);
    const matched = series('2024-10-01', 80, () => 100);
    const opened = simulateSbgbSbmmRelativeLag(leader, sbmm, '2025-01-01', '2025-03-31', 'relative-momentum');
    const quiet = simulateSbgbSbmmRelativeLag(matched, sbmm, '2025-01-01', '2025-03-31', 'relative-momentum');
    expect(opened.decisions.some((decision) => decision.status === 'opened')).toBe(true);
    expect(quiet.decisions.some((decision) => decision.status === 'no-signal')).toBe(true);
  });

  it('aligns only shared weekdays', () => {
    const left = series('2024-10-01', 10, () => 1);
    const right = series('2024-10-03', 8, () => 1);
    const aligned = alignWeekdayBars(left, right);
    expect(aligned.left.length).toBe(aligned.right.length);
    expect(aligned.left[0]?.day).toBe(aligned.right[0]?.day);
  });
});
