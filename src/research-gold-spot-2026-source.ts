import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { tgld2026DaySpecs, type TgldDaySpec } from './research-tgld-2026-feasibility.js';

export type GoldPriceCandle = { time: string; open: number; close: number; high: number; low: number };
type CachedDay = { version: 1; date: string; sha256: string; body: string };
const directory = join(process.cwd(), '.trading', 'gold-spot-2026-source');
const output = join(process.cwd(), '.trading', 'gold-spot-2026-source.json');
const hash = (body: string) => createHash('sha256').update(body).digest('hex');
const cachePath = (date: string) => join(directory, `${date}.json.gz`);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function parseGoldPricePage(payload: unknown, date: string): GoldPriceCandle[] {
  if (typeof payload !== 'object' || payload === null) throw new Error('Invalid gold response');
  const block = (payload as { candles?: unknown }).candles;
  if (typeof block !== 'object' || block === null) throw new Error('Missing gold candles block');
  const { columns, data } = block as { columns?: unknown; data?: unknown };
  if (!Array.isArray(columns) || !Array.isArray(data)) throw new Error('Invalid gold candle table');
  const names = columns.map((name) => String(name).toLowerCase());
  const indices = ['begin', 'open', 'close', 'high', 'low'].map((name) => names.indexOf(name));
  if (indices.some((index) => index < 0)) throw new Error('Missing gold price column');
  const result: GoldPriceCandle[] = [];
  for (const row of data) {
    if (!Array.isArray(row)) throw new Error('Invalid gold candle row');
    const [timeIndex, openIndex, closeIndex, highIndex, lowIndex] = indices;
    const time = row[timeIndex!];
    const open = Number(row[openIndex!]);
    const close = Number(row[closeIndex!]);
    const high = Number(row[highIndex!]);
    const low = Number(row[lowIndex!]);
    if (typeof time !== 'string' || !/\d{4}-\d{2}-\d{2} (1[0-6]:[0-5]\d|17:00):00/.test(time) ||
        !time.startsWith(`${date} `) || ![open, close, high, low].every((price) => Number.isFinite(price) && price > 0) ||
        low > Math.min(open, close) || high < Math.max(open, close)) throw new Error(`Invalid gold candle ${date}`);
    result.push({ time, open, close, high, low });
  }
  for (let index = 1; index < result.length; index += 1) {
    if (result[index]!.time <= result[index - 1]!.time) throw new Error(`Unsorted gold candles ${date}`);
  }
  if (result.length > 421) throw new Error(`Too many gold candles ${date}`);
  return result;
}

async function fetchDay(date: string): Promise<CachedDay> {
  const url = new URL('https://iss.moex.com/iss/engines/currency/markets/selt/boards/CETS/securities/GLDRUB_TOM/candles.json');
  for (const [key, value] of Object.entries({ interval: '1', from: `${date} 10:00:00`, till: `${date} 17:00:00`,
    'iss.meta': 'off', 'iss.only': 'candles', 'candles.columns': 'open,close,high,low,value,volume,begin' })) url.searchParams.set(key, value);
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'AndStrel.trading-mcp' }, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`MOEX HTTP ${response.status}`);
      const body = await response.text();
      parseGoldPricePage(JSON.parse(body) as unknown, date);
      return { version: 1, date, sha256: hash(body), body };
    } catch (error) {
      if (attempt === 4) throw new Error(`${date}: ${error instanceof Error ? error.message : 'unknown failure'}`);
      await sleep(500 * 2 ** (attempt - 1));
    }
  }
  throw new Error('MOEX gold retry attempts exhausted');
}

export function readCachedGoldDay(date: string): { candles: GoldPriceCandle[]; sha256: string } {
  const path = cachePath(date);
  if (!existsSync(path)) throw new Error(`Missing gold source ${path}`);
  const cached = JSON.parse(gunzipSync(readFileSync(path)).toString('utf8')) as CachedDay;
  if (cached.version !== 1 || cached.date !== date || typeof cached.body !== 'string' || cached.sha256 !== hash(cached.body)) {
    throw new Error(`Invalid gold source ${path}`);
  }
  return { candles: parseGoldPricePage(JSON.parse(cached.body) as unknown, date), sha256: cached.sha256 };
}

async function main(): Promise<void> {
  const flags = process.argv.slice(2);
  if (flags.some((flag) => flag !== '--fetch')) throw new Error('Only --fetch is supported');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const specs: TgldDaySpec[] = tgld2026DaySpecs();
  if (flags.includes('--fetch')) {
    let next = 0;
    let completed = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (next < specs.length) {
        const date = specs[next++]!.date;
        if (!existsSync(cachePath(date))) {
          const cached = await fetchDay(date);
          const temporary = `${cachePath(date)}.part`;
          writeFileSync(temporary, gzipSync(JSON.stringify(cached)), { mode: 0o600, flag: 'wx' });
          renameSync(temporary, cachePath(date));
        }
        readCachedGoldDay(date);
        completed += 1;
        if (completed % 20 === 0 || completed === specs.length) console.log(JSON.stringify({ completed, total: specs.length }));
        await sleep(100);
      }
    }));
  }
  const sources = specs.map((spec) => {
    const source = readCachedGoldDay(spec.date);
    return { date: spec.date, candleCount: source.candles.length, sha256: source.sha256 };
  });
  const report = { source: 'MOEX ISS GLDRUB_TOM CETS one-minute price candles, 10:00–17:00 MSK; volume/value can be null',
    summary: { dates: sources.length, active: sources.filter((source) => source.candleCount > 0).length,
      complete421: sources.filter((source) => source.candleCount === 421).length,
      firstMissing: sources.filter((source) => source.candleCount === 0).map((source) => source.date) }, sources };
  const body = `${JSON.stringify(report, null, 2)}\n`;
  writeFileSync(output, body, { mode: 0o600 });
  console.log(JSON.stringify({ output, sha256: hash(body), summary: report.summary }));
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  main().catch((error: unknown) => { console.error(`Gold spot source failed: ${error instanceof Error ? error.message : 'unknown failure'}`); process.exitCode = 1; });
}
