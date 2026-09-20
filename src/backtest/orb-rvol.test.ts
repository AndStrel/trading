import { describe, expect, it } from 'vitest';

import type { HistoricalMinuteCandle } from '../history/market-data-store.js';
import {
  collectOrbRvolResearch,
  DEFAULT_ORB_RVOL_PARAMETERS,
  type OrbRvolParameters,
} from './orb-rvol.js';

const instrument = {
  instrumentId: 'orb-instrument',
  ticker: 'TEST',
  lotSize: 1,
  priceStep: 0.01,
};

function atMoscow(date: string, minuteOfDay: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  return new Date(Date.UTC(year!, month! - 1, day!, hour - 3, minute)).toISOString();
}

function researchParameters(): OrbRvolParameters {
  return {
    ...DEFAULT_ORB_RVOL_PARAMETERS,
    commissionRate: 0.0005,
    slippageRate: 0.0005,
    forwardHorizonsMinutes: [15, 30, 60, 120],
  };
}

function syntheticArchive(options: { stopAndTargetSameMinute?: boolean } = {}): HistoricalMinuteCandle[] {
  const candles: HistoricalMinuteCandle[] = [];
  for (let day = 1; day <= 23; day += 1) {
    const date = `2025-01-${String(day).padStart(2, '0')}`;
    const breakout = day === 21 || day === 22 || day === 23;
    const highVolume = day === 21;
    for (let offset = 0; offset <= 180; offset += 1) {
      const minuteOfDay = 10 * 60 + offset;
      const openingRangeMinute = offset < 30;
      const signalMinute = offset >= 30 && offset < 35;
      const entryMinute = offset === 35;
      const afterEntry = offset > 35;
      const volume = openingRangeMinute && highVolume ? 200 : 100;
      let open = 100;
      let close = 100;
      let high = 100.1;
      let low = 99.9;

      if (breakout && signalMinute) {
        open = 100.05;
        close = 100.8;
        high = 101;
        low = 100;
      } else if (breakout && entryMinute) {
        open = 100.9;
        close = 100.95;
        high = 101;
        low = 100.8;
      } else if (breakout && afterEntry) {
        open = 101;
        close = 101 + Math.min(offset - 35, 30) * 0.08;
        high = close + 0.05;
        low = open - 0.02;
      }

      if (options.stopAndTargetSameMinute && day === 23 && offset === 36) {
        open = 101;
        close = 100.5;
        high = 105;
        low = 99.8;
      }

      candles.push({
        instrumentId: instrument.instrumentId,
        time: atMoscow(date, minuteOfDay),
        open,
        high,
        low,
        close,
        volume,
      });
    }
  }
  return candles;
}

function collect(candles: HistoricalMinuteCandle[]) {
  return collectOrbRvolResearch({
    instruments: [{ instrument, candles }],
    scheduleForSession: () => ({
      startMinuteMoscow: 10 * 60,
      endMinuteMoscow: 13 * 60,
      source: 'test-fixed-schedule',
    }),
    parameters: researchParameters(),
  });
}

describe('collectOrbRvolResearch', () => {
  it('collects all entry events and separates high and ordinary relative volume', () => {
    const report = collect(syntheticArchive());
    const events = report.events;
    expect(events).toHaveLength(3);
    expect(events.map((event) => event.sessionDate)).toEqual(['2025-01-21', '2025-01-22', '2025-01-23']);
    expect(events[0]!.relativeVolume).toBe(2);
    expect(events[1]!.relativeVolume).toBe(1);
    expect(events[0]!.passesRelativeVolume).toBe(true);
    expect(events[1]!.passesRelativeVolume).toBe(false);
    expect(events[0]!.eligible).toBe(true);
    expect(events[0]!.forwardReturns.every((item) => item.status === 'complete')).toBe(true);

    expect(report.summaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ group: 'cost_eligible_high_rvol', eventCount: 1 }),
        expect.objectContaining({ group: 'cost_eligible_low_rvol', eventCount: 2 }),
      ]),
    );
  });

  it('does not let a later session change an earlier relative-volume reference', () => {
    const original = collect(syntheticArchive());
    const extended = collect(syntheticArchive().map((candle) =>
      candle.time.startsWith('2025-01-22') && candle.time < '2025-01-22T07:30:00.000Z'
        ? { ...candle, volume: candle.volume * 100 }
        : candle,
    ));

    expect(extended.events[0]!.relativeVolume).toBe(original.events[0]!.relativeVolume);
    expect(extended.events[1]!.relativeVolume).toBeGreaterThan(original.events[1]!.relativeVolume);
  });

  it('uses the adverse stop first when one minute touches both levels', () => {
    const report = collect(syntheticArchive({ stopAndTargetSameMinute: true }));
    const event = report.events.find((item) => item.sessionDate === '2025-01-23')!;

    expect(event.strategyExit.reason).toBe('stop');
    expect(event.strategyExit.exitMarketPrice).toBe(event.stopPrice);
  });

  it('records an incomplete opening range instead of inventing a session', () => {
    const candles = syntheticArchive().filter((candle) => candle.time !== '2025-01-21T07:15:00.000Z');
    const report = collect(candles);

    expect(report.dataQuality.incompleteOpeningRangeSessionCount).toBe(1);
    expect(report.rejections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sessionDate: '2025-01-21', reason: 'incomplete_opening_range' }),
      ]),
    );
    expect(report.events.some((event) => event.sessionDate === '2025-01-21')).toBe(false);
  });
});
