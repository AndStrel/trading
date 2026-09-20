import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { archiveSha256, parseHistoryMinuteArchive } from './history-archive.js';

function archive(csv: string): Uint8Array {
  return zipSync({ 'candles.csv': strToU8(csv) });
}

function multiFileArchive(files: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, contents]) => [name, strToU8(contents)])));
}

describe('parseHistoryMinuteArchive', () => {
  it('parses a T-Invest minute archive, normalizes time and rejects invalid rows', () => {
    const parsed = parseHistoryMinuteArchive(
      archive(`UID;UTC;open;close;high;low;volume\nuid-1;2025-01-02 07:00:00;100,00;100,50;101,00;99,00;20\nuid-1;2025-01-02T07:01:00Z;100,50;101,50;102,00;100,00;30\nother-uid;2025-01-02T07:02:00Z;100;101;102;99;1\nuid-1;2025-01-02T07:03:00Z;100;103;102;99;1\n`),
      { instrumentId: 'uid-1', year: 2025 },
    );

    expect(parsed).toEqual({
      candles: [
        {
          instrumentId: 'uid-1',
          time: '2025-01-02T07:00:00.000Z',
          open: 100,
          high: 101,
          low: 99,
          close: 100.5,
          volume: 20,
        },
        {
          instrumentId: 'uid-1',
          time: '2025-01-02T07:01:00.000Z',
          open: 100.5,
          high: 102,
          low: 100,
          close: 101.5,
          volume: 30,
        },
      ],
      rawRowCount: 4,
      invalidRowCount: 2,
      duplicateRowCount: 0,
    });
  });

  it('keeps the last occurrence of a duplicate timestamp and reports it', () => {
    const parsed = parseHistoryMinuteArchive(
      archive(`UID,UTC,open,close,high,low,volume\nuid-1,2025-01-02T07:00:00Z,100,100,101,99,20\nuid-1,2025-01-02T07:00:00Z,100,100.7,101,99,22\n`),
      { instrumentId: 'uid-1', year: 2025 },
    );

    expect(parsed.duplicateRowCount).toBe(1);
    expect(parsed.candles).toEqual([
      {
        instrumentId: 'uid-1',
        time: '2025-01-02T07:00:00.000Z',
        open: 100,
        high: 101,
        low: 99,
        close: 100.7,
        volume: 22,
      },
    ]);
  });

  it('refuses an archive that does not have the documented columns', () => {
    expect(() =>
      parseHistoryMinuteArchive(archive('UID,UTC,close\nuid-1,2025-01-02T07:00:00Z,100\n'), {
        instrumentId: 'uid-1',
        year: 2025,
      }),
    ).toThrow('missing open column');
  });

  it('selects the candle CSV and ignores auxiliary external-provider files', () => {
    const parsed = parseHistoryMinuteArchive(
      multiFileArchive({
        'candles.csv': 'UID,UTC,open,close,high,low,volume\nuid-1,2025-01-02T07:00:00Z,100,100,101,99,20\n',
        'manifest.json': '{"source":"history-data"}',
        'readme.csv': 'generated_at,description\n2026-09-19,metadata\n',
      }),
      { instrumentId: 'uid-1', year: 2025 },
    );

    expect(parsed.candles).toHaveLength(1);
  });

  it('merges a candle archive split across multiple CSV files', () => {
    const parsed = parseHistoryMinuteArchive(
      multiFileArchive({
        'uid-1_2025-01-02.csv': 'timestamp,open,close,high,low,volume\n2025-01-02T07:00:00Z,100,100,101,99,20\n',
        'uid-1_2025-01-03.csv': 'timestamp,open,close,high,low,volume\n2025-01-03T07:00:00Z,100,100,101,99,20\n',
      }),
      { instrumentId: 'uid-1', year: 2025 },
    );

    expect(parsed.candles).toHaveLength(2);
  });

  it('accepts the provider begin column as the candle timestamp', () => {
    const parsed = parseHistoryMinuteArchive(
      multiFileArchive({
        'uid-1_2025-01-02.csv': 'begin;open;high;low;close;volume\n2025-01-02T07:00:00Z;100;101;99;100;20\n',
      }),
      { instrumentId: 'uid-1', year: 2025 },
    );

    expect(parsed.candles).toHaveLength(1);
  });

  it('parses the provider headerless candle format', () => {
    const parsed = parseHistoryMinuteArchive(
      multiFileArchive({
        'uid-1_2025-01-02.csv':
          'uid-1;2025-01-02T07:00:00Z;100;100.5;101;99;20;\nuid-1;2025-01-02T07:01:00Z;100.5;101;102;100;30;\n',
      }),
      { instrumentId: 'uid-1', year: 2025 },
    );

    expect(parsed.candles).toHaveLength(2);
    expect(parsed.candles[0]).toMatchObject({
      instrumentId: 'uid-1',
      time: '2025-01-02T07:00:00.000Z',
      open: 100,
      close: 100.5,
      high: 101,
      low: 99,
      volume: 20,
    });
  });

  it('creates a stable archive checksum for import provenance', () => {
    const bytes = archive('UID,UTC,open,close,high,low,volume\n');
    expect(archiveSha256(bytes)).toMatch(/^[a-f0-9]{64}$/);
    expect(archiveSha256(bytes)).toBe(archiveSha256(bytes));
  });
});
