import { describe, expect, it } from 'vitest';
import {
  classifyScheduledCut,
  simulateSbgbAfterCbrCut,
} from './sbgb-after-cbr-cut.js';
import type { DailyBar } from './weekly-trend.js';

function bars(start: string, n: number, price: number): DailyBar[] {
  const rows: DailyBar[] = [];
  const t0 = Date.parse(`${start}T12:00:00Z`);
  for (let offset = 0, added = 0; added < n; offset++) {
    const day = new Date(t0 + offset * 86_400_000).toISOString().slice(0, 10);
    const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
    if (dow < 1 || dow > 5) continue;
    rows.push({ day, open: price, high: price, low: price, close: price, volume: 1 });
    added += 1;
  }
  return rows;
}

describe('SBGB after CBR cut', () => {
  it('classifies cut, hike and hold from the next published rate', () => {
    const rates = [
      { day: '2025-12-19', rate: 16.5 },
      { day: '2025-12-22', rate: 16 },
      { day: '2024-10-25', rate: 21 },
      { day: '2024-10-28', rate: 21 },
      { day: '2024-07-26', rate: 18 },
      { day: '2024-07-29', rate: 18.5 },
    ];
    expect(classifyScheduledCut(rates, '2025-12-19')).toBe('cut');
    expect(classifyScheduledCut(rates, '2024-10-25')).toBe('hold');
    expect(classifyScheduledCut(rates, '2024-07-26')).toBe('hike');
  });

  it('enters SBGB only after a cut and on the next session, not decision day', () => {
    const sbgb = bars('2025-01-06', 40, 100).map((bar, index) => ({
      ...bar,
      open: 100 + index,
      close: 100 + index,
      high: 100 + index,
      low: 100 + index,
    }));
    const sbmm = bars('2025-01-06', 40, 10);
    const rates = [
      { day: '2025-01-10', rate: 21 },
      { day: '2025-01-13', rate: 20 },
    ];
    const result = simulateSbgbAfterCbrCut({
      rates,
      decisions: ['2025-01-10'],
      sbgb,
      sbmm,
      from: '2025-01-01',
      thru: '2025-12-31',
    });
    expect(result[0]?.status).toBe('trade');
    expect(result[0]?.entryDay).toBe('2025-01-13');
    expect(result[0]?.entryDay).not.toBe('2025-01-10');
  });

  it('can require a hike instead of a cut without trading the cut event', () => {
    const sbgb = bars('2025-01-06', 40, 100);
    const sbmm = bars('2025-01-06', 40, 10);
    const rates = [
      { day: '2025-01-10', rate: 20 },
      { day: '2025-01-13', rate: 21 },
    ];
    const hike = simulateSbgbAfterCbrCut({
      rates,
      decisions: ['2025-01-10'],
      sbgb,
      sbmm,
      from: '2025-01-01',
      thru: '2025-12-31',
      requiredMove: 'hike',
    });
    const cut = simulateSbgbAfterCbrCut({
      rates,
      decisions: ['2025-01-10'],
      sbgb,
      sbmm,
      from: '2025-01-01',
      thru: '2025-12-31',
      requiredMove: 'cut',
    });
    expect(hike[0]?.status).toBe('trade');
    expect(cut[0]?.status).toBe('cash');
  });
});
