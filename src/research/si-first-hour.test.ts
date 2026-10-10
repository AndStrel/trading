import { describe, expect, it } from 'vitest';

import {
  evaluateSiDay,
  parseSiCandlePage,
  siContractForDate,
  siTradeReturn,
  summarizeSiTrades,
  type SiCandle,
} from './si-first-hour.js';

const date = '2025-07-15';
function candle(time: string, open: number, close = open): SiCandle {
  return { time: `${date} ${time}:00`, open, close, high: Math.max(open, close), low: Math.min(open, close), volume: 1 };
}
function firstHour(finalClose: number): SiCandle[] {
  return Array.from({ length: 60 }, (_, index) => {
    const minute = String(index).padStart(2, '0');
    return candle(`10:${minute}`, 100, index === 59 ? finalClose : 100);
  });
}

describe('Si first-hour research', () => {
  it('selects the contract by fixed date boundaries', () => {
    expect(siContractForDate('2025-09-10')).toBe('SiU5');
    expect(siContractForDate('2025-09-11')).toBe('SiZ5');
    expect(siContractForDate('2025-12-11')).toBeNull();
  });

  it('parses only valid same-day one-minute MOEX candles', () => {
    const payload = { candles: { columns: ['open', 'close', 'high', 'low', 'volume', 'begin'], data: [[100, 101, 101, 100, 3, `${date} 10:00:00`]] } };
    expect(parseSiCandlePage(payload, date)).toEqual([candle('10:00', 100, 101)].map((item) => ({ ...item, volume: 3 })));
    expect(() => parseSiCandlePage({ candles: { ...payload.candles, data: [[100, 101, 100, 100, 3, `${date} 10:00:00`]] } }, date)).toThrow();
    expect(() => parseSiCandlePage({ candles: { ...payload.candles, data: [[100, 101, 101, 100, 3, '2025-07-16 10:00:00']] } }, date)).toThrow();
    const evening = { candles: { ...payload.candles, data: [[100, 101, 101, 100, 3, `${date} 22:00:00`]] } };
    expect(() => parseSiCandlePage(evening, date)).toThrow();
    expect(parseSiCandlePage(evening, date, { from: '17:00', to: '22:00' })).toHaveLength(1);
  });

  it('requires a complete first hour and exact fills', () => {
    expect(evaluateSiDay(date, 'SiU5', []).status).toBe('no_candles');
    expect(evaluateSiDay(date, 'SiU5', firstHour(100.5).slice(1)).status).toBe('missing_history');
    expect(evaluateSiDay(date, 'SiU5', firstHour(100.5)).status).toBe('cancelled_entry');
    expect(evaluateSiDay(date, 'SiU5', [...firstHour(100.5), candle('11:01', 100.5)]).status).toBe('unresolved_exit');
    expect(evaluateSiDay(date, 'SiU5', [...firstHour(100.1), candle('11:01', 100.1), candle('17:00', 101)]).status).toBe('cash');
  });

  it('accounts for costs on both long and short trades', () => {
    expect(siTradeReturn('long', 100, 101, { commission: 0, slippage: 0 })).toBeCloseTo(0.01);
    expect(siTradeReturn('short', 100, 99, { commission: 0, slippage: 0 })).toBeCloseTo(0.01);
    expect(siTradeReturn('long', 100, 101, { commission: 0.001, slippage: 0.0005 })).toBeLessThan(0.01);
    expect(siTradeReturn('short', 100, 99, { commission: 0.001, slippage: 0.0005 })).toBeLessThan(0.01);
  });

  it('records both directions and does not count missing results as wins', () => {
    const long = evaluateSiDay(date, 'SiU5', [...firstHour(100.5), candle('11:01', 100), candle('17:00', 101)]);
    const short = evaluateSiDay(date, 'SiU5', [...firstHour(99.5), candle('11:01', 100), candle('17:00', 99)]);
    expect(long.status).toBe('trade');
    expect(short.status).toBe('trade');
    expect(long.side).toBe('long');
    expect(short.side).toBe('short');
    const result = summarizeSiTrades([long, short, { date, contract: 'SiU5', status: 'missing_history' }]);
    expect(result.decisions).toBe(3);
    expect(result.trades).toBe(2);
    expect(result.winners).toBe(2);
    expect(result.missingHistory).toBe(1);
  });
});
