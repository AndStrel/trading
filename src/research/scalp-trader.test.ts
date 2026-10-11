import { describe, expect, it } from 'vitest';
import type { HistoricalMinuteCandle as Candle } from '../history/market-data-store.js';
import { eventReturnPct, costScenarios } from './trading-costs.js';
import { scalpGateReasons, simulateScalp } from './scalp-trader.js';

function minute(hhmm: string, open: number, high: number, low: number, close: number): Candle {
  return { instrumentId: 'test', time: `2024-06-03T${hhmm}:00+03:00`, open, high, low, close, volume: 1 };
}

function flat(hhmm: string, price: number): Candle {
  return minute(hhmm, price, price, price, price);
}

describe('trader scalps', () => {
  it('buys the next open after a five-minute continuation and pays trader costs', () => {
    const candles = [
      flat('10:00', 100), flat('10:01', 100), flat('10:02', 100), flat('10:03', 100),
      minute('10:04', 100, 100.2, 100, 100.2),
      minute('10:05', 100.2, 100.6, 100.2, 100.2),
    ];
    const result = simulateScalp('SBER', candles, 'five-minute-continuation');
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]?.reason).toBe('target');
    expect(result.trades[0]?.netPct).toBeCloseTo(eventReturnPct(100.2, 100.2 * 1.003, costScenarios.traderBeforeSubscription), 8);
    expect(result.trades[0]?.netPct).toBeGreaterThan(0);
    expect(result.unresolved).toHaveLength(0);
  });

  it('does not take a signal after the archived session bound', () => {
    const candles = [
      flat('10:00', 100), flat('10:01', 100), flat('10:02', 100), flat('10:03', 100),
      minute('10:04', 100, 100.2, 100, 100.2),
      minute('10:05', 100.2, 100.6, 100.2, 100.2),
    ];
    const result = simulateScalp('T', candles, 'five-minute-continuation', { sessionEnd: '10:10', lastSignal: '10:03' });
    expect(result.trades).toHaveLength(0);
  });

  it('treats a stop and a target in the same minute as a stop', () => {
    const candles = [
      flat('10:00', 100), flat('10:01', 100), flat('10:02', 100), flat('10:03', 100),
      minute('10:04', 100, 100.2, 100, 100.2),
      minute('10:05', 100.2, 101, 99, 100.2),
    ];
    const result = simulateScalp('SBER', candles, 'five-minute-continuation');
    expect(result.trades[0]?.reason).toBe('stop');
    expect(result.trades[0]?.netPct).toBeLessThan(0);
  });

  it('does not open a second trade while the first bracket is still working', () => {
    const candles = ['10:00', '10:01', '10:02', '10:03'].map((hhmm) => flat(hhmm, 100));
    candles.push(minute('10:04', 100, 100.2, 100, 100.2));
    for (let minuteOfHour = 5; minuteOfHour <= 20; minuteOfHour += 1) {
      const hhmm = `10:${String(minuteOfHour).padStart(2, '0')}`;
      candles.push(flat(hhmm, 100.2));
    }
    const result = simulateScalp('SBER', candles, 'five-minute-continuation');
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]?.reason).toBe('time');
  });

  it('rejects a sample that is too small to be a scalping book', () => {
    expect(scalpGateReasons([], 10, 0)).toContain('too-few-trades');
    expect(scalpGateReasons([], 10, 1)).toContain('unresolved');
  });
});
