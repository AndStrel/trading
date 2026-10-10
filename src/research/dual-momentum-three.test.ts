import { describe, expect, it } from 'vitest';
import { simulateDualMomentumThree } from './dual-momentum-three.js';
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

describe('dual momentum three sleeves', () => {
  it('starts in SBMM and later holds the 120-day winner', () => {
    const sbmx = weekdays('2022-01-03', 160, (i) => 100 + i);
    const tgld = weekdays('2022-01-03', 160, () => 100);
    const sbmm = weekdays('2022-01-03', 160, () => 100);
    const result = simulateDualMomentumThree({
      sbmx,
      tgld,
      sbmm,
      from: sbmx[0]!.day,
      thru: sbmx.at(-1)!.day,
    });
    expect(result.firstSignalDay).not.toBeNull();
    expect(result.marks.find((mark) => mark.sleeve !== null)?.sleeve).toBe('sbmm');
    expect(result.marks.some((mark) => mark.sleeve === 'sbmx')).toBe(true);
  });

  it('stays in SBMM when all 120-day returns are non-positive', () => {
    const sbmx = weekdays('2022-01-03', 160, (i) => 100 - i * 0.1);
    const tgld = weekdays('2022-01-03', 160, (i) => 100 - i * 0.05);
    const sbmm = weekdays('2022-01-03', 160, () => 100);
    const result = simulateDualMomentumThree({
      sbmx,
      tgld,
      sbmm,
      from: sbmx[0]!.day,
      thru: sbmx.at(-1)!.day,
    });
    expect(result.marks.filter((mark) => mark.sleeve !== null).every((mark) => mark.sleeve === 'sbmm')).toBe(true);
    expect(result.switches).toBe(0);
  });
});
