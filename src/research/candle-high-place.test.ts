import { describe, expect, it } from 'vitest';
import type { HistoricalMinuteCandle as Candle } from '../history/market-data-store.js';
import { simulateHighPlace } from './candle-high-place.js';

function candle(day: string, hhmm: string, open: number, high: number): Candle {
  return { instrumentId: 'SBER', time: `${day}T${hhmm}:00+03:00`, open, high, low: Math.min(open, high), close: open, volume: 1 };
}

describe('where the daily high prints', () => {
  it('buys the next five sessions after a high printed by 11:59', () => {
    const trades = simulateHighPlace([
      candle('2024-06-03', '10:00', 10, 15),
      candle('2024-06-03', '15:00', 10, 12),
      candle('2024-06-04', '10:00', 20, 20),
      candle('2024-06-05', '10:00', 20, 20),
      candle('2024-06-06', '10:00', 20, 20),
      candle('2024-06-07', '10:00', 20, 20),
      candle('2024-06-10', '17:00', 22, 22),
    ]).trades;
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-04', pattern: 'E' })]);
  });
});
