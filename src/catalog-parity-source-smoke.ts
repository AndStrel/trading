import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { loadReadOnlyReplaySource, ReadOnlyReplaySourceError } from './history/read-only-replay-source.js';

function snapshotFiles(directory: string) {
  return readdirSync(directory).sort().map(name => {
    const path = join(directory, name);
    const info = statSync(path, { bigint: true });
    return {
      name,
      sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
      size: String(info.size),
      mode: String(info.mode),
      mtimeNs: String(info.mtimeNs),
      ctimeNs: String(info.ctimeNs),
    };
  });
}

// Isolated synthetic SQLite only. No original DB, .env, broker client or network.
export function runCatalogParitySourceSmoke() {
  const directory = mkdtempSync(join(tmpdir(), 'trading-catalog-source-smoke-'));
  try {
    const path = join(directory, 'source ? # % with spaces.sqlite');
    const archiveSha = 'a'.repeat(64);
    const from = '2025-08-01T07:00:00.000Z';
    const to = '2025-08-01T07:05:00.000Z';
    const fixture = new DatabaseSync(path);
    try {
      fixture.exec(`PRAGMA journal_mode=WAL;
        CREATE TABLE historical_archive_imports (
          instrument_id TEXT,ticker TEXT,source_year INTEGER,archive_sha256 TEXT,stored_candle_count INTEGER,
          raw_row_count INTEGER,invalid_row_count INTEGER,lot_size INTEGER,price_step REAL,source TEXT,
          duplicate_row_count INTEGER,imported_at TEXT);
        CREATE TABLE historical_minute_candles (
          instrument_id TEXT,candle_time TEXT,open REAL,high REAL,low REAL,close REAL,volume INTEGER,
          source_year INTEGER,source_archive_sha256 TEXT);`);
      fixture.prepare('INSERT INTO historical_archive_imports VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(
        'synthetic-source', 'SBER', 2025, archiveSha, 1, 1, 0, 1, 0.01, 'moex', 0, '2026-10-03T08:00:00.123Z',
      );
      fixture.prepare('INSERT INTO historical_minute_candles VALUES (?,?,?,?,?,?,?,?,?)').run(
        'synthetic-source', from, 100, 101, 99, 100.5, 100, 2025, archiveSha,
      );
    } finally {
      fixture.close();
    }
    assert.deepEqual([...readFileSync(path).subarray(18, 20)], [2, 2]);
    assert.equal(existsSync(path + '-wal'), false);
    assert.equal(existsSync(path + '-shm'), false);
    const before = snapshotFiles(directory);
    const input = { databasePath: path, ticker: 'SBER', from, to };
    const result = loadReadOnlyReplaySource(input);
    assert.equal(result.readOnly, true);
    assert.equal(result.provenanceEvidence, 'archive-linked');
    assert.equal(result.candles.length, 1);
    assert.equal(result.candles[0]?.time, from);
    assert.equal(result.archives[0]?.archiveSha256, archiveSha);
    assert.equal(result.archives[0]?.importedAt, '2026-10-03T08:00:00.123Z');
    assert.match(result.contentSha256, /^[a-f0-9]{64}$/);
    assert.equal(loadReadOnlyReplaySource(input).contentSha256, result.contentSha256);
    assert.deepEqual(snapshotFiles(directory), before);

    const missing = join(directory, 'missing', 'missing.sqlite');
    assert.throws(() => loadReadOnlyReplaySource({ ...input, databasePath: missing }), error =>
      error instanceof ReadOnlyReplaySourceError && error.code === 'source-not-safe',
    );
    assert.equal(existsSync(join(directory, 'missing')), false);
    assert.deepEqual(snapshotFiles(directory), before);
    for (const suffix of ['-wal', '-shm', '-journal']) {
      const marker = path + suffix;
      writeFileSync(marker, 'synthetic-writer-marker');
      const guarded = snapshotFiles(directory);
      assert.throws(() => loadReadOnlyReplaySource(input), error =>
        error instanceof ReadOnlyReplaySourceError && error.code === 'source-not-safe',
      );
      assert.deepEqual(snapshotFiles(directory), guarded);
      rmSync(marker); // Only our synthetic marker inside the unique temporary fixture.
    }
    assert.deepEqual(snapshotFiles(directory), before);
    return {
      status: 'verified' as const,
      synthetic: true,
      brokerRequests: 0,
      immutableWalRead: true,
      sourceUnchanged: true,
      missingFileNotCreated: true,
      nonemptySidecarsRejected: true,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  try {
    process.stdout.write(JSON.stringify(runCatalogParitySourceSmoke()) + '\n');
  } catch {
    process.stderr.write('Synthetic read-only catalogue source verification failed.\n');
    process.exitCode = 1;
  }
}
