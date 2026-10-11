import { describe, expect, it } from 'vitest';
import type { HistoricalMinuteCandle as Candle } from '../history/market-data-store.js';
import { simulateAfternoon } from './candle-afternoon.js';

function candle(hhmm: string, open: number, close: number): Candle {
  return { instrumentId: 'SBER', time: `2024-06-03T${hhmm}:00+03:00`, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('afternoon sign', () => {
  it('buys at noon after a rising morning and sells at 17:00', () => {
    const trades = simulateAfternoon([
      candle('10:00', 100, 100),
      candle('11:59', 101, 102),
      candle('12:00', 102, 102),
      candle('17:00', 104, 104),
    ]).trades;
    expect(trades).toEqual([expect.objectContaining({ day: '2024-06-03', pattern: 'U' })]);
    expect(trades[0]?.netPct).toBeGreaterThan(0);
  });

  it('leaves the day unresolved when the afternoon exit is missing', () => {
    const result = simulateAfternoon([candle('10:00', 100, 100), candle('11:59', 101, 102), candle('12:00', 102, 102)]);
    expect(result.unresolved).toEqual([{ day: '2024-06-03', pattern: 'U' }]);
    expect(result.trades).toHaveLength(0);
  });
});
