import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadReadOnlyReplaySource, ReadOnlyReplaySourceError } from './read-only-replay-source.js';

const dirs: string[] = [],
  sha = 'a'.repeat(64),
  from = '2025-08-01T07:00:00.000Z',
  to = '2025-08-01T07:05:00.000Z';
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
type Row = Record<string, string | number | null>;
const defaultMinute: Row = {
  instrument_id: 'MOEX:TQBR:SBER',
  candle_time: from,
  open: 100,
  high: 101,
  low: 99,
  close: 100.5,
  volume: 100,
  source_year: 2025,
  source_archive_sha256: sha,
};
function fixture(
  options: { rows?: Row[]; archives?: Row[]; wal?: boolean; filename?: string; legacy?: boolean } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), 'trading-replay-ro-'));
  dirs.push(dir);
  const path = join(dir, options.filename ?? 'source.sqlite');
  const db = new DatabaseSync(path);
  if (options.wal) db.exec('PRAGMA journal_mode=WAL');
  db.exec(`CREATE TABLE historical_archive_imports (instrument_id TEXT,ticker TEXT,source_year INTEGER,archive_sha256 TEXT,
    stored_candle_count INTEGER,raw_row_count INTEGER,invalid_row_count INTEGER,lot_size INTEGER,price_step REAL,source TEXT,
    duplicate_row_count INTEGER,imported_at TEXT);
    CREATE TABLE historical_minute_candles (instrument_id TEXT,candle_time TEXT,open REAL,high REAL,low REAL,close REAL,volume INTEGER,
    source_year INTEGER,source_archive_sha256 TEXT);PRAGMA user_version=7;`);
  const rows = options.rows ?? [{ ...defaultMinute }];
  const archives = options.archives ?? [
    {
      instrument_id: 'MOEX:TQBR:SBER',
      ticker: 'SBER',
      source_year: 2025,
      archive_sha256: sha,
      stored_candle_count: rows.length,
      raw_row_count: Math.max(100, rows.length),
      invalid_row_count: 0,
      lot_size: 1,
      price_step: 0.01,
      source: 'moex',
      duplicate_row_count: 0,
      imported_at: '2026-10-03T08:00:00.000Z',
    },
  ];
  const insertArchive = db.prepare('INSERT INTO historical_archive_imports VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  for (const row of archives)
    insertArchive.run(
      row.instrument_id!,
      row.ticker!,
      row.source_year!,
      row.archive_sha256!,
      row.stored_candle_count!,
      row.raw_row_count!,
      row.invalid_row_count!,
      row.lot_size!,
      row.price_step!,
      row.source!,
      row.duplicate_row_count!,
      row.imported_at!,
    );
  const insertMinute = db.prepare('INSERT INTO historical_minute_candles VALUES (?,?,?,?,?,?,?,?,?)');
  for (const row of rows)
    insertMinute.run(
      row.instrument_id!,
      row.candle_time!,
      row.open!,
      row.high!,
      row.low!,
      row.close!,
      row.volume!,
      row.source_year!,
      row.source_archive_sha256!,
    );
  if (options.legacy) db.exec('ALTER TABLE historical_archive_imports DROP COLUMN price_step');
  db.close();
  const input = { databasePath: path, ticker: 'SBER', from, to };
  return { dir, path, input, archives };
}
function bytes(path: string) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
function state(dir: string) {
  return readdirSync(dir)
    .sort()
    .map((name) => {
      const path = join(dir, name),
        value = statSync(path, { bigint: true });
      return {
        name,
        sha: bytes(path),
        mode: String(value.mode),
        size: String(value.size),
        mtimeNs: String(value.mtimeNs),
        ctimeNs: String(value.ctimeNs),
      };
    });
}
function rejects(input: Parameters<typeof loadReadOnlyReplaySource>[0], code: string) {
  try {
    loadReadOnlyReplaySource(input);
    throw new Error('Expected fail-closed source');
  } catch (error) {
    expect(error).toBeInstanceOf(ReadOnlyReplaySourceError);
    expect((error as ReadOnlyReplaySourceError).code).toBe(code);
  }
}

