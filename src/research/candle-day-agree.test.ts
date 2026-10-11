import { describe, expect, it } from 'vitest';
import type { HistoricalMinuteCandle as Candle } from '../history/market-data-store.js';
import { simulateDayAgree } from './candle-day-agree.js';

function candle(day: string, hhmm: string, open: number, close: number): Candle {
  return { instrumentId: 'SBER', time: `${day}T${hhmm}:00+03:00`, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('both halves of the day agree', () => {
  it('buys the next five sessions after an up morning and an up afternoon', () => {
    const trades = simulateDayAgree([
      candle('2024-06-03', '10:00', 10, 10),
      candle('2024-06-03', '11:59', 11, 12),
      candle('2024-06-03', '12:00', 12, 12),
      candle('2024-06-03', '16:59', 12, 13),
      candle('2024-06-04', '10:00', 20, 20),
      candle('2024-06-05', '10:00', 20, 20),
      candle('2024-06-06', '10:00', 20, 20),
      candle('2024-06-07', '10:00', 20, 20),
      candle('2024-06-10', '17:00', 22, 22),
    ]).trades;
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-04', pattern: 'UU' })]);
  });
});
