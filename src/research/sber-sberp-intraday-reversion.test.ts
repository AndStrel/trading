import { describe, expect, it } from 'vitest';
import { evaluatePairDay, joinPairCandles, type PairCandle } from './sber-sberp-intraday-reversion.js';

const date = '2025-01-02';

function candle(minute: number, price: number): PairCandle {
  const hour = String(Math.floor(minute / 60)).padStart(2, '0');
  const min = String(minute % 60).padStart(2, '0');
  return { begin: `${date} ${hour}:${min}:00`, open: price, close: price };
}

describe('SBER/SBERP intraday relative-value reversion', () => {
  it('joins only identical timestamps and uses the synchronized relative price', () => {
    const paired = joinPairCandles([candle(600, 100), candle(610, 100)], [candle(610, 101), candle(620, 102)]);
    expect(paired).toHaveLength(1);
    expect(paired[0]?.begin).toBe(`${date} 10:10:00`);
    expect(paired[0]?.spread).toBeCloseTo(Math.log(1.01));
  });

  it('enters against an extreme relative-price deviation and exits on reversion, net of modeled costs', () => {
    const sber = [] as PairCandle[];
    const sberp = [] as PairCandle[];
    const baseline = [0, 0.0001, 0, 0.0001, 0, 0.0001];
    for (let i = 0; i < baseline.length; i += 1) {
      const minute = 600 + i * 10;
      sber.push(candle(minute, 100));
      sberp.push(candle(minute, 100 * Math.exp(baseline[i]!)));
    }
    sber.push(candle(660, 100), candle(670, 100), candle(680, 100));
    sberp.push(
      candle(660, 100 * Math.exp(0.02)),
      { begin: `${date} 11:10:00`, open: 100 * Math.exp(0.02), close: 100 * Math.exp(0.0001) },
      candle(680, 100 * Math.exp(0.0001)),
    );

    const result = evaluatePairDay(date, joinPairCandles(sber, sberp));
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]?.status).toBe('trade');
    expect(result.attempts[0]?.trade?.side).toBe('short_sberp_long_sber');
    expect(result.attempts[0]?.trade?.exitReason).toBe('reversion');
    expect(result.attempts[0]?.trade?.grossReturn).toBeGreaterThan(0);
    expect(result.attempts[0]?.trade?.baseNetReturn).toBeGreaterThan(0);
  });

  it('does not turn a missing synchronized next bar into an entry fill', () => {
    const sber: PairCandle[] = [];
    const sberp: PairCandle[] = [];
    const baseline = [0, 0.0001, 0, 0.0001, 0, 0.0001];
    for (let i = 0; i < baseline.length; i += 1) {
      const minute = 600 + i * 10;
      sber.push(candle(minute, 100));
      sberp.push(candle(minute, 100 * Math.exp(baseline[i]!)));
    }
    sber.push(candle(660, 100), candle(680, 100));
    sberp.push(candle(660, 100 * Math.exp(0.02)), candle(680, 100));

    const result = evaluatePairDay(date, joinPairCandles(sber, sberp));
    expect(result.attempts[0]?.status).toBe('cancelled_entry');
  });
});
