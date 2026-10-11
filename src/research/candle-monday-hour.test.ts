import { describe, expect, it } from 'vitest';
import type { HistoricalMinuteCandle as Candle } from '../history/market-data-store.js';
import { simulateMondayHour } from './candle-monday-hour.js';

function candle(day: string, hhmm: string, open: number, close: number): Candle {
  return { instrumentId: 'SBER', time: `${day}T${hhmm}:00+03:00`, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('Monday first hour', () => {
  it('buys at 11:00 and sells Friday at 17:00 after an up first hour', () => {
    const trades = simulateMondayHour([
      candle('2024-06-03', '10:00', 10, 10),
      candle('2024-06-03', '10:59', 11, 12),
      candle('2024-06-03', '11:00', 20, 20),
      candle('2024-06-07', '17:00', 22, 22),
    ]).trades;
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-03', pattern: 'U' })]);
  });
});
