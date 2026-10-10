import { describe, expect, it } from 'vitest';

import type { HistoricalMinuteCandle } from '../history/market-data-store.js';
import {
  buildResearchSituations,
  RESEARCH_FEATURE_SPECS,
  researchVectorDistance,
} from './situation-catalog.js';

function candles(count: number, start = '2025-01-02T07:00:00.000Z'): HistoricalMinuteCandle[] {
  const startMs = Date.parse(start);
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + Math.sin(index / 8) + index / 100;
    return {
      instrumentId: 'instrument-uid',
      time: new Date(startMs + index * 60_000).toISOString(),
      open: close - 0.05,
      high: close + 0.1,
      low: close - 0.1,
      close,
      volume: 100 + index,
    };
  });
}

describe('research situation catalog', () => {
  it('does not change features when only future candles change', () => {
    const input = candles(120);
    const metadata = { instrumentId: 'instrument-uid', ticker: 'TEST', sourceYear: 2025, sourceArchiveSha256: 'a'.repeat(64) };
    const original = buildResearchSituations(input, metadata)[0]!;
    const changed = input.map((candle, index) => index <= 30 ? candle : {
      ...candle, open: candle.open * 2, high: candle.high * 2, low: candle.low * 2,
      close: candle.close * 2, volume: candle.volume * 2,
    });
    const rebuilt = buildResearchSituations(changed, metadata)[0]!;
    expect(rebuilt.featureVector).toEqual(original.featureVector);
    expect(rebuilt.outcomes).not.toEqual(original.outcomes);
  });
  it('builds past-only features and separate forward outcomes', () => {
    const result = buildResearchSituations(
      candles(120),
      {
        instrumentId: 'instrument-uid',
        ticker: 'TEST',
        sourceYear: 2025,
        sourceArchiveSha256: 'a'.repeat(64),
      },
      { stepMinutes: 10, outcomeHorizonsMinutes: [15, 30] },
    );

    expect(result.length).toBe(9);
    expect(result[0]).toMatchObject({
      datasetVersion: 'situation-v2',
      ticker: 'TEST',
      sessionDate: '2025-01-02',
      observedAt: '2025-01-02T07:30:00.000Z',
      featureAvailableAt: '2025-01-02T07:31:00.000Z',
      sourceYear: 2025,
    });
    expect(Object.keys(result[0]!.features)).toEqual(RESEARCH_FEATURE_SPECS.map(({ name }) => name));
    expect(result[0]!.featureVector).toHaveLength(RESEARCH_FEATURE_SPECS.length);
    expect(result[0]!.outcomes.map(({ horizonMinutes }) => horizonMinutes)).toEqual([15, 30]);
    expect(result[0]!.outcomes.every((outcome) => outcome.terminalAt > result[0]!.featureAvailableAt)).toBe(true);
  });

  it('does not expose the final candle close until its minute has finished', () => {
    const result = buildResearchSituations(candles(60), {
      instrumentId: 'instrument-uid', ticker: 'TEST', sourceYear: 2025,
      sourceArchiveSha256: 'a'.repeat(64),
    }, { outcomeHorizonsMinutes: [15] });
    expect(result[0]!.featureAvailableAt).toBe('2025-01-02T07:31:00.000Z');
    expect(result[0]!.outcomes[0]).toMatchObject({
      terminalAt: '2025-01-02T07:45:00.000Z',
      outcomeAvailableAt: '2025-01-02T07:46:00.000Z',
    });
  });

  it('does not construct a window across a missing minute', () => {
    const input = candles(90);
    input.splice(45, 1);
    const result = buildResearchSituations(input, {
      instrumentId: 'instrument-uid',
      ticker: 'TEST',
      sourceYear: 2025,
      sourceArchiveSha256: 'a'.repeat(64),
    });

    expect(result.every((situation) => !situation.observedAt.includes('07:45'))).toBe(true);
    expect(result.every((situation) => situation.outcomes.every((outcome) => outcome.terminalAt > situation.observedAt))).toBe(true);
  });

  it('keeps the target features unchanged when future prices and volume change', () => {
    const input = candles(90);
    const metadata = {
      instrumentId: 'instrument-uid', ticker: 'TEST', sourceYear: 2025,
      sourceArchiveSha256: 'a'.repeat(64),
    };
    const original = buildResearchSituations(input, metadata)[0]!;
    const changed = input.map((candle, index) => index <= 30 ? candle : {
      ...candle, open: candle.open * 2, high: candle.high * 2,
      low: candle.low * 2, close: candle.close * 2, volume: candle.volume * 100,
    });
    const rebuilt = buildResearchSituations(changed, metadata)[0]!;
    expect(rebuilt.features).toEqual(original.features);
    expect(rebuilt.featureVector).toEqual(original.featureVector);
    expect(rebuilt.outcomes).not.toEqual(original.outcomes);
  });

  it('calculates deterministic vector distance', () => {
    expect(researchVectorDistance([0, 0], [3, 4])).toBe(5);
    expect(researchVectorDistance([1, 2], [1, 2])).toBe(0);
  });
});
