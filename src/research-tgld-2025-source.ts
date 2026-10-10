import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { parseSiCandlePage, validateSiDayCandles, type SiCandle } from './research/si-first-hour.js';

type CachedDay = { version: 1; date: string; board: 'TQTF'; sha256: string; body: string };
type SourceYear = '2024' | '2025';
const directory = (year: SourceYear) => join(process.cwd(), '.trading', `tgld-${year}-source`);
const reportPath = (year: SourceYear) => join(process.cwd(), '.trading', `tgld-${year}-source.json`);
const hash = (body: string) => createHash('sha256').update(body).digest('hex');
const cachePath = (year: SourceYear, date: string) => join(directory(year), `${date}.json.gz`);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function tgldWeekdays(year: SourceYear): string[] {
  const dates: string[] = [];
  for (let ms = Date.parse(`${year}-01-01T00:00:00Z`); ms <= Date.parse(`${year}-12-31T00:00:00Z`); ms += 86_400_000) {
    const day = new Date(ms);
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) dates.push(day.toISOString().slice(0, 10));
  }
  return dates;
}
export const tgld2025Weekdays = () => tgldWeekdays('2025');

async function fetchDay(date: string): Promise<CachedDay> {
  const url = new URL('https://iss.moex.com/iss/engines/stock/markets/shares/boards/TQTF/securities/TGLD/candles.json');
  for (const [key, value] of Object.entries({ interval: '1', from: `${date} 10:00:00`, till: `${date} 17:00:00`,
    'iss.meta': 'off', 'iss.only': 'candles', 'candles.columns': 'open,close,high,low,volume,begin' })) url.searchParams.set(key, value);
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'AndStrel.trading-mcp' }, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`MOEX HTTP ${response.status}`);
      const body = await response.text();
      parseSiCandlePage(JSON.parse(body) as unknown, date);
      return { version: 1, date, board: 'TQTF', sha256: hash(body), body };
    } catch (error) {
      if (attempt === 4) throw new Error(`${date}: ${error instanceof Error ? error.message : 'unknown failure'}`);
      await sleep(500 * 2 ** (attempt - 1));
    }
  }
  throw new Error('MOEX retry attempts exhausted');
}

export function readCachedTgldDay(year: SourceYear, date: string): { candles: SiCandle[]; sha256: string } {
  const path = cachePath(year, date);
  if (!existsSync(path)) throw new Error(`Missing TGLD source ${path}`);
  const cached = JSON.parse(gunzipSync(readFileSync(path)).toString('utf8')) as CachedDay;
  if (cached.version !== 1 || cached.date !== date || cached.board !== 'TQTF' ||
      typeof cached.body !== 'string' || cached.sha256 !== hash(cached.body)) throw new Error(`Invalid TGLD source ${path}`);
  const candles = parseSiCandlePage(JSON.parse(cached.body) as unknown, date);
  validateSiDayCandles(candles, date);
  if (candles.length > 421) throw new Error(`Unexpectedly many TGLD candles in ${path}`);
  return { candles, sha256: cached.sha256 };
}
export const readCachedTgld2025Day = (date: string) => readCachedTgldDay('2025', date);

async function main(): Promise<void> {
  const flags = process.argv.slice(2);
  if (flags.some((flag) => flag !== '--fetch')) throw new Error('Only --fetch is supported');
  const year = process.env.TGLD_SOURCE_YEAR ?? '2025';
  if (year !== '2024' && year !== '2025') throw new Error('TGLD_SOURCE_YEAR must be 2024 or 2025');
  mkdirSync(directory(year), { recursive: true, mode: 0o700 });
  chmodSync(directory(year), 0o700);
  const dates = tgldWeekdays(year);
  if (flags.includes('--fetch')) {
    let next = 0;
    let completed = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (next < dates.length) {
        const date = dates[next++]!;
        if (!existsSync(cachePath(year, date))) {
          const cached = await fetchDay(date);
          const temporary = `${cachePath(year, date)}.part`;
          writeFileSync(temporary, gzipSync(JSON.stringify(cached)), { mode: 0o600, flag: 'wx' });
          renameSync(temporary, cachePath(year, date));
        }
        readCachedTgldDay(year, date);
        completed += 1;
        if (completed % 40 === 0 || completed === dates.length) console.log(JSON.stringify({ completed, total: dates.length }));
        await sleep(100);
      }
    }));
  }
  const days = dates.map((date) => {
    const { candles, sha256 } = readCachedTgldDay(year, date);
    return { date, sha256, candleCount: candles.length, firstTime: candles[0]?.time ?? null, lastTime: candles.at(-1)?.time ?? null };
  });
  const report = { purpose: 'Source and coverage audit only; no trading outcome or executable bid/ask data',
    source: 'MOEX ISS TGLD TQTF one-minute trade candles, 10:00–17:00 MSK',
    summary: { weekdays: days.length, active: days.filter((day) => day.candleCount > 0).length,
      exact1000: days.filter((day) => day.firstTime?.endsWith('10:00:00')).length,
      lastAtOrAfter1655: days.filter((day) => day.lastTime !== null && day.lastTime.slice(11, 16) >= '16:55').length }, days };
  const body = `${JSON.stringify(report, null, 2)}\n`;
  writeFileSync(reportPath(year), body, { mode: 0o600 });
  console.log(JSON.stringify({ reportPath: reportPath(year), sha256: hash(body), summary: report.summary }));
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  main().catch((error: unknown) => { console.error(`TGLD 2025 source failed: ${error instanceof Error ? error.message : 'unknown failure'}`); process.exitCode = 1; });
}
