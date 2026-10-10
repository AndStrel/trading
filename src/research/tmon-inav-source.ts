import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { si2026DaySpecs } from '../research-si-2026-source.js';

export type InavCandle = { time: string; open: number; close: number; high: number; low: number };
type RawPage = { sha256: string; body: string };
type CachedDay = { version: 1; date: string; indicator: 'TMONA'; board: 'INAV'; pages: RawPage[] };
const directory = join(process.cwd(), '.trading', 'tmon-inav-2026-source');
const reportPath = join(process.cwd(), '.trading', 'tmon-inav-2026-source.json');
const hash = (body: string | Buffer) => createHash('sha256').update(body).digest('hex');
const cachePath = (date: string) => join(directory, `${date}.json.gz`);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function parseInavPage(payload: unknown, date: string): InavCandle[] {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid iNAV response');
  const candles = (payload as Record<string, unknown>).candles;
  if (!candles || typeof candles !== 'object') throw new Error('Missing iNAV candles');
  const { columns, data } = candles as { columns?: unknown; data?: unknown };
  if (!Array.isArray(columns) || !Array.isArray(data)) throw new Error('Invalid iNAV columns/data');
  const indexes = ['open', 'close', 'high', 'low', 'begin'].map((field) => columns.indexOf(field));
  if (indexes.some((index) => index < 0)) throw new Error('Missing iNAV field');
  return data.map((raw) => {
    if (!Array.isArray(raw)) throw new Error('Invalid iNAV row');
    const [open, close, high, low] = indexes.slice(0, 4).map((index) => Number(raw[index]));
    const time = raw[indexes[4]!];
    if (typeof time !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:00$/.test(time) || !time.startsWith(`${date} `) ||
      ![open, close, high, low].every((value) => typeof value === 'number' && Number.isFinite(value) && value > 0) ||
      low! > Math.min(open!, close!) || high! < Math.max(open!, close!)) throw new Error(`Invalid iNAV candle ${date}`);
    return { time, open: open!, close: close!, high: high!, low: low! };
  });
}

export function readCachedInavDay(date: string): { candles: InavCandle[]; pageHashes: string[] } {
  const path = cachePath(date);
  if (!existsSync(path)) throw new Error(`Missing iNAV source ${path}`);
  const day = JSON.parse(gunzipSync(readFileSync(path)).toString('utf8')) as CachedDay;
  if (day.version !== 1 || day.date !== date || day.indicator !== 'TMONA' || day.board !== 'INAV' || !Array.isArray(day.pages) || !day.pages.length) {
    throw new Error(`Invalid iNAV cache ${path}`);
  }
  const candles: InavCandle[] = [];
  for (const page of day.pages) {
    if (page.sha256 !== hash(page.body)) throw new Error(`iNAV raw hash mismatch ${path}`);
    candles.push(...parseInavPage(JSON.parse(page.body) as unknown, date));
  }
  if (candles.length > 1440 || candles.some((row, index) => index > 0 && row.time <= candles[index - 1]!.time)) {
    throw new Error(`Unsorted or duplicated iNAV candles ${path}`);
  }
  if (day.pages.slice(0, -1).some((page) => parseInavPage(JSON.parse(page.body) as unknown, date).length !== 500)) {
    throw new Error(`iNAV pagination gap ${path}`);
  }
  return { candles, pageHashes: day.pages.map((page) => page.sha256) };
}

async function fetchPage(date: string, start: number): Promise<RawPage> {
  const url = new URL('https://iss.moex.com/iss/engines/stock/markets/index/boards/INAV/securities/TMONA/candles.json');
  for (const [key, value] of Object.entries({ 'iss.meta': 'off', interval: '1', from: date, till: date, start: String(start) })) url.searchParams.set(key, value);
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'AndStrel.trading-mcp' }, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`MOEX HTTP ${response.status}`);
      const body = await response.text();
      parseInavPage(JSON.parse(body) as unknown, date);
      return { sha256: hash(body), body };
    } catch (error) {
      if (attempt === 4) throw new Error(`${date} page ${start}: ${error instanceof Error ? error.message : 'unknown error'}`);
      await sleep(500 * 2 ** (attempt - 1));
    }
  }
  throw new Error('iNAV retry limit');
}

async function fetchDay(date: string): Promise<CachedDay> {
  const pages: RawPage[] = [];
  for (let start = 0; start <= 1500; start += 500) {
    const page = await fetchPage(date, start);
    pages.push(page);
    if (parseInavPage(JSON.parse(page.body) as unknown, date).length < 500) {
      return { version: 1, date, indicator: 'TMONA', board: 'INAV', pages };
    }
    await sleep(100);
  }
  throw new Error(`iNAV pagination limit ${date}`);
}

async function main(): Promise<void> {
  const flags = process.argv.slice(2);
  if (flags.some((flag) => flag !== '--fetch')) throw new Error('Only --fetch is supported');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const dates = si2026DaySpecs().map((spec) => spec.date);
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
        readCachedInavDay(date);
        completed += 1;
        if (completed % 20 === 0 || completed === dates.length) process.stdout.write(`${JSON.stringify({ completed, total: dates.length })}\n`);
        await sleep(100);
      }
    }));
  }
  const days = dates.map((date) => {
    const { candles, pageHashes } = readCachedInavDay(date);
    const window = candles.filter((row) => row.time.slice(11, 16) >= '10:00' && row.time.slice(11, 16) <= '17:00');
    return { date, pageHashes, totalCandles: candles.length, windowCandles: window.length,
      has1000: window.some((row) => row.time === `${date} 10:00:00`),
      distinctWindowClose: new Set(window.map((row) => row.close)).size,
      changedAfter1000: window.some((row) => row.close !== window[0]?.close) };
  });
  const report = { protocol: 'docs/TMON_INAV_SOURCE_PROTOCOL.md',
    source: 'MOEX ISS TMONA INAV one-minute index candles, raw pages hash checked',
    summary: { weekdays: days.length, daysWith1000: days.filter((day) => day.has1000).length,
      full1000to1700: days.filter((day) => day.windowCandles === 421).length,
      daysWithWindowChange: days.filter((day) => day.changedAfter1000).length,
      missingWindowDates: days.filter((day) => day.windowCandles !== 421).map((day) => day.date) }, days };
  const body = `${JSON.stringify(report, null, 2)}\n`;
  writeFileSync(reportPath, body, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ reportPath, sha256: hash(body), summary: report.summary })}\n`);
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  main().catch((error: unknown) => { process.stderr.write(`TMON iNAV source failed: ${error instanceof Error ? error.message : 'unknown error'}\n`); process.exitCode = 1; });
}
