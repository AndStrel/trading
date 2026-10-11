import { describe, expect, it } from 'vitest';
import type { HistoricalMinuteCandle as Candle } from '../history/market-data-store.js';
import { simulateDayVwap } from './candle-day-vwap.js';

function candle(day: string, hhmm: string, price: number, volume = 1): Candle {
  return { instrumentId: 'SBER', time: `${day}T${hhmm}:00+03:00`, open: price, high: price, low: price, close: price, volume };
}

describe('close against the session VWAP', () => {
  it('buys the next five sessions after a close above VWAP', () => {
    const trades = simulateDayVwap([
      candle('2024-06-03', '10:00', 10),
      candle('2024-06-03', '16:59', 12),
      candle('2024-06-04', '10:00', 20),
      candle('2024-06-05', '10:00', 20),
      candle('2024-06-06', '10:00', 20),
      candle('2024-06-07', '10:00', 20),
      candle('2024-06-10', '17:00', 22),
    ]).trades;
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-04', pattern: 'U' })]);
  });
});
