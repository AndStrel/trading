import { describe, expect, it } from 'vitest';
import { simulateSbmxSbmmSma60 } from './sbmx-sbmm-sma60-overlay.js';
import type { DailyBar } from './weekly-trend.js';

function weekdays(start: string, count: number, priceAt: (i: number) => number): DailyBar[] {
  const rows: DailyBar[] = [];
  const t0 = Date.parse(`${start}T12:00:00Z`);
  for (let offset = 0; rows.length < count; offset++) {
    const day = new Date(t0 + offset * 86_400_000).toISOString().slice(0, 10);
    const n = new Date(`${day}T12:00:00Z`).getUTCDay();
    if (n < 1 || n > 5) continue;
    const price = priceAt(rows.length);
    rows.push({ day, open: price, high: price, low: price, close: price, volume: 1 });
  }
  return rows;
}

describe('SBMX/SBMM SMA60 overlay', () => {
  it('starts in SBMM then switches to SBMX in a rising market', () => {
    const sbmx = weekdays('2021-10-01', 90, (i) => 100 + i);
    const sbmm = weekdays('2021-10-01', 90, () => 100);
    const result = simulateSbmxSbmmSma60({
      sbmx,
      sbmm,
      from: sbmx[0]!.day,
      thru: sbmx.at(-1)!.day,
    });
    expect(result.marks[0]?.sleeve).toBe('sbmm');
    expect(result.marks.some((mark) => mark.sleeve === 'sbmx')).toBe(true);
    expect(result.switches).toBeGreaterThan(0);
  });

  it('switches back to SBMM after a break below the SMA', () => {
    const sbmx = weekdays('2021-10-01', 90, (i) => (i < 70 ? 100 + i : 50));
    const sbmm = weekdays('2021-10-01', 90, () => 100);
    const result = simulateSbmxSbmmSma60({
      sbmx,
      sbmm,
      from: sbmx[0]!.day,
      thru: sbmx.at(-1)!.day,
    });
    const held = result.marks.filter((mark) => mark.sleeve !== null);
    expect(held.at(-1)?.sleeve).toBe('sbmm');
  });
});
