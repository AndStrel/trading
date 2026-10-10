import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { type SiCandle } from './research/si-first-hour.js';
import { br2026DaySpecs, type DaySpec } from './research-br-2026-source.js';

const sourceDir = join(process.cwd(), '.trading', 'br-2026-late-source');
const reportPath = join(process.cwd(), '.trading', 'br-2026-late-source.json');
const specialDates = new Set(['2026-05-01', '2026-06-12']);
type CachedWindow = { version: 1; date: string; contract: DaySpec['contract']; sha256: string; body: string };
const hash = (body: string) => createHash('sha256').update(body).digest('hex');
const cachePath = (date: string) => join(sourceDir, `${date}.json.gz`);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function parseBrLatePage(payload: unknown, date: string): SiCandle[] {
  if (typeof payload !== 'object' || payload === null) throw new Error('Invalid MOEX response');
  const block = (payload as { candles?: unknown }).candles;
  if (typeof block !== 'object' || block === null) throw new Error('Missing candles block');
  const { columns, data } = block as { columns?: unknown; data?: unknown };
  if (!Array.isArray(columns) || !Array.isArray(data)) throw new Error('Invalid candle table');
  const names = columns.map((name) => String(name).toLowerCase());
  const indices = ['begin', 'open', 'close', 'high', 'low', 'volume'].map((name) => names.indexOf(name));
  if (indices.some((index) => index < 0)) throw new Error('Missing candle column');
  const result: SiCandle[] = [];
  for (const row of data) {
    if (!Array.isArray(row)) throw new Error('Invalid candle row');
    const [timeIndex, openIndex, closeIndex, highIndex, lowIndex, volumeIndex] = indices;
    const time = row[timeIndex!];
    const open = Number(row[openIndex!]);
    const close = Number(row[closeIndex!]);
    const high = Number(row[highIndex!]);
    const low = Number(row[lowIndex!]);
    const volume = Number(row[volumeIndex!]);
    if (typeof time !== 'string' || !new RegExp(`^${date} (17|18):[0-5]\\d:00$`).test(time) ||
        ![open, close, high, low].every((price) => Number.isFinite(price) && price > 0) ||
        !Number.isSafeInteger(volume) || volume < 0 || low > Math.min(open, close) || high < Math.max(open, close)) {
      throw new Error(`Invalid BR late candle for ${date}`);
    }
    result.push({ time, open, close, high, low, volume });
  }
  for (let index = 1; index < result.length; index += 1) {
    if (result[index]!.time <= result[index - 1]!.time) throw new Error(`Unsorted BR late candles for ${date}`);
  }
  if (result.length > 120) throw new Error(`Too many BR late candles for ${date}`);
  return result;
}

async function fetchWindow(spec: DaySpec): Promise<CachedWindow> {
  const url = new URL(`https://iss.moex.com/iss/engines/futures/markets/forts/boards/RFUD/securities/${spec.contract}/candles.json`);
  for (const [key, value] of Object.entries({ interval: '1', from: `${spec.date} 17:00:00`, till: `${spec.date} 18:59:00`,
    'iss.meta': 'off', 'iss.only': 'candles', 'candles.columns': 'open,close,high,low,volume,begin' })) url.searchParams.set(key, value);
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'AndStrel.trading-mcp' }, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`MOEX HTTP ${response.status}`);
      const body = await response.text();
      parseBrLatePage(JSON.parse(body) as unknown, spec.date);
      return { version: 1, date: spec.date, contract: spec.contract, sha256: hash(body), body };
    } catch (error) {
      if (attempt === 4) throw new Error(`${spec.date} ${spec.contract}: ${error instanceof Error ? error.message : 'unknown failure'}`);
      await sleep(500 * 2 ** (attempt - 1));
    }
  }
  throw new Error('Retry attempts exhausted');
}

export function readCachedBrLate(spec: DaySpec): { candles: SiCandle[]; sha256: string } {
  const path = cachePath(spec.date);
  if (!existsSync(path)) throw new Error(`Missing source snapshot ${path}`);
  const cached = JSON.parse(gunzipSync(readFileSync(path)).toString('utf8')) as CachedWindow;
  if (cached.version !== 1 || cached.date !== spec.date || cached.contract !== spec.contract ||
      typeof cached.body !== 'string' || cached.sha256 !== hash(cached.body)) throw new Error(`Invalid source snapshot ${path}`);
  return { candles: parseBrLatePage(JSON.parse(cached.body) as unknown, spec.date), sha256: cached.sha256 };
}

async function main(): Promise<void> {
  const flags = process.argv.slice(2);
  if (flags.some((flag) => flag !== '--fetch')) throw new Error('Only --fetch is supported');
  mkdirSync(sourceDir, { recursive: true, mode: 0o700 });
  chmodSync(sourceDir, 0o700);
  const specs = br2026DaySpecs().filter((spec) => !specialDates.has(spec.date));
  if (flags.includes('--fetch')) {
    let next = 0;
    let completed = 0;
    await Promise.all(Array.from({ length: 3 }, async () => {
      while (next < specs.length) {
        const spec = specs[next++]!;
        if (!existsSync(cachePath(spec.date))) {
          const cached = await fetchWindow(spec);
          const temporary = `${cachePath(spec.date)}.part`;
          writeFileSync(temporary, gzipSync(JSON.stringify(cached)), { mode: 0o600, flag: 'wx' });
          renameSync(temporary, cachePath(spec.date));
        }
        readCachedBrLate(spec);
        completed += 1;
        if (completed % 20 === 0 || completed === specs.length) console.log(JSON.stringify({ completed, total: specs.length }));
        await sleep(100);
      }
    }));
  }
  const sources = specs.map((spec) => {
    const source = readCachedBrLate(spec);
    return { ...spec, candleCount: source.candles.length, sha256: source.sha256 };
  });
  const report = { source: 'MOEX ISS RFUD exact-contract BR one-minute 17:00–18:59 MSK',
    period: { first: specs[0]?.date, last: specs.at(-1)?.date },
    summary: { dates: sources.length, complete: sources.filter((source) => source.candleCount === 120).length,
      incomplete: sources.filter((source) => source.candleCount !== 120).map((source) => source.date) }, sources };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ reportPath, summary: report.summary }));
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  main().catch((error: unknown) => { console.error(`BR late source failed: ${error instanceof Error ? error.message : 'unknown failure'}`); process.exitCode = 1; });
}
