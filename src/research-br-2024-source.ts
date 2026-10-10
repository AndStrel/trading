import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

import { parseSiCandlePage, validateSiDayCandles, type SiCandle } from './research/si-first-hour.js';

type BrContract = 'BRG4' | 'BRH4' | 'BRJ4' | 'BRK4' | 'BRM4' | 'BRN4' | 'BRQ4' | 'BRU4' | 'BRV4';
export type Br2024DaySpec = { date: string; contract: BrContract };
type RawPage = { sha256: string; body: string };
type CachedDay = { version: 1; date: string; contract: BrContract; pages: RawPage[] };

const sourceDir = join(process.cwd(), '.trading', 'br-2024-continuous-source');
const reportPath = join(process.cwd(), '.trading', 'br-2024-continuous-source.json');
const contractByMonth: Record<string, BrContract> = {
  '01': 'BRG4', '02': 'BRH4', '03': 'BRJ4', '04': 'BRK4', '05': 'BRM4',
  '06': 'BRN4', '07': 'BRQ4', '08': 'BRU4', '09': 'BRV4',
};

function sha256(content: string | Buffer): string { return createHash('sha256').update(content).digest('hex'); }

export function br2024DaySpecs(): Br2024DaySpec[] {
  const result: Br2024DaySpec[] = [];
  for (let ms = Date.parse('2024-01-03T00:00:00Z'); ms <= Date.parse('2024-09-25T00:00:00Z'); ms += 86_400_000) {
    const current = new Date(ms);
    if (current.getUTCDay() === 0 || current.getUTCDay() === 6) continue;
    const date = current.toISOString().slice(0, 10);
    const contract = contractByMonth[date.slice(5, 7)];
    if (!contract) throw new Error(`No predetermined BR contract for ${date}`);
    result.push({ date, contract });
  }
  result.push({ date: '2024-04-27', contract: 'BRK4' });
  result.sort((a, b) => a.date.localeCompare(b.date));
  return result;
}

function cachePath(date: string): string { return join(sourceDir, `${date}.json.gz`); }
async function sleep(ms: number): Promise<void> { await new Promise((resolve) => setTimeout(resolve, ms)); }

async function fetchPage(spec: Br2024DaySpec, start: number): Promise<RawPage> {
  const url = new URL(`https://iss.moex.com/iss/engines/futures/markets/forts/boards/RFUD/securities/${spec.contract}/candles.json`);
  for (const [key, value] of Object.entries({
    interval: '1', from: `${spec.date} 10:00:00`, till: `${spec.date} 17:00:00`, start: String(start),
    'iss.meta': 'off', 'iss.only': 'candles', 'candles.columns': 'open,close,high,low,volume,begin',
  })) url.searchParams.set(key, value);
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'AndStrel.trading-mcp' }, signal: AbortSignal.timeout(30_000) });
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

async function fetchDay(spec: Br2024DaySpec): Promise<CachedDay> {
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

export function readCachedBr2024Day(spec: Br2024DaySpec): { candles: SiCandle[]; pageHashes: string[] } {
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
  if (day.pages.length > 1 && candles.length < 500 * (day.pages.length - 1)) throw new Error(`Incomplete pagination in ${path}`);
  validateSiDayCandles(candles, spec.date);
  if (candles.length > 421) throw new Error(`Unexpectedly many 10:00–17:00 candles in ${path}`);
  return { candles, pageHashes: day.pages.map((page) => page.sha256) };
}

async function main(): Promise<void> {
  const flags = process.argv.slice(2);
  if (flags.some((flag) => flag !== '--fetch')) throw new Error('Only --fetch is supported; omit flags for offline verification');
  mkdirSync(sourceDir, { recursive: true, mode: 0o700 });
  chmodSync(sourceDir, 0o700);
  const specs = br2024DaySpecs();
  if (flags.includes('--fetch')) {
    let nextIndex = 0;
    let completed = 0;
    await Promise.all(Array.from({ length: 3 }, async () => {
      while (nextIndex < specs.length) {
        const spec = specs[nextIndex++]!;
        if (!existsSync(cachePath(spec.date))) writeCachedDay(await fetchDay(spec));
        readCachedBr2024Day(spec);
        completed += 1;
        if (completed % 20 === 0 || completed === specs.length) console.log(JSON.stringify({ status: 'source_progress', completed, total: specs.length }));
        await sleep(100);
      }
    }));
  }
  const sources = specs.map((spec) => {
    const { candles, pageHashes } = readCachedBr2024Day(spec);
    return { ...spec, candleCount: candles.length, firstCandle: candles[0]?.time, lastCandle: candles.at(-1)?.time, pageHashes };
  });
  const noSessionDates = new Set(['2024-02-23', '2024-03-08', '2024-05-01', '2024-05-09', '2024-06-12']);
  const report = {
    source: 'MOEX ISS RFUD exact-contract BR one-minute candles, 10:00–17:00 MSK; no broker token',
    period: { first: specs[0]?.date, last: specs.at(-1)?.date },
    contractRule: 'January BRG4, February BRH4, March BRJ4, April BRK4, May BRM4, June BRN4, July BRQ4, August BRU4, September BRV4',
    officialCalendar: 'https://www.moex.com/n64121',
    summary: {
      dateSpecs: specs.length,
      weekdaySpecs: specs.filter((spec) => new Date(`${spec.date}T00:00:00Z`).getUTCDay() >= 1 && new Date(`${spec.date}T00:00:00Z`).getUTCDay() <= 5).length,
      weekendSessionDates: specs.filter((spec) => new Date(`${spec.date}T00:00:00Z`).getUTCDay() === 6).map((spec) => spec.date),
      verifiedNoSessionDates: [...noSessionDates],
      datesWithBars: sources.filter((source) => source.candleCount > 0).length,
      emptyDates: sources.filter((source) => source.candleCount === 0).map((source) => source.date),
      candleCount: sources.reduce((sum, source) => sum + source.candleCount, 0),
      datesByCount: Object.fromEntries([...new Set(sources.map((source) => source.candleCount))].sort((a, b) => a - b)
        .map((count) => [String(count), sources.filter((source) => source.candleCount === count).length])),
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
    console.error(`BR 2024 source audit failed: ${error instanceof Error ? error.message : 'unknown failure'}`);
    process.exitCode = 1;
  });
}
