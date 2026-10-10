import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { paperDualMomentumAsOf, readPaperDualMomentumSignal } from './sbmx-sbgb-dual-momentum.js';
import type { DailyBar } from '../research/weekly-trend.js';

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

describe('paper SBMX/SBGB/SBMM dual momentum', () => {
  it('maps the second sleeve slot to SBGB and stays paper-only', () => {
    const sbmx = weekdays('2022-01-03', 160, (i) => 100 + i);
    const sbgb = weekdays('2022-01-03', 160, () => 100);
    const sbmm = weekdays('2022-01-03', 160, () => 100);
    const signal = paperDualMomentumAsOf(sbmx, sbgb, sbmm, sbmx.at(-1)!.day);
    expect(signal.live).toBe(false);
    expect(signal.sleeve).toBe('SBMX');
  });

  it('refuses when local snapshots are missing', () => {
    const signal = readPaperDualMomentumSignal('2025-12-30', {
      sbmx: '/tmp/missing-sbmx.json',
      sbgb: '/tmp/missing-sbgb.json',
      sbmm: '/tmp/missing-sbmm.json',
    });
    expect(signal).toEqual({ available: false, reason: 'local-daily-snapshots-missing', live: false });
  });

  it('clamps asOf to the last aligned snapshot day when the calendar is ahead', () => {
    const directory = mkdtempSync(join(tmpdir(), 'dual-snapshots-'));
    const rows = weekdays('2022-01-03', 40, (i) => 100 + i);
    const lastDay = rows.at(-1)!.day;
    const snapshot = { rowsSha256: 'test', rows };
    const paths = {
      sbmx: join(directory, 'sbmx.json'),
      sbgb: join(directory, 'sbgb.json'),
      sbmm: join(directory, 'sbmm.json'),
    };
    for (const path of Object.values(paths)) {
      writeFileSync(path, JSON.stringify(snapshot));
    }
    const signal = readPaperDualMomentumSignal('2099-01-01', paths);
    expect(signal.available).toBe(true);
    if (!signal.available) return;
    expect(signal.asOf).toBe(lastDay);
    expect(signal.dataThrough).toBe(lastDay);
    expect(signal.stale).toBe(true);
    expect(signal.requestedAsOf).toBe('2099-01-01');
  });
});
