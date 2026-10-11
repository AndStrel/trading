import { describe, expect, it } from 'vitest';
import type { HistoricalMinuteCandle as Candle } from '../history/market-data-store.js';
import { breakEvenGrossPct, costScenarios } from './trading-costs.js';
import { simulateOpeningDrive } from './tgld-opening-drive-scalp.js';

function candle(hhmm: string, open: number, close: number): Candle {
  return {
    instrumentId: 'TGLD',
    time: `2025-06-02T${hhmm}:00+03:00`,
    open,
    high: Math.max(open, close),
    low: Math.min(open, close),
    close,
    volume: 1,
  };
}

describe('TGLD opening-drive scalp', () => {
  it('skips a day whose opening drive is inside the trader breakeven', () => {
    const hurdle = breakEvenGrossPct(costScenarios.traderBeforeSubscription) / 100;
    const candles = [candle('10:00', 100, 100), candle('10:29', 100, 100 * (1 + hurdle / 2)), candle('10:30', 100, 101), candle('10:45', 101, 101)];
    expect(simulateOpeningDrive(candles).trades).toHaveLength(0);
  });

  it('buys the next slot only while price remains above the session open', () => {
    const candles = [candle('10:00', 100, 100), candle('10:29', 100, 101), candle('10:30', 101, 99)];
    for (let minute = 31; minute <= 44; minute += 1) candles.push(candle(`10:${String(minute).padStart(2, '0')}`, 99, 99));
    candles.push(candle('10:45', 102, 102));
    const result = simulateOpeningDrive(candles);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]?.entry).toBe(101);
    expect(result.trades[0]?.exit).toBe(102);
    expect(result.unresolved).toHaveLength(0);
  });
});
