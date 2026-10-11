import { describe, expect, it } from 'vitest';
import type { HistoricalMinuteCandle as Candle } from '../history/market-data-store.js';
import { simulateCloseHour } from './candle-close-hour.js';

function candle(day: string, hhmm: string, open: number, close: number): Candle {
  return { instrumentId: 'SBER', time: `${day}T${hhmm}:00+03:00`, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('prior close hour', () => {
  it('buys the next day after a rising last hour', () => {
    const trades = simulateCloseHour([
      candle('2024-06-03', '16:00', 100, 100),
      candle('2024-06-03', '16:59', 101, 102),
      candle('2024-06-04', '10:00', 110, 110),
      candle('2024-06-04', '17:00', 112, 112),
    ]).trades;
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-04', pattern: 'U' })]);
  });
});
