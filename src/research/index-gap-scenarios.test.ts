import { describe, expect, it } from 'vitest';
import { pre2015IndexGapScenarios } from './index-gap-scenarios.js';
import type { DailyBar } from './weekly-trend.js';

const bar = (day: string, close: number): DailyBar => ({ day, open: close, close,
  high: close + 1, low: close - 1, volume: 1 });

describe('pre-2015 index gap scenarios', () => {
  it('reconciles only the predefined single gap in both ways', () => {
    const sber = [bar('2008-02-22', 100), bar('2008-02-25', 101), bar('2008-02-26', 102)];
    const gazp = [bar('2008-02-21', 99), ...sber.map((item) => ({ ...item }))];
    const imoex = [bar('2008-02-22', 200), bar('2008-02-26', 202)];
    const result = pre2015IndexGapScenarios(sber, gazp, imoex);
    expect(result.carryForward.imoex.find((item) => item.day === '2008-02-25')?.close).toBe(200);
    expect(result.omitDay.sber.map((item) => item.day)).toEqual(['2008-02-22', '2008-02-26']);
    expect(result.carryForward.gazp.map((item) => item.day)).toEqual(sber.map((item) => item.day));
    expect(result.omitDay.imoex).toEqual(imoex);
  });
  it('rejects any second missing date instead of silently filling it', () => {
    const sber = [bar('2008-02-22', 100), bar('2008-02-25', 101), bar('2008-02-26', 102)];
    expect(() => pre2015IndexGapScenarios(sber, sber, [bar('2008-02-22', 200)]))
      .toThrow('Unexpected pre-2015 calendar gap');
  });
});
