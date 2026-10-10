import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

import {
  evaluateSiDay,
  parseSiCandlePage,
  siContractForDate,
  summarizeSiTrades,
  validateSiDayCandles,
  type SiCandle,
  type SiContract,
  type SiDecision,
} from './research/si-first-hour.js';

type RawPage = { sha256: string; body: string };
type CachedDay = { version: 1; date: string; contract: SiContract; pages: RawPage[] };

const researchDir = join(process.cwd(), '.trading', 'si-first-hour-v1');
const reportPath = join(process.cwd(), '.trading', 'si-first-hour-v1.json');
const protocolPath = join(process.cwd(), 'docs', 'SI_FIRST_HOUR_V1.md');
const pageSize = 500;
const maxPagesPerDate = 5;
// MOEX announced no exchange trading on 2025-11-04: https://www.moex.com/n94881
// This calendar classification was verified after the first run; it changes no trade.
const verifiedNoSessionDates = new Set(['2025-11-04']);

function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

export function weekdays(): string[] {
  const dates: string[] = [];
  for (let milliseconds = Date.parse('2025-07-01T00:00:00Z'); milliseconds <= Date.parse('2025-12-10T00:00:00Z'); milliseconds += 86_400_000) {
    const current = new Date(milliseconds);
    const weekday = current.getUTCDay();
    if (weekday !== 0 && weekday !== 6) dates.push(current.toISOString().slice(0, 10));
  }
  return dates;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchPage(date: string, contract: SiContract, start: number): Promise<RawPage> {
  const url = new URL(`https://iss.moex.com/iss/engines/futures/markets/forts/boards/RFUD/securities/${contract}/candles.json`);
  url.searchParams.set('interval', '1');
  url.searchParams.set('from', `${date} 10:00:00`);
  url.searchParams.set('till', `${date} 17:00:00`);
  url.searchParams.set('start', String(start));
  url.searchParams.set('iss.meta', 'off');
  url.searchParams.set('iss.only', 'candles');
  url.searchParams.set('candles.columns', 'open,close,high,low,volume,begin');
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'AndStrel.trading-mcp' },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`MOEX HTTP ${response.status}`);
      const body = await response.text();
      // Validate before the page can be cached.
      parseSiCandlePage(JSON.parse(body) as unknown, date);
      return { sha256: sha256(body), body };
    } catch (error) {
      if (attempt === 4) throw new Error(`${contract} ${date} page ${start}: ${error instanceof Error ? error.message : 'unknown failure'}`);
      await sleep(500 * 2 ** (attempt - 1));
    }
  }
  throw new Error('MOEX retry attempts exhausted');
}

async function fetchDay(date: string, contract: SiContract): Promise<CachedDay> {
  const pages: RawPage[] = [];
  for (let pageIndex = 0; pageIndex < maxPagesPerDate; pageIndex += 1) {
    const page = await fetchPage(date, contract, pageIndex * pageSize);
    pages.push(page);
    const candles = parseSiCandlePage(JSON.parse(page.body) as unknown, date);
    if (candles.length < pageSize) return { version: 1, date, contract, pages };
    await sleep(100);
  }
  throw new Error(`MOEX pagination limit exceeded for ${contract} ${date}`);
}

function cachePath(date: string): string {
  return join(researchDir, `${date}.json.gz`);
}

function writeCachedDay(day: CachedDay): void {
  const output = cachePath(day.date);
  if (existsSync(output)) throw new Error(`Refusing to replace existing source snapshot ${output}`);
  const temporary = `${output}.part`;
  writeFileSync(temporary, gzipSync(JSON.stringify(day)), { mode: 0o600, flag: 'wx' });
  renameSync(temporary, output);
}

export function readCachedDay(date: string, contract: SiContract): { candles: SiCandle[]; pageHashes: string[] } {
  const path = cachePath(date);
  if (!existsSync(path)) throw new Error(`Missing source snapshot ${path}; run --fetch first`);
  const day = JSON.parse(gunzipSync(readFileSync(path)).toString('utf8')) as CachedDay;
  if (day.version !== 1 || day.date !== date || day.contract !== contract || !Array.isArray(day.pages) || day.pages.length === 0) {
    throw new Error(`Invalid source snapshot ${path}`);
  }
  const candles: SiCandle[] = [];
  for (const page of day.pages) {
    if (typeof page.body !== 'string' || page.sha256 !== sha256(page.body)) throw new Error(`Source hash mismatch in ${path}`);
    candles.push(...parseSiCandlePage(JSON.parse(page.body) as unknown, date));
  }
  if (day.pages.length > 1 && candles.length < pageSize * (day.pages.length - 1)) {
    throw new Error(`Incomplete pagination in ${path}`);
  }
  validateSiDayCandles(candles, date);
  if (candles.length > 421) throw new Error(`Unexpectedly many 10:00–17:00 candles in ${path}`);
  return { candles, pageHashes: day.pages.map((page) => page.sha256) };
}

