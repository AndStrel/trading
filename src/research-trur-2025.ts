import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { parseSiCandlePage, validateSiDayCandles, type SiCandle } from './research/si-first-hour.js';

type CachedDay = { version: 1; date: string; board: 'TQTF'; ticker: 'TRUR'; sha256: string; body: string };
const directory = join(process.cwd(), '.trading', 'trur-2025-source');
const sourcePath = join(process.cwd(), '.trading', 'trur-2025-source.json');
const hash = (body: string) => createHash('sha256').update(body).digest('hex');
const cachePath = (date: string) => join(directory, `${date}.json.gz`);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function weekdays2025(): string[] {
  const dates: string[] = [];
  for (let ms = Date.parse('2025-01-01T00:00:00Z'); ms <= Date.parse('2025-12-31T00:00:00Z'); ms += 86_400_000) {
    const day = new Date(ms);
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) dates.push(day.toISOString().slice(0, 10));
  }
  return dates;
}

async function fetchDay(date: string): Promise<CachedDay> {
  const url = new URL('https://iss.moex.com/iss/engines/stock/markets/shares/boards/TQTF/securities/TRUR/candles.json');
  for (const [key, value] of Object.entries({ interval: '1', from: `${date} 10:00:00`, till: `${date} 17:00:00`,
    'iss.meta': 'off', 'iss.only': 'candles', 'candles.columns': 'open,close,high,low,volume,begin' })) url.searchParams.set(key, value);
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'AndStrel.trading-mcp' }, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`MOEX HTTP ${response.status}`);
      const body = await response.text();
      parseSiCandlePage(JSON.parse(body) as unknown, date);
      return { version: 1, date, board: 'TQTF', ticker: 'TRUR', sha256: hash(body), body };
    } catch (error) {
      if (attempt === 4) throw new Error(`${date}: ${error instanceof Error ? error.message : 'unknown failure'}`);
      await sleep(500 * 2 ** (attempt - 1));
    }
  }
  throw new Error('MOEX retry attempts exhausted');
}

export function readCachedTrurDay(date: string): { candles: SiCandle[]; sha256: string } {
  const path = cachePath(date);
  if (!existsSync(path)) throw new Error(`Missing TRUR source ${path}`);
  const cached = JSON.parse(gunzipSync(readFileSync(path)).toString('utf8')) as CachedDay;
  if (cached.version !== 1 || cached.date !== date || cached.board !== 'TQTF' || cached.ticker !== 'TRUR' ||
      typeof cached.body !== 'string' || cached.sha256 !== hash(cached.body)) throw new Error(`Invalid TRUR source ${path}`);
  const candles = parseSiCandlePage(JSON.parse(cached.body) as unknown, date);
  validateSiDayCandles(candles, date);
  if (candles.length > 421) throw new Error(`Unexpectedly many TRUR candles in ${path}`);
  return { candles, sha256: cached.sha256 };
}

async function main(): Promise<void> {
  if (process.argv.slice(2).some((flag) => flag !== '--fetch')) throw new Error('Only --fetch is supported');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const dates = weekdays2025();
  if (process.argv.includes('--fetch')) {
    let next = 0;
    let completed = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (next < dates.length) {
        const date = dates[next++]!;
        if (!existsSync(cachePath(date))) {
          const cached = await fetchDay(date);
          const temporary = `${cachePath(date)}.part`;
          writeFileSync(temporary, gzipSync(JSON.stringify(cached)), { mode: 0o600, flag: 'wx' });
          renameSync(temporary, cachePath(date));
        }
        readCachedTrurDay(date);
        completed += 1;
        if (completed % 40 === 0 || completed === dates.length) console.log(JSON.stringify({ completed, total: dates.length }));
        await sleep(100);
      }
    }));
  }
  const days = dates.map((date) => {
    const { candles, sha256 } = readCachedTrurDay(date);
    const first = candles.find((candle) => candle.time.slice(11, 16) >= '10:01' && candle.time.slice(11, 16) <= '10:03');
    const last = candles.find((candle) => candle.time.slice(11, 16) >= '16:55' && candle.time.slice(11, 16) <= '17:00');
    return { date, sha256, candleCount: candles.length, entryPrint: !!first, exitPrint: !!last };
  });
  const active = days.filter((day) => day.candleCount > 0);
  const report = { source: 'MOEX ISS TRUR TQTF one-minute trade candles, 10:00–17:00 MSK, 2025',
    summary: { weekdays: days.length, active: active.length, complete421: active.filter((day) => day.candleCount === 421).length,
      entryPrint: active.filter((day) => day.entryPrint).length, exitPrint: active.filter((day) => day.exitPrint).length,
      bothPrints: active.filter((day) => day.entryPrint && day.exitPrint).length,
      unresolvedEntered: active.filter((day) => day.entryPrint && !day.exitPrint).length }, days };
  const body = `${JSON.stringify(report, null, 2)}\n`;
  writeFileSync(sourcePath, body, { mode: 0o600 });
  console.log(JSON.stringify({ sourcePath, sha256: hash(body), summary: report.summary }));
}

if (process.argv[1]?.endsWith('/research-trur-2025.js')) {
  main().catch((error: unknown) => { console.error(`TRUR 2025 source failed: ${error instanceof Error ? error.message : 'unknown failure'}`); process.exitCode = 1; });
}
