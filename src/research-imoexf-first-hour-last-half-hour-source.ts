import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import {
  isWeekday, parseMoexCandles, sessionWindows, validateWindow,
} from './research/imoexf-first-hour-last-half-hour.js';

const protocolPath = join(process.cwd(), 'docs', 'IMOEXF_FIRST_HOUR_LAST_HALF_HOUR_V1.md');
const expectedProtocolSha256 = '56fe50fc8dd76f1ee15b3d612fd94f4b7f9053aabea4dc00eb78d05b492b1b19';
const protocolSha256 = createHash('sha256').update(await readFile(protocolPath)).digest('hex');
if (protocolSha256 !== expectedProtocolSha256) throw new Error('Frozen IMOEXF protocol changed; refuse source collection');

const sourceRoot = join(process.cwd(), '.trading', 'imoexf-first-hour-last-half-hour');
const dailyRoot = join(sourceRoot, 'daily');
const minuteRoot = join(sourceRoot, 'minute');
const manifestPath = join(sourceRoot, 'source-manifest.json');
const apiBase = 'https://iss.moex.com/iss/engines/futures/markets/forts/boards/RFUD/securities/IMOEXF/candles.json';
const fromDate = '2024-07-01';
const tillDate = '2026-09-24';
const pageSize = 500;

type RawPageRef = { path: string; sha256: string; url: string; kind: 'daily' | 'signal' | 'exit'; date?: string; start?: number };
type CacheEntry = { url: string; retrievedAtUtc: string; sha256: string; body: string };
const rawPageRefs: RawPageRef[] = [];
let nextRequestAt = 0;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rateLimit(): Promise<void> {
  const now = Date.now();
  const scheduled = Math.max(now, nextRequestAt);
  nextRequestAt = scheduled + 250;
  if (scheduled > now) await sleep(scheduled - now);
}

