import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { priceToNano } from '../domain/price-tick.js';
import type { HistoricalArchiveProvenance, HistoricalMinuteCandle } from './market-data-store.js';
import { loadReadOnlyReplaySource, type ReadOnlyReplaySource } from './read-only-replay-source.js';

export const FROZEN_MOEX_MINUTE_SOURCE = Object.freeze({
  version: '1',
  ticker: 'SBER',
  instrumentId: 'MOEX:TQBR:SBER',
  board: 'TQBR',
  interval: 1,
  from: '2025-08-01T00:00:00.000Z',
  to: '2026-09-27T00:00:00.000Z',
  lotSize: 1,
  priceStep: 0.01,
  datedMetadataEvidence: 'https://www.moex.com/n92172',
  lotSizeEffectiveFrom: '2025-08-01',
});

const origin = 'https://iss.moex.com';
const pathname = '/iss/engines/stock/markets/shares/boards/TQBR/securities/SBER/candles.json';
const minuteMs = 60_000,
  moscowOffsetMs = 3 * 60 * minuteMs,
  tickNano = 10_000_000n;
const fromMs = Date.parse(FROZEN_MOEX_MINUTE_SOURCE.from),
  toMs = Date.parse(FROZEN_MOEX_MINUTE_SOURCE.to);
const years = [2025, 2026] as const;
const ceilings = {
  maxPages: 2_000,
  maxRows: 1_000_000,
  maxPageBytes: 2 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
  maxElapsedMs: 15 * 60 * 1_000,
  requestTimeoutMs: 30_000,
};
export type FrozenMoexCaptureLimits = Partial<typeof ceilings>;
export type FrozenMoexCaptureProgress = {
  phase: 'capture' | 'database' | 'verified';
  year: number | null;
  pages: number;
  rows: number;
  bytes: number;
};
export type FrozenMoexMinuteCaptureInput = {
  outputDirectory: string;
  fetchImpl?: typeof fetch;
  limits?: FrozenMoexCaptureLimits;
  clock?: { now: () => Date; monotonic: () => number };
  sleep?: (milliseconds: number) => Promise<void>;
  onProgress?: (progress: FrozenMoexCaptureProgress) => void;
};
export type FrozenMoexMinuteCaptureResult = {
  databasePath: string;
  manifestPath: string;
  archives: HistoricalArchiveProvenance[];
  contentSha256: string;
  coverage: ReadOnlyReplaySource['coverage'];
  sourceKind: 'moex-public-frozen-pages-v1';
  researchOnly: true;
  admission: false;
  counts: {
    pages: number;
    rawRows: number;
    storedRows: number;
    bytes: number;
    excludedBeforeFrom: number;
    excludedAtOrAfterTo: number;
  };
};
type Failure =
  | 'invalid-input'
  | 'output-exists'
  | 'unsafe-output'
  | 'http-error'
  | 'transport-error'
  | 'schema-invalid'
  | 'data-invalid'
  | 'page-bound'
  | 'row-bound'
  | 'byte-bound'
  | 'time-bound'
  | 'clock-invalid'
  | 'empty-year'
  | 'capture-changed'
  | 'database-invalid'
  | 'io-error';
export class FrozenMoexCaptureError extends Error {
  constructor(readonly code: Failure) {
    super('Frozen public MOEX capture: ' + code + '; not finalized');
  }
}
const fail = (code: Failure): never => {
  throw new FrozenMoexCaptureError(code);
};
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2) + '\n');
type Counts = { pages: number; rows: number; bytes: number };
type Page = {
  file: string;
  bodySha256: string;
  bytes: number;
  requestStartedAtUtc: string;
  receivedAtUtc: string;
  request: { method: 'GET'; origin: string; pathname: string; query: Record<string, string> };
  status: 200;
  start: number;
  rows: number;
  terminal: boolean;
};
type YearCapture = {
  year: number;
  pages: Page[];
  rawRows: number;
  storedRows: number;
  excludedBeforeFrom: number;
  excludedAtOrAfterTo: number;
  manifestFile: string;
  archiveSha256: string;
  importedAt: string;
};

