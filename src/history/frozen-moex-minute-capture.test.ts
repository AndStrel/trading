import { createHash } from 'node:crypto';
import {
  appendFileSync,
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  captureFrozenMoexMinuteSource,
  FROZEN_MOEX_MINUTE_SOURCE,
  FrozenMoexCaptureError,
  type FrozenMoexMinuteCaptureInput,
} from './frozen-moex-minute-capture.js';
import { loadReadOnlyReplaySource } from './read-only-replay-source.js';

const directories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const columns = ['open', 'close', 'high', 'low', 'volume', 'begin', 'end'];
type CandleRow = (string | number)[];
function row(
  begin: string,
  changes: Partial<Record<(typeof columns)[number], string | number>> = {},
): CandleRow {
  const values: Record<string, string | number> = {
    open: 100,
    close: 100.5,
    high: 101,
    low: 99,
    volume: 100,
    begin,
    end: begin.slice(0, -2) + '59',
    ...changes,
  };
  return columns.map((key) => values[key]!);
}
const empty = () => new Response(JSON.stringify({ candles: { columns, data: [] } }));
const response = (rows: CandleRow[]) =>
  new Response(JSON.stringify({ candles: { columns, data: rows } }, null, 3) + '\n');
function fixture(
  options: {
    pages2025?: CandleRow[][];
    pages2026?: CandleRow[][];
    responseAt?: (call: number, url: URL) => Response | Promise<Response>;
  } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), 'trading-frozen-moex-'));
  directories.push(directory);
  const output = join(directory, 'new public ? # % capture');
  const pages = {
    2025: options.pages2025 ?? [
      [row('2025-08-01 02:59:00'), row('2025-08-01 03:00:00'), row('2025-08-01 03:02:00')],
    ],
    2026: options.pages2026 ?? [
      [row('2026-01-01 00:00:00'), row('2026-09-27 02:59:00'), row('2026-09-27 03:00:00')],
    ],
  };
  const indexes = { 2025: 0, 2026: 0 },
    requests: { url: URL; init: RequestInit | undefined }[] = [];
  let elapsed = 0;
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    requests.push({ url, init });
    if (options.responseAt) return options.responseAt(requests.length, url);
    const year = Number(url.searchParams.get('from')?.slice(0, 4)) as 2025 | 2026;
    const rows = pages[year][indexes[year]++];
    return rows ? response(rows) : empty();
  });
  const input: FrozenMoexMinuteCaptureInput = {
    outputDirectory: output,
    fetchImpl: fetchImpl as typeof fetch,
    clock: { now: () => new Date('2026-10-03T12:00:00.123Z'), monotonic: () => elapsed },
    sleep: async () => undefined,
  };
  return {
    directory,
    output,
    input,
    requests,
    fetchImpl,
    setElapsed: (value: number) => {
      elapsed = value;
    },
  };
}
async function rejects(input: FrozenMoexMinuteCaptureInput, code: string) {
  try {
    await captureFrozenMoexMinuteSource(input);
    throw new Error('expected capture refusal');
  } catch (error) {
    expect(error).toBeInstanceOf(FrozenMoexCaptureError);
    expect((error as FrozenMoexCaptureError).code).toBe(code);
    expect(String(error)).not.toContain('SECRET-MARKER');
  }
  expect(existsSync(join(input.outputDirectory, 'READY.json'))).toBe(false);
}
function readJson(path: string) {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, any>;
}

