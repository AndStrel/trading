import { describe, expect, it } from 'vitest';
import { simulateSbgbCbrPolicyRegime } from './sbgb-cbr-policy-regime.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, price: number): DailyBar {
  return { day, open: price, high: price, low: price, close: price, volume: 1 };
}

describe('SBGB CBR policy regime', () => {
  it('starts in SBMM, switches to SBGB after a cut, and back after a hike', () => {
    const days = ['2021-06-07', '2021-06-08', '2021-06-09', '2021-06-10', '2021-06-11', '2021-06-14'];
    const sbgb = days.map((day, index) => bar(day, 100 + index));
    const sbmm = days.map((day) => bar(day, 100));
    const rates = [
      { day: '2021-06-07', rate: 5 },
      { day: '2021-06-08', rate: 4.5 },
      { day: '2021-06-10', rate: 4.5 },
      { day: '2021-06-11', rate: 5.5 },
    ];
    const result = simulateSbgbCbrPolicyRegime({
      sbgb,
      sbmm,
      rates,
      scheduled: ['2021-06-07', '2021-06-10'],
      unscheduled: [],
      from: '2021-06-07',
      thru: '2021-06-14',
    });
    expect(result.switches).toBe(2);
    expect(result.marks.some((mark) => mark.sleeve === 'sbgb')).toBe(true);
  });

  it('forces SBMM after an unscheduled date even without a scheduled hike', () => {
    const days = ['2022-02-10', '2022-02-11', '2022-02-14', '2022-02-28', '2022-03-01', '2022-03-02'];
    const sbgb = days.map((day, index) => bar(day, 100 - index));
    const sbmm = days.map((day) => bar(day, 100));
    const rates = [
      { day: '2022-02-11', rate: 8.5 },
      { day: '2022-02-12', rate: 8 },
      { day: '2022-02-28', rate: 8 },
      { day: '2022-03-01', rate: 20 },
    ];
    const result = simulateSbgbCbrPolicyRegime({
      sbgb,
      sbmm,
      rates,
      scheduled: ['2022-02-11'],
      unscheduled: ['2022-02-28'],
      from: '2022-02-10',
      thru: '2022-03-02',
    });
    const lastHeld = [...result.marks].reverse().find((mark) => mark.sleeve !== null);
    expect(lastHeld?.sleeve).toBe('sbmm');
  });
});
