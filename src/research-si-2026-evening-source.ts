import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { si2026DaySpecs, type DaySpec } from './research-si-2026-source.js';
import { parseSiCandlePage, validateSiDayCandles, type SiCandle } from './research/si-first-hour.js';

type CachedDay = { version: 1; date: string; contract: DaySpec['contract']; sha256: string; body: string };
const directory = join(process.cwd(), '.trading', 'si-2026-evening-source');
const reportPath = join(process.cwd(), '.trading', 'si-2026-evening-source.json');
const window = { from: '17:00', to: '22:00' } as const;
const hash = (body: string) => createHash('sha256').update(body).digest('hex');
const cachePath = (date: string) => join(directory, `${date}.json.gz`);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function fetchDay(spec: DaySpec): Promise<CachedDay> {
  const url = new URL(`https://iss.moex.com/iss/engines/futures/markets/forts/boards/RFUD/securities/${spec.contract}/candles.json`);
  for (const [key, value] of Object.entries({ interval: '1', from: `${spec.date} 17:00:00`, till: `${spec.date} 22:00:00`,
    'iss.meta': 'off', 'iss.only': 'candles', 'candles.columns': 'open,close,high,low,volume,begin' })) url.searchParams.set(key, value);
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'AndStrel.trading-mcp' }, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`MOEX HTTP ${response.status}`);
      const body = await response.text();
      parseSiCandlePage(JSON.parse(body) as unknown, spec.date, window);
      return { version: 1, date: spec.date, contract: spec.contract, sha256: hash(body), body };
    } catch (error) {
      if (attempt === 4) throw new Error(`${spec.contract} ${spec.date}: ${error instanceof Error ? error.message : 'unknown failure'}`);
      await sleep(500 * 2 ** (attempt - 1));
    }
  }
  throw new Error('MOEX retry attempts exhausted');
}

export function readCachedSi2026EveningDay(spec: DaySpec): { candles: SiCandle[]; sha256: string } {
  const path = cachePath(spec.date);
  if (!existsSync(path)) throw new Error(`Missing evening source ${path}`);
  const cached = JSON.parse(gunzipSync(readFileSync(path)).toString('utf8')) as CachedDay;
  if (cached.version !== 1 || cached.date !== spec.date || cached.contract !== spec.contract ||
      typeof cached.body !== 'string' || cached.sha256 !== hash(cached.body)) throw new Error(`Invalid evening source ${path}`);
  const candles = parseSiCandlePage(JSON.parse(cached.body) as unknown, spec.date, window);
  validateSiDayCandles(candles, spec.date);
  if (candles.length > 301) throw new Error(`Unexpectedly many evening candles in ${path}`);
  return { candles, sha256: cached.sha256 };
}

async function main(): Promise<void> {
  const flags = process.argv.slice(2);
  if (flags.some((flag) => flag !== '--fetch')) throw new Error('Only --fetch is supported');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const specs = si2026DaySpecs();
  if (flags.includes('--fetch')) {
    let next = 0;
    let completed = 0;
    await Promise.all(Array.from({ length: 3 }, async () => {
      while (next < specs.length) {
        const spec = specs[next++]!;
        if (!existsSync(cachePath(spec.date))) {
          const cached = await fetchDay(spec);
          const temporary = `${cachePath(spec.date)}.part`;
          writeFileSync(temporary, gzipSync(JSON.stringify(cached)), { mode: 0o600, flag: 'wx' });
          renameSync(temporary, cachePath(spec.date));
        }
        readCachedSi2026EveningDay(spec);
        completed += 1;
        if (completed % 25 === 0 || completed === specs.length) console.log(JSON.stringify({ completed, total: specs.length }));
        await sleep(100);
      }
    }));
  }
  const days = specs.map((spec) => {
    const { candles, sha256 } = readCachedSi2026EveningDay(spec);
    return { ...spec, sha256, candleCount: candles.length,
      entryPrint: candles.some((candle) => candle.time === `${spec.date} 17:01:00`),
      exitPrint: candles.some((candle) => candle.time === `${spec.date} 22:00:00`) };
  });
  const regular = days.filter((day) => day.date !== '2026-05-01' && day.date !== '2026-06-12');
  const report = { protocol: 'docs/SI_US_SESSION_CONTINUATION_V1.md',
    source: 'MOEX ISS RFUD exact-contract one-minute trade candles, 17:00–22:00 MSK, 2026-03-23 through 2026-09-25',
    summary: { weekdays: days.length, regularSessions: regular.length,
      complete301: regular.filter((day) => day.candleCount === 301).length,
      entryPrint: regular.filter((day) => day.entryPrint).length,
      exitPrint: regular.filter((day) => day.exitPrint).length,
      bothPrints: regular.filter((day) => day.entryPrint && day.exitPrint).length }, days };
  const body = `${JSON.stringify(report, null, 2)}\n`;
  writeFileSync(reportPath, body, { mode: 0o600 });
  console.log(JSON.stringify({ reportPath, sha256: hash(body), summary: report.summary }));
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  main().catch((error: unknown) => { console.error(`Si evening source failed: ${error instanceof Error ? error.message : 'unknown failure'}`); process.exitCode = 1; });
}
