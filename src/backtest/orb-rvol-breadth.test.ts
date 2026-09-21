import { describe, expect, it } from 'vitest';

import type { HistoricalMinuteCandle } from '../history/market-data-store.js';
import { buildOrbRvolOpeningRangeBreadth } from './orb-rvol-breadth.js';

function atMoscow(date: string, minuteOfDay: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  return new Date(Date.UTC(year!, month! - 1, day!, hour - 3, minute)).toISOString();
}

function candlesFor(
  instrumentId: string,
  date: string,
  direction: 'up' | 'down' | 'flat',
  complete = true,
): HistoricalMinuteCandle[] {
  const candles: HistoricalMinuteCandle[] = [];
  for (let offset = 0; offset < 30; offset += 1) {
    if (!complete && offset === 10) continue;
    const close = direction === 'up' && offset === 29 ? 101 : direction === 'down' && offset === 29 ? 99 : 100;
    candles.push({
      instrumentId,
      time: atMoscow(date, 10 * 60 + offset),
      open: 100,
      high: Math.max(100, close),
      low: Math.min(100, close),
      close,
      volume: 100,
    });
  }
  return candles;
}

function build(candles: Array<{ instrumentId: string; ticker: string; candles: HistoricalMinuteCandle[] }>) {
  return buildOrbRvolOpeningRangeBreadth({
    instruments: candles.map(({ instrumentId, ticker, candles: instrumentCandles }) => ({
      instrument: { instrumentId, ticker, lotSize: 1, priceStep: 0.01 },
      candles: instrumentCandles,
    })),
    scheduleForSession: () => ({
      startMinuteMoscow: 10 * 60,
      endMinuteMoscow: 13 * 60,
      source: 'test-fixed-schedule',
    }),
    openingRangeMinutes: 30,
    minValidInstruments: 2,
  });
}

describe('buildOrbRvolOpeningRangeBreadth', () => {
  it('uses only completed opening-range drift and exposes flat instruments', () => {
    const result = build([
      { instrumentId: 'UP', ticker: 'UP', candles: candlesFor('UP', '2025-01-21', 'up') },
      { instrumentId: 'UP2', ticker: 'UP2', candles: candlesFor('UP2', '2025-01-21', 'up') },
      { instrumentId: 'DOWN', ticker: 'DOWN', candles: candlesFor('DOWN', '2025-01-21', 'down') },
      { instrumentId: 'FLAT', ticker: 'FLAT', candles: candlesFor('FLAT', '2025-01-21', 'flat') },
    ]);

    expect(result.get('2025-01-21')).toEqual({
      score: 1 / 3,
      upCount: 2,
      downCount: 1,
      flatCount: 1,
      validInstrumentCount: 3,
      availableInstrumentCount: 4,
    });
  });

  it('returns null when fewer than the minimum number of directional instruments are complete', () => {
    const result = build([
      { instrumentId: 'UP', ticker: 'UP', candles: candlesFor('UP', '2025-01-21', 'up') },
      { instrumentId: 'GAP', ticker: 'GAP', candles: candlesFor('GAP', '2025-01-21', 'up', false) },
    ]);

    expect(result.get('2025-01-21')).toBeNull();
  });

  it('keeps each session independent so later data cannot change an earlier score', () => {
    const result = build([
      {
        instrumentId: 'UP',
        ticker: 'UP',
        candles: [
          ...candlesFor('UP', '2025-01-21', 'up'),
          ...candlesFor('UP', '2025-01-22', 'down'),
        ],
      },
      {
        instrumentId: 'DOWN',
        ticker: 'DOWN',
        candles: [
          ...candlesFor('DOWN', '2025-01-21', 'down'),
          ...candlesFor('DOWN', '2025-01-22', 'down'),
        ],
      },
    ]);

    expect(result.get('2025-01-21')?.score).toBe(0);
    expect(result.get('2025-01-22')?.score).toBe(-1);
  });
});
