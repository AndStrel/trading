import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import { MarketDataStore } from '../history/market-data-store.js';
import { buildResearchSituations, RESEARCH_DATASET_VERSION } from './situation-catalog.js';
import { queryResearchSimilarity } from '../research-similar.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function candles(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + Math.sin(index / 5) + index / 20;
    return {
      instrumentId: 'instrument-uid',
      time: new Date(Date.parse('2025-01-02T07:00:00.000Z') + index * 60_000).toISOString(),
      open: close - 0.05,
      high: close + 0.1,
      low: close - 0.1,
      close,
      volume: 100 + index,
    };
  });
}

describe('research catalog storage', () => {
  it('invalidates derived situations when the same instrument archive is corrected', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'andstrel-research-correction-test-'));
    directories.push(directory);
    const store = new MarketDataStore(join(directory, 'market-data.sqlite'));
    const source = { instrumentId: 'instrument-uid', ticker: 'TEST', year: 2025,
      archiveSha256: 'a'.repeat(64), candles: candles(120), rawRowCount: 120,
      invalidRowCount: 0, lotSize: 1, priceStep: 0.01 };
    store.importMinuteArchive(source);
    const situations = buildResearchSituations(source.candles, {
      instrumentId: source.instrumentId, ticker: source.ticker,
      sourceYear: source.year, sourceArchiveSha256: source.archiveSha256,
    });
    store.replaceResearchSituations({ datasetVersion: 'situation-v2', instrumentId: source.instrumentId,
      sourceYear: source.year, situations });
    store.importMinuteArchive(source);
    expect(store.countResearchSituations({ datasetVersion: 'situation-v2' })).toBe(situations.length);
    store.importMinuteArchive({ ...source, archiveSha256: 'b'.repeat(64) });
    expect(store.countResearchSituations({ datasetVersion: 'situation-v2' })).toBe(0);
  });
  it('replaces one archive catalog and searches only before the target', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'andstrel-research-store-test-'));
    directories.push(directory);
    const store = new MarketDataStore(join(directory, 'market-data.sqlite'));
    const situations = buildResearchSituations(
      candles(120),
      {
        instrumentId: 'instrument-uid',
        ticker: 'TEST',
        sourceYear: 2025,
        sourceArchiveSha256: 'a'.repeat(64),
      },
      { stepMinutes: 5 },
    );

    store.replaceResearchSituations({
      datasetVersion: RESEARCH_DATASET_VERSION,
      instrumentId: 'instrument-uid',
      sourceYear: 2025,
      situations,
    });
    expect(store.countResearchSituations({ datasetVersion: RESEARCH_DATASET_VERSION })).toBe(situations.length);

    const target = situations[2]!;
    expect(store.getResearchSituation({
      datasetVersion: RESEARCH_DATASET_VERSION,
      ticker: 'TEST',
      observedAt: target.observedAt,
    })).toMatchObject({ situationId: target.situationId, outcomes: target.outcomes });

    const neighbors = store.findSimilarResearchSituations({
      datasetVersion: RESEARCH_DATASET_VERSION,
      featureVector: target.featureVector,
      before: target.featureAvailableAt,
      limit: 10,
      excludeSituationId: target.situationId,
    });
    expect(neighbors.length).toBeGreaterThan(0);
    expect(neighbors.every((neighbor) => neighbor.featureAvailableAt < target.featureAvailableAt)).toBe(true);
    expect(neighbors.every((neighbor) => neighbor.situationId !== target.situationId)).toBe(true);
    // The early target is only 10 minutes after the oldest situation. None of
    // those neighbors' 15/30/60-minute closes were known at this cutoff yet.
    expect(neighbors.every((neighbor) => neighbor.outcomes.length === 0)).toBe(true);

    store.replaceResearchSituations({
      datasetVersion: RESEARCH_DATASET_VERSION,
      instrumentId: 'instrument-uid',
      sourceYear: 2025,
      situations,
    });
    expect(store.countResearchSituations({ datasetVersion: RESEARCH_DATASET_VERSION })).toBe(situations.length);
  });

  it('returns only completed outcome candles at the cutoff, including equality', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'andstrel-research-cutoff-test-'));
    directories.push(directory);
    const store = new MarketDataStore(join(directory, 'market-data.sqlite'));
    const situations = buildResearchSituations(candles(120), {
      instrumentId: 'instrument-uid', ticker: 'TEST', sourceYear: 2025,
      sourceArchiveSha256: 'a'.repeat(64),
    });
    store.replaceResearchSituations({
      datasetVersion: situations[0]!.datasetVersion, instrumentId: 'instrument-uid',
      sourceYear: 2025, situations,
    });
    const query = (before: string) => store.findSimilarResearchSituations({
      datasetVersion: situations[0]!.datasetVersion,
      featureVector: situations[0]!.featureVector, before, limit: 1,
    });
    // 07:45 is the START of the terminal candle; its close is not known yet.
    expect(query('2025-01-02T07:45:00.000Z')[0]!.outcomes).toEqual([]);
    expect(query('2025-01-02T07:45:59.999Z')[0]!.outcomes).toEqual([]);
    const matured = query('2025-01-02T07:46:00.000Z')[0]!;
    expect(matured.outcomes.map((outcome) => outcome.horizonMinutes)).toEqual([15]);
    expect(matured.outcomes[0]!.outcomeAvailableAt).toBe('2025-01-02T07:46:00.000Z');
    expect(query('2025-01-02T08:01:00.000Z')[0]!.outcomes.map((outcome) => outcome.horizonMinutes)).toEqual([15, 30]);
    expect(query('2025-01-02T10:46:00+03:00')).toEqual(query('2025-01-02T07:46:00.000Z'));
    // Outcome maturity must not influence which feature vector ranks first.
    expect(matured.situationId).toBe(query('2025-01-02T07:45:00.000Z')[0]!.situationId);
    expect(query(situations[0]!.featureAvailableAt)).toEqual([]);
    expect(() => query('invalid')).toThrow('cutoff is invalid');

    const target = situations[6]!;
    const result = queryResearchSimilarity(store, {
      ticker: 'TEST', observedAt: target.observedAt, neighbors: 10,
    });
    expect(result.target).not.toHaveProperty('outcomes');
    expect(result.outcomeCutoff).toBe(target.featureAvailableAt);
    expect(result.neighbors.every((neighbor) => neighbor.outcomes.every(
      (outcome) => outcome.outcomeAvailableAt <= result.outcomeCutoff,
    ))).toBe(true);

    // Old catalogs must not silently supply minute-open features to the v2 CLI.
    store.replaceResearchSituations({
      datasetVersion: 'situation-v1', instrumentId: 'instrument-uid', sourceYear: 2025,
      situations: situations.map((situation) => ({
        ...situation, datasetVersion: 'situation-v1',
        situationId: situation.situationId.replace('situation-v2', 'situation-v1'),
        featureAvailableAt: situation.observedAt,
      })),
    });
    expect(queryResearchSimilarity(store, {
      ticker: 'TEST', observedAt: target.observedAt, neighbors: 10,
    })).toEqual(result);
  });

  it('pages through a catalog larger than one similarity batch', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'andstrel-research-large-store-test-'));
    directories.push(directory);
    const store = new MarketDataStore(join(directory, 'market-data.sqlite'));
    const situations = Array.from({ length: 5_005 }, (_, index) => {
      const observedAt = new Date(Date.parse('2024-01-01T07:00:00.000Z') + index * 60_000).toISOString();
      return {
        situationId: `situation-v2/test-${index}`,
        datasetVersion: 'situation-v2',
        instrumentId: 'instrument-uid',
        ticker: 'TEST',
        sessionDate: '2024-01-01',
        observedAt,
        featureAvailableAt: observedAt,
        sourceYear: 2024,
        sourceArchiveSha256: 'b'.repeat(64),
        features: {
          return1mPct: 0,
          return5mPct: 0,
          return15mPct: 0,
          return30mPct: 0,
          range30mPct: 0,
          realizedVol30mPct: 0,
          volumeLogRatio30m: 0,
          closeLocation30m: 0,
          drawdown30mPct: 0,
          runup30mPct: 0,
        },
        featureVector: [index],
        outcomes: [],
      };
    });

    store.replaceResearchSituations({
      datasetVersion: 'situation-v2',
      instrumentId: 'instrument-uid',
      sourceYear: 2024,
      situations,
    });
    const neighbors = store.findSimilarResearchSituations({
      datasetVersion: 'situation-v2',
      featureVector: [5_004],
      before: '2025-01-01T00:00:00.000Z',
      limit: 3,
    });

    expect(neighbors.map((neighbor) => neighbor.featureVector[0])).toEqual([5_004, 5_003, 5_002]);
  });
});
