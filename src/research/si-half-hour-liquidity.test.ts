import { describe, expect, it } from 'vitest';
import { evaluateSiHalfHourDay } from './si-half-hour-liquidity.js';
import type { SiCandle } from './si-first-hour.js';

const candle = (date: string, minute: number, price: number): SiCandle => {
  const time = minute === 420 ? '17:00' : `10:${String(minute).padStart(2, '0')}`;
  return { time: `${date} ${time}:00`, open: price, close: price, high: price, low: price, volume: 1 };
};

describe('Si first-half-hour liquidity rule', () => {
  it('uses completed first thirty minutes and not the entry or exit to set side', () => {
    const date = '2025-07-01';
    const candles = Array.from({ length: 30 }, (_, minute) => candle(date, minute, minute === 29 ? 101 : 100));
    candles.push(candle(date, 31, 100), candle(date, 420, 101));
    const decision = evaluateSiHalfHourDay(date, 'SiU5', candles);
    expect(decision.status).toBe('trade');
    expect(decision.side).toBe('long');
    expect(decision.gross).toBeGreaterThan(0);
    expect(decision.baseNet).toBeLessThan(decision.gross!);
  });
  it('does not erase a position whose exit minute is missing', () => {
    const date = '2025-07-01';
    const candles = Array.from({ length: 30 }, (_, minute) => candle(date, minute, minute === 29 ? 99 : 100));
    candles.push(candle(date, 31, 100));
    expect(evaluateSiHalfHourDay(date, 'SiU5', candles).status).toBe('unresolved_exit');
  });
});
