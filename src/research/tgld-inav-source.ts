import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { tgld2026DaySpecs } from '../research-tgld-2026-feasibility.js';
import { parseInavPage, type InavCandle } from './tmon-inav-source.js';

type Page = { sha256: string; body: string };
type Cached = { version: 1; date: string; indicator: 'TGLDB'; pages: Page[] };
const directory = join(process.cwd(), '.trading', 'tgld-inav-2026-source');
const manifestPath = join(process.cwd(), '.trading', 'tgld-inav-2026-source.json');
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const cachePath = (date: string) => join(directory, `${date}.json.gz`);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function readCachedTgldInavDay(date: string): { candles: InavCandle[]; pageHashes: string[] } {
  const path = cachePath(date);
  if (!existsSync(path)) throw new Error(`Missing TGLDB cache ${path}`);
  const cached = JSON.parse(gunzipSync(readFileSync(path)).toString('utf8')) as Cached;
  if (cached.version !== 1 || cached.date !== date || cached.indicator !== 'TGLDB' || !Array.isArray(cached.pages) || !cached.pages.length) {
    throw new Error(`Invalid TGLDB cache ${path}`);
  }
  const candles: InavCandle[] = [];
  for (const [index, page] of cached.pages.entries()) {
    if (page.sha256 !== digest(page.body)) throw new Error(`TGLDB raw hash mismatch ${path}`);
    const rows = parseInavPage(JSON.parse(page.body) as unknown, date);
    if (index < cached.pages.length - 1 && rows.length !== 500) throw new Error(`TGLDB pagination gap ${path}`);
    candles.push(...rows);
  }
  if (candles.length > 1440 || candles.some((row, index) => index > 0 && row.time <= candles[index - 1]!.time)) {
    throw new Error(`Unsorted or duplicated TGLDB candles ${path}`);
  }
  return { candles, pageHashes: cached.pages.map((page) => page.sha256) };
}

async function fetchPage(date: string, start: number): Promise<Page> {
  const url = new URL('https://iss.moex.com/iss/engines/stock/markets/index/boards/INAV/securities/TGLDB/candles.json');
  for (const [key, value] of Object.entries({ 'iss.meta': 'off', interval: '1', from: date, till: date, start: String(start) })) url.searchParams.set(key, value);
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'AndStrel.trading-mcp' }, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`MOEX HTTP ${response.status}`);
      const body = await response.text();
      parseInavPage(JSON.parse(body) as unknown, date);
      return { sha256: digest(body), body };
    } catch (error) {
      if (attempt === 4) throw new Error(`${date} page ${start}: ${error instanceof Error ? error.message : 'unknown error'}`);
      await sleep(500 * 2 ** (attempt - 1));
    }
  }
  throw new Error('TGLDB retry limit');
}

async function fetchDay(date: string): Promise<Cached> {
  const pages: Page[] = [];
  for (let start = 0; start <= 1500; start += 500) {
    const page = await fetchPage(date, start);
    pages.push(page);
    if (parseInavPage(JSON.parse(page.body) as unknown, date).length < 500) return { version: 1, date, indicator: 'TGLDB', pages };
    await sleep(100);
  }
  throw new Error(`TGLDB pagination limit ${date}`);
}

async function main(): Promise<void> {
  const flags = process.argv.slice(2);
  if (flags.some((flag) => flag !== '--fetch')) throw new Error('Only --fetch is supported');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const dates = tgld2026DaySpecs().map((spec) => spec.date);
  if (flags.includes('--fetch')) {
    let next = 0;
    let completed = 0;
    await Promise.all(Array.from({ length: 3 }, async () => {
      while (next < dates.length) {
        const date = dates[next++]!;
        if (!existsSync(cachePath(date))) {
          const cached = await fetchDay(date);
          const temp = `${cachePath(date)}.part`;
          writeFileSync(temp, gzipSync(JSON.stringify(cached)), { mode: 0o600, flag: 'wx' });
          renameSync(temp, cachePath(date));
        }
        readCachedTgldInavDay(date);
        completed += 1;
        if (completed % 20 === 0 || completed === dates.length) process.stdout.write(`${JSON.stringify({ completed, total: dates.length })}\n`);
        await sleep(100);
      }
    }));
  }
  const days = dates.map((date) => {
    const { candles, pageHashes } = readCachedTgldInavDay(date);
    const window = candles.filter((candle) => candle.time.slice(11, 16) >= '10:00' && candle.time.slice(11, 16) <= '17:00');
    return { date, pageHashes, totalCandles: candles.length, windowCandles: window.length,
      distinctWindowClose: new Set(window.map((candle) => candle.close)).size };
  });
  const report = { protocol: 'docs/TGLD_INAV_SOURCE_PROTOCOL.md',
    source: 'MOEX ISS TGLDB rub-denominated one-minute iNAV candles',
    summary: { dates: days.length, full1000to1700: days.filter((day) => day.windowCandles === 421).length,
      changedWithinWindow: days.filter((day) => day.distinctWindowClose > 1).length,
      missingWindowDates: days.filter((day) => day.windowCandles !== 421).map((day) => day.date) }, days };
  const body = `${JSON.stringify(report, null, 2)}\n`;
  writeFileSync(manifestPath, body, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ manifestPath, sha256: digest(body), summary: report.summary })}\n`);
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  main().catch((error: unknown) => { process.stderr.write(`TGLDB source failed: ${error instanceof Error ? error.message : 'unknown error'}\n`); process.exitCode = 1; });
}
