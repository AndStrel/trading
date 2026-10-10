import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { parseSiCandlePage, validateSiDayCandles, type SiCandle } from './research/si-first-hour.js';

export type TgldDaySpec = { date: string; board: 'TQTF' | 'TQBR' };
type CachedDay = { version: 1; date: string; board: TgldDaySpec['board']; sha256: string; body: string };
const directory = join(process.cwd(), '.trading', 'tgld-2026-source');
const output = join(process.cwd(), '.trading', 'tgld-2026-feasibility.json');
const specialDates = new Set(['2026-05-01', '2026-06-12']);
const sha256 = (body: string) => createHash('sha256').update(body).digest('hex');
const cachePath = (date: string) => join(directory, `${date}.json.gz`);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function tgld2026DaySpecs(): TgldDaySpec[] {
  const result: TgldDaySpec[] = [];
  for (let ms = Date.parse('2026-03-23T00:00:00Z'); ms <= Date.parse('2026-09-25T00:00:00Z'); ms += 86_400_000) {
    const day = new Date(ms);
    const date = day.toISOString().slice(0, 10);
    if (day.getUTCDay() === 0 || day.getUTCDay() === 6 || specialDates.has(date)) continue;
    result.push({ date, board: date <= '2026-06-19' ? 'TQTF' : 'TQBR' });
  }
  return result;
}

async function fetchDay(spec: TgldDaySpec): Promise<CachedDay> {
  const url = new URL(`https://iss.moex.com/iss/engines/stock/markets/shares/boards/${spec.board}/securities/TGLD/candles.json`);
  for (const [key, value] of Object.entries({ interval: '1', from: `${spec.date} 10:00:00`, till: `${spec.date} 17:00:00`,
    'iss.meta': 'off', 'iss.only': 'candles', 'candles.columns': 'open,close,high,low,volume,begin' })) url.searchParams.set(key, value);
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'AndStrel.trading-mcp' }, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`MOEX HTTP ${response.status}`);
      const body = await response.text();
      parseSiCandlePage(JSON.parse(body) as unknown, spec.date);
      return { version: 1, ...spec, sha256: sha256(body), body };
    } catch (error) {
      if (attempt === 4) throw new Error(`${spec.date} ${spec.board}: ${error instanceof Error ? error.message : 'unknown failure'}`);
      await sleep(500 * 2 ** (attempt - 1));
    }
  }
  throw new Error('MOEX retry attempts exhausted');
}

export function readCachedTgldDay(spec: TgldDaySpec): { candles: SiCandle[]; sha256: string } {
  const path = cachePath(spec.date);
  if (!existsSync(path)) throw new Error(`Missing TGLD source ${path}`);
  const cached = JSON.parse(gunzipSync(readFileSync(path)).toString('utf8')) as CachedDay;
  if (cached.version !== 1 || cached.date !== spec.date || cached.board !== spec.board ||
      typeof cached.body !== 'string' || cached.sha256 !== sha256(cached.body)) throw new Error(`Invalid TGLD source ${path}`);
  const candles = parseSiCandlePage(JSON.parse(cached.body) as unknown, spec.date);
  validateSiDayCandles(candles, spec.date);
  if (candles.length > 421) throw new Error(`Unexpectedly many TGLD candles in ${path}`);
  return { candles, sha256: cached.sha256 };
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

async function main(): Promise<void> {
  const flags = process.argv.slice(2);
  if (flags.some((flag) => flag !== '--fetch')) throw new Error('Only --fetch is supported');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const specs = tgld2026DaySpecs();
  if (flags.includes('--fetch')) {
    let next = 0;
    let completed = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (next < specs.length) {
        const spec = specs[next++]!;
        if (!existsSync(cachePath(spec.date))) {
          const cached = await fetchDay(spec);
          const temporary = `${cachePath(spec.date)}.part`;
          writeFileSync(temporary, gzipSync(JSON.stringify(cached)), { mode: 0o600, flag: 'wx' });
          renameSync(temporary, cachePath(spec.date));
        }
        readCachedTgldDay(spec);
        completed += 1;
        if (completed % 20 === 0 || completed === specs.length) console.log(JSON.stringify({ completed, total: specs.length }));
        await sleep(100);
      }
    }));
  }
  const days = specs.map((spec) => {
    const { candles, sha256: sourceHash } = readCachedTgldDay(spec);
    const first = candles[0];
    const last = candles.at(-1);
    return { ...spec, sourceHash, candleCount: candles.length, firstTime: first?.time ?? null, lastTime: last?.time ?? null,
      firstLastReturn: first && last ? last.close / first.open - 1 : null,
      highLowRange: first ? (Math.max(...candles.map((candle) => candle.high)) - Math.min(...candles.map((candle) => candle.low))) / first.open : null };
  });
  const returns = days.map((day) => day.firstLastReturn).filter((value): value is number => value !== null);
  const ranges = days.map((day) => day.highLowRange).filter((value): value is number => value !== null);
  const counts = days.map((day) => day.candleCount);
  const report = {
    purpose: 'Feasibility screen only: first/last executed trades are not actionable bid/ask fills or a predeclared trading rule',
    source: 'MOEX ISS TGLD TQTF through 2026-06-19, TQBR from 2026-06-22; 10:00–17:00 MSK one-minute trade candles',
    summary: { dates: days.length, active: days.filter((day) => day.candleCount > 0).length,
      candleCountMin: Math.min(...counts), candleCountMedian: median(counts), candleCountMax: Math.max(...counts),
      firstAt1000: days.filter((day) => day.firstTime?.endsWith('10:00:00')).length,
      lastAtOrAfter1655: days.filter((day) => day.lastTime !== null && day.lastTime.slice(11, 16) >= '16:55').length,
      firstLastPositive: returns.filter((value) => value > 0).length,
      firstLastZero: returns.filter((value) => value === 0).length,
      firstLastNegative: returns.filter((value) => value < 0).length,
      firstLastMean: returns.reduce((sum, value) => sum + value, 0) / returns.length,
      firstLastMedian: median(returns), medianHighLowRange: median(ranges) }, days,
  };
  const body = `${JSON.stringify(report, null, 2)}\n`;
  writeFileSync(output, body, { mode: 0o600 });
  console.log(JSON.stringify({ output, sha256: sha256(body), summary: report.summary }));
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  main().catch((error: unknown) => { console.error(`TGLD feasibility failed: ${error instanceof Error ? error.message : 'unknown failure'}`); process.exitCode = 1; });
}
