import { describe, expect, it } from 'vitest';
import { discountSignal, simulateWeeklySberpDiscount } from './weekly-sberp-discount.js';
import type { DailyBar } from './weekly-trend.js';

function bars(count: number, preferred: boolean): DailyBar[] {
  const result: DailyBar[] = [];
  const date = new Date('2015-01-01T12:00:00Z');
  while (result.length < count) {
    if (date.getUTCDay() >= 1 && date.getUTCDay() <= 5) {
      const index = result.length;
      const ratio = index < 252 ? 0.9 + 0.01 * Math.sin(index) : 0.8;
      const price = preferred ? 100 * ratio : 100;
      result.push({ day: date.toISOString().slice(0, 10), open: price, close: price,
        high: price + 1, low: price - 1, volume: 100 });
    }
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return result;
}

describe('SBERP discount signal', () => {
  it('compares the last completed ratio with earlier history only', () => {
    const ratios = Array.from({ length: 255 }, (_, index) => 0.9 + 0.01 * Math.sin(index));
    ratios[252] = 0.8;
    const first = discountSignal(ratios, 253);
    expect(first.signal).toBe(true);
    ratios[253] = 10;
    expect(discountSignal(ratios, 253)).toEqual(first);
  });
  it('requires matching calendars', () => {
    const sber = bars(320, false), sberp = bars(320, true);
    sberp[20]!.day = '2015-01-01';
    expect(() => simulateWeeklySberpDiscount(sber, sberp)).toThrow('calendars differ');
  });
  it('applies both-side costs and exits after twenty later sessions', () => {
    const sber = bars(330, false), sberp = bars(330, true);
    const result = simulateWeeklySberpDiscount(sber, sberp);
    expect(result.trades.length).toBeGreaterThan(0);
    const trade = result.trades[0]!;
    expect(trade.netPct).toBeLessThan((trade.exit / trade.entry - 1) * 100);
    expect(sberp.findIndex((bar) => bar.day === trade.exitDay) -
      sberp.findIndex((bar) => bar.day === trade.entryDay)).toBe(20);
  });
  it('keeps earlier ratios but does not open before from', () => {
    const sber = bars(400, false), sberp = bars(400, true);
    const all = simulateWeeklySberpDiscount(sber, sberp);
    const later = simulateWeeklySberpDiscount(sber, sberp, '2016-01-01');
    expect(later.trades.every((trade) => trade.entryDay >= '2016-01-01')).toBe(true);
    expect(later.trades.length).toBeLessThan(all.trades.length);
  });
});