function writeReport(report: unknown): void {
  const temporary = `${reportPath}.part`;
  writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, reportPath);
}

async function main(): Promise<void> {
  const flags = process.argv.slice(2);
  if (flags.some((flag) => flag !== '--fetch')) throw new Error('Only --fetch is supported; omit flags for offline replay');
  if (!existsSync(protocolPath)) throw new Error(`Missing fixed protocol ${protocolPath}`);
  mkdirSync(researchDir, { recursive: true, mode: 0o700 });
  chmodSync(researchDir, 0o700);
  const dates = weekdays();
  if (flags.includes('--fetch')) {
    let nextIndex = 0;
    let completed = 0;
    const workers = Array.from({ length: 3 }, async () => {
      while (nextIndex < dates.length) {
        const date = dates[nextIndex++]!;
        const contract = siContractForDate(date);
        if (!contract) throw new Error(`No predetermined contract for ${date}`);
        if (!existsSync(cachePath(date))) writeCachedDay(await fetchDay(date, contract));
        readCachedDay(date, contract);
        completed += 1;
        if (completed % 10 === 0 || completed === dates.length) console.log(JSON.stringify({ status: 'source_progress', completed, total: dates.length }));
        await sleep(100);
      }
    });
    await Promise.all(workers);
  }
  const decisions: SiDecision[] = [];
  const sources: { date: string; contract: SiContract; candleCount: number; pageHashes: string[] }[] = [];
  for (const date of dates) {
    const contract = siContractForDate(date);
    if (!contract) throw new Error(`No predetermined contract for ${date}`);
    const { candles, pageHashes } = readCachedDay(date, contract);
    sources.push({ date, contract, candleCount: candles.length, pageHashes });
    const decision = evaluateSiDay(date, contract, candles);
    if (verifiedNoSessionDates.has(date)) {
      if (decision.status !== 'no_candles') throw new Error(`Verified non-trading date has unexpected candles: ${date}`);
      decisions.push({ date, contract, status: 'no_session' });
    } else {
      decisions.push(decision);
    }
  }
  const combined = summarizeSiTrades(decisions);
  const byContract = {
    SiU5: summarizeSiTrades(decisions.filter((decision) => decision.contract === 'SiU5')),
    SiZ5: summarizeSiTrades(decisions.filter((decision) => decision.contract === 'SiZ5')),
  };
  const bySide = {
    long: summarizeSiTrades(decisions.filter((decision) => decision.side === 'long')),
    short: summarizeSiTrades(decisions.filter((decision) => decision.side === 'short')),
  };
  const months = [...new Set(dates.map((date) => date.slice(0, 7)))];
  const byMonth = Object.fromEntries(months.map((month) => [month, summarizeSiTrades(decisions.filter((decision) => decision.date.startsWith(month)))]));
  const contractGates = [byContract.SiU5, byContract.SiZ5].every((summary) =>
    summary.trades > 0 && (summary.winRate ?? 0) >= 0.51 &&
    (summary.meanBaseNet ?? -1) > 0 && (summary.meanStressNet ?? -1) > 0 &&
    summary.sumBaseNet > 0 && (summary.profitFactor ?? 0) > 1 &&
    (summary.withoutBestDaySum ?? -1) > 0);
  const passesDevelopmentGate = combined.trades >= 100 && combined.signals >= 50 &&
    combined.noCandles === 0 && combined.cancelledEntry === 0 && combined.unresolvedExit === 0 &&
    (combined.winRate ?? 0) >= 0.51 && (combined.meanBaseNet ?? -1) > 0 &&
    combined.sumBaseNet > 0 && (combined.profitFactor ?? 0) > 1 &&
    (combined.meanStressNet ?? -1) > 0 && (combined.withoutBestDaySum ?? -1) > 0 && contractGates;
  const report = {
    protocolSha256: sha256(readFileSync(protocolPath)),
    source: 'MOEX ISS RFUD one-minute candles; cached raw pages, no T-Invest token',
    status: passesDevelopmentGate ? 'candidate-for-independent-check-only' : 'failed-or-insufficient-development-gate',
    costs: { commissionPerSide: 0.001, baseSlippagePerSide: 0.0005, stressSlippagePerSide: 0.001 },
    calendar: { verifiedNoSessionDates: [...verifiedNoSessionDates], source: 'https://www.moex.com/n94881' },
    combined, byContract, bySide, byMonth, sources, decisions,
  };
  writeReport(report);
  console.log(JSON.stringify({ status: report.status, combined, byContract, bySide, reportPath }));
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  main().catch((error: unknown) => {
    console.error(`Si research failed: ${error instanceof Error ? error.message : 'unknown failure'}`);
    process.exitCode = 1;
  });
}