function buildUrl(params: Record<string, string>): string {
  const url = new URL(apiBase);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

async function loadOrFetch(url: string, targetPath: string): Promise<CacheEntry> {
  try {
    const cached = JSON.parse(await readFile(targetPath, 'utf8')) as CacheEntry;
    if (cached.url !== url || typeof cached.body !== 'string' || cached.sha256 !== sha256(cached.body)) {
      throw new Error(`Cached MOEX page failed provenance verification: ${relative(process.cwd(), targetPath)}`);
    }
    return cached;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await rateLimit();
    try {
      const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) {
        if (response.status === 429 || response.status >= 500) {
          await sleep(1000 * (attempt + 1));
          lastError = new Error(`MOEX ISS temporary HTTP ${response.status}`);
          continue;
        }
        throw new Error(`MOEX ISS HTTP ${response.status}`);
      }
      const body = await response.text();
      JSON.parse(body);
      const cached: CacheEntry = { url, retrievedAtUtc: new Date().toISOString(), sha256: sha256(body), body };
      await mkdir(dirname(targetPath), { recursive: true, mode: 0o700 });
      try {
        await writeFile(targetPath, JSON.stringify(cached), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const existing = JSON.parse(await readFile(targetPath, 'utf8')) as CacheEntry;
        if (existing.url !== url || existing.sha256 !== sha256(existing.body)) throw new Error('Concurrent cache write failed verification');
        return existing;
      }
      return cached;
    } catch (error) {
      lastError = error;
      if (attempt === 3) break;
      await sleep(1000 * (attempt + 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('MOEX ISS request failed');
}

async function requestPage(
  kind: RawPageRef['kind'], params: Record<string, string>, targetPath: string,
  extra: Pick<RawPageRef, 'date' | 'start'> = {},
): Promise<string> {
  const url = buildUrl({ ...params, 'iss.meta': 'off', 'iss.only': 'candles' });
  const cached = await loadOrFetch(url, targetPath);
  parseMoexCandles(cached.body);
  rawPageRefs.push({ path: relative(process.cwd(), targetPath), sha256: cached.sha256, url, kind, ...extra });
  return cached.body;
}

async function main(): Promise<void> {
  if (await fileExists(manifestPath)) throw new Error('Source manifest already exists; refusing to overwrite frozen source checkpoint');
  await mkdir(dailyRoot, { recursive: true, mode: 0o700 });
  await mkdir(minuteRoot, { recursive: true, mode: 0o700 });

  const dailyRows: ReturnType<typeof parseMoexCandles> = [];
  for (let start = 0; ; start += pageSize) {
    const path = join(dailyRoot, `page-${String(start).padStart(4, '0')}.json`);
    const body = await requestPage('daily', { from: fromDate, till: tillDate, interval: '24', start: String(start) }, path, { start });
    const parsed = JSON.parse(body) as { candles?: { data?: unknown[][] } };
    const rows = parsed.candles?.data;
    if (!Array.isArray(rows)) throw new Error(`Invalid daily candle page at offset ${start}`);
    dailyRows.push(...parseMoexCandles(body));
    if (rows.length < pageSize) break;
  }

  const dailyDates = dailyRows.map((row) => row.begin.slice(0, 10));
  if (dailyDates.some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < fromDate || date > tillDate)) {
    throw new Error('Daily candle calendar contains an out-of-scope date');
  }
  if (new Set(dailyDates).size !== dailyDates.length) throw new Error('Duplicate dates in official IMOEXF daily candles');
  const tradingWeekdays = dailyDates.filter(isWeekday);
  if (tradingWeekdays.length < 100) throw new Error(`Too few official weekday dates: ${tradingWeekdays.length}`);

  let completedDates = 0;
  const windowCoverage: { date: string; signalComplete: boolean; exitComplete: boolean }[] = [];
  const workerCount = 4;
  let cursor = 0;
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= tradingWeekdays.length) return;
      const date = tradingWeekdays[index]!;
      const windows = sessionWindows(date);
      const signalPath = join(minuteRoot, `${date}-signal.json`);
      const exitPath = join(minuteRoot, `${date}-exit.json`);
      const [signalBody, exitBody] = await Promise.all([
        requestPage('signal', { from: `${date} ${windows.signalStart}:00`, till: `${date} ${windows.signalEnd}:00`, interval: '1', start: '0' }, signalPath, { date, start: 0 }),
        requestPage('exit', { from: `${date} ${windows.exitStart}:00`, till: `${date} ${windows.exitEnd}:00`, interval: '1', start: '0' }, exitPath, { date, start: 0 }),
      ]);
      const signalComplete = validateWindow(parseMoexCandles(signalBody), date, windows.signalStart, windows.signalEnd);
      const exitComplete = validateWindow(parseMoexCandles(exitBody), date, windows.exitStart, windows.exitEnd);
      windowCoverage.push({ date, signalComplete, exitComplete });
      completedDates += 1;
      if (completedDates % 25 === 0 || completedDates === tradingWeekdays.length) {
        process.stdout.write(`Source windows checked: ${completedDates}/${tradingWeekdays.length}\n`);
      }
    }
  });
  await Promise.all(workers);

  windowCoverage.sort((left, right) => left.date.localeCompare(right.date));
  rawPageRefs.sort((left, right) => left.path.localeCompare(right.path));
  const manifestBase = {
    version: 1,
    instrument: 'IMOEXF',
    board: 'RFUD',
    source: 'public MOEX ISS one-minute and daily candles; no broker token',
    protocol: relative(process.cwd(), protocolPath),
    protocolSha256,
    endpoint: apiBase,
    fromDate,
    tillDate,
    weekendPolicy: 'excluded by frozen v1',
    officialDailyDateCount: dailyDates.length,
    officialWeekdayCount: tradingWeekdays.length,
    sourcePages: rawPageRefs,
    windowCoverage,
    sourceOnly: true,
    outcomeReturnsCalculated: false,
    retrievedAtUtc: new Date().toISOString(),
  };
  const manifestSha256 = sha256(JSON.stringify(manifestBase));
  const manifest = { ...manifestBase, manifestSha256 };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  process.stdout.write(`Price-blind source checkpoint saved: ${tradingWeekdays.length} weekday dates; ${rawPageRefs.length} raw pages; SHA-256 ${manifestSha256}\n`);
  process.stdout.write(`Window coverage: signal ${windowCoverage.filter((row) => row.signalComplete).length}/${windowCoverage.length}, exit ${windowCoverage.filter((row) => row.exitComplete).length}/${windowCoverage.length}. No returns calculated.\n`);
}

async function fileExists(path: string): Promise<boolean> {
  try { await readFile(path); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`IMOEXF source collection failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
  process.exitCode = 1;
});