type OwnedFile = { dev: number; ino: number; size: number };
function privateFile(path: string, bytes: Uint8Array, files: Map<string, OwnedFile>): void {
  const fd = openSync(path, 'wx', 0o600);
  try {
    // Record ownership even if a later write/fsync fails, for bounded final-marker cleanup.
    const created = fstatSync(fd);
    files.set(path, { dev: created.dev, ino: created.ino, size: bytes.byteLength });
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function readOwnedFile(path: string, files: Map<string, OwnedFile>, maximum: number): Buffer {
  const expected = files.get(path);
  if (!expected || expected.size > maximum) return fail('capture-changed');
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    return fail('capture-changed');
  }
  try {
    const state = fstatSync(fd);
    if (
      !state.isFile() ||
      state.dev !== expected.dev ||
      state.ino !== expected.ino ||
      state.size !== expected.size ||
      (state.mode & 0o777) !== 0o600
    )
      return fail('capture-changed');
    const body = Buffer.alloc(expected.size);
    let offset = 0;
    while (offset < body.byteLength) {
      const read = readSync(fd, body, offset, body.byteLength - offset, offset);
      if (read === 0) return fail('capture-changed');
      offset += read;
    }
    const after = fstatSync(fd),
      pathState = lstatSync(path);
    if (
      after.size !== state.size ||
      after.mtimeMs !== state.mtimeMs ||
      after.ctimeMs !== state.ctimeMs ||
      pathState.isSymbolicLink() ||
      pathState.dev !== state.dev ||
      pathState.ino !== state.ino
    )
      return fail('capture-changed');
    return body;
  } finally {
    closeSync(fd);
  }
}
function removeOwnedFile(path: string, files: Map<string, OwnedFile>): void {
  const expected = files.get(path);
  if (!expected) return;
  const state = lstatSync(path);
  if (state.isFile() && state.dev === expected.dev && state.ino === expected.ino) unlinkSync(path);
}
function localTime(value: unknown): { epoch: number; year: number; second: number } {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(value))
    return fail('data-invalid');
  const canonical = value.replace(' ', 'T'),
    local = Date.parse(canonical + 'Z');
  if (!Number.isFinite(local) || new Date(local).toISOString().slice(0, 19) !== canonical)
    return fail('data-invalid');
  return { epoch: local - moscowOffsetMs, year: Number(value.slice(0, 4)), second: Number(value.slice(-2)) };
}
function parsePage(body: Uint8Array, year: number): HistoricalMinuteCandle[] {
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
  } catch {
    return fail('schema-invalid');
  }
  const block = (payload as { candles?: { columns?: unknown; data?: unknown } } | null)?.candles;
  if (!block || !Array.isArray(block.columns) || !Array.isArray(block.data)) return fail('schema-invalid');
  const required = ['open', 'close', 'high', 'low', 'volume', 'begin', 'end'];
  const columns = block.columns.map((x: unknown) => (typeof x === 'string' ? x.toLowerCase() : ''));
  if (
    columns.length !== required.length ||
    new Set(columns).size !== columns.length ||
    required.some((x) => !columns.includes(x))
  )
    return fail('schema-invalid');
  const index = Object.fromEntries(required.map((x) => [x, columns.indexOf(x)]));
  return block.data.map((row: unknown) => {
    if (!Array.isArray(row) || row.length !== columns.length) return fail('schema-invalid');
    const begin = localTime(row[index.begin!]),
      end = localTime(row[index.end!]);
    const requestFrom = localTime(year === 2025 ? '2025-08-01 00:00:00' : '2026-01-01 00:00:00').epoch;
    const requestTo = localTime(year === 2025 ? '2025-12-31 23:59:59' : '2026-09-27 23:59:59').epoch;
    if (
      begin.year !== year ||
      end.year !== year ||
      begin.second !== 0 ||
      end.second !== 59 ||
      end.epoch - begin.epoch !== 59_000 ||
      begin.epoch < requestFrom ||
      end.epoch > requestTo
    )
      return fail('data-invalid');
    const amount = (key: string): number => {
      const value: unknown = row[index[key]!];
      if (typeof value !== 'number') return fail('data-invalid');
      try {
        if (priceToNano(value) % tickNano !== 0n) return fail('data-invalid');
      } catch {
        return fail('data-invalid');
      }
      return value;
    };
    const open = amount('open'),
      close = amount('close'),
      high = amount('high'),
      low = amount('low');
    const volume: unknown = row[index.volume!];
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
    return {
      instrumentId: FROZEN_MOEX_MINUTE_SOURCE.instrumentId,
      time: new Date(begin.epoch).toISOString(),
      open,
      close,
      high,
      low,
      volume,
    };
  });
}
function query(year: number, start: number): Record<string, string> {
  return {
    'iss.meta': 'off',
    'iss.only': 'candles',
    'candles.columns': 'open,close,high,low,volume,begin,end',
    interval: '1',
    from: year === 2025 ? '2025-08-01 00:00:00' : '2026-01-01 00:00:00',
    till: year === 2025 ? '2025-12-31 23:59:59' : '2026-09-27 23:59:59',
    start: String(start),
  };
}
function assertNoSidecars(databasePath: string): void {
  for (const suffix of ['-wal', '-shm', '-journal']) {
    try {
      // lstat sees dangling symlinks too; existence must match the immutable loader's guard.
      lstatSync(databasePath + suffix);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      return fail('database-invalid');
    }
    return fail('database-invalid');
  }
}
function limitsFor(input: FrozenMoexCaptureLimits | undefined): typeof ceilings {
  if (input && Object.keys(input).some((key) => !(key in ceilings))) return fail('invalid-input');
  const result = { ...ceilings, ...input };
  for (const key of Object.keys(ceilings) as (keyof typeof ceilings)[])
    if (!Number.isSafeInteger(result[key]) || result[key] <= 0 || result[key] > ceilings[key])
      return fail('invalid-input');
  return result;
}
const schema = [
  'CREATE TABLE historical_archive_imports (instrument_id TEXT NOT NULL,ticker TEXT NOT NULL,source_year INTEGER NOT NULL,',
  'archive_sha256 TEXT NOT NULL,stored_candle_count INTEGER NOT NULL,raw_row_count INTEGER NOT NULL,invalid_row_count INTEGER NOT NULL,',
  'lot_size INTEGER NOT NULL,price_step REAL NOT NULL,source TEXT NOT NULL,duplicate_row_count INTEGER NOT NULL,imported_at TEXT NOT NULL,',
  'PRIMARY KEY(instrument_id,source_year)) STRICT, WITHOUT ROWID;',
  'CREATE TABLE historical_minute_candles (instrument_id TEXT NOT NULL,candle_time TEXT NOT NULL,',
  'open REAL NOT NULL,high REAL NOT NULL,low REAL NOT NULL,close REAL NOT NULL,volume INTEGER NOT NULL,',
  'source_year INTEGER NOT NULL,source_archive_sha256 TEXT NOT NULL,imported_at TEXT NOT NULL,',
  'PRIMARY KEY(instrument_id,candle_time)) STRICT, WITHOUT ROWID;',
].join('\n');

