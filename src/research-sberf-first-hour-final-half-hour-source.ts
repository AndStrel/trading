import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { isWeekday, parseMoexCandles, sessionWindows, validateWindow } from './research/sberf-first-hour-final-half-hour.js';

const protocolPath = join(process.cwd(), 'docs', 'SBERF_FIRST_HOUR_TO_FINAL_HALF_HOUR_TRANSFER_V1.md');
const expectedProtocolSha256 = '5040838a4fe74530d220a3f0602e3ccd064eaa1a738fa3997f54708c3cf150a2';
const protocolSha256 = createHash('sha256').update(await readFile(protocolPath)).digest('hex');
if (protocolSha256 !== expectedProtocolSha256) throw new Error('Frozen SBERF protocol changed; refusing source collection');

const root = join(process.cwd(), '.trading', 'sberf-first-hour-final-half-hour');
const dailyRoot = join(root, 'daily');
const minuteRoot = join(root, 'minute');
const manifestPath = join(root, 'source-manifest.json');
const apiBase = 'https://iss.moex.com/iss/engines/futures/markets/forts/boards/RFUD/securities/SBERF/candles.json';
const fromDate = '2024-10-01';
const tillDate = '2026-09-24';
const pageSize = 500;
type Page = { path: string; sha256: string; url: string; kind: 'daily' | 'signal' | 'exit'; date?: string; start?: number };
type Cache = { url: string; retrievedAtUtc: string; sha256: string; body: string };
const pages: Page[] = [];
let nextRequestAt = 0;
const sha = (v: string) => createHash('sha256').update(v).digest('hex');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(url: string, target: string): Promise<Cache> {
  try {
    const cached = JSON.parse(await readFile(target, 'utf8')) as Cache;
    if (cached.url !== url || sha(cached.body) !== cached.sha256) throw new Error(`Invalid cached page ${relative(process.cwd(), target)}`);
    return cached;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const now = Date.now();
    if (now < nextRequestAt) await sleep(nextRequestAt - now);
    nextRequestAt = Math.max(now, nextRequestAt) + 250;
    try {
      const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`MOEX ISS HTTP ${response.status}`);
      const body = await response.text(); JSON.parse(body);
      const value: Cache = { url, retrievedAtUtc: new Date().toISOString(), sha256: sha(body), body };
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, JSON.stringify(value), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      return value;
    } catch (error) { lastError = error; if (attempt < 3) await sleep((attempt + 1) * 1000); }
  }
  throw lastError instanceof Error ? lastError : new Error('MOEX ISS request failed');
}

async function page(kind: Page['kind'], params: Record<string, string>, target: string, extra: Partial<Page> = {}) {
  const url = new URL(apiBase);
  for (const [key, value] of Object.entries({ ...params, 'iss.meta': 'off', 'iss.only': 'candles' })) url.searchParams.set(key, value);
  const cached = await request(url.toString(), target);
  parseMoexCandles(cached.body);
  pages.push({ path: relative(process.cwd(), target), sha256: cached.sha256, url: url.toString(), kind, ...extra });
  return cached.body;
}

async function exists(path: string) { try { await readFile(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; } }

async function main() {
  if (await exists(manifestPath)) throw new Error('Source manifest already exists; refusing to overwrite');
  await mkdir(dailyRoot, { recursive: true, mode: 0o700 }); await mkdir(minuteRoot, { recursive: true, mode: 0o700 });
  const daily: ReturnType<typeof parseMoexCandles> = [];
  for (let start = 0; ; start += pageSize) {
    const body = await page('daily', { from: fromDate, till: tillDate, interval: '24', start: String(start) }, join(dailyRoot, `page-${String(start).padStart(4, '0')}.json`), { start });
    const rows = (JSON.parse(body) as { candles?: { data?: unknown[] } }).candles?.data;
    if (!Array.isArray(rows)) throw new Error(`Invalid daily page at ${start}`);
    daily.push(...parseMoexCandles(body)); if (rows.length < pageSize) break;
  }
  const dates = daily.map((row) => row.begin.slice(0, 10));
  if (dates.some((date) => date < fromDate || date > tillDate) || new Set(dates).size !== dates.length) throw new Error('Invalid official SBERF daily calendar');
  const weekdays = dates.filter(isWeekday);
  if (weekdays.length < 100) throw new Error(`Too few official weekday dates: ${weekdays.length}`);
  const coverage: { date: string; signalComplete: boolean; exitComplete: boolean }[] = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (cursor < weekdays.length) {
      const date = weekdays[cursor++]!; const w = sessionWindows(date);
      const [signalBody, exitBody] = await Promise.all([
        page('signal', { from: `${date} ${w.signalStart}:00`, till: `${date} ${w.signalEnd}:00`, interval: '1', start: '0' }, join(minuteRoot, `${date}-signal.json`), { date, start: 0 }),
        page('exit', { from: `${date} ${w.exitStart}:00`, till: `${date} ${w.exitEnd}:00`, interval: '1', start: '0' }, join(minuteRoot, `${date}-exit.json`), { date, start: 0 }),
      ]);
      coverage.push({ date, signalComplete: validateWindow(parseMoexCandles(signalBody), date, w.signalStart, w.signalEnd, 0.01), exitComplete: validateWindow(parseMoexCandles(exitBody), date, w.exitStart, w.exitEnd, 0.01) });
    }
  }));
  coverage.sort((a, b) => a.date.localeCompare(b.date)); pages.sort((a, b) => a.path.localeCompare(b.path));
  const base = { version: 1, instrument: 'SBERF', board: 'RFUD', source: 'public MOEX ISS; no broker token', protocol: relative(process.cwd(), protocolPath), protocolSha256, endpoint: apiBase, fromDate, tillDate, officialDailyDateCount: dates.length, officialWeekdayCount: weekdays.length, sourcePages: pages, windowCoverage: coverage, sourceOnly: true, outcomeReturnsCalculated: false, retrievedAtUtc: new Date().toISOString() };
  const manifest = { ...base, manifestSha256: sha(JSON.stringify(base)) };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  process.stdout.write(`Price-blind checkpoint: ${weekdays.length} weekdays; ${pages.length} pages; SHA-256 ${manifest.manifestSha256}\n`);
  process.stdout.write(`Complete windows: signal ${coverage.filter((x) => x.signalComplete).length}/${coverage.length}; exit ${coverage.filter((x) => x.exitComplete).length}/${coverage.length}. No returns calculated.\n`);
}
main().catch((error: unknown) => { process.stderr.write(`SBERF source collection failed: ${error instanceof Error ? error.message : 'unknown error'}\n`); process.exitCode = 1; });
