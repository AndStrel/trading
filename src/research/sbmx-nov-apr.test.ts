import { describe, expect, it } from 'vitest';
import { simulateSbmxNovApr } from './sbmx-nov-apr.js';
import type { DailyBar } from './weekly-trend.js';

function bars(days: string[], price: (day: string) => number): DailyBar[] {
  return days.map((day) => {
    const priceValue = price(day);
    return { day, open: priceValue, high: priceValue, low: priceValue, close: priceValue, volume: 1 };
  });
}

describe('SBMX November-April calendar', () => {
  it('buys on or after 1 Nov and sells on or after 1 May with both-side costs', () => {
    const sbmx = bars(
      ['2021-10-29', '2021-11-01', '2022-04-29', '2022-05-03'],
      (day) => (day >= '2022-05-01' ? 110 : 100),
    );
    const sbmm = bars(
      ['2021-10-29', '2021-11-01', '2022-04-29', '2022-05-03'],
      () => 100,
    );
    const result = simulateSbmxNovApr(sbmx, sbmm, [2021]);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]?.entryDay).toBe('2021-11-01');
    expect(result.trades[0]?.exitDay).toBe('2022-05-03');
    expect(result.trades[0]?.sbmxNetPct).toBeLessThan(10);
    expect(result.trades[0]?.sbmxNetPct).toBeGreaterThan(8);
    expect(result.trades[0]?.excessPct).toBeGreaterThan(0);
  });

  it('marks a winter unresolved when the May session is missing', () => {
    const sbmx = bars(['2021-11-01'], () => 100);
    const sbmm = bars(['2021-11-01'], () => 100);
    const result = simulateSbmxNovApr(sbmx, sbmm, [2021]);
    expect(result.winters[0]?.status).toBe('unresolved');
    expect(result.endingLiquidationValue).toBe(1_000_000);
  });
});
