import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type HistoricalMinuteCandle = {
  instrumentId: string;
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type HistoricalArchiveImport = {
  instrumentId: string;
  /** Exchange ticker captured with the archive so replay does not query today's universe. */
  ticker: string;
  year: number;
  archiveSha256: string;
  /** Instrument properties captured together with the archive for deterministic replay. */
  lotSize: number;
  priceStep: number;
  candles: HistoricalMinuteCandle[];
  rawRowCount: number;
  invalidRowCount: number;
};

export type HistoricalImportResult = {
  instrumentId: string;
  year: number;
  storedCandleCount: number;
  rawRowCount: number;
  invalidRowCount: number;
  importedAt: string;
};

export type HistoricalArchiveProvenance = HistoricalImportResult & {
  archiveSha256: string;
  /** Null only for archives imported before ticker provenance was introduced. */
  ticker: string | null;
  /** Null only for archives imported before replay metadata was introduced. */
  lotSize: number | null;
  /** Null only for archives imported before replay metadata was introduced. */
  priceStep: number | null;
};

export type HistoricalCoverage = {
  instrumentId: string;
  candleCount: number;
  firstCandleAt: string | null;
  lastCandleAt: string | null;
};

const schema = `
  CREATE TABLE IF NOT EXISTS historical_minute_candles (
    instrument_id TEXT NOT NULL,
    candle_time TEXT NOT NULL,
    open REAL NOT NULL CHECK(open > 0),
    high REAL NOT NULL CHECK(high > 0),
    low REAL NOT NULL CHECK(low > 0),
    close REAL NOT NULL CHECK(close > 0),
    volume INTEGER NOT NULL CHECK(volume >= 0),
    source_year INTEGER NOT NULL CHECK(source_year >= 2000),
    source_archive_sha256 TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    PRIMARY KEY (instrument_id, candle_time)
  ) STRICT, WITHOUT ROWID;

  CREATE INDEX IF NOT EXISTS historical_minute_candles_time
    ON historical_minute_candles(candle_time ASC);

  CREATE TABLE IF NOT EXISTS historical_archive_imports (
    instrument_id TEXT NOT NULL,
    ticker TEXT NOT NULL CHECK(ticker GLOB '[A-Z0-9.-]*'),
    source_year INTEGER NOT NULL CHECK(source_year >= 2000),
    archive_sha256 TEXT NOT NULL,
    raw_row_count INTEGER NOT NULL CHECK(raw_row_count >= 0),
    invalid_row_count INTEGER NOT NULL CHECK(invalid_row_count >= 0),
    stored_candle_count INTEGER NOT NULL CHECK(stored_candle_count >= 0),
    lot_size INTEGER CHECK(lot_size > 0),
    price_step REAL CHECK(price_step > 0),
    imported_at TEXT NOT NULL,
    PRIMARY KEY (instrument_id, source_year)
  ) STRICT, WITHOUT ROWID;
`;

type CoverageRow = {
  instrument_id: string;
  candle_count: number | bigint;
  first_candle_at: string | null;
  last_candle_at: string | null;
};

type ArchiveImportRow = {
  instrument_id: string;
  ticker: string | null;
  source_year: number | bigint;
  archive_sha256: string;
  stored_candle_count: number | bigint;
  raw_row_count: number | bigint;
  invalid_row_count: number | bigint;
  lot_size: number | bigint | null;
  price_step: number | null;
  imported_at: string;
};

type TableInfoRow = {
  name: string;
};

function assertFiniteNumber(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
}

function ensureArchiveMetadataColumns(database: DatabaseSync): void {
  const columns = new Set(
    (database.prepare('PRAGMA table_info(historical_archive_imports)').all() as TableInfoRow[]).map((row) => row.name),
  );
  if (!columns.has('lot_size')) {
    database.exec('ALTER TABLE historical_archive_imports ADD COLUMN lot_size INTEGER CHECK(lot_size > 0)');
  }
  if (!columns.has('ticker')) {
    database.exec('ALTER TABLE historical_archive_imports ADD COLUMN ticker TEXT');
  }
  if (!columns.has('price_step')) {
    database.exec('ALTER TABLE historical_archive_imports ADD COLUMN price_step REAL CHECK(price_step > 0)');
  }
}

function assertCandle(candle: HistoricalMinuteCandle, instrumentId: string): void {
  if (candle.instrumentId !== instrumentId) throw new Error('Historical candle instrumentId does not match import');
  if (Number.isNaN(new Date(candle.time).getTime())) throw new Error('Historical candle time is invalid');
  assertFiniteNumber(candle.open, 'Historical candle open');
  assertFiniteNumber(candle.high, 'Historical candle high');
  assertFiniteNumber(candle.low, 'Historical candle low');
  assertFiniteNumber(candle.close, 'Historical candle close');
  assertFiniteNumber(candle.volume, 'Historical candle volume');
  if (
    candle.open <= 0 ||
    candle.high <= 0 ||
    candle.low <= 0 ||
    candle.close <= 0 ||
    candle.high < candle.low ||
    candle.open < candle.low ||
    candle.open > candle.high ||
    candle.close < candle.low ||
    candle.close > candle.high ||
    !Number.isSafeInteger(candle.volume) ||
    candle.volume < 0
  ) {
    throw new Error('Historical candle values are invalid');
  }
}

export class MarketDataStore {
  private readonly databasePath: string;

  constructor(databasePath: string) {
    this.databasePath = resolve(databasePath);
  }

  importMinuteArchive(input: HistoricalArchiveImport): HistoricalImportResult {
    if (!input.instrumentId.trim()) throw new Error('Historical archive instrumentId is required');
    if (!/^[A-Z0-9.-]{1,16}$/.test(input.ticker)) {
      throw new Error('Historical archive ticker is invalid');
    }
    if (!Number.isInteger(input.year) || input.year < 2000) {
      throw new Error('Historical archive year is invalid');
    }
    if (!/^[a-f0-9]{64}$/i.test(input.archiveSha256)) {
      throw new Error('Historical archive SHA-256 is invalid');
    }
    if (!Number.isInteger(input.lotSize) || input.lotSize <= 0) {
      throw new Error('Historical archive lot size is invalid');
    }
    assertFiniteNumber(input.priceStep, 'Historical archive price step');
    if (input.priceStep <= 0) throw new Error('Historical archive price step is invalid');
    if (!Number.isSafeInteger(input.rawRowCount) || input.rawRowCount < 0) {
      throw new Error('Historical archive raw row count is invalid');
    }
    if (!Number.isSafeInteger(input.invalidRowCount) || input.invalidRowCount < 0) {
      throw new Error('Historical archive invalid row count is invalid');
    }
    if (input.candles.length === 0) throw new Error('Historical archive has no valid candles');

    const database = this.open();
    const importedAt = new Date().toISOString();

    try {
      const insertCandle = database.prepare(
        `INSERT INTO historical_minute_candles (
          instrument_id, candle_time, open, high, low, close, volume,
          source_year, source_archive_sha256, imported_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(instrument_id, candle_time) DO UPDATE SET
          open = excluded.open,
          high = excluded.high,
          low = excluded.low,
          close = excluded.close,
          volume = excluded.volume,
          source_year = excluded.source_year,
          source_archive_sha256 = excluded.source_archive_sha256,
          imported_at = excluded.imported_at`,
      );
      const insertImport = database.prepare(
        `INSERT INTO historical_archive_imports (
          instrument_id, ticker, source_year, archive_sha256, raw_row_count, invalid_row_count,
          stored_candle_count, lot_size, price_step, imported_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(instrument_id, source_year) DO UPDATE SET
          ticker = CASE
            WHEN historical_archive_imports.archive_sha256 = excluded.archive_sha256
              AND historical_archive_imports.ticker IS NOT NULL
            THEN historical_archive_imports.ticker
            ELSE excluded.ticker
          END,
          archive_sha256 = excluded.archive_sha256,
          raw_row_count = excluded.raw_row_count,
          invalid_row_count = excluded.invalid_row_count,
          stored_candle_count = excluded.stored_candle_count,
          -- Archive SHA identifies the market data. Keep the first captured instrument
          -- contract for an unchanged archive so a later import cannot rewrite a replay.
          lot_size = CASE
            WHEN historical_archive_imports.archive_sha256 = excluded.archive_sha256
              AND historical_archive_imports.lot_size IS NOT NULL
            THEN historical_archive_imports.lot_size
            ELSE excluded.lot_size
          END,
          price_step = CASE
            WHEN historical_archive_imports.archive_sha256 = excluded.archive_sha256
              AND historical_archive_imports.price_step IS NOT NULL
            THEN historical_archive_imports.price_step
            ELSE excluded.price_step
          END,
          imported_at = excluded.imported_at`,
      );
      const deletePriorArchive = database.prepare(
        `DELETE FROM historical_minute_candles
         WHERE instrument_id = ?
           AND source_year = ?`,
      );

      database.exec('BEGIN IMMEDIATE');
      // A renewed archive is authoritative for its full calendar year. Removing its prior
      // rows inside the same transaction prevents stale rows from surviving a correction.
      deletePriorArchive.run(input.instrumentId, input.year);
      for (const candle of input.candles) {
        assertCandle(candle, input.instrumentId);
        insertCandle.run(
          candle.instrumentId,
          candle.time,
          candle.open,
          candle.high,
          candle.low,
          candle.close,
          candle.volume,
          input.year,
          input.archiveSha256,
          importedAt,
        );
      }
      insertImport.run(
        input.instrumentId,
        input.ticker,
        input.year,
        input.archiveSha256,
        input.rawRowCount,
        input.invalidRowCount,
        input.candles.length,
        input.lotSize,
        input.priceStep,
        importedAt,
      );
      database.exec('COMMIT');

      return {
        instrumentId: input.instrumentId,
        year: input.year,
        storedCandleCount: input.candles.length,
        rawRowCount: input.rawRowCount,
        invalidRowCount: input.invalidRowCount,
        importedAt,
      };
    } catch (error) {
      try {
        database.exec('ROLLBACK');
      } catch {
        // The transaction may already be committed or never started.
      }
      throw error;
    } finally {
      database.close();
    }
  }

  getCoverage(instrumentId: string): HistoricalCoverage {
    const database = this.open();

    try {
      const row = database
        .prepare(
          `SELECT
             instrument_id,
             COUNT(*) AS candle_count,
             MIN(candle_time) AS first_candle_at,
             MAX(candle_time) AS last_candle_at
           FROM historical_minute_candles
           WHERE instrument_id = ?
           GROUP BY instrument_id`,
        )
        .get(instrumentId) as CoverageRow | undefined;

      return row
        ? {
            instrumentId: row.instrument_id,
            candleCount: Number(row.candle_count),
            firstCandleAt: row.first_candle_at,
            lastCandleAt: row.last_candle_at,
          }
        : {
            instrumentId,
            candleCount: 0,
            firstCandleAt: null,
            lastCandleAt: null,
          };
    } finally {
      database.close();
    }
  }

  getArchiveImport(instrumentId: string, year: number): HistoricalArchiveProvenance | null {
    if (!instrumentId.trim()) throw new Error('Historical archive instrumentId is required');
    if (!Number.isInteger(year) || year < 2000) throw new Error('Historical archive year is invalid');

    const database = this.open();
    try {
      const row = database
        .prepare(
          `SELECT
             instrument_id,
             ticker,
             source_year,
             archive_sha256,
             stored_candle_count,
             raw_row_count,
             invalid_row_count,
             lot_size,
             price_step,
             imported_at
           FROM historical_archive_imports
           WHERE instrument_id = ?
             AND source_year = ?`,
        )
        .get(instrumentId, year) as ArchiveImportRow | undefined;

      return row ? toArchiveProvenance(row) : null;
    } finally {
      database.close();
    }
  }

  listArchiveImports(year: number): HistoricalArchiveProvenance[] {
    if (!Number.isInteger(year) || year < 2000) throw new Error('Historical archive year is invalid');

    const database = this.open();
    try {
      const rows = database
        .prepare(
          `SELECT
             instrument_id,
             ticker,
             source_year,
             archive_sha256,
             stored_candle_count,
             raw_row_count,
             invalid_row_count,
             lot_size,
             price_step,
             imported_at
           FROM historical_archive_imports
           WHERE source_year = ?
           ORDER BY ticker ASC, instrument_id ASC`,
        )
        .all(year) as ArchiveImportRow[];
      return rows.map(toArchiveProvenance);
    } finally {
      database.close();
    }
  }

  listMinuteCandles(input: { instrumentId: string; from: string; to: string }): HistoricalMinuteCandle[] {
    const database = this.open();

    try {
      const rows = database
        .prepare(
          `SELECT instrument_id, candle_time, open, high, low, close, volume
           FROM historical_minute_candles
           WHERE instrument_id = ?
             AND candle_time >= ?
             AND candle_time < ?
           ORDER BY candle_time ASC`,
        )
        .all(input.instrumentId, input.from, input.to) as Array<{
        instrument_id: string;
        candle_time: string;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number | bigint;
      }>;

      return rows.map((row) => ({
        instrumentId: row.instrument_id,
        time: row.candle_time,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: Number(row.volume),
      }));
    } finally {
      database.close();
    }
  }

  private open(): DatabaseSync {
    const directory = dirname(this.databasePath);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);

    const database = new DatabaseSync(this.databasePath);
    chmodSync(this.databasePath, 0o600);
    database.exec('PRAGMA journal_mode = WAL;');
    database.exec(schema);
    ensureArchiveMetadataColumns(database);
    return database;
  }
}

function toArchiveProvenance(row: ArchiveImportRow): HistoricalArchiveProvenance {
  return {
    instrumentId: row.instrument_id,
    ticker: row.ticker,
    year: Number(row.source_year),
    archiveSha256: row.archive_sha256,
    storedCandleCount: Number(row.stored_candle_count),
    rawRowCount: Number(row.raw_row_count),
    invalidRowCount: Number(row.invalid_row_count),
    lotSize: row.lot_size === null ? null : Number(row.lot_size),
    priceStep: row.price_step,
    importedAt: row.imported_at,
  };
}