describe('Frozen public SBER minute capture', () => {
  it('preserves raw bytes, links real year manifests, filters UTC tails and verifies through immutable loader', async () => {
    const f = fixture(),
      progress: Record<string, unknown>[] = [];
    const result = await captureFrozenMoexMinuteSource({
      ...f.input,
      onProgress: (value) => progress.push(value),
    });
    expect(result).toMatchObject({
      sourceKind: 'moex-public-frozen-pages-v1',
      researchOnly: true,
      admission: false,
      counts: { pages: 4, rawRows: 6, storedRows: 4, excludedBeforeFrom: 1, excludedAtOrAfterTo: 1 },
    });
    expect(result.coverage.firstCandleAt).toBe('2025-08-01T00:00:00.000Z');
    expect(result.coverage.lastCandleAt).toBe('2026-09-26T23:59:00.000Z');
    expect(result.coverage.missingMinutesWithinSpan).toBe(1);
    const loaded = loadReadOnlyReplaySource({
      databasePath: result.databasePath,
      ticker: 'SBER',
      from: FROZEN_MOEX_MINUTE_SOURCE.from,
      to: FROZEN_MOEX_MINUTE_SOURCE.to,
    });
    expect(loaded.contentSha256).toBe(result.contentSha256);
    expect(loaded.candles.map((c) => c.time)).toContain('2025-12-31T21:00:00.000Z');
    for (const year of [2025, 2026]) {
      const manifestPath = join(f.output, 'year-' + year + '.manifest.json'),
        manifest = readJson(manifestPath);
      expect(result.archives.find((a) => a.year === year)?.archiveSha256).toBe(
        hash(readFileSync(manifestPath)),
      );
      expect(manifest).toMatchObject({
        officialAnnualArchive: false,
        sourceYearMoscow: year,
        source: { lotSize: 1, priceStep: 0.01 },
        terminalEmptyPageCaptured: true,
      });
      expect(manifest.pages[0]).toMatchObject({
        requestStartedAtUtc: '2026-10-03T12:00:00.123Z',
        receivedAtUtc: '2026-10-03T12:00:00.123Z',
      });
      expect(manifest.pages[0]).not.toHaveProperty('fetchedAtUtc');
      const raw = readFileSync(join(f.output, manifest.pages[0].file));
      expect(hash(raw)).toBe(manifest.pages[0].bodySha256);
      expect(raw.toString()).toBe(
        await response(
          year === 2025
            ? [row('2025-08-01 02:59:00'), row('2025-08-01 03:00:00'), row('2025-08-01 03:02:00')]
            : [row('2026-01-01 00:00:00'), row('2026-09-27 02:59:00'), row('2026-09-27 03:00:00')],
        ).text(),
      );
      expect(manifest.pages.at(-1).terminal).toBe(true);
    }
    const ready = readJson(join(f.output, 'READY.json'));
    expect(ready).toMatchObject({ finalized: true, admission: false });
    expect(ready.manifestSha256).toBe(hash(readFileSync(result.manifestPath)));
    expect(existsSync(join(f.output, 'INCOMPLETE.json'))).toBe(false);
    expect(existsSync(join(f.output, 'history.partial.sqlite'))).toBe(false);
    const db = new DatabaseSync(result.databasePath, { readOnly: true });
    try {
      expect(
        db
          .prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name")
          .all()
          .map((r) => r.name),
      ).toEqual(['historical_archive_imports', 'historical_minute_candles']);
      expect(Object.values(db.prepare('PRAGMA journal_mode').get()!)).toEqual(['delete']);
      expect(
        db
          .prepare('SELECT source_year FROM historical_minute_candles WHERE candle_time=?')
          .get('2025-12-31T21:00:00.000Z'),
      ).toMatchObject({ source_year: 2026 });
    } finally {
      db.close();
    }
    for (const suffix of ['-wal', '-shm', '-journal'])
      expect(existsSync(result.databasePath + suffix)).toBe(false);
    expect(readFileSync(result.databasePath).subarray(18, 20)).toEqual(Buffer.from([1, 1]));
    expect(lstatSync(f.output).mode & 0o777).toBe(0o700);
    for (const filename of [
      'history.sqlite',
      'year-2025.manifest.json',
      'capture.manifest.json',
      'READY.json',
    ])
      expect(lstatSync(join(f.output, filename)).mode & 0o777).toBe(0o600);
    expect(progress.at(-1)).toMatchObject({ phase: 'verified', year: null, pages: 4, rows: 6 });
    for (const value of progress)
      expect(Object.keys(value).sort()).toEqual(['bytes', 'pages', 'phase', 'rows', 'year']);
    expect(f.requests.map((r) => r.url.searchParams.get('till'))).toEqual([
      '2025-12-31 23:59:59',
      '2025-12-31 23:59:59',
      '2026-09-27 23:59:59',
      '2026-09-27 23:59:59',
    ]);
    for (const request of f.requests) {
      expect(request.url.origin).toBe('https://iss.moex.com');
      expect(request.url.pathname).toBe(
        '/iss/engines/stock/markets/shares/boards/TQBR/securities/SBER/candles.json',
      );
      expect(request.url.searchParams.get('interval')).toBe('1');
      expect(request.init?.redirect).toBe('error');
      expect(new Headers(request.init?.headers).has('authorization')).toBe(false);
      expect(new Headers(request.init?.headers).has('cookie')).toBe(false);
    }
  });

  it('continues after a short nonempty page until the explicit empty terminal page', async () => {
    const f = fixture({ pages2025: [[row('2025-08-01 03:00:00')], [row('2025-08-01 03:01:00')]] });
    const result = await captureFrozenMoexMinuteSource(f.input);
    expect(
      f.requests
        .filter((r) => r.url.searchParams.get('from')?.startsWith('2025'))
        .map((r) => r.url.searchParams.get('start')),
    ).toEqual(['0', '1', '2']);
    expect(result.counts.pages).toBe(5);
  });
  it('records request start separately from receipt of all bounded response bytes', async () => {
    const f = fixture();
    let wallTime = '2026-10-03T12:00:00.123Z';
    const delegate = f.input.fetchImpl!;
    const result = await captureFrozenMoexMinuteSource({
      ...f.input,
      clock: { now: () => new Date(wallTime), monotonic: () => 0 },
      fetchImpl: (async (...args: Parameters<typeof fetch>) => {
        const received = await delegate(...args);
        wallTime = '2026-10-03T12:00:01.456Z';
        return received;
      }) as typeof fetch,
    });
    expect(result.admission).toBe(false);
    expect(readJson(join(f.output, 'year-2025.manifest.json')).pages[0]).toMatchObject({
      requestStartedAtUtc: '2026-10-03T12:00:00.123Z',
      receivedAtUtc: '2026-10-03T12:00:01.456Z',
    });
  });
  it('does not turn raw out-of-window bars into input or suppress declared excluded counts', async () => {
    const f = fixture({
      pages2025: [[row('2025-08-01 00:00:00'), row('2025-08-01 03:00:00')]],
      pages2026: [
        [
          row('2026-09-26 23:59:00'),
          row('2026-09-27 02:59:00'),
          row('2026-09-27 03:00:00'),
          row('2026-09-27 23:59:00'),
        ],
      ],
    });
    const result = await captureFrozenMoexMinuteSource(f.input);
    expect(result.counts).toMatchObject({
      rawRows: 6,
      storedRows: 3,
      excludedBeforeFrom: 1,
      excludedAtOrAfterTo: 2,
    });
    expect(result.coverage.lastCandleAt).toBe('2026-09-26T23:59:00.000Z');
  });
  it.each([{ rows: [] as CandleRow[] }, { rows: [row('2025-08-01 02:59:00')] }])(
    'fails an empty usable year and retains only incomplete public evidence',
    async ({ rows }) => {
      const f = fixture({ pages2025: [rows] });
      const open = vi.spyOn(DatabaseSync.prototype, 'exec');
      await rejects(f.input, 'empty-year');
      expect(open).not.toHaveBeenCalled();
      expect(readJson(join(f.output, 'INCOMPLETE.json'))).toMatchObject({
        finalized: false,
        admission: false,
      });
      expect(existsSync(join(f.output, 'history.sqlite'))).toBe(false);
    },
  );
  it.each([
    ['off-minute', { begin: '2025-08-01 03:00:01', end: '2025-08-01 03:01:00' }],
    ['wrong-end', { end: '2025-08-01 03:01:00' }],
    ['invalid-calendar', { begin: '2025-08-32 03:00:00', end: '2025-08-32 03:00:59' }],
    ['wrong-year', { begin: '2026-08-01 03:00:00', end: '2026-08-01 03:00:59' }],
    ['out-of-request', { begin: '2025-07-31 23:59:00', end: '2025-07-31 23:59:59' }],
    ['off-tick', { open: 100.001 }],
    ['nanoprecision', { open: 100.0000000001 }],
    ['too-large-price', { high: 1_000_000.01 }],
    ['zero-price', { low: 0 }],
    ['bad-ohlc', { high: 99 }],
    ['fractional-volume', { volume: 1.5 }],
    ['unsafe-volume', { volume: Number.MAX_SAFE_INTEGER + 1 }],
    ['negative-volume', { volume: -1 }],
    ['string-volume', { volume: '10' }],
  ] as const)('refuses %s without a database', async (_name, changes) => {
    const f = fixture({ pages2025: [[row('2025-08-01 03:00:00', changes)]] });
    await rejects(f.input, 'data-invalid');
    expect(existsSync(join(f.output, 'history.partial.sqlite'))).toBe(false);
  });
  it.each([
    { rows: [row('2025-08-01 03:00:00'), row('2025-08-01 03:00:00')] },
    { rows: [row('2025-08-01 03:01:00'), row('2025-08-01 03:00:00')] },
    { rows: [row('2025-08-01 03:00:00'), row('2025-08-01T03:00:00')] },
  ])('refuses duplicates, reordering and timestamp aliases', async ({ rows }) => {
    const f = fixture({ pages2025: [rows] });
    await rejects(f.input, 'data-invalid');
  });
  it('refuses duplicates across page boundaries rather than last-wins replacement', async () => {
    const f = fixture({ pages2025: [[row('2025-08-01 03:00:00')], [row('2025-08-01 03:00:00')]] });
    await rejects(f.input, 'data-invalid');
  });
  it.each([
    'not JSON SECRET-MARKER',
    JSON.stringify({ candles: { columns: ['open', 'open'], data: [] } }),
    JSON.stringify({ candles: { columns, data: [[100]] } }),
    JSON.stringify({ candles: { columns, data: 'wrong' } }),
  ])('refuses schema drift with fixed redacted errors', async (body) => {
    const f = fixture({ responseAt: () => new Response(body) });
    await rejects(f.input, 'schema-invalid');
  });
  it('does not retry HTTP failures or copy/print response bodies', async () => {
    const f = fixture({ responseAt: () => new Response('SECRET-MARKER', { status: 503 }) });
    await rejects(f.input, 'http-error');
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    expect(readdirSync(join(f.output, 'raw-2025'))).toEqual([]);
  });
  it('redacts thrown transport details', async () => {
    const f = fixture({
      responseAt: async () => {
        throw new Error('SECRET-MARKER');
      },
    });
    await rejects(f.input, 'transport-error');
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('refuses a redirect or a response from a changed destination', async () => {
    const f = fixture({
      responseAt: () => {
        const r = response([]);
        Object.defineProperty(r, 'url', { value: 'https://evil.example/SECRET-MARKER' });
        return r;
      },
    });
    await rejects(f.input, 'http-error');
  });
  it.each([
    { limits: { maxPages: 1 }, code: 'page-bound' },
    { limits: { maxRows: 1 }, code: 'row-bound' },
    { limits: { maxPageBytes: 10 }, code: 'byte-bound' },
    { limits: { maxTotalBytes: 10 }, code: 'byte-bound' },
  ])('enforces lower $code bounds without a finalized database', async ({ limits, code }) => {
    const f = fixture();
    await rejects({ ...f.input, limits }, code);
  });
  it('cancels streamed oversized body before unbounded JSON/text consumption', async () => {
    const cancel = vi.fn();
    const f = fixture({
      responseAt: () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(20));
            },
            cancel,
          }),
        ),
    });
    await rejects({ ...f.input, limits: { maxPageBytes: 10 } }, 'byte-bound');
    expect(cancel).toHaveBeenCalled();
  });
  it('counts page and byte limits across both calendar years', async () => {
    const f = fixture();
    await rejects({ ...f.input, limits: { maxPages: 3 } }, 'page-bound');
    expect(f.fetchImpl).toHaveBeenCalledTimes(3);
  });
  it('rejects relaxed limits before creating files or making requests', async () => {
    const f = fixture();
    await rejects({ ...f.input, limits: { maxPages: 2001 } }, 'invalid-input');
    expect(existsSync(f.output)).toBe(false);
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it('blocks an elapsed deadline after awaited response and before database creation', async () => {
    const f = fixture({
      responseAt: () => {
        f.setElapsed(100);
        return response([row('2025-08-01 03:00:00')]);
      },
    });
    await rejects({ ...f.input, limits: { maxElapsedMs: 100 } }, 'time-bound');
    expect(existsSync(join(f.output, 'history.partial.sqlite'))).toBe(false);
  });
  it('blocks a deadline reached during database progress before publication', async () => {
    const f = fixture();
    await rejects(
      {
        ...f.input,
        limits: { maxElapsedMs: 100 },
        onProgress: (value) => {
          if (value.phase === 'database' && value.year === 2026) f.setElapsed(100);
        },
      },
      'time-bound',
    );
    expect(existsSync(join(f.output, 'history.sqlite'))).toBe(false);
  });
  it('counts verified observer latency before publication', async () => {
    const f = fixture();
    await rejects(
      {
        ...f.input,
        limits: { maxElapsedMs: 100 },
        onProgress: (value) => {
          if (value.phase === 'verified') f.setElapsed(100);
        },
      },
      'time-bound',
    );
    expect(existsSync(join(f.output, 'history.sqlite'))).toBe(false);
    expect(existsSync(join(f.output, 'INCOMPLETE.json'))).toBe(true);
  });
  it.each(['ready-written', 'incomplete-removed'] as const)(
    'invalidates only owned READY after late $0 deadline',
    async (point) => {
      const f = fixture();
      await rejects(
        {
          ...f.input,
          limits: { maxElapsedMs: 100 },
          clock: {
            now: f.input.clock!.now,
            monotonic: () =>
              existsSync(join(f.output, 'READY.json')) &&
              (point === 'ready-written' || !existsSync(join(f.output, 'INCOMPLETE.json')))
                ? 100
                : 0,
          },
        },
        'time-bound',
      );
      expect(existsSync(join(f.output, 'history.sqlite'))).toBe(true);
      expect(readJson(join(f.output, 'INCOMPLETE.json'))).toMatchObject({ finalized: false });
    },
  );
  it('refuses a backwards monotonic clock', async () => {
    const f = fixture();
    let clockCalls = 0;
    await rejects(
      {
        ...f.input,
        clock: { now: () => new Date('2026-10-03T12:00:00Z'), monotonic: () => (clockCalls++ ? 0 : 1) },
      },
      'clock-invalid',
    );
  });
  it.each(['file', 'directory', 'symlink'] as const)(
    'never overwrites an existing %s output',
    async (kind) => {
      const f = fixture();
      if (kind === 'file') writeFileSync(f.output, 'sentinel');
      else if (kind === 'directory') mkdirSync(f.output);
      else symlinkSync(join(f.directory, 'missing'), f.output);
      await rejects(f.input, 'output-exists');
      expect(f.fetchImpl).not.toHaveBeenCalled();
      if (kind === 'file') expect(readFileSync(f.output, 'utf8')).toBe('sentinel');
    },
  );
  it('does not create a missing parent or change existing parent permissions/data', async () => {
    const f = fixture();
    chmodSync(f.directory, 0o755);
    const sentinel = join(f.directory, 'private.env');
    writeFileSync(sentinel, 'SECRET-MARKER');
    await rejects({ ...f.input, outputDirectory: join(f.directory, 'absent', 'capture') }, 'io-error');
    expect(existsSync(join(f.directory, 'absent'))).toBe(false);
    await captureFrozenMoexMinuteSource(f.input);
    expect(lstatSync(f.directory).mode & 0o777).toBe(0o755);
    expect(readFileSync(sentinel, 'utf8')).toBe('SECRET-MARKER');
    expect(readFileSync(join(f.output, 'history.sqlite')).includes(Buffer.from('SECRET-MARKER'))).toBe(false);
  });
  it('checks cached bytes again before database import', async () => {
    const f = fixture();
    await rejects(
      {
        ...f.input,
        onProgress: (value) => {
          if (value.phase === 'capture' && value.year === 2026)
            writeFileSync(join(f.output, 'raw-2025/page-0000.json'), 'SECRET-MARKER');
        },
      },
      'capture-changed',
    );
  });
  it.each([
    'raw-2025/page-0000.json',
    'year-2025.manifest.json',
    'capture.manifest.json',
    'history.partial.sqlite',
  ])('rejects late verified-callback changes to $0', async (file) => {
    const f = fixture();
    await rejects(
      {
        ...f.input,
        onProgress: (value) => {
          if (value.phase === 'verified') appendFileSync(join(f.output, file), ' ');
        },
      },
      'capture-changed',
    );
    expect(existsSync(join(f.output, 'history.sqlite'))).toBe(false);
  });
  it('rejects changes to earlier pages after they were already imported', async () => {
    const f = fixture();
    await rejects(
      {
        ...f.input,
        onProgress: (value) => {
          if (value.phase === 'database' && value.year === 2026)
            appendFileSync(join(f.output, 'raw-2025/page-0000.json'), ' ');
        },
      },
      'capture-changed',
    );
  });
  it.each(['raw-2025/page-0000.json', 'year-2025.manifest.json'])(
    'never rereads a substituted $0 symlink',
    async (file) => {
      const f = fixture(),
        sentinel = join(f.directory, 'private.env');
      writeFileSync(sentinel, 'SECRET-MARKER');
      let replaced = false;
      await rejects(
        {
          ...f.input,
          onProgress: (value) => {
            if (value.phase === 'capture' && value.year === 2026 && !replaced) {
              replaced = true;
              unlinkSync(join(f.output, file));
              symlinkSync(sentinel, join(f.output, file));
            }
          },
        },
        'capture-changed',
      );
      expect(readFileSync(sentinel, 'utf8')).toBe('SECRET-MARKER');
    },
  );
  it('never overwrites a final database injected before publication', async () => {
    const f = fixture();
    await rejects(
      {
        ...f.input,
        onProgress: (value) => {
          if (value.phase === 'database' && value.year === 2026)
            writeFileSync(join(f.output, 'history.sqlite'), 'sentinel', { flag: 'wx' });
        },
      },
      'io-error',
    );
    expect(readFileSync(join(f.output, 'history.sqlite'), 'utf8')).toBe('sentinel');
  });
  it.each(['-wal', '-shm', '-journal'] as const)(
    'refuses final database $0 sidecar without deleting it',
    async (suffix) => {
      const f = fixture();
      const foreignSidecar = join(f.output, 'history.sqlite' + suffix);
      await rejects(
        {
          ...f.input,
          onProgress: (value) => {
            if (value.phase === 'verified') writeFileSync(foreignSidecar, 'sentinel', { flag: 'wx' });
          },
        },
        'database-invalid',
      );
      expect(readFileSync(foreignSidecar, 'utf8')).toBe('sentinel');
      expect(existsSync(join(f.output, 'history.sqlite'))).toBe(false);
    },
  );
  it.each(
    ['history.sqlite', 'history.partial.sqlite'].flatMap((databaseFile) =>
      ['-wal', '-shm', '-journal'].map((suffix) => ({ databaseFile, suffix })),
    ),
  )('rejects a dangling $databaseFile$suffix sidecar symlink', async ({ databaseFile, suffix }) => {
    const f = fixture();
    const sidecar = join(f.output, databaseFile + suffix);
    await rejects(
      {
        ...f.input,
        onProgress: (value) => {
          if (value.phase === 'verified') symlinkSync(join(f.directory, 'absent-target'), sidecar);
        },
      },
      'database-invalid',
    );
    expect(lstatSync(sidecar).isSymbolicLink()).toBe(true);
    expect(existsSync(join(f.output, 'history.sqlite'))).toBe(false);
  });
  it('does not remove a READY marker it did not create when publication fails', async () => {
    const f = fixture();
    await expect(
      captureFrozenMoexMinuteSource({
        ...f.input,
        onProgress: (value) => {
          if (value.phase === 'verified')
            writeFileSync(join(f.output, 'READY.json'), 'foreign-marker', { flag: 'wx' });
        },
      }),
    ).rejects.toMatchObject({ code: 'io-error' });
    expect(readFileSync(join(f.output, 'READY.json'), 'utf8')).toBe('foreign-marker');
    expect(readJson(join(f.output, 'INCOMPLETE.json'))).toMatchObject({ finalized: false });
  });
  it('progress callback errors cannot leak details or change source acceptance', async () => {
    const f = fixture();
    expect(
      (
        await captureFrozenMoexMinuteSource({
          ...f.input,
          onProgress: () => {
            throw new Error('SECRET-MARKER');
          },
        })
      ).admission,
    ).toBe(false);
  });
});
