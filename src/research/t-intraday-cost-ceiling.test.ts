import { describe, expect, it } from 'vitest';
import type { SiCandle } from './si-first-hour.js';
import { evaluateTCeilingDay, summarizeTCeilingDays } from './t-intraday-cost-ceiling.js';

const date = '2025-02-04';
function candle(minute: number, open: number, high = open): SiCandle {
  const time = `${date} ${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00`;
  return { time, open, close: open, high, low: open, volume: 1 };
}

describe('T intraday cost ceiling', () => {
  it('never makes the oracle worse than the scheduled exit on a complete day', () => {
    const candles = Array.from({ length: 385 }, (_, index) => candle(631 + index, 250, index === 100 ? 255 : 250));
    const day = evaluateTCeilingDay({ date, ticker: 'T', candles });
    expect(day.status).toBe('complete');
    expect(day.oracleInvestor!).toBeGreaterThanOrEqual(day.scheduledInvestor!);
    expect(day.oraclePro!).toBeGreaterThanOrEqual(day.scheduledPro!);
    expect(day.oraclePro!).toBeGreaterThan(day.oracleInvestor!);
  });

  it('does not silently include a gapped holding window', () => {
    const candles = [candle(631, 250), candle(633, 250), candle(1015, 251)];
    const day = evaluateTCeilingDay({ date, ticker: 'T', candles });
    expect(day.status).toBe('incomplete');
    expect(summarizeTCeilingDays([day]).complete).toBe(0);
  });
});
