import { describe, expect, it } from 'vitest';
import type { SiCandle } from './si-first-hour.js';
import { evaluateTmonV2Day, summarizeTmonV2, tmonLongReturn } from './tmon-intraday-v2.js';

const candle = (date: string, time: string, price: number): SiCandle =>
  ({ time: `${date} ${time}:00`, open: price, close: price, high: price, low: price, volume: 1 });

describe('TMON v2 same-day price-print proxy', () => {
  it('uses the first entry and first last-hour exit, without dropping unknown exits', () => {
    const date = '2025-01-03';
    const trade = evaluateTmonV2Day(date, [candle(date, '10:01', 100), candle(date, '16:00', 100.02), candle(date, '16:30', 101)]);
    expect(trade.exitTime).toBe(`${date} 16:00:00`);
    expect(trade.baseNet).toBeLessThan(trade.gross!);
    expect(evaluateTmonV2Day(date, [candle(date, '10:01', 100)]).status).toBe('unresolved_exit');
  });
  it('charges adverse costs and summarizes strictly positive wins', () => {
    expect(tmonLongReturn(100, 100, 0.00005)).toBeLessThan(0);
    expect(tmonLongReturn(100, 100, 0.00005, 0.01)).toBeCloseTo(99.99 / 100.01 - 1);
    const date = '2025-01-03';
    const summary = summarizeTmonV2([evaluateTmonV2Day(date, [candle(date, '10:01', 100), candle(date, '16:00', 100.02)])]);
    expect(summary.trades).toBe(1);
    expect(summary.baseWins).toBe(1);
  });
});
