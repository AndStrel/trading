import { describe, expect, it } from 'vitest';
import type { HistoricalMinuteCandle as Candle } from '../history/market-data-store.js';
import { breakEvenGrossPct, costScenarios, eventReturnPct } from './trading-costs.js';
import { simulateHourlyHold, simulateSberLag } from './scalp-trader-v2.js';

function candle(day: string, hhmm: string, open: number, close: number): Candle {
  const high = Math.max(open, close);
  const low = Math.min(open, close);
  return { instrumentId: 'test', time: `${day}T${hhmm}:00+03:00`, open, high, low, close, volume: 1 };
}

describe('hourly trader scalps', () => {
  it('buys the hour open after a positive prior hour and exits 20 minutes later', () => {
    const day = '2024-06-03';
    const candles = [
      candle(day, '10:00', 100, 100),
      candle(day, '10:59', 100, 101),
      candle(day, '11:00', 101, 101),
      candle(day, '11:20', 102, 102),
    ];
    const result = simulateHourlyHold('SBER', candles, 'hourly-continuation');
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]?.netPct).toBeCloseTo(eventReturnPct(101, 102, costScenarios.traderBeforeSubscription), 8);
    expect(result.unresolved).toHaveLength(0);
  });

  it('does not buy a positive hour in the fade rule', () => {
    const day = '2024-06-03';
    const candles = [
      candle(day, '10:00', 100, 100),
      candle(day, '10:59', 100, 101),
      candle(day, '11:00', 101, 101),
      candle(day, '11:20', 102, 102),
    ];
    expect(simulateHourlyHold('SBER', candles, 'hourly-fade').trades).toHaveLength(0);
  });

  it('marks a formed hourly signal unresolved when the exit candle is missing', () => {
    const day = '2024-06-03';
    const candles = [candle(day, '10:00', 100, 100), candle(day, '10:59', 100, 101), candle(day, '11:00', 101, 101)];
    expect(simulateHourlyHold('SBER', candles, 'hourly-continuation').unresolved).toEqual(['SBER:2024-06-03']);
  });
});

describe('SBER lag scalp', () => {
  it('buys SBER only after it lags GAZP by at least the trader breakeven', () => {
    const day = '2024-06-03';
    const hurdle = breakEvenGrossPct(costScenarios.traderBeforeSubscription) / 100;
    const sber = [candle(day, '10:00', 100, 100)];
    const gazp = [candle(day, '10:00', 100, 100)];
    for (const minute of [1, 2, 3, 4]) {
      const hhmm = `10:0${minute}`;
      sber.push(candle(day, hhmm, 100, 100 * (1 - hurdle - 0.001)));
      gazp.push(candle(day, hhmm, 100, 100));
    }
    sber.push(candle(day, '10:05', 99, 99), candle(day, '10:15', 100, 100));
    const result = simulateSberLag(sber, gazp);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]?.entry).toBe(99);
    expect(result.trades[0]?.exit).toBe(100);
  });
});
