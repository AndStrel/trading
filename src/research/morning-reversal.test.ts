import { describe, expect, it } from 'vitest';
import { morningReversal } from './morning-reversal.js';
import { breakEvenGrossPct, costScenarios, eventReturnPct } from './trading-costs.js';

const candles = (day = '2024-06-03') => Array.from({ length: 541 }, (_, i) => {
  const open = i === 90 ? 99.2 : i === 121 ? 99.5 : 100;
  const close = i === 119 ? 99.4 : open;
  return { instrumentId: 'TEST', time: new Date(Date.parse(`${day}T10:00:00+03:00`) + i * 60_000).toISOString(),
    open, close, low: Math.min(open, close), high: Math.max(open, close), volume: 10 };
});

describe('morning reversal causal execution', () => {
  it('takes only an already-observed drop and rebound, one attempt per day', () => {
    const data = candles(), r = morningReversal('TEST', data);
    expect(r.decisions).toHaveLength(1); expect(r.trades).toHaveLength(1);
    expect(r.decisions[0]!.morningPct).toBeCloseTo(-0.6);
    expect(r.trades[0]!.entryAt).toBe('2024-06-03T09:01:00.000Z');
    expect(r.trades[0]!.exitAt).toBe('2024-06-03T14:01:00.000Z');
    const changed = data.map((c, i) => i < 120 ? c : { ...c, open: 50, close: 50, high: 50, low: 50 });
    expect(morningReversal('TEST', changed).decisions).toEqual(r.decisions);
  });
  it('does not require fake continuous candles during a halt and executes after resumption', () => {
    const data = candles().filter((_, i) => i < 400 || i >= 450);
    const trade = morningReversal('TEST', data).trades[0]!;
    expect(trade.exitAt).toBe('2024-06-03T14:30:00.000Z');
    expect(trade.exitDelayMinutes).toBe(29);
    expect(trade.interiorMissingMinutes).toBe(50);
  });
  it('retains unfilled attempts and unclosed positions without fabricating returns', () => {
    const cancelled = morningReversal('TEST', candles().filter((_, i) => i < 121 || i > 125));
    expect(cancelled.cancelled).toHaveLength(1); expect(cancelled.trades).toHaveLength(0);
    const unclosed = morningReversal('TEST', candles().slice(0, 421));
    expect(unclosed.unclosed).toHaveLength(1); expect(unclosed.trades).toHaveLength(0);
    expect(unclosed.decisions[0]!.signal).toBe(true);
  });
  it('uses known weekday/history eligibility, not whole future halt dates', () => {
    expect(morningReversal('TEST', candles('2024-06-01')).weekendDays).toBe(1);
    const gap = morningReversal('TEST', candles().filter((_, i) => i !== 80));
    expect(gap.blockedHistory).toHaveLength(1); expect(gap.decisions).toHaveLength(0);
    expect(morningReversal('TEST', candles('2024-02-13')).trades).toHaveLength(1);
  });
  it('does not signal without recovery and validates input candles', () => {
    const data = candles(); data[119] = { ...data[119]!, open: 99, close: 99, high: 99, low: 99 };
    expect(morningReversal('TEST', data).trades).toHaveLength(0);
    expect(morningReversal('TEST', data, true).trades).toHaveLength(1);
    expect(() => morningReversal('TEST', [...data, data[0]!])).toThrow('duplicate');
  });
});
describe('explicit broker cost scenarios', () => {
  it('charges the investor commission on both sides and computes the exact break-even hurdle', () => {
    const c = costScenarios.investorBase;
    expect(eventReturnPct(100, 100, c)).toBeCloseTo((0.9995 * 0.997 / (1.0005 * 1.003) - 1) * 100, 10);
    expect(breakEvenGrossPct(c)).toBeGreaterThan(0.7);
    expect(eventReturnPct(100, 100 + breakEvenGrossPct(c), c)).toBeCloseTo(0, 10);
    expect(eventReturnPct(100, 101, costScenarios.investorStress)).toBeLessThan(eventReturnPct(100, 101, c));
  });
  it('does not fold subscriptions or taxes into unlabelled event returns and rejects invalid inputs', () => {
    expect(eventReturnPct(100, 101, costScenarios.gross)).toBeCloseTo(1);
    expect(eventReturnPct(100, 100, costScenarios.traderBeforeSubscription)).toBeCloseTo(-0.19980015, 6);
    expect(() => eventReturnPct(0, 100, costScenarios.gross)).toThrow('price');
    expect(() => breakEvenGrossPct({ commission: -1, slippage: 0 })).toThrow('costs');
  });
});
