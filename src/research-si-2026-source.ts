import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

import { parseSiCandlePage, validateSiDayCandles, type SiCandle } from './research/si-first-hour.js';

export type DaySpec = { date: string; contract: 'SiM6' | 'SiU6' | 'SiZ6' };
type RawPage = { sha256: string; body: string };
type CachedDay = { version: 1; date: string; contract: DaySpec['contract']; pages: RawPage[] };

const sourceDir = join(process.cwd(), '.trading', 'si-2026-continuous-source');
const reportPath = join(process.cwd(), '.trading', 'si-2026-continuous-source.json');
// Public MOEX calendar: these weekday dates ran in special weekend-style sessions,
// not the ordinary weekday RFUD session evaluated here.
const specialSessionDates = new Set(['2026-05-01', '2026-06-12']);

function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

export function si2026DaySpecs(): DaySpec[] {
  const result: DaySpec[] = [];
  for (let ms = Date.parse('2026-03-23T00:00:00Z'); ms <= Date.parse('2026-09-25T00:00:00Z'); ms += 86_400_000) {
    const current = new Date(ms);
    if (current.getUTCDay() === 0 || current.getUTCDay() === 6) continue;
    const date = current.toISOString().slice(0, 10);
    const contract = date <= '2026-06-10' ? 'SiM6' : date <= '2026-09-10' ? 'SiU6' : 'SiZ6';
    result.push({ date, contract });
  }
  return result;
}

function cachePath(date: string): string {
  return join(sourceDir, `${date}.json.gz`);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPage(spec: DaySpec, start: number): Promise<RawPage> {
  const url = new URL(`https://iss.moex.com/iss/engines/futures/markets/forts/boards/RFUD/securities/${spec.contract}/candles.json`);
  for (const [key, value] of Object.entries({
    interval: '1', from: `${spec.date} 10:00:00`, till: `${spec.date} 17:00:00`, start: String(start),
    'iss.meta': 'off', 'iss.only': 'candles', 'candles.columns': 'open,close,high,low,volume,begin',
  })) url.searchParams.set(key, value);
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'AndStrel.trading-mcp' },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`MOEX HTTP ${response.status}`);
      const body = await response.text();
      parseSiCandlePage(JSON.parse(body) as unknown, spec.date);
      return { sha256: sha256(body), body };
    } catch (error) {
      if (attempt === 4) throw new Error(`${spec.contract} ${spec.date} page ${start}: ${error instanceof Error ? error.message : 'unknown failure'}`);
      await sleep(500 * 2 ** (attempt - 1));
    }
  }
  throw new Error('MOEX retry attempts exhausted');
}

async function fetchDay(spec: DaySpec): Promise<CachedDay> {
  const pages: RawPage[] = [];
  for (let index = 0; index < 5; index += 1) {
    const page = await fetchPage(spec, index * 500);
    pages.push(page);
    if (parseSiCandlePage(JSON.parse(page.body) as unknown, spec.date).length < 500) {
      return { version: 1, date: spec.date, contract: spec.contract, pages };
    }
    await sleep(100);
  }
  throw new Error(`MOEX pagination limit exceeded for ${spec.contract} ${spec.date}`);
}

function writeCachedDay(day: CachedDay): void {
  const output = cachePath(day.date);
  if (existsSync(output)) throw new Error(`Refusing to replace source snapshot ${output}`);
  const temporary = `${output}.part`;
  writeFileSync(temporary, gzipSync(JSON.stringify(day)), { mode: 0o600, flag: 'wx' });
  renameSync(temporary, output);
}

export function readCachedSi2026Day(spec: DaySpec): { candles: SiCandle[]; pageHashes: string[] } {
  const path = cachePath(spec.date);
  if (!existsSync(path)) throw new Error(`Missing source snapshot ${path}; run --fetch first`);
  const day = JSON.parse(gunzipSync(readFileSync(path)).toString('utf8')) as CachedDay;
  if (day.version !== 1 || day.date !== spec.date || day.contract !== spec.contract || !Array.isArray(day.pages) || day.pages.length === 0) {
    throw new Error(`Invalid source snapshot ${path}`);
  }
  const candles: SiCandle[] = [];
  for (const page of day.pages) {
    if (typeof page.body !== 'string' || page.sha256 !== sha256(page.body)) throw new Error(`Source hash mismatch in ${path}`);
    candles.push(...parseSiCandlePage(JSON.parse(page.body) as unknown, spec.date));
  }
  if (day.pages.length > 1 && candles.length < 500 * (day.pages.length - 1)) {
    throw new Error(`Incomplete pagination in ${path}`);
  }
  validateSiDayCandles(candles, spec.date);
  if (candles.length > 421) throw new Error(`Unexpectedly many 10:00–17:00 candles in ${path}`);
  return { candles, pageHashes: day.pages.map((page) => page.sha256) };
}

async function main(): Promise<void> {
  const flags = process.argv.slice(2);
  if (flags.some((flag) => flag !== '--fetch')) throw new Error('Only --fetch is supported; omit flags for offline verification');
  mkdirSync(sourceDir, { recursive: true, mode: 0o700 });
  chmodSync(sourceDir, 0o700);
  const specs = si2026DaySpecs();
  if (flags.includes('--fetch')) {
    let nextIndex = 0;
    let completed = 0;
    const workers = Array.from({ length: 3 }, async () => {
      while (nextIndex < specs.length) {
        const spec = specs[nextIndex++]!;
        if (!existsSync(cachePath(spec.date))) writeCachedDay(await fetchDay(spec));
        readCachedSi2026Day(spec);
        completed += 1;
        if (completed % 20 === 0 || completed === specs.length) {
          console.log(JSON.stringify({ status: 'source_progress', completed, total: specs.length }));
        }
        await sleep(100);
      }
    });
    await Promise.all(workers);
  }
  const sources = specs.map((spec) => {
    const { candles, pageHashes } = readCachedSi2026Day(spec);
    const specialSession = specialSessionDates.has(spec.date);
    if (specialSession && candles.length !== 0) throw new Error(`Special session unexpectedly has RFUD candles: ${spec.date}`);
    return { ...spec, specialSession, candleCount: candles.length, pageHashes };
  });
  const regular = sources.filter((source) => !source.specialSession);
  const report = {
    source: 'MOEX ISS RFUD exact-contract one-minute candles, 10:00–17:00 MSK; no broker token',
    period: { first: specs[0]?.date, last: specs.at(-1)?.date },
    specialSessionSource: 'https://www.moex.com/n99627',
    summary: {
      weekdays: sources.length,
      specialSessions: sources.filter((source) => source.specialSession).length,
      regularSessions: regular.length,
      completeRegularSessions: regular.filter((source) => source.candleCount === 421).length,
      incompleteRegularDates: regular.filter((source) => source.candleCount !== 421).map((source) => source.date),
      byContract: Object.fromEntries(['SiM6', 'SiU6', 'SiZ6'].map((contract) => [contract, regular.filter((source) => source.contract === contract).length])),
    },
    sources,
  };
  const temporary = `${reportPath}.part`;
  writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, reportPath);
  console.log(JSON.stringify({ summary: report.summary, reportPath }));
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  main().catch((error: unknown) => {
    console.error(`Si 2026 source audit failed: ${error instanceof Error ? error.message : 'unknown failure'}`);
    process.exitCode = 1;
  });
}
