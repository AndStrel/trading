import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import { MarketDataStore } from '../history/market-data-store.js';
import { buildResearchSituations } from './situation-catalog.js';

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
      datasetVersion: 'situation-v1',
      instrumentId: 'instrument-uid',
      sourceYear: 2025,
      situations,
    });
    expect(store.countResearchSituations({ datasetVersion: 'situation-v1' })).toBe(situations.length);

    const target = situations[3]!;
    expect(store.getResearchSituation({
      datasetVersion: 'situation-v1',
      ticker: 'TEST',
      observedAt: target.observedAt,
    })).toMatchObject({ situationId: target.situationId, outcomes: target.outcomes });

    const neighbors = store.findSimilarResearchSituations({
      datasetVersion: 'situation-v1',
      featureVector: target.featureVector,
      before: target.featureAvailableAt,
      limit: 10,
      excludeSituationId: target.situationId,
    });
    expect(neighbors.length).toBeGreaterThan(0);
    expect(neighbors.every((neighbor) => neighbor.featureAvailableAt < target.featureAvailableAt)).toBe(true);
    expect(neighbors.every((neighbor) => neighbor.situationId !== target.situationId)).toBe(true);

    store.replaceResearchSituations({
      datasetVersion: 'situation-v1',
      instrumentId: 'instrument-uid',
      sourceYear: 2025,
      situations,
    });
    expect(store.countResearchSituations({ datasetVersion: 'situation-v1' })).toBe(situations.length);
  });

  it('pages through a catalog larger than one similarity batch', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'andstrel-research-large-store-test-'));
    directories.push(directory);
    const store = new MarketDataStore(join(directory, 'market-data.sqlite'));
    const situations = Array.from({ length: 5_005 }, (_, index) => {
      const observedAt = new Date(Date.parse('2024-01-01T07:00:00.000Z') + index * 60_000).toISOString();
      return {
        situationId: `situation-v1/test-${index}`,
        datasetVersion: 'situation-v1',
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
      datasetVersion: 'situation-v1',
      instrumentId: 'instrument-uid',
      sourceYear: 2024,
      situations,
    });
    const neighbors = store.findSimilarResearchSituations({
      datasetVersion: 'situation-v1',
      featureVector: [5_004],
      before: '2025-01-01T00:00:00.000Z',
      limit: 3,
    });

    expect(neighbors.map((neighbor) => neighbor.featureVector[0])).toEqual([5_004, 5_003, 5_002]);
  });
});
