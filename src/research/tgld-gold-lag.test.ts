import { describe, expect, it } from 'vitest';
import { evaluateTgldGoldLag, tgldLongReturn } from './tgld-gold-lag.js';
import type { SiCandle } from './si-first-hour.js';
import type { GoldPriceCandle } from '../research-gold-spot-2026-source.js';

const fund = (time: string, price: number): SiCandle => ({ time, open: price, close: price, high: price, low: price, volume: 1 });
const gold = (time: string, price: number): GoldPriceCandle => ({ time, open: price, close: price, high: price, low: price });

describe('TGLD relative gold lag', () => {
  it('waits for a completed same-minute signal and enters on the next fund trade', () => {
    const date = '2026-09-25';
    const result = evaluateTgldGoldLag({ date,
      fundCandles: [fund(`${date} 10:00:00`, 10), fund(`${date} 11:00:00`, 10.01),
        fund(`${date} 11:01:00`, 10.01), fund(`${date} 16:55:00`, 10.07)],
      goldCandles: [gold(`${date} 10:00:00`, 100), gold(`${date} 11:00:00`, 100.5)] });
    expect(result).toMatchObject({ status: 'trade', signalTime: `${date} 11:00:00`,
      entryTime: `${date} 11:01:00`, entry: 10.01, exit: 10.07 });
    expect(result.baseNet).toBeGreaterThan(0);
  });

  it('cancels the first signal if no fund trade follows within two minutes', () => {
    const date = '2026-09-25';
    expect(evaluateTgldGoldLag({ date,
      fundCandles: [fund(`${date} 10:00:00`, 10), fund(`${date} 11:00:00`, 10),
        fund(`${date} 11:03:00`, 10), fund(`${date} 16:55:00`, 10.1)],
      goldCandles: [gold(`${date} 10:00:00`, 100), gold(`${date} 11:00:00`, 100.5)] })).toMatchObject({
        status: 'cancelled_entry', signalTime: `${date} 11:00:00` });
  });

  it('rounds adverse fills to the 0.01 RUB tick', () => {
    expect(tgldLongReturn(10, 10, 0.001)).toBeLessThan(0);
    expect(tgldLongReturn(10, 10.01, 0.001)).toBeLessThan(0);
    expect(() => tgldLongReturn(10, 10, -0.1)).toThrow();
  });
});
