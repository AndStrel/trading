import { describe, expect, it } from 'vitest';
import type { HistoricalMinuteCandle as Candle } from '../history/market-data-store.js';
import { simulateOpen15 } from './candle-open15.js';

function candle(hhmm: string, open: number, close: number): Candle {
  return { instrumentId: 'SBER', time: `2024-06-03T${hhmm}:00+03:00`, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('first fifteen minutes', () => {
  it('buys at 10:15 after a rising open and sells at 17:00', () => {
    const trades = simulateOpen15([
      candle('10:00', 100, 100),
      candle('10:14', 101, 102),
      candle('10:15', 102, 102),
      candle('17:00', 104, 104),
    ]).trades;
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-03', pattern: 'U' })]);
  });
});
