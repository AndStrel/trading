import { createHash } from 'node:crypto';
import { closeSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { priceToNano } from '../domain/price-tick.js';
import type { HistoricalArchiveProvenance, HistoricalMinuteCandle } from './market-data-store.js';

const minuteMs = 60_000,
  maxSourceCandles = 1_000_000;
const sidecars = ['-wal', '-shm', '-journal'] as const;
type Failure =
  | 'invalid-input'
  | 'source-not-safe'
  | 'source-changed'
  | 'schema-missing'
  | 'provenance-invalid'
  | 'ambiguous-instrument'
  | 'data-invalid'
  | 'bound-exceeded'
  | 'empty-range';
export class ReadOnlyReplaySourceError extends Error {
  constructor(readonly code: Failure) {
    super(`Read-only replay source: ${code}`);
  }
}
const fail = (code: Failure): never => {
  throw new ReadOnlyReplaySourceError(code);
};
export type ReadOnlyReplaySourceInput = {
  databasePath: string;
  ticker: string;
  instrumentId?: string;
  from: string;
  to: string;
  maxCandles?: number;
};
export type ReplayDayCoverage = {
  date: string;
  candleCount: number;
  firstCandleAt: string;
  lastCandleAt: string;
  missingMinutesWithinSpan: number;
};
export type ReadOnlyReplaySource = {
  candles: HistoricalMinuteCandle[];
  archives: HistoricalArchiveProvenance[];
  contentSha256: string;
  coverage: {
    candleCount: number;
    firstCandleAt: string;
    lastCandleAt: string;
    dates: ReplayDayCoverage[];
    missingMinutesWithinSpan: number;
  };
  readOnly: true;
  provenanceEvidence: 'archive-linked';
  warnings: string[];
};
type Row = Record<string, unknown>;

function utcTime(value: unknown, requireMinute = true): { iso: string; epoch: number } {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value))
    return fail('data-invalid');
  const epoch = Date.parse(value),
    iso = Number.isFinite(epoch) ? new Date(epoch).toISOString() : '';
  if (
    !iso ||
    iso !== value.replace(/Z$/, value.includes('.') ? 'Z' : '.000Z') ||
    (requireMinute && epoch % minuteMs !== 0)
  )
    return fail('data-invalid');
  return { iso, epoch };
}
function count(value: unknown): number {
  if (typeof value === 'bigint')
    value = value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : Number.NaN;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    return fail('provenance-invalid');
  return value;
}
function identity(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 256 ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    return fail('provenance-invalid');
  return value;
}
function sha(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) return fail('provenance-invalid');
  return value;
}
function amount(value: unknown): number {
  if (typeof value !== 'number') return fail('data-invalid');
  try {
    priceToNano(value);
  } catch {
    return fail('data-invalid');
  }
  return value;
}
function stat(path: string) {
  try {
    const value = lstatSync(path, { bigint: true });
    if (!value.isFile()) return fail('source-not-safe');
    return {
      dev: String(value.dev),
      ino: String(value.ino),
      size: String(value.size),
      mode: String(value.mode),
      mtimeNs: String(value.mtimeNs),
      ctimeNs: String(value.ctimeNs),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
function sourceState(path: string) {
  const file = stat(path);
  if (!file) return fail('source-not-safe');
  const companions = sidecars.map((suffix) => stat(path + suffix));
  if (companions.some((item) => item !== null && BigInt(item.size) > 0n)) return fail('source-not-safe');
  return { file, companions };
}
function assertSqliteHeader(path: string) {
  const fd = openSync(path, 'r'),
    header = Buffer.alloc(100);
  try {
    if (
      readSync(fd, header, 0, header.length, 0) !== 100 ||
      header.subarray(0, 16).toString() !== 'SQLite format 3\0' ||
      !([1, 2].includes(header[18]!) && header[18] === header[19])
    )
      return fail('source-not-safe');
  } finally {
    closeSync(fd);
  }
}
function requireColumns(db: DatabaseSync, table: string, columns: readonly string[]) {
  const kind = db.prepare('SELECT type FROM sqlite_schema WHERE name=? LIMIT 2').all(table) as Row[];
  if (kind.length !== 1 || kind[0]?.type !== 'table') return fail('schema-missing');
  const names = new Set(
    (db.prepare('SELECT name FROM pragma_table_info(?)').all(table) as Row[]).map((row) => row.name),
  );
  if (columns.some((name) => !names.has(name))) return fail('schema-missing');
}
function archive(row: Row): HistoricalArchiveProvenance {
  const instrumentId = identity(row.instrument_id),
    year = count(row.source_year),
    archiveSha256 = sha(row.archive_sha256);
  const lotSize = count(row.lot_size);
  if (
    year < 2000 ||
    year > 2100 ||
    typeof row.ticker !== 'string' ||
    !/^[A-Z0-9.-]{1,16}$/.test(row.ticker) ||
    (row.source !== 'tinvest' && row.source !== 'moex') ||
    lotSize <= 0 ||
    lotSize > 1_000_000 ||
    typeof row.price_step !== 'number'
  )
    return fail('provenance-invalid');
  amount(row.price_step);
  const storedCandleCount = count(row.stored_candle_count),
    rawRowCount = count(row.raw_row_count),
    invalidRowCount = count(row.invalid_row_count),
    duplicateRowCount = count(row.duplicate_row_count);
  if (storedCandleCount > rawRowCount || invalidRowCount > rawRowCount || duplicateRowCount > rawRowCount)
    return fail('provenance-invalid');
  return {
    instrumentId,
    ticker: row.ticker,
    year,
    archiveSha256,
    storedCandleCount,
    rawRowCount,
    invalidRowCount,
    lotSize,
    priceStep: row.price_step,
    source: row.source,
    duplicateRowCount,
    importedAt: utcTime(row.imported_at, false).iso,
  };
}

/** No fallback, migrations, file permission changes, checkpointing or source copying.
 * immutable is required: ordinary readOnly SQLite may create WAL/SHM on SELECT.
 * Nonempty sidecars are refused because immutable would ignore their commits.
 */
export function loadReadOnlyReplaySource(input: ReadOnlyReplaySourceInput): ReadOnlyReplaySource {
  let db: DatabaseSync | undefined;
  try {
    if (
      typeof input.databasePath !== 'string' ||
      !input.databasePath ||
      input.databasePath.length > 4096 ||
      input.databasePath.includes('\0') ||
      typeof input.ticker !== 'string' ||
      !/^[A-Z0-9.-]{1,16}$/.test(input.ticker)
    )
      return fail('invalid-input');
    if (input.instrumentId !== undefined) identity(input.instrumentId);
    const from = utcTime(input.from),
      to = utcTime(input.to),
      limit = input.maxCandles ?? maxSourceCandles;
    if (
      from.epoch >= to.epoch ||
      new Date(from.epoch).getUTCFullYear() < 2000 ||
      new Date(to.epoch).getUTCFullYear() > 2100 ||
      !Number.isSafeInteger(limit) ||
      limit <= 0 ||
      limit > maxSourceCandles
    )
      return fail('invalid-input');
    const path = realpathSync(resolve(input.databasePath)),
      before = sourceState(path);
    assertSqliteHeader(path);
    const uri = pathToFileURL(path);
    uri.search = '?mode=ro&immutable=1';
    // Passing the URI STRING preserves immutable on Node's SQLite connection.
    db = new DatabaseSync(uri.href, { readOnly: true });
    requireColumns(db, 'historical_archive_imports', [
      'instrument_id',
      'ticker',
      'source_year',
      'archive_sha256',
      'stored_candle_count',
      'raw_row_count',
      'invalid_row_count',
      'lot_size',
      'price_step',
      'source',
      'duplicate_row_count',
      'imported_at',
    ]);
    requireColumns(db, 'historical_minute_candles', [
      'instrument_id',
      'candle_time',
      'open',
      'high',
      'low',
      'close',
      'volume',
      'source_year',
      'source_archive_sha256',
    ]);
    const firstYear = new Date(from.epoch).getUTCFullYear(),
      lastYear = new Date(to.epoch - 1 + 3 * 60 * minuteMs).getUTCFullYear();
    const archiveQuery =
      db.prepare(`SELECT instrument_id,ticker,source_year,archive_sha256,stored_candle_count,raw_row_count,invalid_row_count,
      lot_size,price_step,source,duplicate_row_count,imported_at FROM historical_archive_imports
      WHERE ticker=? AND source_year>=? AND source_year<=? AND (? IS NULL OR instrument_id=?)
      ORDER BY source_year,instrument_id LIMIT 129`);
    archiveQuery.setReadBigInts(true);
    const imports = archiveQuery.all(
      input.ticker,
      firstYear,
      lastYear,
      input.instrumentId ?? null,
      input.instrumentId ?? null,
    ) as Row[];
    if (imports.length === 0) return fail('provenance-invalid');
    if (imports.length > 128) return fail('bound-exceeded');
    const archives = imports.map(archive),
      ids = new Set(archives.map((item) => item.instrumentId));
    if (ids.size !== 1) return fail('ambiguous-instrument');
    const instrumentId = archives[0]!.instrumentId,
      byYear = new Map<number, HistoricalArchiveProvenance>();
    for (const item of archives) {
      if (byYear.has(item.year)) return fail('provenance-invalid');
      byYear.set(item.year, item);
    }
    // Read whole boundary UTC days so differently spelled UTC timestamp aliases
    // cannot be hidden by TEXT ordering at [from,to). Still bound the SQL read.
    const broadFrom = from.iso.slice(0, 10),
      broadTo = new Date(Math.floor((to.epoch - 1) / 86_400_000) * 86_400_000 + 86_400_000)
        .toISOString()
        .slice(0, 10);
    const candleQuery =
      db.prepare(`SELECT instrument_id,candle_time,open,high,low,close,volume,source_year,source_archive_sha256
      FROM historical_minute_candles WHERE instrument_id=? AND candle_time>=? AND candle_time<? ORDER BY candle_time LIMIT ?`);
    candleQuery.setReadBigInts(true);
    const rows = candleQuery.all(instrumentId, broadFrom, broadTo, limit + 1) as Row[];
    if (rows.length > limit) return fail('bound-exceeded');
    const candles: HistoricalMinuteCandle[] = [],
      seen = new Set<number>(),
      usedCounts = new Map<number, number>(),
      days = new Map<string, ReplayDayCoverage>();
    const hash = createHash('sha256');
    hash.update(
      JSON.stringify({
        version: '1',
        ticker: input.ticker,
        instrumentId,
        from: from.iso,
        to: to.iso,
        archives,
      }) + '\n',
    );
    for (const row of rows) {
      const time = utcTime(row.candle_time);
      if (seen.has(time.epoch)) return fail('data-invalid');
      seen.add(time.epoch);
      if (time.epoch < from.epoch || time.epoch >= to.epoch) continue;
      const year = count(row.source_year),
        provenance = byYear.get(year);
      const sourceYear = new Date(
        time.epoch + (provenance?.source === 'moex' ? 3 * 60 * minuteMs : 0),
      ).getUTCFullYear();
      if (
        !provenance ||
        row.instrument_id !== instrumentId ||
        year !== sourceYear ||
        sha(row.source_archive_sha256) !== provenance.archiveSha256
      )
        return fail('provenance-invalid');
      const open = amount(row.open),
        high = amount(row.high),
        low = amount(row.low),
        close = amount(row.close);
      const volume = typeof row.volume === 'bigint' ? Number(row.volume) : row.volume;
      if (
        low > high ||
        open < low ||
        open > high ||
        close < low ||
        close > high ||
        typeof volume !== 'number' ||
        !Number.isSafeInteger(volume) ||
        volume < 0
      )
        return fail('data-invalid');
      const candle = { instrumentId, time: time.iso, open, high, low, close, volume };
      candles.push(candle);
      usedCounts.set(year, (usedCounts.get(year) ?? 0) + 1);
      hash.update(
        JSON.stringify({ candle, sourceYear: year, archiveSha256: provenance.archiveSha256 }) + '\n',
      );
      const date = new Date(time.epoch + 3 * 60 * minuteMs).toISOString().slice(0, 10),
        day = days.get(date);
      if (day) {
        day.candleCount++;
        day.lastCandleAt = time.iso;
      } else
        days.set(date, {
          date,
          candleCount: 1,
          firstCandleAt: time.iso,
          lastCandleAt: time.iso,
          missingMinutesWithinSpan: 0,
        });
    }
    candles.sort((a, b) => a.time.localeCompare(b.time));
    if (candles.length === 0) return fail('empty-range');
    for (const [year, total] of usedCounts)
      if (total > byYear.get(year)!.storedCandleCount) return fail('provenance-invalid');
    const dates = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
    for (const day of dates)
      day.missingMinutesWithinSpan =
        (Date.parse(day.lastCandleAt) - Date.parse(day.firstCandleAt)) / minuteMs + 1 - day.candleCount;
    const missingMinutesWithinSpan = dates.reduce((sum, day) => sum + day.missingMinutesWithinSpan, 0);
    const warnings = [
      'Archive lot size, price step and volume normalization are captured metadata, not proof of historical as-of instrument terms.',
      'OHLCV archives do not establish executable bid/ask depth, trading status, auction exclusion or fills.',
      'Daily gaps describe observed spans only; no exchange-calendar coverage or missing bars are inferred or filled.',
    ];
    if (missingMinutesWithinSpan > 0) warnings.push('Missing minute timestamps remain absent.');
    if (archives.some((item) => item.invalidRowCount > 0 || item.duplicateRowCount > 0))
      warnings.push('Archive import reports invalid or duplicate upstream rows.');
    db.close();
    db = undefined;
    if (JSON.stringify(sourceState(path)) !== JSON.stringify(before)) return fail('source-changed');
    return {
      candles,
      archives,
      contentSha256: hash.digest('hex'),
      coverage: {
        candleCount: candles.length,
        firstCandleAt: candles[0]!.time,
        lastCandleAt: candles.at(-1)!.time,
        dates,
        missingMinutesWithinSpan,
      },
      readOnly: true,
      provenanceEvidence: 'archive-linked',
      warnings,
    };
  } catch (error) {
    if (error instanceof ReadOnlyReplaySourceError) throw error;
    return fail('source-not-safe');
  } finally {
    db?.close();
  }
}