/** Creates only a fresh public capture. Importing this module performs no I/O.
 * Historical gaps remain absent; READY means source verification, never trading admission.
 */
export async function captureFrozenMoexMinuteSource(
  input: FrozenMoexMinuteCaptureInput,
): Promise<FrozenMoexMinuteCaptureResult> {
  let database: DatabaseSync | undefined, directory: string | undefined;
  const ownedFiles = new Map<string, OwnedFile>();
  const counts: Counts = { pages: 0, rows: 0, bytes: 0 };
  try {
    const limits = limitsFor(input.limits);
    if (
      typeof input.outputDirectory !== 'string' ||
      !isAbsolute(input.outputDirectory) ||
      input.outputDirectory.length > 4096 ||
      input.outputDirectory.includes('\0')
    )
      return fail('invalid-input');
    const clock = input.clock ?? { now: () => new Date(), monotonic: () => performance.now() };
    const started = clock.monotonic();
    let lastClock = started;
    if (!Number.isFinite(started)) return fail('clock-invalid');
    const now = () => {
      const date = clock.now();
      if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return fail('clock-invalid');
      return date.toISOString();
    };
    const capturedAtUtc = now();
    if (Date.parse(capturedAtUtc) < toMs) return fail('invalid-input');
    const guardTime = () => {
      const value = clock.monotonic();
      if (!Number.isFinite(value) || value < lastClock) return fail('clock-invalid');
      lastClock = value;
      if (value - started >= limits.maxElapsedMs) return fail('time-bound');
      return limits.maxElapsedMs - (value - started);
    };
    const progress = (phase: FrozenMoexCaptureProgress['phase'], year: number | null) => {
      // Progress observers cannot change source verification or leak their errors.
      try {
        input.onProgress?.({ phase, year, ...counts });
      } catch {
        /* counts-only best effort */
      }
    };
    const requested = resolve(input.outputDirectory),
      parent = realpathSync(dirname(requested));
    if (!lstatSync(parent).isDirectory()) return fail('unsafe-output');
    const candidate = join(parent, basename(requested));
    try {
      mkdirSync(candidate, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return fail('output-exists');
      return fail('unsafe-output');
    }
    directory = candidate;
    const owned = lstatSync(directory);
    if (!owned.isDirectory() || (owned.mode & 0o777) !== 0o700) return fail('unsafe-output');
    privateFile(
      join(directory, 'INCOMPLETE.json'),
      jsonBytes({ version: '1', finalized: false, researchOnly: true, admission: false }),
      ownedFiles,
    );
    const fetchImpl = input.fetchImpl ?? fetch,
      sleep = input.sleep ?? ((ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms)));
    const captures: YearCapture[] = [];
    let lastTimestamp = -Infinity;
    for (const year of years) {
      mkdirSync(join(directory, 'raw-' + year), { mode: 0o700 });
      const capture: YearCapture = {
        year,
        pages: [],
        rawRows: 0,
        storedRows: 0,
        excludedBeforeFrom: 0,
        excludedAtOrAfterTo: 0,
        manifestFile: 'year-' + year + '.manifest.json',
        archiveSha256: '',
        importedAt: '',
      };
      let start = 0;
      for (;;) {
        const remaining = guardTime();
        if (counts.pages >= limits.maxPages) return fail('page-bound');
        const parameters = query(year, start),
          url = new URL(pathname, origin);
        for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
        const request = { method: 'GET' as const, origin, pathname, query: parameters };
        const requestStartedAtUtc = now();
        let response: Response;
        try {
          response = await fetchImpl(url, {
            method: 'GET',
            redirect: 'error',
            headers: {
              Accept: 'application/json',
              'Accept-Encoding': 'identity',
              'User-Agent': 'AndStrel.trading-public-minute-capture',
            },
            signal: AbortSignal.timeout(
              Math.max(1, Math.min(limits.requestTimeoutMs, Math.floor(remaining))),
            ),
          });
        } catch {
          return fail('transport-error');
        }
        guardTime();
        if (response.status !== 200 || response.redirected || (response.url && response.url !== url.href))
          return fail('http-error');
        if (!response.body) return fail('schema-invalid');
        const reader = response.body.getReader(),
          chunks: Buffer[] = [];
        let pageBytes = 0;
        try {
          for (;;) {
            const chunk = await reader.read();
            guardTime();
            if (chunk.done) break;
            pageBytes += chunk.value.byteLength;
            counts.bytes += chunk.value.byteLength;
            if (pageBytes > limits.maxPageBytes || counts.bytes > limits.maxTotalBytes)
              return fail('byte-bound');
            chunks.push(Buffer.from(chunk.value));
          }
        } catch (error) {
          try {
            await reader.cancel();
          } catch {
            /* no additional requests */
          }
          if (error instanceof FrozenMoexCaptureError) throw error;
          return fail('transport-error');
        } finally {
          reader.releaseLock();
        }
        const receivedAtUtc = now();
        const body = Buffer.concat(chunks),
          file = 'raw-' + year + '/page-' + String(capture.pages.length).padStart(4, '0') + '.json';
        privateFile(join(directory, file), body, ownedFiles);
        const candles = parsePage(body, year);
        if (counts.rows + candles.length > limits.maxRows) return fail('row-bound');
        for (const candle of candles) {
          const epoch = Date.parse(candle.time);
          if (epoch <= lastTimestamp) return fail('data-invalid');
          lastTimestamp = epoch;
          if (epoch < fromMs) capture.excludedBeforeFrom++;
          else if (epoch >= toMs) capture.excludedAtOrAfterTo++;
          else capture.storedRows++;
        }
        counts.pages++;
        counts.rows += candles.length;
        capture.rawRows += candles.length;
        capture.pages.push({
          file,
          bodySha256: sha(body),
          bytes: body.byteLength,
          requestStartedAtUtc,
          receivedAtUtc,
          request,
          status: 200,
          start,
          rows: candles.length,
          terminal: candles.length === 0,
        });
        progress('capture', year);
        if (candles.length === 0) break;
        start += candles.length;
        await sleep(150);
        guardTime();
      }
      if (capture.storedRows === 0) return fail('empty-year');
      capture.importedAt = now();
      const bytes = jsonBytes({
        version: '1',
        kind: 'moex-public-window-page-bundle',
        officialAnnualArchive: false,
        bodyRepresentation: 'fetch-response-entity-bytes-before-json-parse',
        source: FROZEN_MOEX_MINUTE_SOURCE,
        sourceYearMoscow: year,
        importedAt: capture.importedAt,
        rawRows: capture.rawRows,
        storedRows: capture.storedRows,
        excludedBeforeFrom: capture.excludedBeforeFrom,
        excludedAtOrAfterTo: capture.excludedAtOrAfterTo,
        terminalEmptyPageCaptured: true,
        pages: capture.pages,
      });
      privateFile(join(directory, capture.manifestFile), bytes, ownedFiles);
      capture.archiveSha256 = sha(bytes);
      captures.push(capture);
    }
    guardTime();
    const temporaryDatabasePath = join(directory, 'history.partial.sqlite'),
      databasePath = join(directory, 'history.sqlite');
    privateFile(temporaryDatabasePath, new Uint8Array(), ownedFiles);
    const uri = pathToFileURL(temporaryDatabasePath);
    uri.search = '?mode=rw';
    database = new DatabaseSync(uri.href);
    database.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;');
    database.exec(schema);
    database.exec('BEGIN IMMEDIATE');
    const insertArchive = database.prepare(
      'INSERT INTO historical_archive_imports VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    );
    const insertCandle = database.prepare(
      'INSERT INTO historical_minute_candles VALUES (?,?,?,?,?,?,?,?,?,?)',
    );
    lastTimestamp = -Infinity;
    for (const capture of captures) {
      guardTime();
      const manifestBytes = readOwnedFile(
        join(directory, capture.manifestFile),
        ownedFiles,
        limits.maxTotalBytes,
      );
      if (sha(manifestBytes) !== capture.archiveSha256) return fail('capture-changed');
      insertArchive.run(
        FROZEN_MOEX_MINUTE_SOURCE.instrumentId,
        'SBER',
        capture.year,
        capture.archiveSha256,
        capture.storedRows,
        capture.rawRows,
        0,
        1,
        0.01,
        'moex',
        0,
        capture.importedAt,
      );
      for (const page of capture.pages) {
        const body = readOwnedFile(join(directory, page.file), ownedFiles, limits.maxPageBytes);
        if (sha(body) !== page.bodySha256) return fail('capture-changed');
        for (const candle of parsePage(body, capture.year)) {
          const epoch = Date.parse(candle.time);
          if (epoch <= lastTimestamp) return fail('capture-changed');
          lastTimestamp = epoch;
          if (epoch < fromMs || epoch >= toMs) continue;
          insertCandle.run(
            candle.instrumentId,
            candle.time,
            candle.open,
            candle.high,
            candle.low,
            candle.close,
            candle.volume,
            capture.year,
            capture.archiveSha256,
            capture.importedAt,
          );
        }
        guardTime();
      }
      progress('database', capture.year);
    }
    database.exec('COMMIT');
    const checked = database.prepare('PRAGMA quick_check').get();
    if (!checked || Object.values(checked)[0] !== 'ok') return fail('database-invalid');
    const tables = database.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all();
    if (
      JSON.stringify(tables.map((row) => row.name)) !==
      JSON.stringify(['historical_archive_imports', 'historical_minute_candles'])
    )
      return fail('database-invalid');
    database.close();
    database = undefined;
    assertNoSidecars(temporaryDatabasePath);
    guardTime();
    const verified = loadReadOnlyReplaySource({
      databasePath: temporaryDatabasePath,
      ticker: 'SBER',
      instrumentId: FROZEN_MOEX_MINUTE_SOURCE.instrumentId,
      from: FROZEN_MOEX_MINUTE_SOURCE.from,
      to: FROZEN_MOEX_MINUTE_SOURCE.to,
      maxCandles: limits.maxRows,
    });
    const verifiedDatabaseState = lstatSync(temporaryDatabasePath, { bigint: true });
    const originalDatabaseIdentity = ownedFiles.get(temporaryDatabasePath)!;
    if (
      !verifiedDatabaseState.isFile() ||
      verifiedDatabaseState.dev !== BigInt(originalDatabaseIdentity.dev) ||
      verifiedDatabaseState.ino !== BigInt(originalDatabaseIdentity.ino) ||
      (verifiedDatabaseState.mode & 0o777n) !== 0o600n
    )
      return fail('capture-changed');
    const storedRows = captures.reduce((sum, c) => sum + c.storedRows, 0);
    if (verified.candles.length !== storedRows) return fail('database-invalid');
    const result: FrozenMoexMinuteCaptureResult = {
      databasePath,
      manifestPath: join(directory, 'capture.manifest.json'),
      archives: verified.archives,
      contentSha256: verified.contentSha256,
      coverage: verified.coverage,
      sourceKind: 'moex-public-frozen-pages-v1',
      researchOnly: true,
      admission: false,
      counts: {
        pages: counts.pages,
        rawRows: counts.rows,
        storedRows,
        bytes: counts.bytes,
        excludedBeforeFrom: captures.reduce((sum, c) => sum + c.excludedBeforeFrom, 0),
        excludedAtOrAfterTo: captures.reduce((sum, c) => sum + c.excludedAtOrAfterTo, 0),
      },
    };
    privateFile(
      result.manifestPath,
      jsonBytes({
        version: '1',
        source: FROZEN_MOEX_MINUTE_SOURCE,
        sourceKind: result.sourceKind,
        researchOnly: true,
        admission: false,
        capturedAtUtc,
        finalizedAtUtc: now(),
        counts: result.counts,
        contentSha256: result.contentSha256,
        coverage: result.coverage,
        archives: captures.map((c) => ({ year: c.year, file: c.manifestFile, sha256: c.archiveSha256 })),
        exchangeCalendarCoverageProven: false,
        executablePricesProven: false,
        historicalMetadataIsDatedAssumption: true,
        missingMinutesFilled: false,
      }),
      ownedFiles,
    );
    const manifestSha256 = sha(readOwnedFile(result.manifestPath, ownedFiles, limits.maxTotalBytes));
    // Observer work remains inside the cooperative elapsed budget, before final publication.
    progress('verified', null);
    guardTime();
    // This is the final observer boundary. Recheck every persisted provenance byte after it.
    for (const capture of captures) {
      if (
        sha(readOwnedFile(join(directory, capture.manifestFile), ownedFiles, limits.maxTotalBytes)) !==
        capture.archiveSha256
      )
        return fail('capture-changed');
      for (const page of capture.pages) {
        if (
          sha(readOwnedFile(join(directory, page.file), ownedFiles, limits.maxPageBytes)) !== page.bodySha256
        )
          return fail('capture-changed');
        guardTime();
      }
    }
    if (sha(readOwnedFile(result.manifestPath, ownedFiles, limits.maxTotalBytes)) !== manifestSha256)
      return fail('capture-changed');
    const currentDatabaseState = lstatSync(temporaryDatabasePath, { bigint: true });
    if (
      !currentDatabaseState.isFile() ||
      currentDatabaseState.dev !== verifiedDatabaseState.dev ||
      currentDatabaseState.ino !== verifiedDatabaseState.ino ||
      currentDatabaseState.size !== verifiedDatabaseState.size ||
      currentDatabaseState.mtimeNs !== verifiedDatabaseState.mtimeNs ||
      currentDatabaseState.ctimeNs !== verifiedDatabaseState.ctimeNs ||
      currentDatabaseState.mode !== verifiedDatabaseState.mode
    )
      return fail('capture-changed');
    guardTime();
    assertNoSidecars(temporaryDatabasePath);
    assertNoSidecars(databasePath);
    // link is atomic and fails if the final name exists; rename would overwrite it.
    linkSync(temporaryDatabasePath, databasePath);
    guardTime();
    unlinkSync(temporaryDatabasePath);
    guardTime();
    assertNoSidecars(databasePath);
    privateFile(
      join(directory, 'READY.json'),
      jsonBytes({
        version: '1',
        finalized: true,
        admission: false,
        databaseFile: 'history.sqlite',
        manifestFile: 'capture.manifest.json',
        manifestSha256,
      }),
      ownedFiles,
    );
    guardTime();
    removeOwnedFile(join(directory, 'INCOMPLETE.json'), ownedFiles);
    guardTime();
    assertNoSidecars(databasePath);
    guardTime();
    return result;
  } catch (error) {
    if (database) {
      try {
        database.exec('ROLLBACK');
      } catch {
        /* may already be committed */
      }
      try {
        database.close();
      } catch {
        /* preserve incomplete public capture */
      }
    }
    if (directory) {
      // Never remove another attempt's final marker or any public source/database evidence.
      try {
        removeOwnedFile(join(directory, 'READY.json'), ownedFiles);
      } catch {
        /* best effort owned cleanup */
      }
      try {
        const marker = join(directory, 'INCOMPLETE.json');
        if (!existsSync(marker))
          privateFile(
            marker,
            jsonBytes({ version: '1', finalized: false, researchOnly: true, admission: false }),
            ownedFiles,
          );
      } catch {
        /* preserve evidence even when marker I/O itself fails */
      }
    }
    // Do not clean up source evidence or silently resume a partial capture.
    if (error instanceof FrozenMoexCaptureError) throw error;
    return fail('io-error');
  }
}
