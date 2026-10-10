import { describe, expect, it } from 'vitest';
import type { SiCandle } from './si-first-hour.js';
import { evaluateTMorningStrength, tLongReturn } from './t-morning-strength.js';

const date = '2025-02-04';
function candle(minute: string, price: number): SiCandle {
  return { time: `${date} ${minute}:00`, open: price, close: price, high: price, low: price, volume: 1 };
}

describe('T morning strength', () => {
  it('charges commission and adverse rounded execution in both cost scenarios', () => {
    const gross = tLongReturn(2500, 2520, 0, 0, 0);
    const pro = tLongReturn(2500, 2520, 0.0005, 0, 0.02);
    const investor = tLongReturn(2500, 2520, 0.0005, 0.003, 0.02);
    expect(gross).toBeGreaterThan(pro);
    expect(pro).toBeGreaterThan(investor);
    expect(() => tLongReturn(2500, 2520, -0.01, 0, 0.02)).toThrow();
  });

  it('does not enter on a weak signal or from future information', () => {
    expect(evaluateTMorningStrength(date, [candle('10:00', 2500), candle('10:30', 2504)]).status).toBe('cash');
    expect(evaluateTMorningStrength(date, [candle('10:00', 2500), candle('10:30', 2510),
      candle('10:34', 2512)]).status).toBe('cancelled_entry');
  });

  it('marks a gap while holding unresolved even if an exit print exists', () => {
    const decision = evaluateTMorningStrength(date, [candle('10:00', 2500), candle('10:30', 2510),
      candle('10:31', 2512), candle('16:55', 2520)]);
    expect(decision.status).toBe('unresolved_exit');
    expect(decision.reason).toBe('holding_minute_missing');
  });
});
