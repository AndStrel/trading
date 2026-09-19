import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { MarketDataStore } from './market-data-store.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function storeForTest(): Promise<MarketDataStore> {
  const directory = await mkdtemp(join(tmpdir(), 'andstrel-market-data-test-'));
  directories.push(directory);
  return new MarketDataStore(join(directory, 'market-data.sqlite'));
}

describe('MarketDataStore', () => {
  it('stores an annual archive with provenance and exposes deterministic coverage', async () => {
    const store = await storeForTest();
    const result = store.importMinuteArchive({
      instrumentId: 'instrument-uid',
      year: 2025,
      archiveSha256: 'a'.repeat(64),
      rawRowCount: 3,
      invalidRowCount: 1,
      candles: [
        {
          instrumentId: 'instrument-uid',
          time: '2025-01-02T07:00:00.000Z',
          open: 100,
          high: 101,
          low: 99,
          close: 100.5,
          volume: 20,
        },
        {
          instrumentId: 'instrument-uid',
          time: '2025-01-02T07:01:00.000Z',
          open: 100.5,
          high: 102,
          low: 100,
          close: 101.5,
          volume: 30,
        },
      ],
    });

    expect(result).toMatchObject({
      instrumentId: 'instrument-uid',
      year: 2025,
      storedCandleCount: 2,
      rawRowCount: 3,
      invalidRowCount: 1,
    });
    expect(store.getCoverage('instrument-uid')).toEqual({
      instrumentId: 'instrument-uid',
      candleCount: 2,
      firstCandleAt: '2025-01-02T07:00:00.000Z',
      lastCandleAt: '2025-01-02T07:01:00.000Z',
    });
    expect(store.getArchiveImport('instrument-uid', 2025)).toMatchObject({
      instrumentId: 'instrument-uid',
      year: 2025,
      archiveSha256: 'a'.repeat(64),
      storedCandleCount: 2,
      rawRowCount: 3,
      invalidRowCount: 1,
    });
    expect(store.getArchiveImport('instrument-uid', 2024)).toBeNull();
    expect(
      store.listMinuteCandles({
        instrumentId: 'instrument-uid',
        from: '2025-01-02T07:00:00.000Z',
        to: '2025-01-02T07:02:00.000Z',
      }),
    ).toEqual([
      {
        instrumentId: 'instrument-uid',
        time: '2025-01-02T07:00:00.000Z',
        open: 100,
        high: 101,
        low: 99,
        close: 100.5,
        volume: 20,
      },
      {
        instrumentId: 'instrument-uid',
        time: '2025-01-02T07:01:00.000Z',
        open: 100.5,
        high: 102,
        low: 100,
        close: 101.5,
        volume: 30,
      },
    ]);
  });

  it('updates the same candle on a renewed archive instead of duplicating it', async () => {
    const store = await storeForTest();
    const input = {
      instrumentId: 'instrument-uid',
      year: 2025,
      rawRowCount: 1,
      invalidRowCount: 0,
      candles: [
        {
          instrumentId: 'instrument-uid',
          time: '2025-01-02T07:00:00.000Z',
          open: 100,
          high: 101,
          low: 99,
          close: 100,
          volume: 20,
        },
      ],
    };

    store.importMinuteArchive({ ...input, archiveSha256: 'a'.repeat(64) });
    store.importMinuteArchive({
      ...input,
      archiveSha256: 'b'.repeat(64),
      candles: [{ ...input.candles[0]!, close: 100.7, high: 100.7 }],
    });

    expect(store.getCoverage('instrument-uid').candleCount).toBe(1);
    expect(
      store.listMinuteCandles({
        instrumentId: 'instrument-uid',
        from: '2025-01-02T07:00:00.000Z',
        to: '2025-01-02T07:01:00.000Z',
      }),
    ).toMatchObject([{ close: 100.7, high: 100.7 }]);
  });

  it('removes stale candles when a renewed annual archive no longer contains them', async () => {
    const store = await storeForTest();
    const firstCandle = {
      instrumentId: 'instrument-uid',
      time: '2025-01-02T07:00:00.000Z',
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 20,
    };
    const secondCandle = {
      ...firstCandle,
      time: '2025-01-02T07:01:00.000Z',
      open: 100.5,
      high: 102,
      low: 100,
      close: 101,
      volume: 30,
    };

    store.importMinuteArchive({
      instrumentId: 'instrument-uid',
      year: 2025,
      archiveSha256: 'a'.repeat(64),
      rawRowCount: 2,
      invalidRowCount: 0,
      candles: [firstCandle, secondCandle],
    });
    store.importMinuteArchive({
      instrumentId: 'instrument-uid',
      year: 2025,
      archiveSha256: 'b'.repeat(64),
      rawRowCount: 1,
      invalidRowCount: 0,
      candles: [{ ...firstCandle, close: 100.2 }],
    });

    expect(store.getCoverage('instrument-uid').candleCount).toBe(1);
    expect(
      store.listMinuteCandles({
        instrumentId: 'instrument-uid',
        from: '2025-01-02T07:00:00.000Z',
        to: '2025-01-02T07:02:00.000Z',
      }),
    ).toEqual([{ ...firstCandle, close: 100.2 }]);
  });

  it('rejects invalid candle geometry before committing the archive', async () => {
    const store = await storeForTest();

    expect(() =>
      store.importMinuteArchive({
        instrumentId: 'instrument-uid',
        year: 2025,
        archiveSha256: 'a'.repeat(64),
        rawRowCount: 1,
        invalidRowCount: 0,
        candles: [
          {
            instrumentId: 'instrument-uid',
            time: '2025-01-02T07:00:00.000Z',
            open: 100,
            high: 99,
            low: 98,
            close: 100,
            volume: 1,
          },
        ],
      }),
    ).toThrow('Historical candle values are invalid');
    expect(store.getCoverage('instrument-uid').candleCount).toBe(0);
  });
});