describe('Untouched immutable SQLite research source', () => {
  it.each([false, true])(
    'reads finalized WAL=%s without file, permissions, timestamp, sidecar or user-version writes',
    (wal) => {
      const f = fixture({ wal, filename: 'source ? # % with spaces.sqlite' });
      chmodSync(f.path, 0o400);
      chmodSync(f.dir, 0o500);
      const before = state(f.dir),
        directory = statSync(f.dir, { bigint: true });
      const result = loadReadOnlyReplaySource(f.input);
      expect(result).toMatchObject({
        readOnly: true,
        provenanceEvidence: 'archive-linked',
        candles: [{ instrumentId: 'MOEX:TQBR:SBER', time: from, volume: 100 }],
      });
      expect(result.archives[0]).toMatchObject({
        lotSize: 1,
        priceStep: 0.01,
        archiveSha256: sha,
        ticker: 'SBER',
      });
      expect(result.contentSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(state(f.dir)).toEqual(before);
      const after = statSync(f.dir, { bigint: true });
      expect(after.mode).toBe(directory.mode);
      expect(after.mtimeNs).toBe(directory.mtimeNs);
      expect(existsSync(f.path + '-wal')).toBe(false);
      expect(existsSync(f.path + '-shm')).toBe(false);
      chmodSync(f.dir, 0o700);
      chmodSync(f.path, 0o600);
    },
  );
  it('fails missing source without creating a file or parent directory', () => {
    const f = fixture(),
      path = join(f.dir, 'absent', 'source.sqlite');
    const before = readdirSync(f.dir);
    rejects({ ...f.input, databasePath: path }, 'source-not-safe');
    expect(readdirSync(f.dir)).toEqual(before);
    expect(existsSync(join(f.dir, 'absent'))).toBe(false);
  });
  it.each(['-wal', '-shm', '-journal'])(
    'refuses nonempty %s before opening SQLite and leaves bytes unchanged',
    (suffix) => {
      const f = fixture();
      writeFileSync(f.path + suffix, Buffer.alloc(64, 17));
      const before = state(f.dir);
      const open = vi.spyOn(DatabaseSync.prototype, 'prepare');
      rejects(f.input, 'source-not-safe');
      expect(open).not.toHaveBeenCalled();
      expect(state(f.dir)).toEqual(before);
    },
  );
  it('refuses live WAL rather than reading only its checkpointed prefix', () => {
    const f = fixture({ wal: true }),
      writer = new DatabaseSync(f.path);
    writer.exec(
      "INSERT INTO historical_minute_candles SELECT instrument_id,'2025-08-01T07:01:00.000Z',open,high,low,close,volume,source_year,source_archive_sha256 FROM historical_minute_candles LIMIT 1",
    );
    try {
      expect(statSync(f.path + '-wal').size).toBeGreaterThan(0);
      const before = state(f.dir);
      rejects(f.input, 'source-not-safe');
      expect(state(f.dir)).toEqual(before);
    } finally {
      writer.close();
    }
  });
  it('preserves zero-size companion files with immutable and never changes WAL mode', () => {
    const f = fixture({ wal: true });
    for (const suffix of ['-wal', '-shm', '-journal']) writeFileSync(f.path + suffix, '');
    const before = state(f.dir);
    expect(loadReadOnlyReplaySource(f.input).candles).toHaveLength(1);
    expect(state(f.dir)).toEqual(before);
    expect([...readFileSync(f.path).subarray(18, 20)]).toEqual([2, 2]);
  });
  it('rejects legacy metadata without ALTER, migrations or file writes', () => {
    const f = fixture({ legacy: true }),
      before = state(f.dir);
    rejects(f.input, 'schema-missing');
    expect(state(f.dir)).toEqual(before);
  });
  it('rejects source timestamps changed during a read', () => {
    const f = fixture(),
      prepare = DatabaseSync.prototype.prepare;
    vi.spyOn(DatabaseSync.prototype, 'prepare').mockImplementation(function (
      this: DatabaseSync,
      sql: string,
    ) {
      if (sql.includes('FROM historical_minute_candles'))
        utimesSync(f.path, new Date('2020-01-01T00:00:00Z'), new Date('2020-01-01T00:00:00Z'));
      return prepare.call(this, sql);
    });
    rejects(f.input, 'source-changed');
  });
  it('rejects a newly created nonempty sidecar during a read with no cleanup or fallback', () => {
    const f = fixture(),
      prepare = DatabaseSync.prototype.prepare;
    vi.spyOn(DatabaseSync.prototype, 'prepare').mockImplementation(function (
      this: DatabaseSync,
      sql: string,
    ) {
      if (sql.includes('FROM historical_minute_candles')) writeFileSync(f.path + '-wal', 'external-writer');
      return prepare.call(this, sql);
    });
    rejects(f.input, 'source-not-safe');
    expect(readFileSync(f.path + '-wal', 'utf8')).toBe('external-writer');
  });
});

describe('Bounded archive-linked minute rows', () => {
  it('uses [from,to), reports Moscow dates and gaps without inventing a missing minute', () => {
    const f = fixture({
      rows: [
        { ...defaultMinute, candle_time: '2025-08-01T06:59:00.000Z' },
        { ...defaultMinute },
        { ...defaultMinute, candle_time: '2025-08-01T07:02:00.000Z' },
        { ...defaultMinute, candle_time: to },
      ],
    });
    const result = loadReadOnlyReplaySource(f.input);
    expect(result.candles.map((row) => row.time)).toEqual([from, '2025-08-01T07:02:00.000Z']);
    expect(result.coverage).toMatchObject({
      candleCount: 2,
      missingMinutesWithinSpan: 1,
      dates: [{ date: '2025-08-01', candleCount: 2, missingMinutesWithinSpan: 1 }],
    });
    expect(result.warnings.join(' ')).toContain('as-of');
    expect(result.warnings.join(' ')).toContain('executable');
  });
  it('does not join missing minutes across separate Moscow dates', () => {
    const f = fixture({
      rows: [
        { ...defaultMinute, candle_time: '2025-08-01T20:59:00.000Z' },
        { ...defaultMinute, candle_time: '2025-08-01T21:01:00.000Z' },
      ],
    });
    const result = loadReadOnlyReplaySource({
      ...f.input,
      from: '2025-08-01T20:59:00.000Z',
      to: '2025-08-01T21:02:00.000Z',
    });
    expect(result.coverage.dates.map((day) => [day.date, day.missingMinutesWithinSpan])).toEqual([
      ['2025-08-01', 0],
      ['2025-08-02', 0],
    ]);
  });
  it('normalizes a UTC spelling but rejects duplicated timestamp aliases at the requested boundary', () => {
    const only = fixture({ rows: [{ ...defaultMinute, candle_time: '2025-08-01T07:00:00Z' }] });
    expect(loadReadOnlyReplaySource(only.input).candles[0]!.time).toBe(from);
    const duplicate = fixture({
      rows: [{ ...defaultMinute }, { ...defaultMinute, candle_time: '2025-08-01T07:00:00Z' }],
    });
    rejects(duplicate.input, 'data-invalid');
  });
  it.each([
    { candle_time: '2025-08-01T07:00:01.000Z' },
    { candle_time: '2025-08-01T07:00:00+00:00' },
    { candle_time: '2025-08-01T07:00:00.001Z' },
    { open: 0 },
    { high: 98 },
    { low: 102 },
    { close: 103 },
    { volume: -1 },
    { volume: 0.5 },
    { volume: Number.MAX_SAFE_INTEGER + 1 },
  ])('rejects malformed row %#', (patch) => {
    const f = fixture({ rows: [{ ...defaultMinute, ...patch }] });
    rejects(f.input, 'data-invalid');
  });
  it.each([
    { source_archive_sha256: 'b'.repeat(64) },
    { source_year: 2024 },
    { source_archive_sha256: 'not-a-sha' },
  ])('rejects orphan/mismatched row provenance %#', (patch) => {
    const f = fixture({ rows: [{ ...defaultMinute, ...patch }] });
    rejects(f.input, 'provenance-invalid');
  });
  it.each([
    { lot_size: null },
    { price_step: null },
    { price_step: 0.0000000001 },
    { lot_size: 0 },
    { archive_sha256: 'bad' },
    { source: 'unknown' },
    { stored_candle_count: 0 },
    { raw_row_count: -1 },
  ])('rejects unsupported archive metadata %#', (patch) => {
    const base = fixture().archives[0]!;
    const f = fixture({ archives: [{ ...base, ...patch }] });
    expect(() => loadReadOnlyReplaySource(f.input)).toThrow(ReadOnlyReplaySourceError);
  });
  it('rejects duplicate archive year identities and ambiguous ticker UID aliases', () => {
    const base = fixture().archives[0]!;
    const duplicate = fixture({ archives: [base, { ...base }] });
    rejects(duplicate.input, 'provenance-invalid');
    const other = { ...base, instrument_id: 'another-UID' },
      f = fixture({
        archives: [base, other],
        rows: [{ ...defaultMinute }, { ...defaultMinute, instrument_id: 'another-UID' }],
      });
    rejects(f.input, 'ambiguous-instrument');
    expect(
      loadReadOnlyReplaySource({ ...f.input, instrumentId: 'another-UID' }).candles[0]!.instrumentId,
    ).toBe('another-UID');
  });
  it('binds a quoted instrument UID as data rather than executing SQL', () => {
    const uid = "instrument' OR 1=1 --",
      base = fixture().archives[0]!;
    const f = fixture({
      archives: [{ ...base, instrument_id: uid }],
      rows: [{ ...defaultMinute, instrument_id: uid }],
    });
    expect(loadReadOnlyReplaySource({ ...f.input, instrumentId: uid }).candles[0]!.instrumentId).toBe(uid);
  });
  it('hard-bounds rows and rejects an empty requested range', () => {
    const f = fixture({
      rows: [{ ...defaultMinute }, { ...defaultMinute, candle_time: '2025-08-01T07:01:00.000Z' }],
    });
    rejects({ ...f.input, maxCandles: 1 }, 'bound-exceeded');
    rejects({ ...f.input, from: to, to: '2025-08-01T07:06:00.000Z' }, 'empty-range');
  });
  it.each([0, -1, 0.5, 1_000_001, Number.NaN])('rejects invalid maxCandles %s', (maxCandles) => {
    const f = fixture();
    rejects({ ...f.input, maxCandles }, 'invalid-input');
  });
  it('fingerprints canonical result content reproducibly and changes it when actual OHLC changes', () => {
    const f = fixture(),
      first = loadReadOnlyReplaySource(f.input),
      second = loadReadOnlyReplaySource(f.input);
    expect(second.contentSha256).toBe(first.contentSha256);
    const writer = new DatabaseSync(f.path);
    writer.exec('UPDATE historical_minute_candles SET close=100.6');
    writer.close();
    expect(loadReadOnlyReplaySource(f.input).contentSha256).not.toBe(first.contentSha256);
  });
  it('preserves actual nonzero milliseconds in archive importedAt metadata', () => {
    const base = fixture().archives[0]!,
      f = fixture({ archives: [{ ...base, imported_at: '2026-10-03T08:00:00.123Z' }] });
    expect(loadReadOnlyReplaySource(f.input).archives[0]!.importedAt).toBe('2026-10-03T08:00:00.123Z');
  });
});
