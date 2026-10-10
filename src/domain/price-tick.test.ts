import { describe, expect, it } from 'vitest';
import { decimalPriceNano } from '../execution/sandbox-stop-state.js';
import { priceToNano, roundPriceToTick } from './price-tick.js';

describe('exact exchange price ticks', () => {
  it('keeps tick-aligned prices canonical in both directions across realistic asks', () => {
    for (let ticks = 10051; ticks <= 10149; ticks++) {
      const price = ticks / 100;
      expect(roundPriceToTick(price, 0.01, 'ceil')).toBe(price);
      expect(roundPriceToTick(price, 0.01, 'floor')).toBe(price);
      expect(decimalPriceNano(roundPriceToTick(price, 0.01, 'ceil'))).toBe(String(BigInt(ticks) * 10_000_000n));
    }
  });

  it('proves floor and ceil directions for decimal inputs between ticks without floating arithmetic', () => {
    expect(roundPriceToTick(100.571, 0.01, 'floor')).toBe(100.57);
    expect(roundPriceToTick(100.571, 0.01, 'ceil')).toBe(100.58);
    expect(roundPriceToTick(100.57000000000001, 0.01, 'floor')).toBe(100.57);
    expect(roundPriceToTick(100.56999999999999, 0.01, 'ceil')).toBe(100.57);
    expect(roundPriceToTick(0.004, 0.01, 'floor')).toBe(0);
  });

  it('supports nanoruble and non-power-of-ten ticks with canonical output', () => {
    expect(roundPriceToTick(0.0000000011, 0.000000001, 'floor')).toBe(0.000000001);
    expect(roundPriceToTick(0.0000000011, 0.000000001, 'ceil')).toBe(0.000000002);
    expect(roundPriceToTick(101.03, 0.05, 'floor')).toBe(101);
    expect(roundPriceToTick(101.03, 0.05, 'ceil')).toBe(101.05);
    expect(priceToNano(1_000_000)).toBe(1_000_000_000_000_000n);
  });

  it.each([0, -0.01, 0.0000000001, 0.010000000000000002, Infinity, NaN, 1_000_001])(
    'rejects unsupported or inexact step %s', step => {
      expect(() => roundPriceToTick(100.57, step, 'ceil')).toThrow();
    },
  );

  it('rejects out-of-range source and resulting prices instead of rounding past the supported endpoint', () => {
    expect(() => roundPriceToTick(-1, 0.01, 'floor')).toThrow();
    expect(() => roundPriceToTick(1_000_001, 0.01, 'floor')).toThrow();
    expect(() => roundPriceToTick(1_000_000, 0.03, 'ceil')).toThrow();
  });
});
